import { useEffect, useState } from 'react';
import { ChevronDown, Copy, ExternalLink, GitBranch, Hourglass, Terminal, Check, X } from 'lucide-react';
import type { BoxCard as BoxCardModel, SessionCard, TimelineEvent } from '@shared/types';
import { modelLabel } from '@shared/model.js';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Clawd, type ClawdPose } from '@/components/Clawd';
import { fetchTimeline } from '@/lib/api';
import { cn, fmtDuration, fmtTime, fmtTokens } from '@/lib/utils';

const PHASE_LABEL: Record<string, string> = {
  running: 'läuft', 'waiting-setup': 'wartet auf Setup', 'waiting-config': 'Config nicht beschreibbar', restarting: 'startet neu',
};

const DASH = '–';

function dotClass(box: BoxCardModel): string {
  if (!box.up) return 'bg-muted-foreground/50';
  switch (box.phase) {
    case 'running': return 'bg-success';
    case 'restarting': return 'bg-destructive';
    case 'waiting-setup': case 'waiting-config': return 'bg-warning';
    default: return 'bg-muted-foreground';
  }
}

export function BoxCard({ box, now }: { box: BoxCardModel; now: number }) {
  const active = box.sessions.find((s) => s.state !== 'ended') ?? box.sessions[0] ?? null;
  const [open, setOpen] = useState(false);
  const status = deriveStatus(box, active, now);

  return (
    <Card className={cn('gap-3', status.variant === 'warning' && box.up && active?.state === 'waiting' && 'ring-2 ring-warning/60')}>
      <CardHeader className="flex-row items-center gap-2">
        <span className={cn('inline-block size-2.5 shrink-0 rounded-full', dotClass(box))} aria-hidden />
        <span className="min-w-0 truncate font-semibold">{box.name}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {box.up
            ? <Badge variant="secondary">{PHASE_LABEL[box.phase ?? ''] ?? box.phase ?? DASH}</Badge>
            : <Badge variant="outline" className="text-muted-foreground">offline</Badge>}
          {box.permission_mode && <Badge variant="outline">{box.permission_mode}</Badge>}
        </span>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="clawd-track min-w-0"><Clawd pose={status.pose} /></div>
        <StatusBox status={status} />
        <SessionBlock s={active} now={now} />
      </CardContent>

      <Collapsible open={open} onOpenChange={setOpen}>
        <CardFooter className="justify-between gap-2">
          <SessionLink s={active} />
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Verlauf" disabled={!active}>
              Verlauf <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
        </CardFooter>
        <CollapsibleContent>
          <div className="px-4 pt-3">{open && active && <Timeline session={active.id} now={now} />}</div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// --- status box ----------------------------------------------------------------

type Variant = 'success' | 'warning' | 'muted' | 'destructive';
interface Status { variant: Variant; pose: ClawdPose; title: string; detail: string; mono?: boolean }

function deriveStatus(box: BoxCardModel, s: SessionCard | null, now: number): Status {
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

function StatusBox({ status }: { status: Status }) {
  return (
    <div role="status" className={cn('status-box grid min-w-0 gap-0.5 rounded-lg border px-3 py-2', BOX_CLASS[status.variant])}>
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

// --- session block: always four rows ----------------------------------------------

function SessionBlock({ s, now }: { s: SessionCard | null; now: number }) {
  const ratio = s && s.context_window ? Math.min(100, Math.round((s.context / s.context_window) * 100)) : 0;
  const muted = 'text-muted-foreground';
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
        <span className="min-w-0 truncate">{s?.git?.branch ?? s?.branch ?? DASH}</span>
        {s?.git && (
          <span className="shrink-0">
            {s.git.ahead > 0 && <>· {s.git.ahead} Commit{s.git.ahead === 1 ? '' : 's'} vor </>}
            {s.git.dirty > 0 && <>· {s.git.dirty} geändert</>}
          </span>
        )}
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
function sessionAge(s: SessionCard, now: number): string {
  const parts: string[] = [];
  if (s.started) parts.push(`seit ${fmtDuration(now - Date.parse(s.started))}`);
  if (s.last_activity && new Date(s.last_activity).toDateString() !== new Date(now).toDateString()) {
    parts.push(`zuletzt ${fmtTime(s.last_activity)}`);
  }
  return parts.join(' · ');
}

// --- footer ---------------------------------------------------------------------------

function SessionLink({ s }: { s: SessionCard | null }) {
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

// --- timeline ----------------------------------------------------------------------------

function Timeline({ session, now }: { session: string; now: number }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchTimeline(session).then((e) => { if (alive) setEvents(e); }).catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [session, Math.floor(now / 10000)]);
  if (!events) return <div className="flex flex-col gap-2"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-8 w-1/2 self-end" /><Skeleton className="h-6 w-2/3" /></div>;
  if (!events.length) return <p className="text-muted-foreground text-sm">Noch keine Ereignisse.</p>;
  return (
    <div className="max-h-96 overflow-y-auto">
      <ol className="flex min-w-0 flex-col gap-2 pb-2 text-sm">
        {events.map((e) => <TimelineItem key={e.seq} e={e} />)}
      </ol>
    </div>
  );
}

function TimelineItem({ e }: { e: TimelineEvent }) {
  const time = <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">{fmtTime(e.ts)}</span>;
  switch (e.type) {
    case 'prompt':
      return <li className="flex flex-col items-end gap-0.5"><div className="bg-primary text-primary-foreground max-w-[85%] min-w-0 rounded-2xl rounded-br-sm px-3 py-1.5 whitespace-pre-wrap break-words">{e.text}</div>{time}</li>;
    case 'reply':
      return <li className="flex flex-col items-start gap-0.5"><div className="bg-muted max-w-[85%] min-w-0 rounded-2xl rounded-bl-sm px-3 py-1.5 whitespace-pre-wrap break-words">{e.text}</div>{time}</li>;
    case 'tool':
      return <li className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs"><Terminal className="size-3 shrink-0" /><span className="shrink-0 font-medium">{e.tool}</span><span className="min-w-0 truncate font-mono">{e.summary}</span>{time}</li>;
    case 'tool_result':
      return <li className="text-muted-foreground flex items-center gap-2 text-xs">{e.ok === false ? <X className="text-destructive size-3" /> : <Check className="text-success size-3" />}<span>{e.ok === false ? 'Fehler' : 'ok'}</span>{time}</li>;
    case 'waiting':
      return <li className="text-warning-foreground dark:text-warning flex items-center gap-2 text-xs"><Hourglass className="size-3" /><span>wartet{e.source === 'hook' ? ' (Freigabe)' : ''}</span>{time}</li>;
    case 'resumed':
      return <li className="text-muted-foreground flex items-center gap-2 text-xs"><Check className="size-3" /><span>weiter</span>{time}</li>;
    default:
      return null;
  }
}
