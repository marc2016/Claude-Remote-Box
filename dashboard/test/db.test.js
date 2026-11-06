import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { buildCards } from '../server/cards.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require_sqlite = () => createRequire(import.meta.url)('node:sqlite');

const T0 = Date.parse('2026-11-06T12:00:00Z');
const iso = (offsetS) => new Date(T0 + offsetS * 1000).toISOString();
let seq = 0;
const ev = (type, extra = {}) => ({ box: 'b1', ts: iso(seq), seq: ++seq, type, ...extra });

test('batch stores all events, replay stores none twice', () => {
  const store = openDb(':memory:');
  const batch = [ev('phase', { phase: 'running' }), ev('heartbeat', { phase: 'running', image: '0.3.0' }),
    ev('session_start', { session: 's1', cwd: '/workspace', branch: 'main', permission_mode: 'auto' }),
    ev('prompt', { session: 's1', text: 'Zeig mir die Startseite bitte' })];
  const changed = store.ingest(batch, new Date(T0));
  assert.deepEqual(changed, ['b1']);
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM events').get().c, 4);
  const again = store.ingest(batch, new Date(T0 + 1000));
  assert.deepEqual(again, []);
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM events').get().c, 4);
  const cards = buildCards(store, T0 + 5000);
  assert.equal(cards.boxes[0].up, true);
  assert.equal(cards.boxes[0].phase, 'running');
  assert.equal(cards.boxes[0].permission_mode, 'auto');
  assert.equal(cards.boxes[0].sessions[0].label, 'Zeig mir die Startseite bitte');
});

test('waiting is set by waiting and cleared by tool_result', () => {
  const store = openDb(':memory:');
  store.ingest([ev('session_start', { session: 's1' }), ev('tool', { session: 's1', tool: 'Bash', summary: 'npm test', call_id: 'c1' }),
    ev('waiting', { session: 's1', tool: 'Bash', summary: 'npm test', source: 'heuristic' })], new Date(T0));
  let s = buildCards(store, T0 + 15000).boxes[0].sessions[0];
  assert.equal(s.state, 'waiting');
  assert.equal(s.waiting_text, 'Bash: npm test');
  store.ingest([ev('tool_result', { session: 's1', call_id: 'c1', ok: true }), ev('resumed', { session: 's1' })], new Date(T0));
  s = buildCards(store, T0 + 20000).boxes[0].sessions[0];
  assert.equal(s.state, 'working');
  assert.equal(s.waiting_since, null);
});

test('derived states: down box, idle and ended sessions, summary totals', () => {
  const store = openDb(':memory:');
  store.ingest([ev('heartbeat', { phase: 'running' })], new Date(T0));
  store.ingest([ev('session_start', { session: 's1' }),
    ev('summary', { session: 's1', model: 'claude-opus-5-5', tokens_in: 47, tokens_out: 180, cache_read: 61100, cache_write: 600, context: 20705, turns: 3, tool_calls: 2, cost_usd: 0.42 }),
  ], new Date(T0));
  let cards = buildCards(store, T0 + 30000);
  assert.equal(cards.boxes[0].up, true);
  assert.equal(cards.boxes[0].sessions[0].state, 'working');
  assert.equal(cards.boxes[0].sessions[0].tokens_out, 180);
  assert.equal(cards.boxes[0].sessions[0].context_window, 200000);
  assert.equal(cards.boxes[0].sessions[0].cost_usd, 0.42);
  cards = buildCards(store, T0 + 120000);
  assert.equal(cards.boxes[0].up, false, 'no heartbeat for 2 min');
  assert.equal(cards.boxes[0].sessions[0].state, 'idle');
  store.ingest([ev('session_end', { session: 's1', reason: 'idle' })], new Date(T0));
  assert.equal(buildCards(store, T0 + 120000).boxes[0].sessions[0].state, 'ended');
});

test('waiting-setup box without sessions, git worktree picked by branch', () => {
  const store = openDb(':memory:');
  store.ingest([ev('phase', { phase: 'waiting-setup' }), ev('heartbeat', { phase: 'waiting-setup' })], new Date(T0));
  const b = buildCards(store, T0).boxes[0];
  assert.equal(b.phase, 'waiting-setup');
  assert.equal(b.sessions.length, 0);
  store.ingest([ev('session_start', { session: 's1', branch: 'feat', cwd: '/workspace/.wt/x' }),
    ev('git', { worktrees: [{ path: '/workspace', branch: 'main', ahead: 0, dirty: 0 }, { path: '/workspace/.wt/x', branch: 'feat', ahead: 2, dirty: 1, subject: 'Add nav' }] })], new Date(T0));
  const s = buildCards(store, T0).boxes[0].sessions[0];
  assert.equal(s.git.ahead, 2);
  assert.equal(s.git.subject, 'Add nav');
});

test('pruning removes old events and keeps recent sessions', () => {
  const store = openDb(':memory:');
  const old = new Date(T0 - 8 * 86400000).toISOString();
  const month = new Date(T0 - 30 * 86400000).toISOString();
  store.ingest([{ box: 'b1', seq: 1, ts: old, type: 'prompt', session: 'old', text: 'x' },
    { box: 'b1', seq: 2, ts: month, type: 'summary', session: 'old', turns: 1 },
    { box: 'b1', seq: 3, ts: iso(0), type: 'prompt', session: 'new', text: 'y' }], new Date(T0));
  const r = store.prune(new Date(T0));
  assert.equal(r.events, 2);
  assert.equal(r.sessions, 0, 'session 30 days old is kept');
  assert.equal(store.sessionEvents('new').length, 1);
  assert.equal(store.sessionEvents('old').length, 0);
});

