#!/usr/bin/env node
// crb-watch: reports a box's phase, heartbeat, and session activity to a
// status endpoint. Reads Claude Code's session transcripts (JSONL files under
// $CLAUDE_CONFIG_DIR/projects) and never writes to them. No dependencies.
//
//   crb-watch.js                       daemon (started by the entrypoint)
//   crb-watch.js --emit k=v [k=v...]   send one event (phase, heartbeat)
//   crb-watch.js --dry-run FILE...     print the events of transcripts, no network
//   crb-watch.js --hook                Claude Code hook: reads the hook JSON on stdin
//   crb-watch.js --git [DIR]           print the git event of DIR (default: the workspace), no network
//   crb-watch.js --version
//
// Environment: CRB_STATUS_URL (off when empty), CRB_STATUS_TOKEN, CRB_NAME,
// CLAUDE_CONFIG_DIR, CRB_STATE (phase file), CRB_SPAWN_EFFECTIVE,
// CRB_IMAGE_VERSION, CRB_SPOOL (default /tmp/crb-spool.jsonl), CRB_WORKSPACE
// (default /workspace).
// State (run id, sequence counter, read offsets) lives in
// $CLAUDE_CONFIG_DIR/.crb-watch.json, so it survives a container recreation.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const VERSION = '1';
const TEXT_LIMIT = 4000;
const SUMMARY_LIMIT = 200;
const SPOOL_LIMIT = 500;
const BATCH_MS = 500;
const BATCH_MAX = 50;
const SEND_TIMEOUT_MS = 2000;
const BACKOFF_MS = [5000, 10000, 30000, 60000];
const SCAN_MS = 5000;
const HEARTBEAT_MS = 30000;
const WAITING_MS = 10000;
const IDLE_END_MS = 60 * 60 * 1000;
const STATE_SAVE_MS = 5000;
const GIT_TIMEOUT_MS = 5000;

const env = process.env;
const cfg = {
  url: env.CRB_STATUS_URL || '',
  token: env.CRB_STATUS_TOKEN || '',
  box: env.CRB_NAME || 'unknown',
  configDir: env.CLAUDE_CONFIG_DIR || path.join(env.HOME || '/home/node', '.claude'),
  stateFile: env.CRB_STATE || '/tmp/crb-state',
  spoolFile: env.CRB_SPOOL || '/tmp/crb-spool.jsonl',
  emitSeqFile: env.CRB_EMIT_SEQ || '/tmp/crb-emit-seq',
  spawn: env.CRB_SPAWN_EFFECTIVE || env.CRB_SPAWN || '',
  image: env.CRB_IMAGE_VERSION || 'unknown',
  workspace: env.CRB_WORKSPACE || '/workspace',
};

function log(msg) { process.stderr.write(`crb-watch: ${msg}\n`); }

// --- helpers -----------------------------------------------------------------

function truncate(s, limit) {
  if (typeof s !== 'string') return '';
  if (s.length <= limit) return s;
  return s.slice(0, limit) + ' …[truncated]';
}

function oneLine(s) { return String(s).replace(/\s+/g, ' ').trim(); }

function readPhase() {
  try { return fs.readFileSync(cfg.stateFile, 'utf8').trim() || 'unknown'; } catch { return 'unknown'; }
}

function containerUptimeS() {
  try { return Math.round((Date.now() - fs.statSync('/proc/1').ctimeMs) / 1000); } catch { return null; }
}

let claudeVersionCache;
function claudeVersion() {
  if (claudeVersionCache !== undefined) return claudeVersionCache;
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = (r.stdout || '').match(/\d+\.\d+\.\d+/);
    claudeVersionCache = m ? m[0] : null;
  } catch { claudeVersionCache = null; }
  return claudeVersionCache;
}

