// Git actions: the state of the queue and the host agent, and queuing with
// the passkey confirmation the server may ask for. The server side is
// server/git.js; the dashboard itself never runs Git.
import type { GitActionKind, GitState } from '@shared/types';
import { queueWithConfirm } from '@shared/model.js';
import { signIn, UnauthorizedError } from '@/lib/auth';

export async function fetchGit(): Promise<GitState> {
  const r = await fetch('/api/git', { cache: 'no-store' });
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) throw new Error(`git: ${r.status}`);
  return r.json();
}

export interface ActionRequest {
  box: string;
  kind: GitActionKind;
  branch?: string;
  name?: string;
  carry?: boolean;
}

export type QueueOutcome = Awaited<ReturnType<typeof queueWithConfirm>>;

/** What the page says when an action could not be queued. */
export const QUEUE_MESSAGES: Record<Exclude<QueueOutcome, 'queued'>, string> = {
  unconfirmed: 'Die Aktion wurde nicht bestätigt.',
  absent: 'Der Host-Agent antwortet nicht.',
  limited: 'Zu viele offene Aktionen. Bitte warten, bis sie fertig sind.',
  'signed-out': 'Die Sitzung ist beendet. Bitte neu anmelden.',
  error: 'Das hat nicht geklappt. Bitte noch einmal versuchen.',
};

/** Queues an action; asks for the passkey once when the sign-in is older than the server allows. */
export function queueAction(action: ActionRequest): Promise<QueueOutcome> {
  const post = async () => {
    const r = await fetch('/api/git/actions', {
      method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action),
    });
    let error: string | undefined;
    try { error = (await r.json()).error; } catch { /* no details */ }
    return { status: r.status, error };
  };
  return queueWithConfirm(post, async () => (await signIn().catch(() => 'error')) === null).catch((): QueueOutcome => 'error');
}
