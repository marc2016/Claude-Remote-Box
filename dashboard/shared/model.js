// Shared between server and web app: thresholds, derived states, model table.
// Plain JS with JSDoc so the server runs it without a build; types.ts mirrors it.

/** Seconds without a heartbeat after which a box counts as down. */
export const DOWN_AFTER_S = 90;
/** Seconds since the last event after which a session counts as idle. */
export const IDLE_AFTER_S = 60;

/** Context window per model prefix, used only for the ratio on the card. */
const CONTEXT_WINDOWS = [
  ['claude-opus-5', 200000],
  ['claude-sonnet-5', 200000],
  ['claude-haiku-5', 200000],
  ['claude-fable-5', 200000],
];
export const DEFAULT_CONTEXT_WINDOW = 200000;

/** @param {string | null | undefined} model */
export function contextWindow(model) {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  for (const [prefix, size] of CONTEXT_WINDOWS) if (model.startsWith(prefix)) return size;
  return DEFAULT_CONTEXT_WINDOW;
}

/** Short display name for a model id, e.g. "Opus 5.5". */
export function modelLabel(model) {
  if (!model) return '';
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return model;
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`;
}

/**
 * URL that opens a session in the Claude app or claude.ai/code. Returns null
 * until the pattern is confirmed (task 1.1); the card then shows the id with
 * a copy button instead.
 * @param {string} sessionId
 * @returns {string | null}
 */
export function sessionUrl(sessionId) {
  void sessionId;
  return null;
}

/**
 * @param {{ last_heartbeat: string | null }} box
 * @param {number} nowMs
 */
export function boxUp(box, nowMs) {
  if (!box.last_heartbeat) return false;
  return nowMs - Date.parse(box.last_heartbeat) < DOWN_AFTER_S * 1000;
}

/**
 * Activity state of a session.
 * @param {{ ended_at: string | null, waiting_since: string | null, last: string | null }} s
 * @param {number} nowMs
 * @returns {'ended' | 'waiting' | 'working' | 'idle'}
 */
export function sessionState(s, nowMs) {
  if (s.ended_at) return 'ended';
  if (s.waiting_since) return 'waiting';
  if (s.last && nowMs - Date.parse(s.last) < IDLE_AFTER_S * 1000) return 'working';
  return 'idle';
}

/** Event types the UI shows in a session timeline. */
export const TIMELINE_TYPES = ['prompt', 'reply', 'tool', 'tool_result', 'waiting', 'resumed'];