// Tool call summaries: the one line a human wants to see.
function toolSummary(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = (...keys) => { for (const k of keys) if (typeof input[k] === 'string' && input[k]) return input[k]; return ''; };
  let s = '';
  switch (name) {
    case 'Bash': s = pick('command'); break;
    case 'Edit': case 'Write': case 'Read': case 'NotebookEdit': case 'MultiEdit': s = pick('file_path', 'notebook_path'); break;
    case 'Grep': case 'Glob': s = pick('pattern') + (input.path ? ` in ${input.path}` : ''); break;
    case 'WebFetch': case 'WebSearch': s = pick('url', 'query'); break;
    case 'Agent': case 'Task': s = pick('description', 'prompt'); break;
    case 'AskUserQuestion': s = Array.isArray(input.questions) && input.questions[0] ? String(input.questions[0].question || '') : ''; break;
    default: s = pick(...Object.keys(input));
  }
  return truncate(oneLine(s), SUMMARY_LIMIT);
}

// --- state: run id, sequence counter, read offsets -----------------------------

const stateFile = path.join(cfg.configDir, '.crb-watch.json');
const state = { run: null, seq: 0, files: {} };
let stateDirty = false;
let stateFresh = true; // no saved state at start: existing transcripts are backfill only
let stateWarned = false;

function loadState() {
  try {
    const d = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (d && typeof d.run === 'string' && d.run) {
      state.run = d.run;
      state.seq = Number.isFinite(d.seq) ? d.seq : 0;
      state.files = d.files && typeof d.files === 'object' ? d.files : {};
      stateFresh = false;
    }
  } catch { /* no state yet */ }
  if (!state.run) { state.run = require('crypto').randomBytes(4).toString('hex'); stateDirty = true; }
}

function saveState() {
  if (!stateDirty) return;
  try {
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state));
    fs.renameSync(stateFile + '.tmp', stateFile);
    stateDirty = false;
  } catch (e) {
    if (!stateWarned) { log(`cannot write ${stateFile} (${e.message}); state is kept in memory only`); stateWarned = true; }
  }
}

let seq = 0;
function nextSeq() {
  state.seq += 1;
  seq = state.seq;
  stateDirty = true;
  return seq;
}

// --- sender: batches, timeout, spool, backoff --------------------------------

const queue = [];
let sending = false;
let backoffIdx = -1;
let nextTryAt = 0;
let lossLogged = false;
let batchTimer = null;
let dryRun = false;
const dryOut = [];

function emit(ev) {
  const full = Object.assign({ box: cfg.box, run: state.run, ts: ev.ts || new Date().toISOString(), seq: nextSeq() }, ev);
  if (dryRun) { dryOut.push(full); return; }
  queue.push(full);
  if (queue.length >= BATCH_MAX) flush();
  else if (!batchTimer) batchTimer = setTimeout(flush, BATCH_MS);
}

function post(events) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(cfg.url); } catch { return resolve(false); }
    const body = JSON.stringify(events);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      },
      timeout: SEND_TIMEOUT_MS,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

function spoolAppend(events) {
  try {
    // Heartbeats and git state describe the present; an old one is worth nothing.
    const lines = events.filter((e) => e.type !== 'heartbeat' && e.type !== 'git').map((e) => JSON.stringify(e));
    if (!lines.length) return;
    let existing = [];
    try { existing = fs.readFileSync(cfg.spoolFile, 'utf8').split('\n').filter(Boolean); } catch { /* none */ }
    const all = existing.concat(lines);
    if (all.length > SPOOL_LIMIT) {
      if (!lossLogged) { log(`endpoint unreachable, spool full: oldest events are dropped (keeping ${SPOOL_LIMIT})`); lossLogged = true; }
    }
    fs.writeFileSync(cfg.spoolFile, all.slice(-SPOOL_LIMIT).join('\n') + '\n');
  } catch (e) { log(`spool write failed: ${e.message}`); }
}

function spoolTake() {
  try {
    const lines = fs.readFileSync(cfg.spoolFile, 'utf8').split('\n').filter(Boolean);
    if (!lines.length) return [];
    const events = [];
    for (const l of lines) { try { events.push(JSON.parse(l)); } catch { /* skip */ } }
    return events;
  } catch { return []; }
}

function spoolClear() { try { fs.unlinkSync(cfg.spoolFile); } catch { /* none */ } }

