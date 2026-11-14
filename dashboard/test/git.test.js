import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';
import { authenticator } from './support/authenticator.js';

const ORIGIN = 'https://crb.example.org';
const AGENT = 'agent-token-0123456789abcdef0123456789';
let server, base, store, webDir, dir, cookie, key, clock = Date.parse('2026-11-13T08:00:00Z');
const now = () => new Date(clock);

async function start(options = {}) {
  const s = createServer(store, { token: 'status-token', agentToken: AGENT, webDir, url: ORIGIN, now, log: () => {}, holdMs: 400, sweepMs: 50, ...options });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}
const stop = (s) => { for (const c of s.clients) c.end(); s.closeAllConnections(); s.close(); };

const authPost = async (route, body, c) => {
  const r = await fetch(`${base}/api/auth/${route}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: ORIGIN, ...(c ? { cookie: c } : {}) } });
  const set = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json(), cookie: set ? set.split(';')[0] : null };
};
async function signIn(c) {
  const o = await authPost('login/options', {}, c);
  return authPost('login/verify', { id: o.body.id, response: key.get(o.body.options) }, c);
}

/** Queues as the page at the public address would. */
async function queue(body, { c = cookie, origin = ORIGIN, type = 'application/json', to = base } = {}) {
  const r = await fetch(`${to}/api/git/actions`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': type, ...(origin ? { origin } : {}), ...(c ? { cookie: c } : {}) } });
  return { status: r.status, body: await r.json() };
}
const gitState = async (c = cookie, to = base) => { const r = await fetch(`${to}/api/git`, { headers: c ? { cookie: c } : {} }); return { status: r.status, body: await r.json() }; };
/** The agent asks for work. */
async function next({ token = AGENT, headers = {}, to = base } = {}) {
  const r = await fetch(`${to}/api/agent/next`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...headers } });
  return { status: r.status, text: await r.text() };
}
async function report(id, body, { token = AGENT, headers = {} } = {}) {
  const r = await fetch(`${base}/api/agent/actions/${id}`, { method: 'POST', body, headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain', ...headers } });
  return r.status;
}
const count = () => store.db.prepare('SELECT COUNT(*) AS c FROM git_actions').get().c;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crb-git-'));
  webDir = path.join(dir, 'web');
  fs.mkdirSync(webDir);
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>crb</title>');
  store = openDb(path.join(dir, 'dashboard.sqlite'));
  store.ingest([{ box: 'flashagenda', ts: now().toISOString(), seq: 1, type: 'heartbeat', phase: 'running' }], now());
  server = await start();
  base = `http://127.0.0.1:${server.address().port}`;
  key = authenticator({ origin: ORIGIN });
  const secret = store.issueEnroll(now());
  const o = await authPost('enroll/options', { secret });
  const done = await authPost('enroll/verify', { secret, id: o.body.id, response: key.create(o.body.options) });
  assert.equal(done.status, 200, JSON.stringify(done.body));
});
after(() => { stop(server); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
// Every test starts with a fresh sign-in, a present agent, and no actions.
beforeEach(async () => {
  clock += 61000;
  store.db.exec('DELETE FROM git_actions; DELETE FROM auth_sessions;');
  cookie = (await signIn()).cookie;
  assert.ok(cookie);
  store.agentSeen(now());
});

// --- Queuing --------------------------------------------------------------------

test('a push is queued and listed', async () => {
  const q = await queue({ box: 'flashagenda', kind: 'push', branch: 'calm-clock' });
  assert.equal(q.status, 202);
  assert.ok(q.body.id);
  const g = await gitState();
  assert.equal(g.status, 200);
  assert.equal(g.body.enabled, true);
  assert.equal(g.body.agent.present, true);
  assert.deepEqual(g.body.actions.map((a) => [a.id, a.box, a.kind, a.branch, a.state]), [[q.body.id, 'flashagenda', 'push', 'calm-clock', 'queued']]);
});

test('the same action twice is stored once', async () => {
  const a = await queue({ box: 'flashagenda', kind: 'push', branch: 'calm-clock' });
  const b = await queue({ box: 'flashagenda', kind: 'push', branch: 'calm-clock' });
  assert.equal(b.status, 202);
  assert.equal(b.body.id, a.body.id);
  assert.equal(count(), 1);
});

test('bad names, unknown kinds and unknown boxes are refused and nothing is stored', async () => {
  for (const body of [
    { box: 'flashagenda', kind: 'branch', name: 'x; rm -rf /' },
    { box: 'flashagenda', kind: 'branch', name: '-x' },
    { box: 'flashagenda', kind: 'branch', name: 'a\tb' },
    { box: 'flashagenda', kind: 'branch', name: 'x'.repeat(101) },
    { box: 'flashagenda', kind: 'branch' },
    { box: 'flashagenda', kind: 'push' },
    { box: 'flashagenda', kind: 'push', branch: 'a b' },
    { box: 'flashagenda', kind: 'delete', branch: 'main' },
    { box: 'nope', kind: 'fetch' },
    { kind: 'fetch' },
    [],
  ]) assert.equal((await queue(body)).status, 400, JSON.stringify(body));
  assert.equal(count(), 0);
});

test('every kind is accepted with what it needs; carry only for a branch', async () => {
  for (const body of [
    { box: 'flashagenda', kind: 'fetch' }, { box: 'flashagenda', kind: 'sync' },
    { box: 'flashagenda', kind: 'pull', branch: 'main' }, { box: 'flashagenda', kind: 'merge', branch: 'feature/nav' },
    { box: 'flashagenda', kind: 'branch', name: 'rescue', carry: true },
  ]) assert.equal((await queue(body)).status, 202, JSON.stringify(body));
  const stored = (await gitState()).body.actions;
  assert.equal(stored.find((a) => a.kind === 'branch').carry, true);
  assert.equal(stored.find((a) => a.kind === 'branch').name, 'rescue');
  assert.equal(stored.find((a) => a.kind === 'merge').carry, false);
});

test('20 open actions are the limit', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await queue({ box: 'flashagenda', kind: 'push', branch: `b${i}` })).status, 202);
  assert.equal((await queue({ box: 'flashagenda', kind: 'push', branch: 'one-more' })).status, 429);
});

