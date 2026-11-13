import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { buildCards } from '../server/cards.js';
import { gitStateParts, gitSummary } from '../shared/model.js';
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

test('git state of a box: checkouts, fetch time, old shapes', () => {
  const store = openDb(':memory:');
  const fetched = iso(-300);
  store.ingest([ev('heartbeat', { phase: 'running' }),
    ev('session_start', { session: 's1', branch: 'feat', cwd: '/workspace/.wt/x' }),
    ev('git', { fetched_at: fetched, worktrees: [
      { path: '/workspace/.wt/x', branch: 'feat', ahead: 2, dirty: 1, remote: 'ok', upstream: 'origin/feat', unpushed: 2, behind: 0 },
      { path: '/workspace', branch: 'main', ahead: 0, dirty: 0, remote: 'ok', upstream: 'origin/main', unpushed: 0, behind: 3 },
      { path: '/workspace/.wt/y', branch: 'fresh', ahead: 1, dirty: 0, remote: 'none', upstream: null, unpushed: null, behind: null }] })], new Date(T0));
  let b = buildCards(store, T0).boxes[0];
  assert.equal(b.git.fetched_at, fetched);
  assert.deepEqual(b.git.worktrees.map((w) => w.branch), ['main', 'feat', 'fresh'], 'workspace first, then as reported');
  assert.equal(b.git.worktrees[0].behind, 3);
  assert.equal(b.sessions[0].git.unpushed, 2);
  assert.equal(b.sessions[0].git.remote, 'ok');

  assert.equal(b.git.default_branch, null, 'a box that does not report the default branch');
  assert.equal(b.sessions[0].git.behind_default, undefined);

  // Distance to the default branch, as newer boxes report it.
  store.ingest([ev('git', { fetched_at: fetched, default_branch: 'main', worktrees: [
    { path: '/workspace', branch: 'main', ahead: 0, dirty: 0, remote: 'ok', upstream: 'origin/main', unpushed: 0, behind: 0, behind_default: 0 },
    { path: '/workspace/.wt/x', branch: 'feat', ahead: 2, dirty: 1, remote: 'ok', upstream: 'origin/feat', unpushed: 2, behind: 0, behind_default: 12 }] })], new Date(T0));
  b = buildCards(store, T0).boxes[0];
  assert.equal(b.git.default_branch, 'main');
  assert.equal(b.sessions[0].git.behind_default, 12);

  // An older box: no remote state, no fetch time.
  store.ingest([ev('git', { worktrees: [{ path: '/workspace', branch: 'main', ahead: 0, dirty: 0 }, { path: '/workspace/.wt/x', branch: 'feat', ahead: 2, dirty: 1 }] })], new Date(T0));
  b = buildCards(store, T0).boxes[0];
  assert.equal(b.git.fetched_at, null);
  assert.equal(b.git.default_branch, null);
  assert.equal(b.git.worktrees.length, 2);
  assert.equal(b.sessions[0].git.remote, undefined);
  assert.equal(b.sessions[0].git.ahead, 2);

  // A row stored before this change holds the bare array.
  store.db.prepare('UPDATE boxes SET git_json = ? WHERE name = ?').run(JSON.stringify([{ path: '/workspace', branch: 'main', ahead: 1, dirty: 0 }]), 'b1');
  b = buildCards(store, T0).boxes[0];
  assert.equal(b.git.fetched_at, null);
  assert.equal(b.git.worktrees[0].ahead, 1);

  // No git event at all, or an empty one: no git state.
  store.ingest([ev('git', { worktrees: [] })], new Date(T0));
  assert.equal(buildCards(store, T0).boxes[0].git, null);
});