async function flush() {
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
  if (sending || !cfg.url) return;
  if (Date.now() < nextTryAt) {
    // Still backing off: move the queue into the spool and wait.
    if (queue.length) spoolAppend(queue.splice(0));
    return;
  }
  sending = true;
  try {
    // Spooled events go first, in order.
    const spooled = spoolTake();
    if (spooled.length) {
      if (await post(spooled)) { spoolClear(); lossLogged = false; }
      else { failed(); spoolAppend(queue.splice(0)); return; }
    }
    while (queue.length) {
      const batch = queue.splice(0, BATCH_MAX);
      if (await post(batch)) { backoffIdx = -1; nextTryAt = 0; }
      else { failed(); spoolAppend(batch.concat(queue.splice(0))); return; }
    }
  } finally { sending = false; }
}

function failed() {
  backoffIdx = Math.min(backoffIdx + 1, BACKOFF_MS.length - 1);
  nextTryAt = Date.now() + BACKOFF_MS[backoffIdx];
  if (backoffIdx === 0) log(`send failed, retrying in ${BACKOFF_MS[0] / 1000}s (spooling)`);
}

// --- transcript parsing --------------------------------------------------------

// One tracked session: aggregates and pending tool calls.
function newSession(id) {
  return {
    id, started: null, last: null, announced: false, model: null,
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, context: 0,
    turns: 0, toolCalls: 0, costUsd: undefined, linesAdded: undefined, linesRemoved: undefined,
    pending: new Map(), // call_id -> { tool, summary, ts, flagged }
    ended: false, cwd: null, branch: null, version: null, permissionMode: null, sidechain: false,
  };
}

const sessions = new Map();

function session(id) {
  let s = sessions.get(id);
  if (!s) { s = newSession(id); sessions.set(id, s); }
  return s;
}

function summaryEvent(s, extra) {
  const ev = {
    type: 'summary', session: s.id, model: s.model,
    tokens_in: s.tokensIn, tokens_out: s.tokensOut, cache_read: s.cacheRead, cache_write: s.cacheWrite,
    context: s.context, turns: s.turns, tool_calls: s.toolCalls, started: s.started, last: s.last,
  };
  if (s.costUsd !== undefined) ev.cost_usd = s.costUsd;
  if (s.linesAdded !== undefined) ev.lines_added = s.linesAdded;
  if (s.linesRemoved !== undefined) ev.lines_removed = s.linesRemoved;
  if (s.sidechain) ev.sidechain = true;
  return Object.assign(ev, extra || {});
}

// handleLine(sessionIdFromFile, parsedLine, live): live=false means backfill
// (older than 24 h): aggregate only, no per-line events.
function handleLine(fileSession, d, live) {
  if (!d || typeof d !== 'object') return;
  const id = d.sessionId || fileSession;
  const s = session(id);
  const ts = typeof d.timestamp === 'string' ? d.timestamp : new Date().toISOString();
  if (d.isSidechain) s.sidechain = true;

  if (d.type === 'cost-state') {
    if (typeof d.totalCostUSD === 'number') s.costUsd = d.totalCostUSD;
    if (typeof d.totalLinesAdded === 'number') s.linesAdded = d.totalLinesAdded;
    if (typeof d.totalLinesRemoved === 'number') s.linesRemoved = d.totalLinesRemoved;
    return;
  }
  if (d.type !== 'user' && d.type !== 'assistant') return;
  const m = d.message;
  if (!m || typeof m !== 'object') return;

  if (!s.started) s.started = ts;
  s.last = ts;
  if (d.cwd) s.cwd = d.cwd;
  if (d.gitBranch) s.branch = d.gitBranch;
  if (d.version) s.version = d.version;
  if (d.permissionMode) s.permissionMode = d.permissionMode;
  if (!s.announced) {
    s.announced = true;
    if (live) {
      emit({ type: 'session_start', session: s.id, ts, cwd: s.cwd, branch: s.branch,
        claude_version: s.version, permission_mode: s.permissionMode, ...(s.sidechain ? { sidechain: true } : {}) });
    }
  }

  const content = Array.isArray(m.content) ? m.content : (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : []);

  if (d.type === 'user') {
    for (const b of content) {
      if (b.type === 'text' && !d.isMeta) {
        if (live) emit({ type: 'prompt', session: s.id, ts, text: truncate(b.text, TEXT_LIMIT) });
      } else if (b.type === 'tool_result') {
        const p = s.pending.get(b.tool_use_id);
        s.pending.delete(b.tool_use_id);
        if (live) {
          emit({ type: 'tool_result', session: s.id, ts, call_id: b.tool_use_id, ok: !b.is_error });
          if (p && p.flagged) emit({ type: 'resumed', session: s.id, ts });
        }
      }
    }
    return;
  }

  // assistant
  if (typeof m.model === 'string' && m.model && !m.model.startsWith('<')) s.model = m.model;
  for (const b of content) {
    if (b.type === 'text' && b.text && b.text.trim()) {
      if (live) emit({ type: 'reply', session: s.id, ts, text: truncate(b.text, TEXT_LIMIT) });
    } else if (b.type === 'tool_use') {
      s.toolCalls += 1;
      const summary = toolSummary(b.name, b.input);
      s.pending.set(b.id, { tool: b.name, summary, ts: Date.parse(ts) || Date.now(), flagged: false });
      if (live) emit({ type: 'tool', session: s.id, ts, tool: b.name, summary, call_id: b.id });
    }
  }
  const u = m.usage;
  if (u && typeof u === 'object') {
    const inT = u.input_tokens || 0, cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    s.tokensIn += inT; s.tokensOut += u.output_tokens || 0; s.cacheRead += cr; s.cacheWrite += cw;
    s.context = inT + cr + cw;
    s.turns += 1;
    if (live) emit(summaryEvent(s, { ts }));
  }
}

