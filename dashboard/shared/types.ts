// Event contract as sent by the boxes (box-status-reporting, design D2) and
// the card model served by the dashboard. Keep in step with shared/model.js.

export type EventType =
  | 'phase' | 'heartbeat' | 'session_start' | 'prompt' | 'reply' | 'tool' | 'tool_result'
  | 'waiting' | 'resumed' | 'summary' | 'git' | 'session_end';

export interface BoxEvent {
  box: string;
  run?: string;
  ts: string;
  seq: number;
  type: EventType | string;
  session?: string | null;
  // phase / heartbeat
  phase?: string;
  uptime_s?: number | null;
  image?: string;
  claude_version?: string | null;
  spawn?: string | null;
  // session_start
  cwd?: string | null;
  branch?: string | null;
  permission_mode?: string | null;
  // prompt / reply
  text?: string;
  // tool / tool_result / waiting
  tool?: string;
  summary?: string;
  call_id?: string;
  ok?: boolean;
  source?: 'heuristic' | 'hook';
  // summary
  model?: string | null;
  tokens_in?: number;
  tokens_out?: number;
  cache_read?: number;
  cache_write?: number;
  context?: number;
  turns?: number;
  tool_calls?: number;
  started?: string | null;
  last?: string | null;
  cost_usd?: number;
  lines_added?: number;
  lines_removed?: number;
  // git
  worktrees?: GitWorktree[];
  fetched_at?: string | null;
  // session_end
  reason?: string;
  backfill?: boolean;
  sidechain?: boolean;
}

export interface GitWorktree {
  path: string;
  branch: string | null;
  ahead: number;
  dirty: number;
  added: number;
  removed: number;
  subject: string | null;
  committed: string | null;
  /** State against the remote counterpart; absent when the box is older than these fields. */
  remote?: 'ok' | 'none' | 'gone';
  upstream?: string | null;
  unpushed?: number | null;
  behind?: number | null;
  /** Commits of origin's default branch this checkout lacks; absent when the box is older than the field. */
  behind_default?: number | null;
}

/** Every checkout of a box and when its repository was last fetched. */
export interface BoxGit {
  fetched_at: string | null;
  /** Name of origin's default branch, e.g. "main"; null when unknown or the box is older than the field. */
  default_branch?: string | null;
  worktrees: GitWorktree[];
}

export type GitActionKind = 'fetch' | 'sync' | 'push' | 'pull' | 'merge' | 'branch';
export type GitActionState = 'queued' | 'running' | 'done' | 'refused' | 'failed' | 'expired';

/** A Git action queued for the host agent, and what became of it. */
export interface GitAction {
  id: string;
  box: string;
  kind: GitActionKind;
  branch: string | null;
  name: string | null;
  carry: boolean;
  state: GitActionState;
  queued: string;
  started: string | null;
  finished: string | null;
  text: string | null;
}

/** `GET /api/git`: whether actions exist at all (they need the login), the host agent, recent actions. */
export interface GitState {
  enabled: boolean;
  agent: { seen: boolean; present: boolean; at: string | null };
  actions: GitAction[];
}

export type SessionActivity = 'ended' | 'waiting' | 'working' | 'idle';

export interface SessionCard {
  id: string;
  box: string;
  label: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
  context: number;
  context_window: number;
  turns: number;
  tool_calls: number;
  started: string | null;
  last: string | null;
  cost_usd: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  permission_mode: string | null;
  branch: string | null;
  git: GitWorktree | null;
  state: SessionActivity;
  waiting_since: string | null;
  waiting_text: string | null;
  last_tool: string | null;
  last_activity: string | null;
  ended_at: string | null;
  url: string | null;
}

export interface BoxCard {
  name: string;
  up: boolean;
  phase: string | null;
  last_heartbeat: string | null;
  image: string | null;
  claude_version: string | null;
  spawn: string | null;
  permission_mode: string | null;
  git: BoxGit | null;
  sessions: SessionCard[];
}

export interface BoxesResponse {
  now: string;
  boxes: BoxCard[];
}

export interface TimelineEvent {
  /** Storage id on the dashboard: global order and paging key. */
  id: number;
  seq: number;
  ts: string;
  type: string;
  text?: string;
  tool?: string;
  summary?: string;
  call_id?: string;
  ok?: boolean;
  source?: string;
}
