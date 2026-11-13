import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';
import { authenticator } from './support/authenticator.js';

const ORIGIN = 'https://crb.example.org';
const DAY = 86400000;
let server, base, store, webDir, dir, clock = Date.parse('2026-11-12T08:00:00Z');
const now = () => new Date(clock);

async function start(options = {}) {
  const s = createServer(store, { token: 'secret', webDir, url: ORIGIN, now, log: () => {}, sessionCheckMs: 100, ...options });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}
const stop = (s) => { for (const c of s.clients) c.end(); s.closeAllConnections(); s.close(); };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crb-auth-'));
  webDir = path.join(dir, 'web');
  fs.mkdirSync(webDir);
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>crb</title>');
  store = openDb(path.join(dir, 'dashboard.sqlite'));
  server = await start();
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { stop(server); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
// A fresh minute for the attempt limit, and no leftovers of the test before.
beforeEach(() => { clock += 61000; store.resetAuth(now()); });

/** POST to an auth route as a browser at the public address would. */
async function post(route, body = {}, { cookie, origin = ORIGIN, headers = {}, to = base } = {}) {
  const r = await fetch(`${to}/api/auth/${route}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...headers },
  });
  const set = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json(), set, cookie: set ? set.split(';')[0] : null, retry: r.headers.get('retry-after') };
}
const boxes = (cookie, to = base) => fetch(`${to}/api/boxes`, { headers: cookie ? { cookie } : {} });

async function enroll(key, secret = store.issueEnroll(now())) {
  const o = await post('enroll/options', { secret });
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return post('enroll/verify', { secret, id: o.body.id, response: key.create(o.body.options) });
}
async function signIn(key, extra = {}) {
  const o = await post('login/options');
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return post('login/verify', { id: o.body.id, response: key.get(o.body.options, extra) });
}

// --- Enrollment through a one-time link -------------------------------------

test('first passkey: the link creates it, signs the device in, and is spent', async () => {
  const key = authenticator({ origin: ORIGIN });
  const secret = store.issueEnroll(now());
  const r = await enroll(key, secret);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(store.passkeyCount(), 1);
  assert.equal((await boxes(r.cookie)).status, 200);
  const again = await post('enroll/options', { secret });
  assert.equal(again.status, 410);
  assert.equal(again.body.error, 'link invalid');
  assert.equal(store.passkeyCount(), 1);
});

test('the session cookie is HttpOnly, Secure, SameSite=Strict and lasts 30 days', async () => {
  const r = await enroll(authenticator({ origin: ORIGIN }));
  assert.match(r.set, /^crb_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$/);
});

test('an expired link creates nothing and says so', async () => {
  const secret = store.issueEnroll(now());
  clock += 11 * 60000;
  const r = await post('enroll/options', { secret });
  assert.equal(r.status, 410);
  assert.equal(r.body.error, 'link expired');
  assert.equal(store.passkeyCount(), 0);
});

test('an unknown link and a link replaced by a newer one are refused', async () => {
  const first = store.issueEnroll(now());
  store.issueEnroll(now());
  assert.equal((await post('enroll/options', { secret: first })).status, 410);
  assert.equal((await post('enroll/options', { secret: 'x'.repeat(43) })).status, 410);
  assert.equal((await post('enroll/options', {})).status, 410);
});

test('a cancelled enrollment leaves the link usable', async () => {
  const secret = store.issueEnroll(now());
  assert.equal((await post('enroll/options', { secret })).status, 200); // the device dialog is dismissed
  const r = await enroll(authenticator({ origin: ORIGIN }), secret);
  assert.equal(r.status, 200);
});

test('second device: its own passkey and session, the first stays signed in', async () => {
  const phone = await enroll(authenticator({ origin: ORIGIN }));
  const laptop = await enroll(authenticator({ origin: ORIGIN }));
  assert.equal(laptop.status, 200);
  assert.equal(store.passkeyCount(), 2);
  assert.notEqual(phone.cookie, laptop.cookie);
  assert.equal((await boxes(phone.cookie)).status, 200);
  assert.equal((await boxes(laptop.cookie)).status, 200);
});

test('a passkey without user verification is not accepted', async () => {
  const r = await enroll(authenticator({ origin: ORIGIN, userVerified: false }));
  assert.equal(r.status, 400);
  assert.equal(store.passkeyCount(), 0);
  assert.equal(r.set, null);
});

// --- Passkey sign-in --------------------------------------------------------

test('sign in with a known passkey starts a session', async () => {
  const key = authenticator({ origin: ORIGIN });
  await enroll(key);
  const r = await signIn(key);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await boxes(r.cookie)).status, 200);
});

test('signing in again while signed in leaves one valid session', async () => {
  const key = authenticator({ origin: ORIGIN });
  const first = (await enroll(key)).cookie;
  const o = await post('login/options', {}, { cookie: first });
  const again = await post('login/verify', { id: o.body.id, response: key.get(o.body.options) }, { cookie: first });
  assert.equal(again.status, 200);
  assert.notEqual(again.cookie, first);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM auth_sessions').get().c, 1);
  assert.equal((await boxes(first)).status, 401);
  assert.equal((await boxes(again.cookie)).status, 200);
});

test('a sign-in that is started but not completed creates no session', async () => {
  await enroll(authenticator({ origin: ORIGIN }));
  store.endAllSessions(now());
  const o = await post('login/options');
  assert.equal(o.status, 200);
  assert.equal(o.set, null);
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM auth_sessions').get().c, 0);
});

test('unknown passkey, removed passkey and wrong signature get the same refusal', async () => {
  const known = authenticator({ origin: ORIGIN });
  await enroll(known);
  const stranger = await signIn(authenticator({ origin: ORIGIN }));
  assert.equal(stranger.status, 401);
  assert.equal(stranger.set, null);
  const o = await post('login/options');
  const forged = known.get(o.body.options);
  forged.response.signature = authenticator({ origin: ORIGIN }).get(o.body.options).response.signature;
  const wrong = await post('login/verify', { id: o.body.id, response: forged });
  store.resetAuth(now());
  const removed = await signIn(known);
  assert.deepEqual([wrong.status, removed.status], [401, 401]);
  assert.deepEqual(wrong.body, stranger.body);
  assert.deepEqual(removed.body, stranger.body);
});

test('a challenge works once and only for the kind it was issued for', async () => {
  const key = authenticator({ origin: ORIGIN });
  await enroll(key);
  const o = await post('login/options');
  const response = key.get(o.body.options);
  assert.equal((await post('login/verify', { id: o.body.id, response })).status, 200);
  assert.equal((await post('login/verify', { id: o.body.id, response })).status, 401);
});

// --- Public address ---------------------------------------------------------

test('a response produced at another origin is refused', async () => {
  const key = authenticator({ origin: ORIGIN });
  await enroll(key);
  const r = await signIn(key, { from: 'https://evil.example.org' });
  assert.equal(r.status, 401);
  assert.equal(r.set, null);
});

test('a POST without the public address as Origin, or without JSON, is refused', async () => {
  assert.equal((await post('login/options', {}, { origin: 'https://evil.example.org' })).status, 403);
  assert.equal((await post('login/options', {}, { origin: null })).status, 403);
  assert.equal((await post('login/options', {}, { headers: { 'content-type': 'text/plain' } })).status, 403);
});

test('without a public address nothing can be enrolled or signed in and the data stays closed', async () => {
  const s = await start({ url: '' });
  const to = `http://127.0.0.1:${s.address().port}`;
  try {
    const secret = store.issueEnroll(now());
    assert.equal((await post('enroll/options', { secret }, { to })).status, 403);
    assert.equal((await post('login/options', {}, { to })).status, 403);
    assert.equal((await boxes(null, to)).status, 401);
    const state = await (await fetch(`${to}/api/auth/state`)).json();
    assert.deepEqual(state, { auth: 'on', signedIn: false, configured: false, passkeys: false, url: '' });
  } finally { stop(s); }
});

// --- Sessions and sign-out --------------------------------------------------

test('a session used yesterday still works after 20 days, one unused for 31 days does not', async () => {
  const r = await enroll(authenticator({ origin: ORIGIN }));
  clock += 19 * DAY;
  assert.equal((await boxes(r.cookie)).status, 200);
  clock += DAY;
  const used = await boxes(r.cookie);
  assert.equal(used.status, 200);
  assert.match(used.headers.get('set-cookie'), /Max-Age=2592000/, 'the cookie is sent again when its use was recorded');
  clock += 31 * DAY;
  assert.equal((await boxes(r.cookie)).status, 401);
  assert.equal((await (await fetch(`${base}/api/auth/state`, { headers: { cookie: r.cookie } })).json()).signedIn, false);
});

test('sign-out ends this browser only and clears its cookie', async () => {
  const phone = await enroll(authenticator({ origin: ORIGIN }));
  const laptop = await enroll(authenticator({ origin: ORIGIN }));
  const out = await post('logout', {}, { cookie: phone.cookie });
  assert.equal(out.status, 200);
  assert.match(out.set, /^crb_session=; Path=\/; Max-Age=0;/);
  assert.equal((await boxes(phone.cookie)).status, 401);
  assert.equal((await boxes(laptop.cookie)).status, 200);
  assert.equal((await post('logout', {}, { cookie: phone.cookie })).status, 401);
  assert.equal((await post('logout')).status, 401);
});

test('sessions and passkeys survive a restart', async () => {
  const key = authenticator({ origin: ORIGIN });
  const r = await enroll(key);
  const file = path.join(dir, 'dashboard.sqlite');
  const second = openDb(file);
  const s = createServer(second, { token: 'secret', webDir, url: ORIGIN, now, log: () => {} });
  await new Promise((done) => s.listen(0, '127.0.0.1', done));
  const to = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.equal((await boxes(r.cookie, to)).status, 200);
    const o = await post('login/options', {}, { to });
    assert.equal((await post('login/verify', { id: o.body.id, response: key.get(o.body.options) }, { to })).status, 200);
  } finally { stop(s); second.close(); }
});