// --- file tracking ---------------------------------------------------------------

const files = new Map(); // path -> { offset, rest, session, mtimeMs }

function listTranscripts(root) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); }
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

function readNew(p, f, live) {
  let st;
  try { st = fs.statSync(p); } catch { return; }
  if (st.size < f.offset) { f.offset = 0; f.rest = ''; } // truncated/rotated
  if (st.size === f.offset) return;
  const fd = fs.openSync(p, 'r');
  try {
    const len = st.size - f.offset;
    const buf = Buffer.alloc(Math.min(len, 8 * 1024 * 1024));
    let pos = f.offset;
    while (pos < st.size) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      f.rest += buf.toString('utf8', 0, n);
      let idx;
      while ((idx = f.rest.indexOf('\n')) >= 0) {
        const line = f.rest.slice(0, idx);
        f.rest = f.rest.slice(idx + 1);
        if (!line.trim()) continue;
        let d;
        try { d = JSON.parse(line); } catch { f.badLines = (f.badLines || 0) + 1; continue; }
        handleLine(f.session, d, live);
      }
    }
    f.offset = pos;
  } finally { fs.closeSync(fd); }
}

function scan(initial) {
  const root = path.join(cfg.configDir, 'projects');
  for (const p of listTranscripts(root)) {
    let f = files.get(p);
    if (!f) {
      f = { offset: 0, rest: '', session: path.basename(p, '.jsonl') };
      files.set(p, f);
      if (!initial) { readNew(p, f, true); continue; } // a session that appeared after start: live
      const saved = state.files[p];
      if (Number.isFinite(saved) && saved > 0) {
        // Known file: resume where the previous run stopped.
        f.offset = saved;
        readNew(p, f, true);
      } else {
        // Unknown at start: aggregate only, report a summary; live events start after this point.
        readNew(p, f, false);
        const s = sessions.get(f.session);
        if (s && s.started) emit(summaryEvent(s, { backfill: true }));
      }
    } else {
      readNew(p, f, true);
    }
    if (state.files[p] !== f.offset) { state.files[p] = f.offset; stateDirty = true; }
  }
}

// --- git state -------------------------------------------------------------------
// Read-only, and never over the network: the remote state comes from the refs
// the last fetch on the host left in the repository.

function git(dir, args) {
  try {
    const r = spawnSync('git', ['-C', dir, '-c', 'gc.auto=0', ...args], {
      encoding: 'utf8', timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    });
    return r.status === 0 ? r.stdout.replace(/\n+$/, '') : null;
  } catch { return null; }
}

function count(s) { const n = parseInt(s, 10); return Number.isFinite(n) ? n : 0; }

