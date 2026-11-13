#!/usr/bin/env node
// Posts a realistic event stream to a running dashboard, for development
// without boxes. Usage: CRB_STATUS_TOKEN=t node seed.mjs [http://127.0.0.1:8080]
// Four boxes: one waiting for approval, one working, one in waiting-setup,
// one whose session ended; then keeps the heartbeats going until Ctrl-C.
const base = process.argv[2] || 'http://127.0.0.1:8080';
const token = process.env.CRB_STATUS_TOKEN || 'dev';
const seqs = {};
const now = () => new Date().toISOString();
const yesterday = () => new Date(Date.now() - 26 * 3600 * 1000).toISOString();
const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
const ev = (box, type, extra = {}) => ({ box, ts: now(), seq: (seqs[box] = (seqs[box] || 0) + 1), type, ...extra });

async function post(events) {
  const r = await fetch(`${base}/api/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(events) });
  if (!r.ok) throw new Error(`ingest ${r.status}`);
}

// Wait for the server (npm run dev starts both at once).
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not yet */ }
  if (i === 99) { console.error(`seed: no server at ${base}`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 100));
}

const hb = (box, phase) => ev(box, 'heartbeat', { phase, image: '0.3.0', claude_version: '2.1.316', spawn: 'worktree', uptime_s: 7300 });

await post([
  ev('janus-note-vs', 'phase', { phase: 'running' }), hb('janus-note-vs', 'running'),
  ev('janus-note-vs', 'session_start', { session: 'sess-janus-1', cwd: '/workspace/.claude/worktrees/calm-clock', branch: 'session/calm-clock', claude_version: '2.1.316', permission_mode: 'auto' }),
  ev('janus-note-vs', 'prompt', { session: 'sess-janus-1', text: 'Zeig mir die Startseite auf dem Handy und fix die abgeschnittene Navigation' }),
  ev('janus-note-vs', 'tool', { session: 'sess-janus-1', tool: 'Bash', summary: 'npx playwright screenshot --device="iPhone 15" http://localhost:3000 start.png', call_id: 'c1' }),
  ev('janus-note-vs', 'tool_result', { session: 'sess-janus-1', call_id: 'c1', ok: true }),
  ev('janus-note-vs', 'reply', { session: 'sess-janus-1', text: 'Die Navigation läuft bei 390 px aus dem Viewport. Ich setze flex-wrap und reduziere das Padding.' }),
  ev('janus-note-vs', 'tool', { session: 'sess-janus-1', tool: 'Edit', summary: '/workspace/src/components/Nav.tsx', call_id: 'c2' }),
  ev('janus-note-vs', 'tool_result', { session: 'sess-janus-1', call_id: 'c2', ok: true }),
  ev('janus-note-vs', 'tool', { session: 'sess-janus-1', tool: 'Bash', summary: 'npm test', call_id: 'c3' }),
  ev('janus-note-vs', 'summary', { session: 'sess-janus-1', model: 'claude-opus-5-5', tokens_in: 310, tokens_out: 18400, cache_read: 1260000, cache_write: 42000, context: 84000, turns: 12, tool_calls: 41, cost_usd: 1.2, lines_added: 212, lines_removed: 37, started: now(), last: now() }),
  ev('janus-note-vs', 'waiting', { session: 'sess-janus-1', tool: 'Bash', summary: 'npm test', source: 'hook' }),
  ev('janus-note-vs', 'git', { fetched_at: minutesAgo(12), default_branch: 'main', worktrees: [
    { path: '/workspace', branch: 'main', ahead: 0, dirty: 0, added: 0, removed: 0, subject: 'Release 0.3.0', committed: now(), remote: 'ok', upstream: 'origin/main', unpushed: 0, behind: 3 },
    { path: '/workspace/.claude/worktrees/calm-clock', branch: 'session/calm-clock', ahead: 2, dirty: 1, added: 212, removed: 37, subject: 'Wrap navigation on small screens', committed: now(), remote: 'ok', upstream: 'origin/session/calm-clock', unpushed: 2, behind: 0, behind_default: 12 },
    { path: '/workspace/.claude/worktrees/brave-otter', branch: 'session/brave-otter-with-a-rather-long-descriptive-branch-name', ahead: 1, dirty: 0, added: 4, removed: 0, subject: 'Try another layout', committed: now(), remote: 'none', upstream: null, unpushed: null, behind: null },
    { path: '/workspace/.claude/worktrees/old-fix', branch: 'fix/login', ahead: 0, dirty: 0, added: 0, removed: 0, subject: 'Fix login redirect', committed: now(), remote: 'gone', upstream: null, unpushed: null, behind: null },
  ] }),

  ev('looptalk', 'phase', { phase: 'running' }), hb('looptalk', 'running'),
  ev('looptalk', 'session_start', { session: 'sess-loop-1', cwd: '/workspace', branch: 'main', permission_mode: 'default' }),
  ev('looptalk', 'prompt', { session: 'sess-loop-1', text: 'Schreib Tests für den Audio-Player' }),
  ev('looptalk', 'tool', { session: 'sess-loop-1', tool: 'Read', summary: '/workspace/src/player.ts', call_id: 'l1' }),
  ev('looptalk', 'tool_result', { session: 'sess-loop-1', call_id: 'l1', ok: true }),
  ev('looptalk', 'tool', { session: 'sess-loop-1', tool: 'Write', summary: '/workspace/src/player.test.ts', call_id: 'l2' }),
  ev('looptalk', 'git', { fetched_at: minutesAgo(2), worktrees: [{ path: '/workspace', branch: 'main', ahead: 0, dirty: 0, added: 0, removed: 0, subject: 'Add player tests', committed: now(), remote: 'ok', upstream: 'origin/main', unpushed: 0, behind: 0 }] }),
  ev('looptalk', 'summary', { session: 'sess-loop-1', model: 'claude-sonnet-5-5', tokens_in: 120, tokens_out: 6100, cache_read: 380000, cache_write: 12000, context: 31000, turns: 4, tool_calls: 9, started: now(), last: now() }),

  ev('flashagenda', 'phase', { phase: 'waiting-setup' }), hb('flashagenda', 'waiting-setup'),

  ev('archiv', 'phase', { phase: 'running' }), hb('archiv', 'running'),
  { ...ev('archiv', 'session_start', { session: 'sess-archiv-1', cwd: '/workspace', branch: 'main', permission_mode: 'default' }), ts: yesterday() },
  { ...ev('archiv', 'prompt', { session: 'sess-archiv-1', text: 'Changelog für 0.2.0 schreiben' }), ts: yesterday() },
  { ...ev('archiv', 'reply', { session: 'sess-archiv-1', text: 'Erledigt, der Changelog steht in CHANGELOG.md.' }), ts: yesterday() },
  { ...ev('archiv', 'summary', { session: 'sess-archiv-1', model: 'claude-haiku-5-5', tokens_in: 40, tokens_out: 900, cache_read: 20000, cache_write: 0, context: 12000, turns: 2, tool_calls: 3, started: yesterday(), last: yesterday() }), ts: yesterday() },
  ev('archiv', 'git', { worktrees: [{ path: '/workspace', branch: 'main', ahead: 3, dirty: 0, added: 40, removed: 2, subject: 'Changelog for 0.2.0', committed: yesterday() }] }),
  { ...ev('archiv', 'session_end', { session: 'sess-archiv-1', reason: 'idle' }), ts: yesterday() },
]);
console.log(`seeded ${base}; heartbeats every 30 s, Ctrl-C to stop`);

let i = 0;
setInterval(async () => {
  i += 1;
  const batch = [hb('janus-note-vs', 'running'), hb('looptalk', 'running'), hb('flashagenda', 'waiting-setup'), hb('archiv', 'running')];
  if (i % 2 === 0) batch.push(ev('looptalk', 'tool', { session: 'sess-loop-1', tool: 'Bash', summary: `npm test -- player (${i})`, call_id: `l${i + 10}` }), ev('looptalk', 'tool_result', { session: 'sess-loop-1', call_id: `l${i + 10}`, ok: i % 4 !== 0 }));
  await post(batch).catch((e) => console.error(e.message));
}, 30000);
