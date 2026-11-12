// SQLite storage: raw events (idempotent by box+seq), per-session and per-box
// state updated on ingest, pruning.
import { DatabaseSync } from 'node:sqlite';

const EVENT_RETENTION_DAYS = 7;
const SESSION_RETENTION_DAYS = 90;

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
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
          .run(JSON.stringify({ worktrees: Array.isArray(ev.worktrees) ? ev.worktrees : [], fetched_at: ev.fetched_at ?? null }), ev.box);
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
    return { events: a, sessions: b };
  }

  close() { this.db.close(); }
}

function label(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}