test('last tool call is kept, old databases get the column', () => {
  const store = openDb(':memory:');
  store.ingest([ev('session_start', { session: 's1' }), ev('tool', { session: 's1', tool: 'Bash', summary: 'npm test', call_id: 'c1' })], new Date(T0));
  assert.equal(buildCards(store, T0).boxes[0].sessions[0].last_tool, 'Bash: npm test');
  // A database file from before the column existed gets it on open.
  const { DatabaseSync } = require_sqlite();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crb-db-')), 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, box TEXT NOT NULL, label TEXT, model TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
    cache_read INTEGER DEFAULT 0, cache_write INTEGER DEFAULT 0, context INTEGER DEFAULT 0, turns INTEGER DEFAULT 0, tool_calls INTEGER DEFAULT 0,
    started TEXT, last TEXT, last_activity TEXT, cost_usd REAL, lines_added INTEGER, lines_removed INTEGER, permission_mode TEXT, branch TEXT, cwd TEXT, git_json TEXT,
    waiting_since TEXT, waiting_text TEXT, ended_at TEXT, sidechain INTEGER DEFAULT 0)`);
  old.close();
  const upgraded = openDb(file);
  assert.ok(upgraded.db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'last_tool'));
  upgraded.ingest([ev('session_start', { session: 's9' }), ev('tool', { session: 's9', tool: 'Read', summary: '/x', call_id: 'c9' })], new Date(T0));
  assert.equal(buildCards(upgraded, T0).boxes[0].sessions[0].last_tool, 'Read: /x');
  upgraded.close();
});

test('session events page backwards with before', () => {
  const store = openDb(':memory:');
  const batch = [];
  for (let i = 1; i <= 500; i++) batch.push({ box: 'b1', seq: i, ts: iso(i), type: i % 2 ? 'prompt' : 'reply', session: 'big', text: `m${i}` });
  store.ingest(batch, new Date(T0));
  const newest = store.sessionEvents('big', 200);
  assert.equal(newest.length, 200);
  assert.equal(newest[0].seq, 301);
  assert.equal(newest[199].seq, 500);
  const older = store.sessionEvents('big', 200, null, 301);
  assert.equal(older.length, 200);
  assert.equal(older[0].seq, 101);
  assert.equal(older[199].seq, 300);
  assert.equal(store.sessionEvents('big', 200, null, 101).length, 100);
});

test('a new run with repeated sequence numbers is stored, old run replays are not', () => {
  const store = openDb(':memory:');
  const a = [{ box: 'b1', run: 'aaaa', seq: 1, ts: iso(0), type: 'heartbeat', phase: 'running' }, { box: 'b1', run: 'aaaa', seq: 2, ts: iso(1), type: 'phase', phase: 'running' }];
  assert.deepEqual(store.ingest(a, new Date(T0)), ['b1']);
  assert.deepEqual(store.ingest(a, new Date(T0 + 1000)), [], 'replay of the same run');
  const b = [{ box: 'b1', run: 'bbbb', seq: 1, ts: iso(200), type: 'heartbeat', phase: 'running' }];
  assert.deepEqual(store.ingest(b, new Date(T0 + 200000)), ['b1'], 'new run, same seq');
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM events').get().c, 3);
  assert.equal(buildCards(store, T0 + 230000).boxes[0].up, true, 'heartbeat of the new run counts');
  assert.deepEqual(store.ingest([{ box: 'b1', seq: 1, ts: iso(300), type: 'phase', phase: 'running' }], new Date(T0)), ['b1']);
  assert.deepEqual(store.ingest([{ box: 'b1', seq: 1, ts: iso(300), type: 'phase', phase: 'running' }], new Date(T0)), []);
});

test('old events table is rebuilt with the run column and keeps its rows', () => {
  const { DatabaseSync } = require_sqlite();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crb-db-')), 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE events (box TEXT NOT NULL, seq INTEGER NOT NULL, session TEXT, ts TEXT NOT NULL, type TEXT NOT NULL, json TEXT NOT NULL, received TEXT NOT NULL, PRIMARY KEY (box, seq));
    INSERT INTO events VALUES ('b1', 1, 's1', '${iso(0)}', 'prompt', '{"box":"b1","seq":1,"type":"prompt","session":"s1","text":"alt"}', '${iso(0)}');`);
  old.close();
  const store = openDb(file);
  assert.deepEqual(store.db.prepare('PRAGMA table_info(events)').all().map((c) => c.name), ['box', 'run', 'seq', 'session', 'ts', 'type', 'json', 'received']);
  assert.equal(store.sessionEvents('s1').length, 1);
  assert.equal(store.sessionEvents('s1')[0].id, 1);
  assert.deepEqual(store.ingest([{ box: 'b1', run: 'new1', seq: 1, ts: iso(5), type: 'prompt', session: 's1', text: 'neu' }], new Date(T0)), ['b1']);
  assert.equal(store.sessionEvents('s1').length, 2);
  store.close();
});

test('events outside the contract are stored but harmless', () => {
  const store = openDb(':memory:');
  store.ingest([ev('mystery', { session: 's1', foo: 1 }), { nonsense: true }, ev('prompt', { session: 's1', text: 'ok' })], new Date(T0));
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM events').get().c, 2);
  assert.equal(buildCards(store, T0).boxes[0].sessions[0].label, 'ok');
});
