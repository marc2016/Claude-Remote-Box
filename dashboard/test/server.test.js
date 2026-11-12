import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createServer } from '../server/index.js';

let server, base, store, webDir;

before(async () => {
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crb-web-'));
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>crb</title>');
  store = openDb(':memory:');
  server = createServer(store, { token: 'secret', webDir, auth: 'off' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { for (const c of server.clients) c.end(); server.closeAllConnections(); server.close(); store.close(); fs.rmSync(webDir, { recursive: true, force: true }); });

const post = (body, token = 'secret') => fetch(`${base}/api/ingest`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('wrong or missing token gives 401 and stores nothing', async () => {
  assert.equal((await post([{ box: 'x', seq: 1, type: 'phase', ts: new Date().toISOString() }], 'nope')).status, 401);
  assert.equal((await post([{ box: 'x', seq: 1, type: 'phase', ts: new Date().toISOString() }], '')).status, 401);
  assert.equal((await (await fetch(`${base}/api/boxes`)).json()).boxes.length, 0);
});

test('bad bodies give 400', async () => {
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post({ box: 'x' })).status, 400);
});

test('valid batch gives 204, boxes show derived state, SSE fires within a second', async () => {
  const sse = await fetch(`${base}/api/events`, { headers: { accept: 'text/event-stream' } });
  const reader = sse.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let pendingRead = null; // one read at a time, so a timed-out race does not lose a chunk
  const readUntil = async (pat, ms) => {
    const deadline = Date.now() + ms;
    while (!buf.includes(pat) && Date.now() < deadline) {
      pendingRead ??= reader.read();
      const r = await Promise.race([pendingRead, new Promise((res) => setTimeout(() => res(null), 200))]);
      if (r === null) continue;
      pendingRead = null;
      if (r.done) break;
      buf += dec.decode(r.value);
    }
    return buf.includes(pat);
  };
  assert.ok(await readUntil('event: hello', 2000));

  const now = new Date().toISOString();
  const twoMinAgo = new Date(Date.now() - 120000).toISOString();
  const batch = [
    { box: 'up', seq: 1, ts: now, type: 'heartbeat', phase: 'running', image: '0.3.0', spawn: 'worktree' },
    { box: 'up', seq: 2, ts: now, type: 'session_start', session: 's1', permission_mode: 'auto' },
    { box: 'up', seq: 3, ts: now, type: 'tool', session: 's1', tool: 'Bash', summary: 'npm test', call_id: 'c1' },
    { box: 'up', seq: 4, ts: now, type: 'waiting', session: 's1', tool: 'Bash', summary: 'npm test', source: 'heuristic' },
    { box: 'setup', seq: 1, ts: now, type: 'phase', phase: 'waiting-setup' },
    { box: 'setup', seq: 2, ts: now, type: 'heartbeat', phase: 'waiting-setup' },
  ];
  const t = Date.now();
  const r = await post(batch);
  assert.equal(r.status, 204);
  assert.ok(await readUntil('event: changed', 1500), 'SSE changed within 1 s');
  assert.ok(Date.now() - t < 1500);
  assert.ok(buf.includes('"up"') && buf.includes('"setup"'));

  // A box whose heartbeat is old: stored with an old receipt time by writing directly.
  store.ingest([{ box: 'down', seq: 1, ts: twoMinAgo, type: 'heartbeat', phase: 'running' }], new Date(Date.now() - 120000));

  const boxes = (await (await fetch(`${base}/api/boxes`)).json()).boxes;
  const by = Object.fromEntries(boxes.map((b) => [b.name, b]));
  assert.equal(by.up.up, true);
  assert.equal(by.up.sessions[0].state, 'waiting');
  assert.equal(by.up.sessions[0].waiting_text, 'Bash: npm test');
  assert.equal(by.up.permission_mode, 'auto');
  assert.equal(by.down.up, false);
  assert.equal(by.setup.phase, 'waiting-setup');
  assert.equal(by.setup.sessions.length, 0);

  const ev = await (await fetch(`${base}/api/sessions/s1/events?limit=10`)).json();
  assert.deepEqual(ev.events.map((e) => e.type), ['tool', 'waiting']);

  // Replay: 204, nothing new, no second SSE message needed.
  assert.equal((await post(batch)).status, 204);
  reader.cancel();
});

test('static files and SPA fallback', async () => {
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /crb/);
  const deep = await fetch(`${base}/some/route`);
  assert.equal(deep.status, 200);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/../etc/passwd`)).status, 200, 'normalized to index');
});

// --- Login on: guard, ingest through a proxy, headers ------------------------

import { publicOrigin, proxyList, authSettings } from '../server/auth.js';

/** A second server on its own database with the login on. */
async function locked(options = {}) {
  const db = openDb(':memory:');
  const s = createServer(db, { token: 'secret', webDir, url: 'https://crb.example.org', log: () => {}, sessionCheckMs: 100, ...options });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const to = `http://127.0.0.1:${s.address().port}`;
  db.addPasskey({ id: 'cred-1', publicKey: new Uint8Array([1]) });
  const cookie = `crb_session=${db.createSession('cred-1')}`;
  const close = () => { for (const c of s.clients) c.end(); s.closeAllConnections(); s.close(); db.close(); };
  return { db, to, cookie, close };
}
const batch = (seq = 1) => [{ box: 'locked', seq, type: 'prompt', session: 's1', text: 'geheim', ts: new Date().toISOString() }];
const ingest = (to, headers = {}, seq = 1) => fetch(`${to}/api/ingest`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret', ...headers }, body: JSON.stringify(batch(seq)),
});

test('login on: read routes give 401 without a session and with the ingest token, and no data', async () => {
  const { to, close } = await locked();
  try {
    assert.equal((await ingest(to)).status, 204, 'ingest needs no session');
    for (const p of ['/api/boxes', '/api/sessions/s1/events', '/api/events']) {
      for (const headers of [{}, { authorization: 'Bearer secret' }, { cookie: 'crb_session=nope' }]) {
        const r = await fetch(to + p, { headers });
        assert.equal(r.status, 401, `${p} ${JSON.stringify(headers)}`);
        const text = await r.text();
        assert.ok(!text.includes('geheim') && !text.includes('locked'), 'no data in the refusal');
      }
    }
    assert.equal((await fetch(`${to}/api/health`)).status, 200);
    assert.equal((await fetch(`${to}/`)).status, 200, 'the page shell is served');
  } finally { close(); }
});

test('login on: a session reads boxes, events, and gets live updates', async () => {
  const { to, cookie, close } = await locked();
  try {
    const sse = await fetch(`${to}/api/events`, { headers: { cookie } });
    assert.equal(sse.status, 200);
    const reader = sse.body.getReader();
    await reader.read(); // hello
    const t0 = Date.now();
    await ingest(to);
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /event: changed/);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal((await (await fetch(`${to}/api/boxes`, { headers: { cookie } })).json()).boxes[0].name, 'locked');
    assert.equal((await (await fetch(`${to}/api/sessions/s1/events`, { headers: { cookie } })).json()).events[0].text, 'geheim');
    await reader.cancel();
  } finally { close(); }
});

