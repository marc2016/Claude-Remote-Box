// Login: passkeys (WebAuthn) created through a one-time link from the host,
// a session cookie, and a limit on attempts. One user, no password.
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { LOGIN_DAYS } from './db.js';

export const COOKIE = 'crb_session';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 100;
const ATTEMPTS_PER_MINUTE = 10;
const MAX_CLIENTS = 10000;
const MAX_AUTH_BODY = 64 * 1024;
const ALGORITHMS = [-7, -257]; // ES256, RS256

/**
 * The public address as an origin, or '' when the value is not usable:
 * https without a path, or http://localhost for development.
 */
export function publicOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let u;
  try { u = new URL(value.trim()); } catch { return ''; }
  const local = u.protocol === 'http:' && u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !local) return '';
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return '';
  return u.origin;
}

const plainAddress = (a) => (typeof a === 'string' && a.startsWith('::ffff:') && net.isIPv4(a.slice(7)) ? a.slice(7) : a || '');

/** Reads CRB_DASHBOARD_PROXY: addresses and CIDR ranges, comma-separated. Unusable entries are returned in `bad`. */
export function proxyList(value) {
  const list = new net.BlockList();
  const bad = [];
  let size = 0;
  for (const raw of String(value || '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const [address, prefix] = entry.split('/');
    const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
    const bits = prefix === undefined ? null : Number(prefix);
    if (!family || (bits !== null && (!/^\d+$/.test(prefix) || bits > (family === 'ipv4' ? 32 : 128)))) { bad.push(entry); continue; }
    if (bits === null) list.addAddress(address, family); else list.addSubnet(address, bits, family);
    size++;
  }
  const has = (a) => { const p = plainAddress(a); return net.isIP(p) !== 0 && list.check(p, net.isIPv4(p) ? 'ipv4' : 'ipv6'); };
  return { has, size, bad };
}

/** Settings of the login from createServer options, with the environment as the default. */
export function authSettings(options = {}, env = process.env) {
  const rawUrl = options.url ?? env.CRB_DASHBOARD_URL ?? '';
  const url = publicOrigin(rawUrl);
  const proxy = proxyList(options.proxy ?? env.CRB_DASHBOARD_PROXY ?? '');
  return {
    on: (options.auth ?? env.CRB_DASHBOARD_AUTH ?? '') !== 'off',
    url,
    rpID: url ? new URL(url).hostname : '',
    invalidUrl: !url && String(rawUrl).trim() ? String(rawUrl).trim() : '',
    proxy,
    remoteIngest: (options.remoteIngest ?? env.CRB_DASHBOARD_REMOTE_INGEST ?? '') === '1' || options.remoteIngest === true,
  };
}

export function createAuth(store, settings, { now = () => new Date(), log = console.error } = {}) {
  const challenges = new Map(); // id -> { challenge, kind, expires }
  const attempts = new Map(); // client -> { start, n }
  let warnedForwarded = false;
  const userID = settings.rpID ? new Uint8Array(createHash('sha256').update(`crb-user:${settings.rpID}`).digest().subarray(0, 16)) : null;

  /** The client's address: the connection's, or what a listed proxy reports. */
  function clientOf(req) {
    const peer = plainAddress(req.socket.remoteAddress);
    const forwarded = req.headers['x-forwarded-for'];
    if (!forwarded) return peer;
    if (!settings.proxy.has(peer)) {
      if (!warnedForwarded) {
        warnedForwarded = true;
        log(`note: a request forwarded by ${peer} was counted under that address; add it to CRB_DASHBOARD_PROXY if it is your reverse proxy`);
      }
      return peer;
    }
    const hops = String(forwarded).split(',').map((h) => plainAddress(h.trim())).filter((h) => net.isIP(h) !== 0);
    for (let i = hops.length - 1; i >= 0; i--) if (!settings.proxy.has(hops[i])) return hops[i];
    return peer;
  }

  function limited(req) {
    const client = clientOf(req);
    const t = now().getTime();
    let a = attempts.get(client);
    if (!a || t - a.start >= 60000) {
      if (!a && attempts.size >= MAX_CLIENTS) attempts.delete(attempts.keys().next().value);
      a = { start: t, n: 0 };
      attempts.delete(client);
      attempts.set(client, a);
    }
    a.n++;
    return a.n > ATTEMPTS_PER_MINUTE ? Math.max(1, Math.ceil((a.start + 60000 - t) / 1000)) : 0;
  }

  function remember(challenge, kind) {
    const t = now().getTime();
    for (const [id, c] of challenges) if (c.expires <= t) challenges.delete(id);
    while (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value);
    const id = randomBytes(16).toString('base64url');
    challenges.set(id, { challenge, kind, expires: t + CHALLENGE_TTL_MS });
    return id;
  }

  function take(id, kind) {
    const c = typeof id === 'string' ? challenges.get(id) : null;
    if (!c) return null;
    challenges.delete(id);
    return c.kind === kind && c.expires > now().getTime() ? c.challenge : null;
  }

  const cookieValue = (req) => {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
    }
    return '';
  };
  const setCookie = (res, value) => res.setHeader('set-cookie',
    `${COOKIE}=${value}; Path=/; Max-Age=${value ? LOGIN_DAYS * 86400 : 0}; HttpOnly; Secure; SameSite=Strict`);

  /** The request's session, or null. Sends the cookie again when its last use was written. */
  function sessionOf(req, res) {
    const value = cookieValue(req);
    const s = value ? store.session(value, now()) : null;
    if (s && s.renewed && res && !res.headersSent) setCookie(res, value);
    return s;
  }

  /** True when the request may read box data. */
  const allowed = (req, res) => !settings.on || Boolean(sessionOf(req, res));

  function state(req, res) {
    if (!settings.on) return { auth: 'off', signedIn: true, configured: true, passkeys: false, url: '' };
    return { auth: 'on', signedIn: Boolean(sessionOf(req, res)), configured: Boolean(settings.url), passkeys: store.passkeyCount() > 0, url: settings.url };
  }

  /** Handles /api/auth/*; returns false when the path is not one of its routes. */
  async function handle(req, res, p, json) {
    if (req.method === 'GET' && p === '/api/auth/state') { json(res, 200, state(req, res)); return true; }
    const route = req.method === 'POST' && /^\/api\/auth\/(login\/options|login\/verify|enroll\/options|enroll\/verify|logout)$/.exec(p);
    if (!route || !settings.on) return false;
    if (!settings.url) { json(res, 403, { error: 'not configured' }); return true; }
    if (req.headers.origin !== settings.url || !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      json(res, 403, { error: 'wrong origin' });
      return true;
    }
    if (route[1] === 'logout') {
      const value = cookieValue(req);
      if (!value || !store.session(value, now())) { json(res, 401, { error: 'unauthorized' }); return true; }
      store.endSession(value);
      setCookie(res, '');
      json(res, 200, { ok: true });
      return true;
    }
    if (!sessionOf(req, null)) {
      const wait = limited(req);
      if (wait) { res.setHeader('retry-after', String(wait)); json(res, 429, { error: 'too many attempts' }); return true; }
    }
    let body;
    try { body = await readJson(req); } catch { json(res, 400, { error: 'invalid json' }); return true; }

    if (route[1] === 'login/options') {
      const options = await generateAuthenticationOptions({ rpID: settings.rpID, userVerification: 'required' });
      json(res, 200, { id: remember(options.challenge, 'login'), options });
      return true;
    }

    if (route[1] === 'login/verify') {
      const challenge = take(body.id, 'login');
      const credential = challenge && typeof body.response?.id === 'string' ? store.passkey(body.response.id) : null;
      let info = null;
      if (credential) {
        try {
          const v = await verifyAuthenticationResponse({
            response: body.response, expectedChallenge: challenge, expectedOrigin: settings.url, expectedRPID: settings.rpID,
            credential: { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports },
            requireUserVerification: true,
          });
          if (v.verified) info = v.authenticationInfo;
        } catch { /* refused below, with the same answer as every other failure */ }
      }
      if (!info) { json(res, 401, { error: 'sign-in failed' }); return true; }
      store.usedPasskey(credential.id, info.newCounter, now());
      setCookie(res, store.createSession(credential.id, now()));
      json(res, 200, { ok: true });
      return true;
    }

    // Enrollment: the link's secret is checked on both calls and spent only when the passkey is stored.
    const link = store.enrollState(body.secret, now());
    if (link !== 'ok') { json(res, 410, { error: link === 'expired' ? 'link expired' : 'link invalid' }); return true; }

    if (route[1] === 'enroll/options') {
      const options = await generateRegistrationOptions({
        rpName: 'claude-remote-box', rpID: settings.rpID, userName: 'claude-remote-box', userID,
        attestationType: 'none', supportedAlgorithmIDs: ALGORITHMS,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      json(res, 200, { id: remember(options.challenge, 'enroll'), options });
      return true;
    }

    const challenge = take(body.id, 'enroll');
    let info = null;
    if (challenge) {
      try {
        const v = await verifyRegistrationResponse({
          response: body.response, expectedChallenge: challenge, expectedOrigin: settings.url, expectedRPID: settings.rpID,
          requireUserVerification: true, supportedAlgorithmIDs: ALGORITHMS,
        });
        if (v.verified) info = v.registrationInfo;
      } catch { /* refused below */ }
    }
    if (!info || store.passkey(info.credential.id)) { json(res, 400, { error: 'passkey not accepted' }); return true; }
    store.addPasskey({
      id: info.credential.id, publicKey: info.credential.publicKey, counter: info.credential.counter,
      transports: body.response?.response?.transports, label: deviceLabel(req.headers['user-agent']),
    }, now());
    store.spendEnroll();
    setCookie(res, store.createSession(info.credential.id, now()));
    json(res, 200, { ok: true });
    return true;
  }

  return { settings, allowed, sessionOf, handle, clientOf };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_AUTH_BODY) { req.destroy(); reject(new Error('too large')); return; } body += c; });
    req.on('error', reject);
    req.on('end', () => {
      try {
        const v = body ? JSON.parse(body) : {};
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch (e) { reject(e); }
    });
  });
}

/** A short name for the device a passkey was created on, for the host's listing and logs. */
export function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  for (const [pattern, name] of [[/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Android/, 'Android'], [/Macintosh|Mac OS X/, 'Mac'], [/Windows/, 'Windows'], [/Linux/, 'Linux']]) {
    if (pattern.test(ua)) return name;
  }
  return 'Gerät';
}
