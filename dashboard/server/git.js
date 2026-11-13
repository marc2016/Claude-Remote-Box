// Git actions: the page queues them, the host agent collects them and reports
// what became of them. The dashboard never runs Git and holds no credential.
import { createHash, timingSafeEqual } from 'node:crypto';
import { ACTION_KINDS } from './db.js';
import { validBranchName } from '../shared/model.js';

export const CONFIRM_MINUTES = 10;
const HOLD_MS = 25000;
const MAX_BODY = 64 * 1024;
const OUTCOMES = ['done', 'refused', 'failed'];

/** A branch name the dashboard stores: nothing a shell or the agent's line format could trip over. */
export const validName = validBranchName;

const digest = (v) => createHash('sha256').update(String(v)).digest();
const sameToken = (a, b) => timingSafeEqual(digest(a), digest(b));

/**
 * @param {import('./db.js').Store} store
 * @param {ReturnType<import('./auth.js').createAuth>} auth
 */
export function createGit(store, auth, { agentToken = '', now = () => new Date(), notify = () => {}, holdMs = HOLD_MS } = {}) {
  const waiting = new Set(); // held requests of the agent: { res, timer }

  /** Hands queued actions to held requests, oldest request first. */
  function serve() {
    for (const w of waiting) {
      const a = store.nextAction(now());
      if (!a) return;
      waiting.delete(w);
      clearTimeout(w.timer);
      sendAction(w.res, a);
      notify([a.box]);
    }
  }

  function sendAction(res, a) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    // "-" for an empty field: a shell that splits on tabs would swallow it otherwise.
    res.end([a.id, a.kind, a.box, a.branch || '-', a.name || '-', a.carry ? '1' : '0'].join('\t') + '\n');
  }

  /** Applies what time decided and tells open pages; called on a timer by the server. */
  function sweep() {
    const boxes = store.sweepActions(now());
    if (boxes.length) notify(boxes);
  }

  function state() {
    return { enabled: auth.settings.on, agent: store.agentState(now()), actions: auth.settings.on ? store.actions(50, now()) : [] };
  }

  /** Handles /api/git* and /api/agent/*; returns false when the path is none of its routes. */
  async function handle(req, res, p, json) {
    if (p.startsWith('/api/agent/')) return agent(req, res, p, json);
    if (req.method === 'GET' && p === '/api/git') {
      if (!auth.allowed(req, res)) json(res, 401, { error: 'unauthorized' });
      else json(res, 200, state());
      return true;
    }
    if (req.method !== 'POST' || p !== '/api/git/actions') return false;
    if (!auth.settings.on) { json(res, 403, { error: 'actions need the login' }); return true; }
    const session = auth.sessionOf(req, res);
    if (!session) { json(res, 401, { error: 'unauthorized' }); return true; }
    if (req.headers.origin !== auth.settings.url || !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      json(res, 403, { error: 'wrong origin' });
      return true;
    }
    if (now().getTime() - Date.parse(session.created) > CONFIRM_MINUTES * 60000) { json(res, 403, { error: 'confirm' }); return true; }
    let body;
    try { body = JSON.parse(await read(req)); } catch { json(res, 400, { error: 'invalid json' }); return true; }
    const action = parse(body);
    if (!action) { json(res, 400, { error: 'invalid action' }); return true; }
    if (!store.boxKnown(action.box)) { json(res, 400, { error: 'unknown box' }); return true; }
    if (!store.agentState(now()).present) { json(res, 503, { error: 'agent absent' }); return true; }
    const q = store.queueAction(action, now());
    if (q.full) { json(res, 429, { error: 'too many open actions' }); return true; }
    json(res, 202, { id: q.id, existing: Boolean(q.existing) });
    if (!q.existing) { notify([action.box]); serve(); }
    return true;
  }

  function parse(body) {
    if (!body || typeof body !== 'object' || typeof body.box !== 'string' || !body.box || body.box.length > 100) return null;
    if (!ACTION_KINDS.includes(body.kind)) return null;
    const a = { box: body.box, kind: body.kind, branch: '', name: '', carry: false };
    if (body.kind === 'push' || body.kind === 'pull' || body.kind === 'merge') {
      if (!validName(body.branch)) return null;
      a.branch = body.branch;
    } else if (body.kind === 'branch') {
      if (!validName(body.name)) return null;
      a.name = body.name;
      a.carry = body.carry === true;
    }
    return a;
  }

  async function agent(req, res, p, json) {
    const report = /^\/api\/agent\/actions\/([A-Za-z0-9_-]{1,40})$/.exec(p);
    if (req.method !== 'POST' || (p !== '/api/agent/next' && !report)) return false;
    // The agent is on the dashboard's machine; what a proxy forwards is never it.
    if (req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined) {
      res.setHeader('connection', 'close');
      json(res, 403, { error: 'not through a proxy' });
      return true;
    }
    const bearer = req.headers.authorization || '';
    if (!agentToken || !bearer.startsWith('Bearer ') || !sameToken(bearer.slice(7), agentToken)) { json(res, 401, { error: 'unauthorized' }); return true; }

    if (report) {
      let body;
      try { body = await read(req); } catch { json(res, 400, { error: 'too large' }); return true; }
      const nl = body.indexOf('\n');
      const outcome = (nl < 0 ? body : body.slice(0, nl)).trim();
      if (!OUTCOMES.includes(outcome)) { json(res, 400, { error: 'unknown outcome' }); return true; }
      const box = store.finishAction(report[1], outcome, nl < 0 ? '' : body.slice(nl + 1), now());
      if (!box) { json(res, 409, { error: 'not running' }); return true; }
      res.writeHead(204); res.end();
      notify([box]);
      return true;
    }

    req.resume();
    if (store.agentSeen(now())) notify([]);
    const a = store.nextAction(now());
    if (a) { sendAction(res, a); notify([a.box]); return true; }
    const w = { res, timer: null };
    w.timer = setTimeout(() => { waiting.delete(w); res.writeHead(204); res.end(); }, holdMs);
    waiting.add(w);
    res.on('close', () => { clearTimeout(w.timer); waiting.delete(w); });
    return true;
  }

  function close() {
    for (const w of waiting) { clearTimeout(w.timer); w.res.end(); }
    waiting.clear();
  }

  return { handle, sweep, state, close };
}

function read(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); reject(new Error('too large')); return; } body += c; });
    req.on('error', reject);
    req.on('end', () => resolve(body));
  });
}