test('the state route tells an anonymous caller only whether a passkey exists', async () => {
  const anonymous = async () => (await fetch(`${base}/api/auth/state`)).json();
  assert.deepEqual(await anonymous(), { auth: 'on', signedIn: false, configured: true, passkeys: false, url: ORIGIN });
  const r = await enroll(authenticator({ origin: ORIGIN }));
  await enroll(authenticator({ origin: ORIGIN }));
  assert.deepEqual(await anonymous(), { auth: 'on', signedIn: false, configured: true, passkeys: true, url: ORIGIN });
  assert.equal((await (await fetch(`${base}/api/auth/state`, { headers: { cookie: r.cookie } })).json()).signedIn, true);
});

// --- Limits on attempts -----------------------------------------------------

test('the eleventh attempt within a minute gets 429, another client is not affected', async () => {
  const s = await start({ proxy: '127.0.0.1' });
  const to = `http://127.0.0.1:${s.address().port}`;
  try {
    const from = (client) => ({ to, headers: { 'x-forwarded-for': client } });
    for (let i = 0; i < 10; i++) assert.equal((await post('login/options', {}, from('203.0.113.7'))).status, 200);
    const blocked = await post('login/options', {}, from('203.0.113.7'));
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.retry) >= 1 && Number(blocked.retry) <= 60);
    assert.equal((await post('login/options', {}, from('203.0.113.8'))).status, 200);
    assert.equal((await post('login/options', {}, from('198.51.100.1, 203.0.113.7'))).status, 429, 'the entry next to the proxy counts');
    clock += 61000;
    assert.equal((await post('login/options', {}, from('203.0.113.7'))).status, 200);
  } finally { stop(s); }
});

