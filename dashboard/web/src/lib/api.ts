import type { BoxesResponse, TimelineEvent } from '@shared/types';

export async function fetchBoxes(): Promise<BoxesResponse> {
  const r = await fetch('/api/boxes', { cache: 'no-store' });
  if (!r.ok) throw new Error(`boxes: ${r.status}`);
  return r.json();
}

export async function fetchTimeline(session: string, limit = 200): Promise<TimelineEvent[]> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(session)}/events?limit=${limit}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`events: ${r.status}`);
  const j = await r.json();
  return j.events as TimelineEvent[];
}

/** Opens the SSE stream; calls onChange with the affected box names. Returns a stop function. */
export function subscribe(onChange: (boxes: string[]) => void, onState?: (open: boolean) => void): () => void {
  let es: EventSource | null = null;
  let retry = 1000;
  let stopped = false;
  const connect = () => {
    if (stopped) return;
    es = new EventSource('/api/events');
    es.addEventListener('hello', () => { retry = 1000; onState?.(true); });
    es.addEventListener('changed', (e) => {
      try { onChange(JSON.parse((e as MessageEvent).data).boxes ?? []); } catch { onChange([]); }
    });
    es.onerror = () => {
      onState?.(false);
      es?.close();
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
  };
  connect();
  return () => { stopped = true; es?.close(); };
}
