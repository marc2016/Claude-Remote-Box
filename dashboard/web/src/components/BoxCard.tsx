import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronRight, Copy, ExternalLink, GitBranch, Hourglass, Check, TriangleAlert } from 'lucide-react';
import type { BoxCard as BoxCardModel, SessionCard } from '@shared/types';
import { gitStale, gitStateParts, modelLabel } from '@shared/model.js';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Clawd, type ClawdPose } from '@/components/Clawd';
import { cn, fmtDuration, fmtTime, fmtTokens } from '@/lib/utils';

const PHASE_LABEL: Record<string, string> = {
  running: 'läuft', 'waiting-setup': 'wartet auf Setup', 'waiting-config': 'Config nicht beschreibbar', restarting: 'startet neu',
};

const DASH = '–';

export function activeSession(box: BoxCardModel): SessionCard | null {
  return box.sessions.find((s) => s.state !== 'ended') ?? box.sessions[0] ?? null;
}

function dotClass(box: BoxCardModel): string {
  if (!box.up) return 'bg-muted-foreground/50';
  switch (box.phase) {
    case 'running': return 'bg-success';
    case 'restarting': return 'bg-destructive';
    case 'waiting-setup': case 'waiting-config': return 'bg-warning';
    default: return 'bg-muted-foreground';
  }
}

/** The card in the grid: tap anywhere (except a button) to open the detail view. */
/** `named`: this card takes part in the current open/close transition; while its dialog is open the name belongs to the dialog. */
export function BoxCard({ box, now, onOpen, named = false }: { box: BoxCardModel; now: number; onOpen: (name: string) => void; named?: boolean }) {
  const active = activeSession(box);
  const status = deriveStatus(box, active, now);
  const open = (e: MouseEvent | KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    onOpen(box.name);
  };
  return (
    <Card
      role="button" tabIndex={0} aria-label={`${box.name} öffnen`}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } }}
      style={named ? { viewTransitionName: `box-${cssName(box.name)}`, viewTransitionClass: 'box' } as React.CSSProperties : undefined}
      className={cn('cursor-pointer gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/60', status.variant === 'warning' && box.up && active?.state === 'waiting' && 'ring-2 ring-warning/60')}
    >
      <BoxHeader box={box} />
      <CardContent className="flex flex-col gap-3">
        <div className="clawd-track min-w-0"><Clawd pose={status.pose} /></div>
        <StatusBox status={status} />
        <SessionBlock s={active} now={now} defaultBranch={box.git?.default_branch} />
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <SessionLink s={active} />
        <Button variant="ghost" size="sm" onClick={() => onOpen(box.name)}>Öffnen <ChevronRight /></Button>
      </CardFooter>
    </Card>
  );
}

export function cssName(name: string): string { return name.replace(/[^a-zA-Z0-9_-]/g, '_'); }

// --- pieces shared by the card and the detail view ---------------------------------------

export function BoxHeader({ box, className, children }: { box: BoxCardModel; className?: string; children?: React.ReactNode }) {
  return (
    <CardHeader className={cn('flex-row items-center gap-2', className)}>
      <span className={cn('inline-block size-2.5 shrink-0 rounded-full', dotClass(box))} aria-hidden />
      <span className="min-w-0 truncate font-semibold">{box.name}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {box.up
          ? <Badge variant="secondary">{PHASE_LABEL[box.phase ?? ''] ?? box.phase ?? DASH}</Badge>
          : <Badge variant="outline" className="text-muted-foreground">offline</Badge>}
        {box.permission_mode && <Badge variant="outline">{box.permission_mode}</Badge>}
        {children}
      </span>
    </CardHeader>
  );
}

export type Variant = 'success' | 'warning' | 'muted' | 'destructive';
export interface Status { variant: Variant; pose: ClawdPose; title: string; detail: string; mono?: boolean }

export function deriveStatus(box: BoxCardModel, s: SessionCard | null, now: number): Status {
  if (!box.up) {
    return { variant: 'muted', pose: 'sleep', title: `Offline${box.last_heartbeat ? ` seit ${fmtDuration(now - Date.parse(box.last_heartbeat))}` : ''}`,
      detail: box.last_heartbeat ? `letzter Heartbeat ${fmtTime(box.last_heartbeat)}` : '' };
  }
  if (box.phase === 'restarting') return { variant: 'destructive', pose: 'wrench', title: 'Startet neu', detail: 'Server ist beendet, Neustart folgt' };
  if (box.phase === 'waiting-setup') return { variant: 'warning', pose: 'wrench', title: 'Setup fehlt', detail: `docker compose exec -it ${box.name} setup`, mono: true };
  if (box.phase === 'waiting-config') return { variant: 'warning', pose: 'wrench', title: 'Config-Ordner nicht beschreibbar', detail: `docker compose logs ${box.name}`, mono: true };
  if (!s) return { variant: 'muted', pose: 'sit', title: 'Noch keine Session', detail: '' };
  switch (s.state) {
    case 'ended':
      return { variant: 'muted', pose: 'sleep', title: 'Session beendet', detail: s.ended_at ? fmtTime(s.ended_at) : '' };
    case 'waiting':
      return { variant: 'warning', pose: 'wait', title: `Wartet auf dich${s.waiting_since ? ` · ${fmtDuration(now - Date.parse(s.waiting_since))}` : ''}`,
        detail: s.waiting_text ?? s.last_tool ?? '', mono: true };
    case 'working':
      return { variant: 'success', pose: 'walk', title: 'Arbeitet', detail: s.last_tool ?? '', mono: true };
    default:
      return { variant: 'muted', pose: 'sit', title: `Idle${s.last_activity ? ` seit ${fmtDuration(now - Date.parse(s.last_activity))}` : ''}`,
        detail: s.last_tool ?? '', mono: true };
  }
}

