import { GitBranch } from 'lucide-react';
import type { BoxGit } from '@shared/types';
import { gitStateParts, gitSummary } from '@shared/model.js';
import { cn, fmtDuration } from '@/lib/utils';

function fetchAge(git: BoxGit, now: number): string {
  return git.fetched_at ? `Fetch vor ${fmtDuration(now - Date.parse(git.fetched_at))}` : 'Fetch nie';
}

/**
 * Every checkout of a box against origin. Read-only: syncing happens on the
 * host with `./crb git sync`. `compact` is the single line for narrow screens.
 */
export function GitOverview({ git, now, compact = false, className }: { git: BoxGit | null; now: number; compact?: boolean; className?: string }) {
  if (!git || !git.worktrees.length) return null;
  if (compact) {
    const { unpushed, behind } = gitSummary(git.worktrees);
    return (
      <div className={cn('git-overview text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs leading-4 whitespace-nowrap', className)}>
        <GitBranch className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{unpushed} nicht gepusht · {behind} hinter · {fetchAge(git, now)}</span>
      </div>
    );
  }
  return (
    <div className={cn('git-overview flex min-w-0 flex-col gap-1.5 text-xs', className)}>
      <div className="text-muted-foreground flex items-baseline justify-between gap-2 leading-4">
        <span className="text-foreground font-medium">Git</span>
        <span className="shrink-0">{fetchAge(git, now)}</span>
      </div>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {git.worktrees.map((w) => (
          <li key={w.path} className="text-muted-foreground flex min-w-0 items-baseline justify-between gap-2 leading-4 whitespace-nowrap" title={w.path}>
            <span className="text-foreground min-w-0 truncate" style={{ flexShrink: 1000 }}>{w.branch ?? 'ohne Branch'}</span>
            <span className="min-w-0 truncate">{gitStateParts(w).join(' · ') || '–'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