test('a forwarded address from a connection that is not the proxy is ignored', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await post('login/options', {}, { headers: { 'x-forwarded-for': `203.0.113.${i}` } })).status, 200);
  assert.equal((await post('login/options', {}, { headers: { 'x-forwarded-for': '203.0.113.99' } })).status, 429);
});

test('requests with a valid session are not limited', async () => {
  const r = await enroll(authenticator({ origin: ORIGIN }));
  for (let i = 0; i < 12; i++) assert.equal((await post('login/options', {}, { cookie: r.cookie })).status, 200);
});

// --- Host commands (server/admin.js) ----------------------------------------

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ADMIN = fileURLToPath(new URL('../server/admin.js', import.meta.url));
function admin(command, env = {}) {
  const r = spawnSync(process.execPath, [ADMIN, command], { env: { ...process.env, DATA_DIR: dir, CRB_DASHBOARD_URL: ORIGIN, ...env }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
}

test('admin enroll: the running server accepts the secret once', async () => {
  // The script uses the real clock; this test's server does too.
  const s = await start({ now: undefined });
  const to = `http://127.0.0.1:${s.address().port}`;
  try {
    const a = admin('enroll');
    assert.equal(a.status, 0, a.err);
    assert.deepEqual([a.out.passkeys, a.out.minutes, a.out.url, a.out.auth], [0, 10, ORIGIN, 'on']);
    const key = authenticator({ origin: ORIGIN });
    const o = await post('enroll/options', { secret: a.out.secret }, { to });
    assert.equal(o.status, 200);
    assert.equal((await post('enroll/verify', { secret: a.out.secret, id: o.body.id, response: key.create(o.body.options) }, { to })).status, 200);
    assert.equal((await post('enroll/options', { secret: a.out.secret }, { to })).status, 410);
    assert.equal(admin('enroll').out.passkeys, 1);
    assert.deepEqual(admin('status').out, { passkeys: 1, sessions: 1, url: ORIGIN, auth: 'on' });
  } finally { stop(s); }
});

test('admin logout: cookies stop working and open streams close within 6 seconds; passkeys stay', async () => {
  const s = await start({ now: undefined, sessionCheckMs: undefined });
  const to = `http://127.0.0.1:${s.address().port}`;
  try {
    const key = authenticator({ origin: ORIGIN });
    const a = admin('enroll');
    const o = await post('enroll/options', { secret: a.out.secret }, { to });
    const first = await post('enroll/verify', { secret: a.out.secret, id: o.body.id, response: key.create(o.body.options) }, { to });
    const o2 = await post('login/options', {}, { to });
    const second = await post('login/verify', { id: o2.body.id, response: key.get(o2.body.options) }, { to });
    assert.equal((await boxes(second.cookie, to)).status, 200);
    const sse = await fetch(`${to}/api/events`, { headers: { cookie: first.cookie } });
    const reader = sse.body.getReader();
    await reader.read(); // hello
    assert.deepEqual(admin('logout').out, { sessions: 2 });
    const t0 = Date.now();
    assert.equal((await boxes(first.cookie, to)).status, 401);
    assert.equal((await boxes(second.cookie, to)).status, 401);
    let done = false;
    while (!done) ({ done } = await reader.read());
    assert.ok(Date.now() - t0 < 6000, `stream closed after ${Date.now() - t0} ms`);
    const o3 = await post('login/options', {}, { to });
    assert.equal((await post('login/verify', { id: o3.body.id, response: key.get(o3.body.options) }, { to })).status, 200, 'the passkey still works');
  } finally { stop(s); }
});

test('admin reset: passkeys and sessions are gone', async () => {
  const s = await start({ now: undefined });
  const to = `http://127.0.0.1:${s.address().port}`;
  try {
    const key = authenticator({ origin: ORIGIN });
    const a = admin('enroll');
    const o = await post('enroll/options', { secret: a.out.secret }, { to });
    const r = await post('enroll/verify', { secret: a.out.secret, id: o.body.id, response: key.create(o.body.options) }, { to });
    assert.deepEqual(admin('reset').out, { passkeys: 1, sessions: 1 });
    assert.equal((await boxes(r.cookie, to)).status, 401);
    assert.deepEqual(admin('status').out, { passkeys: 0, sessions: 0, url: ORIGIN, auth: 'on' });
    assert.equal((await (await fetch(`${to}/api/auth/state`)).json()).passkeys, false);
  } finally { stop(s); }
});

test('admin: unknown command and missing database fail without output on stdout', () => {
  assert.equal(admin('nope').status, 2);
  const missing = admin('status', { DATA_DIR: path.join(dir, 'nowhere') });
  assert.equal(missing.status, 1);
  assert.equal(missing.out, null);
  assert.ok(!fs.existsSync(path.join(dir, 'nowhere')));
});