// --- Who may queue ----------------------------------------------------------------

test('without a session: 401 for queuing and for the list', async () => {
  assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' }, { c: null })).status, 401);
  assert.equal((await gitState(null)).status, 401);
  assert.equal(count(), 0);
});

test('another origin or a form post is refused', async () => {
  assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' }, { origin: null })).status, 403);
  assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' }, { type: 'text/plain' })).status, 403);
  assert.equal(count(), 0);
});

test('a sign-in older than ten minutes has to be confirmed; the confirmation leaves one session', async () => {
  clock += 9 * 60000;
  store.agentSeen(now());
  assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' })).status, 202);
  clock += 2 * 60000;
  store.agentSeen(now());
  const late = await queue({ box: 'flashagenda', kind: 'sync' });
  assert.equal(late.status, 403);
  assert.equal(late.body.error, 'confirm');
  assert.equal(count(), 1);

  const old = cookie;
  const again = await signIn(old);
  assert.equal(again.status, 200);
  assert.ok(again.cookie && again.cookie !== old);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM auth_sessions').get().c, 1, 'one valid session');
  assert.equal((await gitState(old)).status, 401, 'the old cookie stops working');
  assert.equal((await queue({ box: 'flashagenda', kind: 'sync' }, { c: again.cookie })).status, 202);
});

test('with the login off nothing can be queued and the list says so', async () => {
  const off = await start({ auth: 'off' });
  const to = `http://127.0.0.1:${off.address().port}`;
  try {
    assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' }, { to })).status, 403);
    const g = await gitState(null, to);
    assert.equal(g.status, 200);
    assert.equal(g.body.enabled, false);
    assert.deepEqual(g.body.actions, []);
    assert.equal(count(), 0);
  } finally { stop(off); }
});

test('while the agent is absent queuing is answered with 503', async () => {
  clock += 91000;
  cookie = (await signIn(cookie)).cookie;
  const g = await gitState();
  assert.deepEqual([g.body.agent.seen, g.body.agent.present], [true, false]);
  assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' })).status, 503);
  assert.equal(count(), 0);
  assert.equal((await next()).status, 204, 'the agent returns');
  assert.equal((await gitState()).body.agent.present, true);
  assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' })).status, 202);
});

test('a dashboard no agent ever contacted reports that', async () => {
  store.db.exec('DELETE FROM agent_state');
  assert.deepEqual((await gitState()).body.agent, { seen: false, present: false, at: null });
  assert.equal((await queue({ box: 'flashagenda', kind: 'fetch' })).status, 503);
});

// --- Agent access -------------------------------------------------------------------

test('the agent collects an action once, as one tab-separated line, oldest first', async () => {
  const a = await queue({ box: 'flashagenda', kind: 'merge', branch: 'calm-clock' });
  const b = await queue({ box: 'flashagenda', kind: 'branch', name: 'rescue', carry: true });
  const first = await next();
  assert.equal(first.status, 200);
  assert.equal(first.text, `${a.body.id}\tmerge\tflashagenda\tcalm-clock\t-\t0\n`);
  assert.equal((await next()).text, `${b.body.id}\tbranch\tflashagenda\t-\trescue\t1\n`);
  assert.equal((await next()).status, 204);
  assert.deepEqual((await gitState()).body.actions.map((x) => x.state), ['running', 'running']);
});

