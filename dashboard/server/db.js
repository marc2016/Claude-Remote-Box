// SQLite storage: raw events (idempotent by box+seq), per-session and per-box
// state updated on ingest, pruning, the login's passkeys, sessions, and
// enrollment link, and the Git actions queued for the agent.
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const EVENT_RETENTION_DAYS = 7;
const SESSION_RETENTION_DAYS = 90;
export const LOGIN_DAYS = 30;
export const ENROLL_MINUTES = 10;
const TOUCH_EVERY_MS = 60 * 1000;
/** A queued action nobody collected is dropped: it must not run later against another state. */
export const ACTION_QUEUE_SECONDS = 120;
export const ACTION_RUN_MINUTES = 10;
export const ACTION_OPEN_LIMIT = 20;
export const AGENT_PRESENT_SECONDS = 90;
const ACTION_RETENTION_DAYS = 7;
const ACTION_TEXT_LIMIT = 2000;
export const ACTION_KINDS = ['fetch', 'sync', 'push', 'pull', 'merge', 'branch'];

/** Cookie values and link secrets are stored as this hash only. */
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS events (
      box TEXT NOT NULL, run TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL, session TEXT, ts TEXT NOT NULL,
      type TEXT NOT NULL, json TEXT NOT NULL, received TEXT NOT NULL,
      PRIMARY KEY (box, run, seq)
    );
    CREATE INDEX IF NOT EXISTS events_session ON events (session);
    CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, box TEXT NOT NULL, label TEXT, model TEXT,
      tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
      cache_read INTEGER DEFAULT 0, cache_write INTEGER DEFAULT 0, context INTEGER DEFAULT 0,
      turns INTEGER DEFAULT 0, tool_calls INTEGER DEFAULT 0,
      started TEXT, last TEXT, last_activity TEXT,
      cost_usd REAL, lines_added INTEGER, lines_removed INTEGER,
      permission_mode TEXT, branch TEXT, cwd TEXT, git_json TEXT,
      waiting_since TEXT, waiting_text TEXT, ended_at TEXT, sidechain INTEGER DEFAULT 0,
      last_tool TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_box ON sessions (box, last);
    CREATE TABLE IF NOT EXISTS boxes (
      name TEXT PRIMARY KEY, phase TEXT, last_heartbeat TEXT, image TEXT,
      claude_version TEXT, spawn TEXT, uptime_s INTEGER, git_json TEXT, updated TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_passkeys (
      id TEXT PRIMARY KEY, public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT, label TEXT, created TEXT NOT NULL, last_used TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      hash TEXT PRIMARY KEY, passkey TEXT NOT NULL, created TEXT NOT NULL, last_used TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_enroll (
      id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL, issued TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS git_actions (
      id TEXT PRIMARY KEY, box TEXT NOT NULL, kind TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '', carry INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
      queued TEXT NOT NULL, started TEXT, finished TEXT, text TEXT
    );
    CREATE INDEX IF NOT EXISTS git_actions_state ON git_actions (state, queued);
    CREATE TABLE IF NOT EXISTS agent_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), seen TEXT NOT NULL
    );
  `);
  // Columns added after the first release, for databases created before them.
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (!cols.includes('last_tool')) db.exec('ALTER TABLE sessions ADD COLUMN last_tool TEXT');
  // Events keyed by (box, seq) only: rebuild with the run id in the key (old rows keep run '').
  const ecols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  if (!ecols.includes('run')) {
    db.exec(`
      BEGIN;
      ALTER TABLE events RENAME TO events_old;
      CREATE TABLE events (
        box TEXT NOT NULL, run TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL, session TEXT, ts TEXT NOT NULL,
        type TEXT NOT NULL, json TEXT NOT NULL, received TEXT NOT NULL,
        PRIMARY KEY (box, run, seq)
      );
      INSERT INTO events (box, run, seq, session, ts, type, json, received)
        SELECT box, '', seq, session, ts, type, json, received FROM events_old ORDER BY received, seq;
      DROP TABLE events_old;
      CREATE INDEX IF NOT EXISTS events_session ON events (session);
      CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
      COMMIT;
    `);
  }
  return new Store(db);
}

export class Store {
  constructor(db) {
    this.db = db;
    this.insertEvent = db.prepare(
      'INSERT OR IGNORE INTO events (box, run, seq, session, ts, type, json, received) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    this.upsertBox = db.prepare(`INSERT INTO boxes (name, updated) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET updated = excluded.updated`);
    this.ensureSession = db.prepare(`INSERT OR IGNORE INTO sessions (id, box) VALUES (?, ?)`);
  }

  /**
   * Stores a batch in one transaction. Returns the names of boxes whose state
   * changed (empty when every event was a replay).
   * @param {object[]} events
   */
  ingest(events, now = new Date()) {
    const received = now.toISOString();
    const changed = new Set();
    this.db.exec('BEGIN');
    try {
      for (const ev of events) {
        if (!ev || typeof ev !== 'object' || typeof ev.box !== 'string' || typeof ev.seq !== 'number' || typeof ev.type !== 'string') continue;
        const ts = typeof ev.ts === 'string' ? ev.ts : received;
        const run = typeof ev.run === 'string' ? ev.run : '';
        const r = this.insertEvent.run(ev.box, run, ev.seq, ev.session ?? null, ts, ev.type, JSON.stringify(ev), received);
        if (r.changes === 0) continue; // replay
        this.apply(ev, ts, received);
        changed.add(ev.box);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return [...changed];
  }

  apply(ev, ts, received) {
    const db = this.db;
    this.upsertBox.run(ev.box, received);
    switch (ev.type) {
      case 'phase':
        db.prepare('UPDATE boxes SET phase = ? WHERE name = ?').run(ev.phase ?? null, ev.box);
        break;
      case 'heartbeat':
        db.prepare(`UPDATE boxes SET phase = COALESCE(?, phase), last_heartbeat = ?, image = COALESCE(?, image),
          claude_version = COALESCE(?, claude_version), spawn = COALESCE(?, spawn), uptime_s = ? WHERE name = ?`)
          .run(ev.phase ?? null, received, ev.image ?? null, ev.claude_version ?? null, ev.spawn ?? null, ev.uptime_s ?? null, ev.box);
        break;
      case 'git':
        // Stored as an object; rows written before `fetched_at` existed hold the bare array.
        db.prepare('UPDATE boxes SET git_json = ? WHERE name = ?')
          .run(JSON.stringify({ worktrees: Array.isArray(ev.worktrees) ? ev.worktrees : [], fetched_at: ev.fetched_at ?? null, default_branch: ev.default_branch ?? null }), ev.box);
        break;
      default:
        if (ev.session) this.applySession(ev, ts);
    }
  }

  applySession(ev, ts) {
    const db = this.db;
    const id = ev.session;
    this.ensureSession.run(id, ev.box);
    const touch = () => db.prepare(`UPDATE sessions SET last_activity = MAX(COALESCE(last_activity, ''), ?) WHERE id = ?`).run(ts, id);
    switch (ev.type) {
      case 'session_start':
        db.prepare(`UPDATE sessions SET started = COALESCE(started, ?), cwd = ?, branch = COALESCE(?, branch),
          permission_mode = COALESCE(?, permission_mode), sidechain = ?, ended_at = NULL WHERE id = ?`)
          .run(ts, ev.cwd ?? null, ev.branch ?? null, ev.permission_mode ?? null, ev.sidechain ? 1 : 0, id);
        touch();
        break;
      case 'prompt':
        db.prepare('UPDATE sessions SET label = COALESCE(label, ?), ended_at = NULL WHERE id = ?')
          .run(label(ev.text), id);
        touch();
        break;
      case 'reply':
      case 'tool_result':
      case 'resumed':
        db.prepare('UPDATE sessions SET waiting_since = NULL, waiting_text = NULL, ended_at = NULL WHERE id = ?').run(id);
        touch();
        break;
      case 'tool':
        db.prepare('UPDATE sessions SET last_tool = ?, ended_at = NULL WHERE id = ?')
          .run([ev.tool, ev.summary].filter(Boolean).join(': ') || null, id);
        touch();
        break;
      case 'waiting':
        db.prepare('UPDATE sessions SET waiting_since = COALESCE(waiting_since, ?), waiting_text = ? WHERE id = ?')
          .run(ts, [ev.tool, ev.summary].filter(Boolean).join(': ') || null, id);
        touch();
        break;
      case 'summary':
        db.prepare(`UPDATE sessions SET model = COALESCE(?, model), tokens_in = ?, tokens_out = ?, cache_read = ?, cache_write = ?,
          context = ?, turns = ?, tool_calls = ?, started = COALESCE(started, ?), last = ?,
          cost_usd = COALESCE(?, cost_usd), lines_added = COALESCE(?, lines_added), lines_removed = COALESCE(?, lines_removed),
          sidechain = CASE WHEN ? THEN 1 ELSE sidechain END WHERE id = ?`)
          .run(ev.model ?? null, ev.tokens_in ?? 0, ev.tokens_out ?? 0, ev.cache_read ?? 0, ev.cache_write ?? 0,
            ev.context ?? 0, ev.turns ?? 0, ev.tool_calls ?? 0, ev.started ?? ts, ev.last ?? ts,
            ev.cost_usd ?? null, ev.lines_added ?? null, ev.lines_removed ?? null, ev.sidechain ? 1 : 0, id);
        if (!ev.backfill) touch();
        break;
      case 'session_end':
        db.prepare('UPDATE sessions SET ended_at = ?, waiting_since = NULL, waiting_text = NULL WHERE id = ?').run(ts, id);
        break;
      default:
        break;
    }
  }

  boxes() {
    return this.db.prepare('SELECT * FROM boxes ORDER BY name').all();
  }

  sessionsOf(box) {
    return this.db.prepare('SELECT * FROM sessions WHERE box = ? AND sidechain = 0 ORDER BY COALESCE(last_activity, last, started) DESC').all(box);
  }

  /** Newest `limit` events of a session in storage order, oldest first, each with its `id`; `before` (an id) pages backwards. */
  sessionEvents(session, limit = 200, types = null, before = null) {
    const where = (types ? ` AND type IN (${types.map(() => '?').join(',')})` : '') + (before != null ? ' AND rowid < ?' : '');
    const params = [session, ...(types ?? []), ...(before != null ? [before] : []), limit];
    const rows = this.db.prepare(`SELECT rowid AS id, json FROM events WHERE session = ?${where} ORDER BY rowid DESC LIMIT ?`).all(...params);
    return rows.map((r) => Object.assign(JSON.parse(r.json), { id: r.id })).reverse();
  }

  prune(now = new Date()) {
    const cutEvents = new Date(now.getTime() - EVENT_RETENTION_DAYS * 86400000).toISOString();
    const cutSessions = new Date(now.getTime() - SESSION_RETENTION_DAYS * 86400000).toISOString();
    const a = this.db.prepare('DELETE FROM events WHERE ts < ?').run(cutEvents).changes;
    const b = this.db.prepare('DELETE FROM sessions WHERE COALESCE(last_activity, last, started) < ?').run(cutSessions).changes;
    this.db.prepare('DELETE FROM auth_sessions WHERE last_used < ?').run(loginCut(now));
    this.db.prepare('DELETE FROM auth_enroll WHERE issued < ?').run(enrollCut(now));
    this.db.prepare('DELETE FROM git_actions WHERE queued < ?').run(new Date(now.getTime() - ACTION_RETENTION_DAYS * 86400000).toISOString());
    return { events: a, sessions: b };
  }

  // --- Login ---------------------------------------------------------------

  passkeyCount() {
    return this.db.prepare('SELECT COUNT(*) AS c FROM auth_passkeys').get().c;
  }

  /** @returns {{id: string, publicKey: Uint8Array, counter: number, transports: string[]|undefined}|null} */
  passkey(id) {
    const r = this.db.prepare('SELECT * FROM auth_passkeys WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, publicKey: new Uint8Array(r.public_key), counter: r.counter, transports: r.transports ? JSON.parse(r.transports) : undefined, label: r.label };
  }

  addPasskey({ id, publicKey, counter = 0, transports, label = null }, now = new Date()) {
    this.db.prepare('INSERT INTO auth_passkeys (id, public_key, counter, transports, label, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, publicKey, counter, transports ? JSON.stringify(transports) : null, label, now.toISOString());
  }

  usedPasskey(id, counter, now = new Date()) {
    this.db.prepare('UPDATE auth_passkeys SET counter = ?, last_used = ? WHERE id = ?').run(counter, now.toISOString(), id);
  }

  /** Starts a session and returns the cookie value; only its hash is stored. */
  createSession(passkey, now = new Date()) {
    const value = newSecret();
    this.db.prepare('INSERT INTO auth_sessions (hash, passkey, created, last_used) VALUES (?, ?, ?, ?)')
      .run(sha256(value), passkey, now.toISOString(), now.toISOString());
    return value;
  }

  /**
   * The session of a cookie value, or null when it is unknown, unused for
   * LOGIN_DAYS, or its passkey is gone. `renewed` says that last_used was
   * written, so the caller sends the cookie again.
   */
  session(value, now = new Date()) {
    if (typeof value !== 'string' || !value) return null;
    const hash = sha256(value);
    const r = this.db.prepare(`SELECT s.hash, s.passkey, s.created, s.last_used FROM auth_sessions s
      JOIN auth_passkeys p ON p.id = s.passkey WHERE s.hash = ? AND s.last_used >= ?`).get(hash, loginCut(now));
    if (!r) return null;
    const renewed = now.getTime() - Date.parse(r.last_used) >= TOUCH_EVERY_MS;
    if (renewed) this.db.prepare('UPDATE auth_sessions SET last_used = ? WHERE hash = ?').run(now.toISOString(), hash);
    return { hash, passkey: r.passkey, created: r.created, renewed };
  }

  /** Whether the session with this hash still exists and is within its lifetime; does not count as a use. */
  sessionAlive(hash, now = new Date()) {
    return Boolean(this.db.prepare('SELECT 1 FROM auth_sessions WHERE hash = ? AND last_used >= ?').get(hash, loginCut(now)));
  }

  endSession(value) {
    return this.db.prepare('DELETE FROM auth_sessions WHERE hash = ?').run(sha256(value)).changes;
  }

  endAllSessions(now = new Date()) {
    this.db.prepare('DELETE FROM auth_sessions WHERE last_used < ?').run(loginCut(now));
    return this.db.prepare('DELETE FROM auth_sessions').run().changes;
  }

  /** Removes every passkey, session, and the enrollment link. */
  resetAuth(now = new Date()) {
    const sessions = this.endAllSessions(now);
    const passkeys = this.db.prepare('DELETE FROM auth_passkeys').run().changes;
    this.db.prepare('DELETE FROM auth_enroll').run();
    return { passkeys, sessions };
  }

  /** Issues the enrollment secret; a link issued before stops working. */
  issueEnroll(now = new Date()) {
    const secret = newSecret();
    this.db.prepare('INSERT INTO auth_enroll (id, hash, issued) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, issued = excluded.issued')
      .run(sha256(secret), now.toISOString());
    return secret;
  }

  /** 'ok', 'expired', or 'unknown' (never issued, replaced, or already used). */
  enrollState(secret, now = new Date()) {
    if (typeof secret !== 'string' || !secret) return 'unknown';
    const r = this.db.prepare('SELECT issued FROM auth_enroll WHERE id = 1 AND hash = ?').get(sha256(secret));
    if (!r) return 'unknown';
    return r.issued >= enrollCut(now) ? 'ok' : 'expired';
  }

  spendEnroll() {
    this.db.prepare('DELETE FROM auth_enroll').run();
  }

  // --- Git actions for the agent ------------------------------------------

  boxKnown(name) {
    return Boolean(this.db.prepare('SELECT 1 FROM boxes WHERE name = ?').get(name));
  }

  /**
   * Ends what time has decided: queued actions nobody collected, running ones
   * without an answer. Returns the boxes whose actions changed.
   */
  sweepActions(now = new Date()) {
    const t = now.toISOString();
    const queuedCut = new Date(now.getTime() - ACTION_QUEUE_SECONDS * 1000).toISOString();
    const runCut = new Date(now.getTime() - ACTION_RUN_MINUTES * 60000).toISOString();
    const hit = this.db.prepare(`SELECT DISTINCT box FROM git_actions
      WHERE (state = 'queued' AND queued < ?) OR (state = 'running' AND started < ?)`).all(queuedCut, runCut).map((r) => r.box);
    if (!hit.length) return hit;
    this.db.prepare("UPDATE git_actions SET state = 'expired', finished = ?, text = ? WHERE state = 'queued' AND queued < ?")
      .run(t, 'Der Git-Agent hat die Aktion nicht abgeholt.', queuedCut);
    this.db.prepare("UPDATE git_actions SET state = 'failed', finished = ?, text = ? WHERE state = 'running' AND started < ?")
      .run(t, 'Der Host hat nicht geantwortet.', runCut);
    return hit;
  }

  /**
   * Queues an action. `{ id }` for a new one, `{ id, existing: true }` when an
   * equal one is still open, `{ full: true }` at the limit of open actions.
   */
  queueAction({ box, kind, branch = '', name = '', carry = false }, now = new Date()) {
    this.sweepActions(now);
    const same = this.db.prepare(`SELECT id FROM git_actions WHERE state IN ('queued', 'running')
      AND box = ? AND kind = ? AND branch = ? AND name = ? AND carry = ?`).get(box, kind, branch, name, carry ? 1 : 0);
    if (same) return { id: same.id, existing: true };
    const open = this.db.prepare("SELECT COUNT(*) AS c FROM git_actions WHERE state IN ('queued', 'running')").get().c;
    if (open >= ACTION_OPEN_LIMIT) return { full: true };
    const id = randomBytes(12).toString('base64url');
    this.db.prepare("INSERT INTO git_actions (id, box, kind, branch, name, carry, state, queued) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)")
      .run(id, box, kind, branch, name, carry ? 1 : 0, now.toISOString());
    return { id };
  }

  /** Hands out the oldest queued action once and marks it as running; null when none is queued. */
  nextAction(now = new Date()) {
    this.sweepActions(now);
    const r = this.db.prepare("SELECT * FROM git_actions WHERE state = 'queued' ORDER BY queued, rowid LIMIT 1").get();
    if (!r) return null;
    this.db.prepare("UPDATE git_actions SET state = 'running', started = ? WHERE id = ? AND state = 'queued'").run(now.toISOString(), r.id);
    return { id: r.id, box: r.box, kind: r.kind, branch: r.branch, name: r.name, carry: Boolean(r.carry) };
  }

  /** Stores the outcome of a running action, once. Returns its box, or null when it was not running. */
  finishAction(id, state, text, now = new Date()) {
    this.sweepActions(now);
    const r = this.db.prepare("SELECT box FROM git_actions WHERE id = ? AND state = 'running'").get(id);
    if (!r) return null;
    const t = String(text ?? '').trim();
    this.db.prepare('UPDATE git_actions SET state = ?, finished = ?, text = ? WHERE id = ?')
      .run(state, now.toISOString(), t.length > ACTION_TEXT_LIMIT ? t.slice(0, ACTION_TEXT_LIMIT) + '…' : t, id);
    return r.box;
  }

  /** The most recent actions, newest first. */
  actions(limit = 50, now = new Date()) {
    this.sweepActions(now);
    return this.db.prepare('SELECT * FROM git_actions ORDER BY queued DESC, rowid DESC LIMIT ?').all(limit).map((r) => ({
      id: r.id, box: r.box, kind: r.kind, branch: r.branch || null, name: r.name || null, carry: Boolean(r.carry),
      state: r.state, queued: r.queued, started: r.started ?? null, finished: r.finished ?? null, text: r.text ?? null,
    }));
  }

  /** Records a request of the agent. Returns true when it was absent before. */
  agentSeen(now = new Date()) {
    const was = this.agentState(now).present;
    this.db.prepare('INSERT INTO agent_state (id, seen) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET seen = excluded.seen').run(now.toISOString());
    return !was;
  }

  /** `seen`: an agent has ever asked for work; `present`: within the last AGENT_PRESENT_SECONDS. */
  agentState(now = new Date()) {
    const r = this.db.prepare('SELECT seen FROM agent_state WHERE id = 1').get();
    if (!r) return { seen: false, present: false, at: null };
    return { seen: true, present: now.getTime() - Date.parse(r.seen) < AGENT_PRESENT_SECONDS * 1000, at: r.seen };
  }

  close() { this.db.close(); }
}

const loginCut = (now) => new Date(now.getTime() - LOGIN_DAYS * 86400000).toISOString();
const enrollCut = (now) => new Date(now.getTime() - ENROLL_MINUTES * 60000).toISOString();

function label(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}