const BOX_CLASS: Record<Variant, string> = {
  success: 'border-success/60 bg-success/15 [&>.title]:text-success-foreground',
  warning: 'border-warning/60 bg-warning/15 [&>.title]:text-warning-foreground dark:[&>.title]:text-warning',
  muted: 'border-border bg-muted/60 [&>.title]:text-muted-foreground',
  destructive: 'border-destructive/60 bg-destructive/15 [&>.title]:text-destructive',
};

export function StatusBox({ status, className }: { status: Status; className?: string }) {
  return (
    <div role="status" className={cn('status-box grid min-w-0 gap-0.5 rounded-lg border px-3 py-2', BOX_CLASS[status.variant], className)}>
      <div className="title flex items-center gap-2 text-sm font-medium leading-5">
        {status.variant === 'warning' && status.pose === 'wait' ? <Hourglass className="size-4 shrink-0" /> : null}
        <span className="min-w-0 truncate">{status.title}</span>
      </div>
      <div className={cn('text-muted-foreground min-w-0 truncate text-xs leading-5', status.mono && 'font-mono')}>
        {status.detail || ' '}
      </div>
    </div>
  );
}

export function SessionBlock({ s, now, defaultBranch }: { s: SessionCard | null; now: number; defaultBranch?: string | null }) {
  const ratio = s && s.context_window ? Math.min(100, Math.round((s.context / s.context_window) * 100)) : 0;
  const muted = 'text-muted-foreground';
  const gitState = gitStateParts(s?.git).join(' · ');
  // The session works on a branch that lacks commits of the default branch.
  const stale = gitStale(s?.git, defaultBranch);
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className={cn('flex items-baseline justify-between gap-2 leading-4', muted)} title={s && s.label !== s.id ? s.label : undefined}>
        <span className="min-w-0 truncate">{s ? sessionAge(s, now) || DASH : DASH}</span>
        <span className="shrink-0">{s?.model ? modelLabel(s.model) : DASH}</span>
      </div>
      <div className={cn('flex items-center gap-2 leading-4', muted)}>
        <span className="shrink-0">Kontext {s ? `${fmtTokens(s.context)}/${fmtTokens(s.context_window)}` : DASH}</span>
        <Progress value={ratio} className="h-1" indicatorClassName={ratio > 85 ? 'bg-destructive' : ratio > 60 ? 'bg-warning' : undefined} />
      </div>
      <div className={cn('flex min-w-0 items-center gap-3 leading-4 whitespace-nowrap', muted)}>
        <span className="min-w-0 truncate">{s ? `${fmtTokens(s.tokens_in + s.cache_read + s.cache_write)} in · ${fmtTokens(s.tokens_out)} out` : DASH}</span>
        <span className="shrink-0">{s ? `${s.turns} Züge · ${s.tool_calls} Tools` : DASH}</span>
        {s?.cost_usd != null && <span className="shrink-0">~{s.cost_usd.toFixed(2)} $</span>}
      </div>
      <div className={cn('flex min-w-0 items-center gap-1.5 leading-4 whitespace-nowrap', muted)}>
        <GitBranch className="size-3 shrink-0" />
        {/* The branch name gives way first, the state only when even that is not enough. */}
        <span className={cn('truncate', gitState || stale ? 'min-w-14' : 'min-w-0')} style={{ flexShrink: 1000 }}>{s?.git?.branch ?? s?.branch ?? DASH}</span>
        {stale && <span className="git-stale text-warning-foreground flex shrink-0 items-center gap-1"><TriangleAlert className="size-3 shrink-0" />{stale}</span>}
        {gitState && <span className="git-state min-w-0 truncate">· {gitState}</span>}
        <span className="ml-auto shrink-0">
          {s && (s.lines_added != null || s.lines_removed != null)
            ? <><span className="text-success">+{s.lines_added ?? 0}</span> / <span className="text-destructive">-{s.lines_removed ?? 0}</span></>
            : DASH}
        </span>
      </div>
    </div>
  );
}

// "seit 2 h", plus "zuletzt <day time>" when the last activity was not today.
export function sessionAge(s: SessionCard, now: number): string {
  const parts: string[] = [];
  if (s.started) parts.push(`seit ${fmtDuration(now - Date.parse(s.started))}`);
  if (s.last_activity && new Date(s.last_activity).toDateString() !== new Date(now).toDateString()) {
    parts.push(`zuletzt ${fmtTime(s.last_activity)}`);
  }
  return parts.join(' · ');
}

export function SessionLink({ s }: { s: SessionCard | null }) {
  const [copied, setCopied] = useState(false);
  if (s?.url) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href={s.url} target="_blank" rel="noreferrer"><ExternalLink /> In der App öffnen</a>
      </Button>
    );
  }
  const copy = async () => {
    if (!s) return;
    try { await navigator.clipboard.writeText(s.id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} title={s?.id} disabled={!s}>
      {copied ? <Check /> : <Copy />} Session-ID
    </Button>
  );
}