test('a held request is answered as soon as an action is queued', async () => {
  const held = next();
  await new Promise((r) => setTimeout(r, 80));
  const t0 = Date.now();
  const q = await queue({ box: 'flashagenda', kind: 'fetch' });
  const got = await held;
  assert.ok(Date.now() - t0 < 100, `answered after ${Date.now() - t0} ms`);
  assert.equal(got.text.split('\t')[0], q.body.id);
});

test('a held request ends with 204 when the dashboard shuts down', async () => {
  const s = await start({ holdMs: 5000 });
  const held = next({ to: `http://127.0.0.1:${s.address().port}` });
  await new Promise((r) => setTimeout(r, 80));
  s.git.close();
  const got = await held;
  stop(s);
  assert.equal(got.status, 204);
  assert.equal(got.text, '');
});

test('the boxes\' token, no token, a session cookie and an empty agent token are refused', async () => {
  await queue({ box: 'flashagenda', kind: 'fetch' });
  assert.equal((await next({ token: 'status-token' })).status, 401);
  assert.equal((await next({ token: '' })).status, 401);
  const r = await fetch(`${base}/api/agent/next`, { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 401);
  assert.equal((await gitState()).body.actions[0].state, 'queued', 'the action stays queued');
  const bare = await start({ agentToken: '' });
  try {
    const to = `http://127.0.0.1:${bare.address().port}`;
    assert.equal((await next({ to })).status, 401);
    assert.equal((await next({ to, token: '' })).status, 401);
    assert.equal((await fetch(`${to}/api/agent/actions/x`, { method: 'POST', body: 'done\n', headers: { authorization: 'Bearer ' } })).status, 401);
  } finally { stop(bare); }
});

test('agent routes cannot be reached through a proxy', async () => {
  const q = await queue({ box: 'flashagenda', kind: 'fetch' });
  assert.equal((await next({ headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 403);
  assert.equal((await next({ headers: { forwarded: 'for=203.0.113.9' } })).status, 403);
  assert.equal(await report(q.body.id, 'done\n', { headers: { 'x-forwarded-for': '203.0.113.9' } }), 403);
  assert.equal((await gitState()).body.actions[0].state, 'queued');
});

// --- Life of an action ---------------------------------------------------------------

test('an outcome is stored once and reaches open pages through the stream', async () => {
  const q = await queue({ box: 'flashagenda', kind: 'push', branch: 'calm-clock' });
  await next();
  const stream = await fetch(`${base}/api/events`, { headers: { cookie } });
  const reader = stream.body.getReader();
  await reader.read(); // hello
  const t0 = Date.now();
  assert.equal(await report(q.body.id, 'done\n✓ calm-clock 2 gepusht\n'), 204);
  let seen = '';
  while (!seen.includes('event: changed')) seen += new TextDecoder().decode((await reader.read()).value);
  assert.ok(Date.now() - t0 < 2000);
  assert.match(seen, /"boxes":\["flashagenda"\]/);
  await reader.cancel();
  const a = (await gitState()).body.actions[0];
  assert.deepEqual([a.state, a.text], ['done', '✓ calm-clock 2 gepusht']);
  assert.ok(a.finished);
  assert.equal(await report(q.body.id, 'failed\nagain\n'), 409);
  assert.equal((await gitState()).body.actions[0].state, 'done');
});

test('outcomes for unknown or queued actions and unknown outcomes are rejected', async () => {
  const q = await queue({ box: 'flashagenda', kind: 'fetch' });
  assert.equal(await report(q.body.id, 'done\n'), 409, 'not collected yet');
  assert.equal(await report('nope', 'done\n'), 409);
  await next();
  assert.equal(await report(q.body.id, 'perfect\n'), 400);
  assert.equal(await report(q.body.id, 'refused\nBranch x gibt es nicht.'), 204);
  assert.equal((await gitState()).body.actions[0].state, 'refused');
});

test('an action nobody collects expires; one without an answer fails', async () => {
  const a = await queue({ box: 'flashagenda', kind: 'fetch' });
  clock += 121000;
  await new Promise((r) => setTimeout(r, 120)); // the server's sweep
  assert.equal(store.db.prepare('SELECT state FROM git_actions WHERE id = ?').get(a.body.id).state, 'expired');
  assert.equal((await next()).status, 204, 'an agent started afterwards does not get it');

  cookie = (await signIn(cookie)).cookie;
  const b = await queue({ box: 'flashagenda', kind: 'sync' });
  await next();
  clock += 601000;
  cookie = (await signIn(cookie)).cookie;
  const failed = (await gitState()).body.actions.find((x) => x.id === b.body.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.text, /nicht geantwortet/);
});