test('git state wording', () => {
  const text = (w) => gitStateParts(w).join(' · ');
  assert.equal(text({ ahead: 2, dirty: 1, remote: 'ok', unpushed: 2, behind: 0 }), '2 nicht gepusht · 1 geändert');
  assert.equal(text({ ahead: 0, dirty: 0, remote: 'ok', unpushed: 0, behind: 3 }), '3 hinter');
  assert.equal(text({ ahead: 1, dirty: 0, remote: 'ok', unpushed: 1, behind: 2 }), '1 nicht gepusht · 2 hinter');
  assert.equal(text({ ahead: 4, dirty: 0, remote: 'ok', unpushed: 0, behind: 0 }), 'gepusht');
  assert.equal(text({ ahead: 1, dirty: 0, remote: 'none', unpushed: null, behind: null }), 'nicht auf origin');
  assert.equal(text({ ahead: 0, dirty: 0, remote: 'none', unpushed: null, behind: null }), '');
  assert.equal(text({ ahead: 0, dirty: 2, remote: 'gone', unpushed: null, behind: null }), 'auf origin gelöscht · 2 geändert');
  // Unknown remote state: what the row showed before.
  assert.equal(text({ ahead: 2, dirty: 1 }), '2 Commits vor · 1 geändert');
  assert.equal(text({ ahead: 1, dirty: 0 }), '1 Commit vor');
  assert.equal(text(null), '');
  assert.deepEqual(gitSummary([{ remote: 'ok', unpushed: 2, behind: 0 }, { remote: 'ok', unpushed: 0, behind: 3 }, { remote: 'none', ahead: 1 }, { remote: 'none', ahead: 0 }, { ahead: 5 }]), { unpushed: 2, behind: 1 });
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

// --- Login -----------------------------------------------------------------

const DAY = 86400000;
const key = () => ({ id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'], label: 'iPhone' });

test('login: a session lasts 30 days after its last use and is pruned after that', () => {
  const store = openDb(':memory:');
  store.addPasskey(key(), new Date(T0));
  const value = store.createSession('cred-1', new Date(T0));
  assert.ok(store.session(value, new Date(T0 + 29 * DAY)), 'used on day 29');
  assert.ok(store.session(value, new Date(T0 + 58 * DAY)), '29 days after the last use');
  assert.equal(store.session(value, new Date(T0 + 89 * DAY + 1000)), null, '31 days after the last use');
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM auth_sessions').get().c, 1);
  store.prune(new Date(T0 + 89 * DAY + 1000));
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM auth_sessions').get().c, 0);
});

test('login: last use is written at most once a minute and reported as renewed', () => {
  const store = openDb(':memory:');
  store.addPasskey(key(), new Date(T0));
  const value = store.createSession('cred-1', new Date(T0));
  assert.equal(store.session(value, new Date(T0 + 30000)).renewed, false);
  assert.equal(store.session(value, new Date(T0 + 61000)).renewed, true);
  assert.equal(store.db.prepare('SELECT last_used FROM auth_sessions').get().last_used, new Date(T0 + 61000).toISOString());
});

test('login: ending one session keeps the others, unknown values give no session', () => {
  const store = openDb(':memory:');
  store.addPasskey(key(), new Date(T0));
  const a = store.createSession('cred-1', new Date(T0));
  const b = store.createSession('cred-1', new Date(T0));
  assert.equal(store.endSession(a), 1);
  assert.equal(store.session(a, new Date(T0)), null);
  assert.ok(store.session(b, new Date(T0)));
  assert.equal(store.session('nope', new Date(T0)), null);
  assert.equal(store.session('', new Date(T0)), null);
  assert.equal(store.endAllSessions(new Date(T0)), 1);
  assert.equal(store.session(b, new Date(T0)), null);
});

test('login: a second enrollment link replaces the first, links expire after 10 minutes', () => {
  const store = openDb(':memory:');
  const first = store.issueEnroll(new Date(T0));
  assert.equal(store.enrollState(first, new Date(T0 + 9 * 60000)), 'ok');
  assert.equal(store.enrollState(first, new Date(T0 + 11 * 60000)), 'expired');
  const second = store.issueEnroll(new Date(T0 + 60000));
  assert.equal(store.enrollState(first, new Date(T0 + 61000)), 'unknown');
  assert.equal(store.enrollState(second, new Date(T0 + 61000)), 'ok');
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM auth_enroll').get().c, 1);
  store.spendEnroll();
  assert.equal(store.enrollState(second, new Date(T0 + 61000)), 'unknown');
  store.issueEnroll(new Date(T0));
  store.prune(new Date(T0 + 11 * 60000));
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM auth_enroll').get().c, 0);
});

test('login: neither the cookie value nor the link secret is stored', () => {
  const store = openDb(':memory:');
  store.addPasskey(key(), new Date(T0));
  const value = store.createSession('cred-1', new Date(T0));
  const secret = store.issueEnroll(new Date(T0));
  const dump = JSON.stringify([store.db.prepare('SELECT hash, passkey FROM auth_sessions').all(), store.db.prepare('SELECT hash FROM auth_enroll').all()]);
  assert.ok(!dump.includes(value) && !dump.includes(secret));
  assert.notEqual(value, secret);
  assert.ok(value.length >= 43 && secret.length >= 43, '32 random bytes each');
});

test('login: reset removes passkeys, sessions and the link; a session without its passkey is gone', () => {
  const store = openDb(':memory:');
  store.addPasskey(key(), new Date(T0));
  const value = store.createSession('cred-1', new Date(T0));
  const secret = store.issueEnroll(new Date(T0));
  assert.equal(store.passkeyCount(), 1);
  assert.deepEqual(store.passkey('cred-1').transports, ['internal']);
  assert.deepEqual([...store.passkey('cred-1').publicKey], [1, 2, 3]);
  store.usedPasskey('cred-1', 7, new Date(T0));
  assert.equal(store.passkey('cred-1').counter, 7);
  assert.deepEqual(store.resetAuth(new Date(T0)), { passkeys: 1, sessions: 1 });
  assert.equal(store.passkeyCount(), 0);
  assert.equal(store.session(value, new Date(T0)), null);
  assert.equal(store.enrollState(secret, new Date(T0)), 'unknown');
  assert.equal(store.passkey('cred-1'), null);
});

test('login: a database of the current release gets the tables and keeps its data', () => {
  const { DatabaseSync } = require_sqlite();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crb-db-')), 'released.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE events (box TEXT NOT NULL, run TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL, session TEXT, ts TEXT NOT NULL, type TEXT NOT NULL, json TEXT NOT NULL, received TEXT NOT NULL, PRIMARY KEY (box, run, seq));
    CREATE TABLE boxes (name TEXT PRIMARY KEY, phase TEXT, last_heartbeat TEXT, image TEXT, claude_version TEXT, spawn TEXT, uptime_s INTEGER, git_json TEXT, updated TEXT);
    INSERT INTO boxes (name, phase) VALUES ('b1', 'running');
    INSERT INTO events VALUES ('b1', '', 1, 's1', '${iso(0)}', 'prompt', '{"box":"b1","seq":1,"type":"prompt","session":"s1","text":"alt"}', '${iso(0)}');`);
  old.close();
  const store = openDb(file);
  assert.equal(store.passkeyCount(), 0);
  assert.equal(store.boxes()[0].phase, 'running');
  assert.equal(store.sessionEvents('s1').length, 1);
  store.close();
});

// --- Git actions --------------------------------------------------------------

test('actions: queued, collected once, finished once', () => {
  const store = openDb(':memory:');
  const t = (s) => new Date(T0 + s * 1000);
  const a = store.queueAction({ box: 'b1', kind: 'push', branch: 'calm-clock' }, t(0));
  assert.ok(a.id);
  assert.deepEqual(store.queueAction({ box: 'b1', kind: 'push', branch: 'calm-clock' }, t(1)), { id: a.id, existing: true }, 'an equal open action is not stored again');
  const b = store.queueAction({ box: 'b1', kind: 'branch', name: 'rescue', carry: true }, t(2));
  assert.equal(store.actions(50, t(3)).length, 2);

  const next = store.nextAction(t(4));
  assert.deepEqual(next, { id: a.id, box: 'b1', kind: 'push', branch: 'calm-clock', name: '', carry: false }, 'the oldest first');
  assert.equal(store.nextAction(t(5)).id, b.id);
  assert.equal(store.nextAction(t(6)), null, 'each action is handed out once');
  assert.equal(store.queueAction({ box: 'b1', kind: 'push', branch: 'calm-clock' }, t(6)).existing, true, 'a running one is still open');

  assert.equal(store.finishAction(a.id, 'done', '✓ calm-clock 2 gepusht\n', t(7)), 'b1');
  assert.equal(store.finishAction(a.id, 'failed', 'again', t(8)), null, 'an outcome is accepted once');
  assert.equal(store.finishAction('nope', 'done', '', t(8)), null);
  const done = store.actions(50, t(9)).find((x) => x.id === a.id);
  assert.equal(done.state, 'done');
  assert.equal(done.text, '✓ calm-clock 2 gepusht');
  assert.equal(done.branch, 'calm-clock');
  assert.equal(done.finished, t(7).toISOString());
  assert.ok(store.queueAction({ box: 'b1', kind: 'push', branch: 'calm-clock' }, t(10)).id !== a.id, 'after it finished the same action can be queued again');
  assert.equal(store.finishAction(b.id, 'refused', 'x'.repeat(5000), t(11)), 'b1');
  assert.equal(store.actions(50, t(12)).find((x) => x.id === b.id).text.length, 2001, 'long output is cut');
});

test('actions: an uncollected one expires after two minutes, a running one fails after ten', () => {
  const store = openDb(':memory:');
  const t = (s) => new Date(T0 + s * 1000);
  const a = store.queueAction({ box: 'b1', kind: 'fetch' }, t(0));
  assert.deepEqual(store.sweepActions(t(119)), []);
  assert.deepEqual(store.sweepActions(t(121)), ['b1']);
  assert.equal(store.actions(50, t(122))[0].state, 'expired');
  assert.equal(store.nextAction(t(123)), null, 'an expired action is never handed out');

  const b = store.queueAction({ box: 'b2', kind: 'sync' }, t(200));
  assert.notEqual(b.id, a.id);
  store.nextAction(t(201));
  assert.deepEqual(store.sweepActions(t(201 + 599)), []);
  assert.deepEqual(store.sweepActions(t(201 + 601)), ['b2']);
  const failed = store.actions(50, t(900)).find((x) => x.id === b.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.text, /nicht geantwortet/);
  assert.equal(store.finishAction(b.id, 'done', 'late', t(901)), null, 'a late outcome is rejected');
});

test('actions: at most 20 open, removed after seven days', () => {
  const store = openDb(':memory:');
  const t = (s) => new Date(T0 + s * 1000);
  for (let i = 0; i < 20; i++) assert.ok(store.queueAction({ box: 'b1', kind: 'push', branch: `b${i}` }, t(0)).id);
  assert.deepEqual(store.queueAction({ box: 'b1', kind: 'push', branch: 'one-more' }, t(1)), { full: true });
  store.sweepActions(t(200));
  assert.ok(store.queueAction({ box: 'b1', kind: 'push', branch: 'one-more' }, t(201)).id, 'expired ones do not count');
  store.prune(new Date(T0 + 6 * 86400000));
  assert.equal(store.actions(50, new Date(T0 + 6 * 86400000)).length, 21);
  store.prune(new Date(T0 + 8 * 86400000));
  assert.equal(store.actions(50, new Date(T0 + 8 * 86400000)).length, 0);
});

test('agent state: never seen, present, absent after 90 seconds', () => {
  const store = openDb(':memory:');
  const t = (s) => new Date(T0 + s * 1000);
  assert.deepEqual(store.agentState(t(0)), { seen: false, present: false, at: null });
  assert.equal(store.agentSeen(t(0)), true, 'it was absent before');
  assert.equal(store.agentSeen(t(30)), false);
  assert.deepEqual(store.agentState(t(100)), { seen: true, present: true, at: t(30).toISOString() });
  assert.equal(store.agentState(t(121)).present, false);
  assert.equal(store.agentSeen(t(200)), true);
});