test('login on: an open stream is closed when its session ends and delivers nothing more', async () => {
  const { db, to, cookie, close } = await locked();
  try {
    const sse = await fetch(`${to}/api/events`, { headers: { cookie } });
    const reader = sse.body.getReader();
    await reader.read(); // hello
    db.endAllSessions();
    const t0 = Date.now();
    let closed = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { closed = true; break; }
      assert.ok(!new TextDecoder().decode(value).includes('changed'));
    }
    assert.ok(closed && Date.now() - t0 < 2000, 'closed by the server');
    await ingest(to);
    assert.equal((await fetch(`${to}/api/events`, { headers: { cookie } })).status, 401);
  } finally { close(); }
});

test('ingest forwarded by a proxy gets 403 and stores nothing, unless remote boxes are enabled', async () => {
  const { db, to, close } = await locked();
  try {
    for (const headers of [{ 'x-forwarded-for': '203.0.113.7' }, { forwarded: 'for=203.0.113.7' }]) {
      assert.equal((await ingest(to, headers)).status, 403);
    }
    assert.equal(db.db.prepare('SELECT COUNT(*) c FROM events').get().c, 0);
  } finally { close(); }
  const remote = await locked({ remoteIngest: '1' });
  try {
    assert.equal((await ingest(remote.to, { 'x-forwarded-for': '203.0.113.7' })).status, 204);
    assert.equal(remote.db.db.prepare('SELECT COUNT(*) c FROM events').get().c, 1);
    assert.equal((await ingest(remote.to, { 'x-forwarded-for': '203.0.113.7', authorization: 'Bearer nope' }, 2)).status, 401);
  } finally { remote.close(); }
});

