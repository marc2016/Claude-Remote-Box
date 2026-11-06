// Turns stored rows into the card model the web app renders.
import { boxUp, sessionState, contextWindow, sessionUrl } from '../shared/model.js';

export function buildCards(store, nowMs = Date.now()) {
  const boxes = store.boxes().map((b) => {
    const gitBox = b.git_json ? safeJson(b.git_json, []) : [];
    const sessions = store.sessionsOf(b.name).map((s) => sessionCard(s, gitBox, nowMs));
    const active = sessions.find((s) => s.state !== 'ended');
    return {
      name: b.name,
      up: boxUp(b, nowMs),
      phase: b.phase ?? null,
      last_heartbeat: b.last_heartbeat ?? null,
      image: b.image ?? null,
      claude_version: b.claude_version ?? null,
      spawn: b.spawn ?? null,
      permission_mode: active?.permission_mode ?? sessions[0]?.permission_mode ?? null,
      sessions,
    };
  });
  return { now: new Date(nowMs).toISOString(), boxes };
}

function sessionCard(s, gitBox, nowMs) {
  const git = pickWorktree(gitBox, s.cwd, s.branch);
  return {
    id: s.id,
    box: s.box,
    label: s.label ?? s.id,
    model: s.model ?? null,
    tokens_in: s.tokens_in ?? 0,
    tokens_out: s.tokens_out ?? 0,
    cache_read: s.cache_read ?? 0,
    cache_write: s.cache_write ?? 0,
    context: s.context ?? 0,
    context_window: contextWindow(s.model),
    turns: s.turns ?? 0,
    tool_calls: s.tool_calls ?? 0,
    started: s.started ?? null,
    last: s.last ?? null,
    cost_usd: s.cost_usd ?? null,
    lines_added: s.lines_added ?? null,
    lines_removed: s.lines_removed ?? null,
    permission_mode: s.permission_mode ?? null,
    branch: s.branch ?? git?.branch ?? null,
    git,
    state: sessionState({ ended_at: s.ended_at, waiting_since: s.waiting_since, last: s.last_activity ?? s.last }, nowMs),
    waiting_since: s.waiting_since ?? null,
    waiting_text: s.waiting_text ?? null,
    last_tool: s.last_tool ?? null,
    last_activity: s.last_activity ?? s.last ?? null,
    ended_at: s.ended_at ?? null,
    url: sessionUrl(s.id),
  };
}

function pickWorktree(worktrees, cwd, branch) {
  if (!Array.isArray(worktrees) || !worktrees.length) return null;
  return worktrees.find((w) => cwd && w.path === cwd)
    ?? worktrees.find((w) => branch && w.branch === branch)
    ?? null;
}

function safeJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
