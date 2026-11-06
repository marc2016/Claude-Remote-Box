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