test('every response forbids framing and sniffing and sends no referrer', async () => {
  const { to, close } = await locked();
  try {
    for (const p of ['/', '/index.html', '/api/boxes', '/api/health', '/api/auth/state', '/api/nope']) {
      const r = await fetch(to + p);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer', p);
      assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
      assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'none'", p);
      await r.arrayBuffer();
    }
  } finally { close(); }
});

test('login off: the read API is open and the state says so', async () => {
  assert.equal((await fetch(`${base}/api/boxes`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/auth/state`)).json(), { auth: 'off', signedIn: true, configured: true, passkeys: false, url: '' });
  const r = await fetch(`${base}/api/auth/login/options`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 404);
});

test('settings: only off turns the login off; the public address must be an https origin', () => {
  assert.equal(authSettings({}, {}).on, true);
  assert.equal(authSettings({}, { CRB_DASHBOARD_AUTH: 'on' }).on, true);
  assert.equal(authSettings({}, { CRB_DASHBOARD_AUTH: 'OFF' }).on, true);
  assert.equal(authSettings({}, { CRB_DASHBOARD_AUTH: 'off' }).on, false);
  assert.equal(publicOrigin('https://crb.example.org'), 'https://crb.example.org');
  assert.equal(publicOrigin('https://crb.example.org/'), 'https://crb.example.org');
  assert.equal(publicOrigin('https://crb.example.org:8443'), 'https://crb.example.org:8443');
  assert.equal(publicOrigin('http://localhost:5173'), 'http://localhost:5173');
  for (const bad of ['', 'crb.example.org', 'http://crb.example.org', 'https://crb.example.org/dash', 'https://crb.example.org/?a=1', 'https://user@crb.example.org', 'ftp://crb.example.org', 'http://127.0.0.1:8080']) {
    assert.equal(publicOrigin(bad), '', bad);
  }
  const s = authSettings({}, { CRB_DASHBOARD_URL: 'http://crb.example.org' });
  assert.deepEqual([s.url, s.rpID, s.invalidUrl], ['', '', 'http://crb.example.org']);
  assert.equal(authSettings({}, { CRB_DASHBOARD_URL: 'https://crb.example.org' }).rpID, 'crb.example.org');
  assert.equal(authSettings({}, { CRB_DASHBOARD_REMOTE_INGEST: '1' }).remoteIngest, true);
  assert.equal(authSettings({}, { CRB_DASHBOARD_REMOTE_INGEST: 'yes' }).remoteIngest, false);
});

test('settings: the proxy list takes addresses and ranges and reports unusable entries', () => {
  const list = proxyList('10.0.5.2, 192.168.7.0/24 ,fd00::/8,nonsense,10.0.0.0/40');
  assert.deepEqual([list.has('10.0.5.2'), list.has('::ffff:10.0.5.2'), list.has('10.0.5.3'), list.has('192.168.7.99'), list.has('fd00::1'), list.has('')], [true, true, false, true, true, false]);
  assert.deepEqual(list.bad, ['nonsense', '10.0.0.0/40']);
  assert.equal(proxyList('').size, 0);
});
