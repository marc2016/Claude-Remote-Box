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

/**
 * The words after the branch name: push state, then changed files. With an
 * unknown remote state (a box from before these fields) it is the commits
 * ahead of the default branch, as before.
 * @param {{ ahead?: number, dirty?: number, remote?: 'ok' | 'none' | 'gone', unpushed?: number | null, behind?: number | null } | null | undefined} w
 * @returns {string[]}
 */
export function gitStateParts(w) {
  if (!w) return [];
  const parts = [];
  const ahead = w.ahead ?? 0;
  switch (w.remote) {
    case 'ok':
      if (w.unpushed) parts.push(`${w.unpushed} nicht gepusht`);
      if (w.behind) parts.push(`${w.behind} hinter`);
      if (!w.unpushed && !w.behind) parts.push('gepusht');
      break;
    case 'none':
      if (ahead > 0) parts.push('nicht auf origin');
      break;
    case 'gone':
      parts.push('auf origin gelöscht');
      break;
    default:
      if (ahead > 0) parts.push(`${ahead} Commit${ahead === 1 ? '' : 's'} vor`);
  }
  if (w.dirty) parts.push(`${w.dirty} geändert`);
  return parts;
}

/**
 * Counts for the one-line summary of a box's checkouts.
 * @param {Array<{ ahead?: number, remote?: string, unpushed?: number | null, behind?: number | null }>} worktrees
 * @returns {{ unpushed: number, behind: number }}
 */
export function gitSummary(worktrees) {
  let unpushed = 0; let behind = 0;
  for (const w of worktrees) {
    if ((w.remote === 'ok' && w.unpushed) || (w.remote === 'none' && (w.ahead ?? 0) > 0)) unpushed += 1;
    if (w.remote === 'ok' && w.behind) behind += 1;
  }
  return { unpushed, behind };
}

/**
 * The warning for a checkout that lacks commits of origin's default branch:
 * "12 hinter main", or null. Not for the default branch itself (its distance
 * is the ordinary "behind"), and not for a box that does not report the field.
 * @param {{ branch?: string | null, behind_default?: number | null } | null | undefined} w
 * @param {string | null | undefined} defaultBranch
 * @returns {string | null}
 */
export function gitStale(w, defaultBranch) {
  if (!w || !defaultBranch || !w.branch || w.branch === defaultBranch) return null;
  return w.behind_default ? `${w.behind_default} hinter ${defaultBranch}` : null;
}

/**
 * Which actions the reported state of a checkout allows. The page offers
 * them; the host agent looks again and decides.
 * @param {{ branch?: string | null, ahead?: number, remote?: 'ok' | 'none' | 'gone', unpushed?: number | null, behind?: number | null } | null | undefined} w
 * @param {string | null | undefined} defaultBranch
 * @returns {{ push: boolean, pull: boolean, merge: boolean, diverged: boolean }}
 */
export function gitActions(w, defaultBranch) {
  const none = { push: false, pull: false, merge: false, diverged: false };
  if (!w || !w.branch || !w.remote) return none;
  const ahead = w.ahead ?? 0;
  const unpushed = w.remote === 'ok' ? w.unpushed ?? 0 : 0;
  const behind = w.remote === 'ok' ? w.behind ?? 0 : 0;
  return {
    push: (unpushed > 0 && behind === 0) || (w.remote === 'none' && ahead > 0),
    pull: behind > 0 && unpushed === 0,
    // A diverged branch is resolved on the host first; the page offers nothing for it.
    merge: Boolean(defaultBranch) && w.branch !== defaultBranch && ahead > 0 && !(unpushed > 0 && behind > 0),
    diverged: unpushed > 0 && behind > 0,
  };
}

/**
 * True while the checkouts shown are older than the last finished action: the
 * box reports on its own schedule, up to half a minute later. Every action
 * starts with a fetch, so a report from after it carries a newer fetch time.
 * Gives up after a minute, for an action that never got to fetch.
 * @param {{ started?: string | null, finished?: string | null } | null | undefined} last
 * @param {string | null | undefined} fetchedAt
 * @param {number} now
 */
export function gitSettling(last, fetchedAt, now) {
  if (!last || !last.started || !last.finished) return false;
  if (now - Date.parse(last.finished) > 60000) return false;
  return !fetchedAt || Date.parse(fetchedAt) < Date.parse(last.started);
}

/** A branch name the dashboard accepts; the same rule as the server's. */
export const validBranchName = (v) => typeof v === 'string' && /^[A-Za-z0-9._/-]{1,100}$/.test(v) && !v.startsWith('-');

/**
 * Queues an action and, when the server asks for a recent passkey
 * confirmation, runs it once and queues again.
 * @param {() => Promise<{ status: number, error?: string }>} post sends the action
 * @param {() => Promise<boolean>} confirm asks for the passkey; true when it was given
 * @returns {Promise<'queued' | 'unconfirmed' | 'absent' | 'limited' | 'signed-out' | 'error'>}
 */
export async function queueWithConfirm(post, confirm) {
  let r = await post();
  if (r.status === 403 && r.error === 'confirm') {
    if (!(await confirm())) return 'unconfirmed';
    r = await post();
    if (r.status === 403 && r.error === 'confirm') return 'unconfirmed';
  }
  if (r.status === 202) return 'queued';
  if (r.status === 503) return 'absent';
  if (r.status === 429) return 'limited';
  if (r.status === 401) return 'signed-out';
  return 'error';
}

/** Event types the UI shows in a session timeline. */
export const TIMELINE_TYPES = ['prompt', 'reply', 'tool', 'tool_result', 'waiting', 'resumed'];
