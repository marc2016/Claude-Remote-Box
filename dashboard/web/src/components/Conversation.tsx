import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { Check, Hourglass, Loader2, Terminal, X } from 'lucide-react';
import type { TimelineEvent } from '@shared/types';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle,
} from '@/components/ui/trace';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchTimeline, PAGE_SIZE } from '@/lib/api';
import { cn, fmtTime } from '@/lib/utils';

// --- grouping: prompts and replies as messages, tool bursts as one trace -------------

type ToolStatus = 'running' | 'done' | 'error' | 'waiting';
interface ToolItem { seq: number; ts: string; tool: string; summary: string; status: ToolStatus; callId?: string }
type Block =
  | { kind: 'prompt'; seq: number; ts: string; text: string }
  | { kind: 'reply'; seq: number; ts: string; text: string }
  | { kind: 'tools'; seq: number; items: ToolItem[] };
// `seq` in a block is the storage id of its first event (unique per dashboard).

function toBlocks(events: TimelineEvent[], waiting: boolean): Block[] {
  const blocks: Block[] = [];
  const byCall = new Map<string, ToolItem>();
  let lastTool: ToolItem | null = null;
  const tools = () => {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'tools') return last;
    const b: Block = { kind: 'tools', seq: 0, items: [] };
    blocks.push(b);
    return b;
  };
  for (const e of events) {
    switch (e.type) {
      case 'prompt': blocks.push({ kind: 'prompt', seq: e.id, ts: e.ts, text: e.text ?? '' }); break;
      case 'reply': blocks.push({ kind: 'reply', seq: e.id, ts: e.ts, text: e.text ?? '' }); break;
      case 'tool': {
        const item: ToolItem = { seq: e.id, ts: e.ts, tool: e.tool ?? 'Tool', summary: e.summary ?? '', status: 'running', callId: e.call_id };
        const g = tools();
        if (!g.seq) g.seq = e.id;
        g.items.push(item);
        if (e.call_id) byCall.set(e.call_id, item);
        lastTool = item;
        break;
      }
      case 'tool_result': {
        const item = (e.call_id && byCall.get(e.call_id)) || lastTool;
        if (item) item.status = e.ok === false ? 'error' : 'done';
        break;
      }
      case 'waiting': if (lastTool && lastTool.status === 'running') lastTool.status = 'waiting'; break;
      case 'resumed': if (lastTool && lastTool.status === 'waiting') lastTool.status = 'running'; break;
      default: break;
    }
  }
  // The card's waiting state wins over the heuristic: mark the last unfinished tool.
  if (waiting && lastTool && (lastTool as ToolItem).status === 'running') (lastTool as ToolItem).status = 'waiting';
  return blocks;
}

// --- component ------------------------------------------------------------------------

