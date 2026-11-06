import { useEffect, useState } from 'react';
import { ChevronDown, Copy, ExternalLink, GitBranch, Hourglass, Terminal, Check, X } from 'lucide-react';
import type { BoxCard as BoxCardModel, SessionCard, TimelineEvent } from '@shared/types';
import { modelLabel } from '@shared/model.js';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Clawd, type ClawdPose } from '@/components/Clawd';
import { fetchTimeline } from '@/lib/api';
import { cn, fmtDuration, fmtTime, fmtTokens } from '@/lib/utils';

const PHASE_LABEL: Record<string, string> = {
  running: 'läuft', 'waiting-setup': 'wartet auf Setup', 'waiting-config': 'Config nicht beschreibbar', restarting: 'startet neu',
};

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
  const setupPending = box.phase === 'waiting-setup' || box.phase === 'waiting-config';

  return (
    <Card className={cn('gap-3', active?.state === 'waiting' && box.up && 'ring-2 ring-warning/60')}>
      <CardHeader className="flex-row items-center gap-2">
        <span className={cn('inline-block size-2.5 shrink-0 rounded-full', dotClass(box))} aria-hidden />
        <span className="min-w-0 truncate font-semibold">{box.name}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {box.up
            ? <Badge variant="secondary">{PHASE_LABEL[box.phase ?? ''] ?? box.phase ?? '–'}</Badge>
            : <Badge variant="outline" className="text-muted-foreground">offline{box.last_heartbeat ? ` seit ${fmtDuration(now - Date.parse(box.last_heartbeat))}` : ''}</Badge>}
          {box.permission_mode && <Badge variant="outline">{box.permission_mode}</Badge>}
        </span>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <Stage box={box} s={active} now={now} />
        {setupPending && box.up ? (
          <Alert>
            <Terminal />
            <AlertTitle>{box.phase === 'waiting-setup' ? 'Setup fehlt' : 'Config-Ordner gehört nicht dem Container'}</AlertTitle>
            <AlertDescription>
              <code className="text-xs break-all">
                {box.phase === 'waiting-setup' ? `docker compose exec -it ${box.name} setup` : `docker compose logs ${box.name}`}
              </code>
            </AlertDescription>
          </Alert>
        ) : active ? (
          <SessionBlock s={active} now={now} up={box.up} />
        ) : null}
      </CardContent>

      {active && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CardFooter className="justify-between gap-2">
            <SessionLink s={active} />
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Verlauf">
                Verlauf <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          </CardFooter>
          <CollapsibleContent>
            <div className="px-4 pt-3">{open && <Timeline session={active.id} now={now} />}</div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

function SessionBlock({ s, now, up }: { s: SessionCard; now: number; up: boolean }) {
  const ratio = s.context_window ? Math.min(100, Math.round((s.context / s.context_window) * 100)) : 0;
  return (
    <>
      {s.state === 'waiting' && up && (
        <Alert variant="warning">
          <Hourglass />
          <AlertTitle>Wartet auf dich{s.waiting_since ? ` · ${fmtDuration(now - Date.parse(s.waiting_since))}` : ''}</AlertTitle>
          {s.waiting_text && <AlertDescription><span className="break-all font-mono text-xs">{s.waiting_text}</span></AlertDescription>}
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-sm" title={s.label !== s.id ? s.label : undefined}>
          <span className="text-muted-foreground min-w-0 truncate text-xs">{sessionAge(s, now)}</span>
          {s.model && <span className="text-muted-foreground shrink-0 text-xs">{modelLabel(s.model)}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Kontext {fmtTokens(s.context)}/{fmtTokens(s.context_window)}</span>
          <Progress value={ratio} className="h-1" indicatorClassName={ratio > 85 ? 'bg-destructive' : ratio > 60 ? 'bg-warning' : undefined} />
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span>{fmtTokens(s.tokens_in + s.cache_read + s.cache_write)} in · {fmtTokens(s.tokens_out)} out</span>
          <span>{s.turns} Züge · {s.tool_calls} Tools</span>
          {s.cost_usd != null && <span>~{s.cost_usd.toFixed(2)} $</span>}
          {(s.lines_added != null || s.lines_removed != null) && (
            <span><span className="text-success">+{s.lines_added ?? 0}</span> / <span className="text-destructive">-{s.lines_removed ?? 0}</span></span>
          )}
        </div>
        {(s.branch || s.git) && (
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <GitBranch className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{s.git?.branch ?? s.branch}</span>
            {s.git && (
              <span className="shrink-0">
                {s.git.ahead > 0 && <>· {s.git.ahead} Commit{s.git.ahead === 1 ? '' : 's'} vor main </>}
                {s.git.dirty > 0 && <>· {s.git.dirty} geändert</>}
              </span>
            )}
          </div>
        )}
      </div>
    </>
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

// The stage: Clawd acts out the state, the activity text stands to his right.
function Stage({ box, s, now }: { box: BoxCardModel; s: SessionCard | null; now: number }) {
  let pose: ClawdPose;
  let text: string;
  let muted = true;
  if (!box.up) {
    pose = 'sleep'; text = 'Box offline';
  } else if (box.phase === 'waiting-setup' || box.phase === 'waiting-config') {
    pose = 'wrench'; text = box.phase === 'waiting-setup' ? 'wartet auf Setup' : 'wartet auf den Config-Ordner';
  } else if (!s) {
    pose = 'sit'; text = 'noch keine Session';
  } else if (s.state === 'ended') {
    pose = 'sleep'; text = `Session beendet${s.ended_at ? ' ' + fmtTime(s.ended_at) : ''}`;
  } else if (s.state === 'waiting') {
    pose = 'wait'; text = 'wartet auf dich'; muted = false;
  } else if (s.state === 'working') {
    pose = 'walk'; text = 'arbeitet'; muted = false;
  } else {
    const since = s.last_activity ? fmtDuration(now - Date.parse(s.last_activity)) : '';
    pose = 'sit'; text = `idle${since ? ` seit ${since}` : ''}`;
  }
  return (
    <div className="flex h-6 min-w-0 items-center gap-3">
      <div className="clawd-track min-w-0 flex-1"><Clawd pose={pose} /></div>
      <span className={cn('shrink-0 text-sm', muted && 'text-muted-foreground')}>{text}</span>
    </div>
  );
}

function SessionLink({ s }: { s: SessionCard }) {
  const [copied, setCopied] = useState(false);
  if (s.url) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href={s.url} target="_blank" rel="noreferrer"><ExternalLink /> In der App öffnen</a>
      </Button>
    );
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(s.id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} title={s.id}>
      {copied ? <Check /> : <Copy />} Session-ID
    </Button>
  );
}

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