// The default branch as a ref: origin/HEAD, else main or master.
function defaultBranch(ws) {
  const head = git(ws, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
  if (head) return `refs/remotes/${head}`;
  for (const ref of ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']) {
    if (git(ws, ['show-ref', '--verify', '-q', ref]) !== null) return ref;
  }
  return null;
}

// One checkout: state against the default branch and against its remote
// counterpart (the configured upstream on origin, else origin/<branch>).
function worktreeState(dir, def) {
  const w = { path: dir, branch: null, ahead: 0, dirty: 0, added: 0, removed: 0, subject: null, committed: null,
    remote: 'none', upstream: null, unpushed: null, behind: null };
  const st = git(dir, ['status', '--porcelain=v2', '--branch']);
  if (st === null) return null;
  let upstream = null; let ab = null;
  for (const line of st.split('\n')) {
    if (line.startsWith('# branch.head ')) { const h = line.slice(14); w.branch = h === '(detached)' ? null : h; }
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) ab = line.match(/\+(\d+) -(\d+)/);
    else if (line && !line.startsWith('#')) w.dirty += 1;
  }
  if (upstream && upstream.startsWith('origin/')) {
    if (ab) { w.remote = 'ok'; w.upstream = upstream; w.unpushed = count(ab[1]); w.behind = count(ab[2]); }
    else w.remote = 'gone';
  } else if (w.branch && git(dir, ['show-ref', '--verify', '-q', `refs/remotes/origin/${w.branch}`]) !== null) {
    const lr = git(dir, ['rev-list', '--left-right', '--count', `HEAD...refs/remotes/origin/${w.branch}`]);
    if (lr !== null) {
      const [a, b] = lr.split(/\s+/);
      w.remote = 'ok'; w.upstream = `origin/${w.branch}`; w.unpushed = count(a); w.behind = count(b);
    }
  }
  if (def) {
    w.ahead = count(git(dir, ['rev-list', '--count', `${def}..HEAD`]));
    const stat = git(dir, ['diff', '--shortstat', `${def}...HEAD`]) || '';
    const ins = stat.match(/(\d+) insertion/); const del = stat.match(/(\d+) deletion/);
    w.added = ins ? count(ins[1]) : 0; w.removed = del ? count(del[1]) : 0;
  }
  const last = git(dir, ['log', '-1', '--format=%s%x00%cI']);
  if (last) { const [subject, committed] = last.split('\0'); w.subject = truncate(subject, SUMMARY_LIMIT); w.committed = committed || null; }
  return w;
}

// The git event for the workspace, or null when it is not a repository.
function gitEvent(ws) {
  if (!fs.existsSync(path.join(ws, '.git'))) return null;
  const list = git(ws, ['worktree', 'list', '--porcelain']);
  if (list === null) return null;
  const def = defaultBranch(ws);
  const worktrees = [];
  for (const line of list.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const dir = line.slice(9);
    if (!fs.existsSync(dir)) continue; // a stale record
    const w = worktreeState(dir, def);
    if (w) worktrees.push(w);
  }
  let fetchedAt = null;
  const common = git(ws, ['rev-parse', '--git-common-dir']);
  if (common) {
    try { fetchedAt = fs.statSync(path.join(path.resolve(ws, common), 'FETCH_HEAD')).mtime.toISOString(); } catch { /* never fetched */ }
  }
  return { type: 'git', worktrees, fetched_at: fetchedAt };
}

// --- periodic checks -----------------------------------------------------------

function checkWaiting() {
  const now = Date.now();
  for (const s of sessions.values()) {
    for (const [, p] of s.pending) {
      if (!p.flagged && now - p.ts > WAITING_MS) {
        p.flagged = true;
        emit({ type: 'waiting', session: s.id, tool: p.tool, summary: p.summary, source: 'heuristic' });
      }
    }
    if (!s.ended && s.last && now - Date.parse(s.last) > IDLE_END_MS) {
      s.ended = true;
      emit({ type: 'session_end', session: s.id, reason: 'idle' });
    } else if (s.ended && s.last && now - Date.parse(s.last) <= IDLE_END_MS) {
      s.ended = false; // woke up again
    }
  }
}