export function Conversation({ session, waiting, tick, className }: { session: string | null; waiting: boolean; tick: number; className?: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Latest page; merged by seq so a refetch only appends what is new.
  const loadLatest = useCallback(async () => {
    if (!session) { setEvents([]); setHasMore(false); return; }
    try {
      const page = await fetchTimeline(session, PAGE_SIZE);
      setEvents((prev) => {
        if (!prev) { setHasMore(page.length >= PAGE_SIZE); return page; }
        const known = new Set(prev.map((e) => e.id));
        const fresh = page.filter((e) => !known.has(e.id));
        return fresh.length ? [...prev, ...fresh].sort((a, b) => a.id - b.id) : prev;
      });
    } catch { setEvents((prev) => prev ?? []); }
  }, [session]);

  useEffect(() => { setEvents(null); setHasMore(false); void loadLatest(); }, [session, loadLatest]);
  useEffect(() => { if (tick > 0) void loadLatest(); }, [tick, loadLatest]);

  const loadOlder = async () => {
    if (!session || !events?.length || loadingMore) return;
    setLoadingMore(true);
    const viewport = rootRef.current?.querySelector<HTMLElement>('[data-slot=message-scroller-viewport]');
    const before = viewport ? viewport.scrollHeight - viewport.scrollTop : 0;
    try {
      const older = await fetchTimeline(session, PAGE_SIZE, events[0].id);
      setHasMore(older.length >= PAGE_SIZE);
      if (older.length) {
        setEvents((prev) => [...older, ...(prev ?? [])]);
        requestAnimationFrame(() => { if (viewport) viewport.scrollTop = viewport.scrollHeight - before; });
      }
    } finally { setLoadingMore(false); }
  };

  const blocks = useMemo(() => (events ? toBlocks(events, waiting) : []), [events, waiting]);

  if (!session) {
    return <div className={cn('text-muted-foreground flex h-full items-center justify-center p-6 text-sm', className)}>Noch keine Session.</div>;
  }
  if (!events) {
    return (
      <div className={cn('flex flex-col gap-3 p-4', className)}>
        <Skeleton className="h-10 w-2/3 self-end rounded-xl" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-16 w-3/4 rounded-xl" />
      </div>
    );
  }
  return (
    <div ref={rootRef} className={cn('flex min-h-0 flex-col', className)}>
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport className="px-4 py-4">
            <MessageScrollerContent className="gap-4">
              {hasMore && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={loadOlder} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="animate-spin" /> : null} frühere Einträge
                  </Button>
                </div>
              )}
              {blocks.length === 0 && <p className="text-muted-foreground text-center text-sm">Noch keine Einträge.</p>}
              {blocks.map((b) => (
                <MessageScrollerItem key={`${b.kind}-${b.seq}`}>
                  {b.kind === 'prompt' && <PromptBlock b={b} />}
                  {b.kind === 'reply' && <ReplyBlock b={b} />}
                  {b.kind === 'tools' && <ToolsBlock items={b.items} />}
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton direction="end" />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

function PromptBlock({ b }: { b: Extract<Block, { kind: 'prompt' }> }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end">
          <BubbleContent className="whitespace-pre-wrap">{b.text}</BubbleContent>
        </Bubble>
        <MessageFooter>{fmtTime(b.ts)}</MessageFooter>
      </MessageContent>
    </Message>
  );
}

function ReplyBlock({ b }: { b: Extract<Block, { kind: 'reply' }> }) {
  return (
    <Message align="start">
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
            <Streamdown>{b.text}</Streamdown>
          </BubbleContent>
        </Bubble>
        <MessageFooter>{fmtTime(b.ts)}</MessageFooter>
      </MessageContent>
    </Message>
  );
}

const STATUS_LABEL: Record<ToolStatus, string> = { running: 'läuft', done: 'ok', error: 'Fehler', waiting: 'Freigabe ausstehend' };

function ToolLine({ item }: { item: ToolItem }) {
  const status = item.status === 'error' ? 'error' : item.status === 'waiting' ? 'pending' : item.status === 'running' ? 'running' : undefined;
  return (
    <TraceLine status={status} className={cn(item.status === 'waiting' && 'text-warning-foreground dark:text-warning opacity-100')}>
      <TraceIcon>
        {item.status === 'done' && <Check className="text-success" />}
        {item.status === 'error' && <X />}
        {item.status === 'running' && <Loader2 className="animate-spin" />}
        {item.status === 'waiting' && <Hourglass />}
      </TraceIcon>
      <TraceTitle><span className="font-medium">{item.tool}</span>{item.summary ? <span className="font-mono text-xs">: {item.summary}</span> : null}</TraceTitle>
      <TraceDescription>{STATUS_LABEL[item.status]}</TraceDescription>
    </TraceLine>
  );
}

function ToolsBlock({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length <= 4) {
    return <Trace>{items.map((it) => <ToolLine key={it.seq} item={it} />)}</Trace>;
  }
  const last = items[items.length - 1];
  const errors = items.filter((i) => i.status === 'error').length;
  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={errors ? 'error' : last.status === 'running' ? 'running' : undefined}>
            <TraceIcon><Terminal /></TraceIcon>
            <TraceTitle>{items.length} Schritte{errors ? ` · ${errors} Fehler` : ''}</TraceTitle>
            <TraceDescription>zuletzt {last.tool}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-1.5">{items.map((it) => <ToolLine key={it.seq} item={it} />)}</div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
      {!open && last.status !== 'done' && <ToolLine item={last} />}
    </Trace>
  );
}
