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
  server = createServer(store, { token: 'secret', webDir });
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