function heartbeat() {
  emit({ type: 'heartbeat', phase: readPhase(), uptime_s: containerUptimeS(), image: cfg.image,
    claude_version: claudeVersion(), spawn: cfg.spawn || null });
  const g = gitEvent(cfg.workspace);
  if (g) emit(g);
  flush();
}

// --- modes ------------------------------------------------------------------------

function parseKv(args) {
  const ev = {};
  for (const a of args) {
    const i = a.indexOf('=');
    if (i <= 0) continue;
    const k = a.slice(0, i), v = a.slice(i + 1);
    ev[k] = /^-?\d+$/.test(v) ? parseInt(v, 10) : v;
  }
  return ev;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--version') { console.log(VERSION); return; }

  if (args[0] === '--git') {
    const g = gitEvent(args[1] || cfg.workspace);
    if (g) console.log(JSON.stringify(g));
    return;
  }

  if (args[0] === '--dry-run') {
    dryRun = true;
    state.run = 'dry';
    for (const p of args.slice(1)) {
      const f = { offset: 0, rest: '', session: path.basename(p, '.jsonl') };
      readNew(p, f, true);
    }
    for (const ev of dryOut) console.log(JSON.stringify(ev));
    return;
  }

  if (args[0] === '--hook') {
    loadState();
    // Claude Code Notification hook. Always logs (for the spike), emits only
    // for permission prompts when reporting is configured.
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    let d = {};
    try { d = JSON.parse(raw); } catch { /* keep raw */ }
    try {
      const logFile = env.CRB_HOOK_LOG || '/tmp/crb-hook.log';
      let lines = [];
      try { lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean); } catch { /* none */ }
      lines.push(JSON.stringify({ ts: new Date().toISOString(), hook: d && Object.keys(d).length ? d : raw.slice(0, 2000) }));
      fs.writeFileSync(logFile, lines.slice(-200).join('\n') + '\n');
    } catch { /* best effort */ }
    if (!cfg.url) return;
    const kind = String(d.notification_type || d.type || '');
    const msg = String(d.message || d.title || '');
    if (/permission/i.test(kind) || /permission/i.test(msg)) {
      emit({ type: 'waiting', session: d.session_id || null, source: 'hook', summary: truncate(oneLine(msg), SUMMARY_LIMIT) });
      await flush();
    }
    return;
  }

  if (args[0] === '--emit') {
    if (!cfg.url) return;
    // Own counter and run suffix: these one-shot processes must not race the daemon.
    loadState(); saveState();
    let eseq = 0;
    try { eseq = parseInt(fs.readFileSync(cfg.emitSeqFile, 'utf8'), 10) || 0; } catch { /* fresh */ }
    eseq += 1;
    try { fs.writeFileSync(cfg.emitSeqFile, String(eseq)); } catch { /* best effort */ }
    state.run = `${state.run}.e`;
    state.seq = eseq - 1;
    const ev = parseKv(args.slice(1));
    if (ev.type === 'heartbeat') {
      Object.assign(ev, { uptime_s: containerUptimeS(), image: cfg.image, claude_version: claudeVersion(), spawn: cfg.spawn || null });
      if (!ev.phase) ev.phase = readPhase();
    }
    emit(ev);
    await flush();
    return;
  }

  if (!cfg.url) { log('CRB_STATUS_URL is not set, nothing to do'); return; }
  if (!cfg.token) log('CRB_STATUS_TOKEN is empty, sending without a token');
  loadState();
  log(`reporting ${cfg.box} to ${cfg.url} (run ${state.run}${stateFresh ? ', fresh state' : ''})`);

  scan(true);
  saveState();
  heartbeat();
  setInterval(() => scan(false), SCAN_MS);
  setInterval(checkWaiting, 1000);
  setInterval(heartbeat, HEARTBEAT_MS);
  setInterval(flush, BATCH_MS);
  setInterval(saveState, STATE_SAVE_MS);

  const stop = () => { saveState(); flush().finally(() => process.exit(0)); setTimeout(() => process.exit(0), SEND_TIMEOUT_MS + 500); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => { log(`fatal: ${e && e.stack || e}`); process.exit(1); });
