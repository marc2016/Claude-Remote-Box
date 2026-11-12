import { lazy, Suspense, useEffect } from 'react';
import { X } from 'lucide-react';
import type { BoxCard as BoxCardModel } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Clawd } from '@/components/Clawd';
import { Skeleton } from '@/components/ui/skeleton';
import { GitOverview } from '@/components/GitOverview';

// The conversation pulls in the Markdown renderer; load it only when a detail view opens.
const Conversation = lazy(() => import('@/components/Conversation').then((m) => ({ default: m.Conversation })));
import { activeSession, BoxHeader, cssName, deriveStatus, SessionBlock, SessionLink, StatusBox } from '@/components/BoxCard';

/**
 * The detail view of one box: the card's information on the left (on top on a
 * phone) and the conversation on the right (below). Rendered over the grid.
 */
export function DetailView({ box, now, tick, onClose }: { box: BoxCardModel; now: number; tick: number; onClose: () => void }) {
  const active = activeSession(box);
  const status = deriveStatus(box, active, now);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // Backdrop: the grid stays visible behind it; a tap outside the dialog closes.
    <div
      className="detail-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-2 backdrop-blur-sm md:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={box.name}
        style={{ viewTransitionName: `box-${cssName(box.name)}`, viewTransitionClass: 'box' } as React.CSSProperties}
        className="bg-card text-card-foreground flex h-full w-full max-w-6xl min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border p-3 shadow-2xl md:grid md:h-[min(92dvh,900px)] md:grid-cols-[minmax(280px,360px)_1fr] md:gap-4 md:p-4"
      >
        {/* information */}
        <section className="flex min-w-0 shrink-0 flex-col gap-3 rounded-xl border py-4 md:self-start">
          <BoxHeader box={box}>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Schließen" className="md:hidden"><X /></Button>
          </BoxHeader>
          <div className="flex flex-col gap-3 px-4">
            <div className="clawd-track hidden min-w-0 md:block"><Clawd pose={status.pose} /></div>
            <StatusBox status={status} />
            <div className="hidden md:block"><SessionBlock s={active} now={now} /></div>
            <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs md:hidden">
              <span className="min-w-0 truncate">{active ? `${active.turns} Züge · ${active.tool_calls} Tools` : '–'}</span>
              <SessionLink s={active} />
            </div>
            <GitOverview git={box.git} now={now} compact className="md:hidden" />
            <GitOverview git={box.git} now={now} className="hidden border-t pt-3 md:flex" />
            <div className="hidden md:block"><SessionLink s={active} /></div>
          </div>
        </section>

        {/* conversation */}
        <section className="relative flex min-h-0 flex-1 flex-col rounded-xl border">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-medium">Verlauf</span>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Schließen" className="hidden md:inline-flex"><X /></Button>
          </div>
          <Suspense fallback={<div className="flex flex-col gap-3 p-4"><Skeleton className="h-10 w-2/3 self-end rounded-xl" /><Skeleton className="h-16 w-3/4 rounded-xl" /></div>}>
            <Conversation session={active?.id ?? null} waiting={active?.state === 'waiting'} tick={tick} className="min-h-0 flex-1" />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
