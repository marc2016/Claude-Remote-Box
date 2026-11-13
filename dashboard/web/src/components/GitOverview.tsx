import { ChevronRight, GitBranch, TriangleAlert } from 'lucide-react';
import type { BoxCard, GitState } from '@shared/types';
import { gitStale, gitSummary } from '@shared/model.js';
import { GitPanel, Modal } from '@/components/GitPanel';
import { cn, fmtDuration } from '@/lib/utils';

/**
 * The Git state of a box in the detail view. From 768 px the list of checkouts
 * with its actions stands in place; below that, one line that opens the same
 * list in a sheet over the conversation.
 */
export function GitOverview({ box, git, now, sheet, onSheet }: { box: BoxCard; git: GitState | null; now: number; sheet: boolean; onSheet: (open: boolean) => void }) {
  const state = box.git;
  if (!state || !state.worktrees.length) return null;
  const { unpushed, behind } = gitSummary(state.worktrees);
  const stale = state.worktrees.some((w) => gitStale(w, state.default_branch));
  const working = git?.actions.some((a) => a.box === box.name && (a.state === 'queued' || a.state === 'running'));
  const age = state.fetched_at ? `Fetch vor ${fmtDuration(now - Date.parse(state.fetched_at))}` : 'Fetch nie';
  return (
    <>
      <button
        type="button" onClick={() => onSheet(true)} aria-haspopup="dialog" aria-label="Git: Branches und Aktionen öffnen"
        className={cn('git-overview text-muted-foreground -my-2 flex min-h-11 w-full min-w-0 items-center gap-1.5 text-left text-xs leading-4 whitespace-nowrap md:hidden')}
      >
        {stale ? <TriangleAlert className="text-warning-foreground size-3.5 shrink-0" /> : <GitBranch className="size-3 shrink-0" />}
        <span className="min-w-0 truncate">{unpushed} nicht gepusht · {behind} hinter · {working ? 'Aktion läuft' : age}</span>
        <ChevronRight className="ml-auto size-4 shrink-0" />
      </button>
      <GitPanel box={box} git={git} now={now} className="hidden border-t pt-3 md:flex" />
      {sheet && (
        <Modal title={`Git · ${box.name}`} onClose={() => onSheet(false)} className="md:hidden">
          <GitPanel box={box} git={git} now={now} />
        </Modal>
      )}
    </>
  );
}
