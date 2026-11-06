import { useCallback, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import type { BoxesResponse } from '@shared/types';
import { BoxCard } from '@/components/BoxCard';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchBoxes, subscribe } from '@/lib/api';

const REFRESH_MS = 30000;
const TICK_MS = 5000;

export default function App() {
  const [data, setData] = useState<BoxesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(() => {
    fetchBoxes().then((d) => { setData(d); setError(null); }).catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    refresh();
    const stop = subscribe(() => refresh(), setLive);
    const poll = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => { stop(); clearInterval(poll); clearInterval(tick); };
  }, [refresh]);

  const waiting = data?.boxes.filter((b) => b.up && b.sessions.some((s) => s.state === 'waiting')).length ?? 0;
  const sorted = data ? [...data.boxes].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)) : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl min-w-0 flex-col gap-4 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">claude-remote-box</h1>
        <span className="text-muted-foreground text-sm">{data ? `${data.boxes.length} Box${data.boxes.length === 1 ? '' : 'en'}` : ''}{waiting > 0 ? ` · ${waiting} wartet` : ''}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {live ? <span className="bg-success inline-block size-2 rounded-full" /> : <WifiOff className="size-3.5" />}
          {live ? 'live' : 'verbinde …'}
        </span>
      </header>

      {error && <p className="text-destructive text-sm">Server nicht erreichbar: {error}</p>}

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : data.boxes.length === 0 ? (
        <div className="text-muted-foreground mt-12 flex flex-col items-center gap-2 text-center text-sm">
          <p>Noch keine Box hat sich gemeldet.</p>
          <p>Setze <code>CRB_STATUS_URL</code> und <code>CRB_STATUS_TOKEN</code> in <code>box.yaml</code> und starte die Services neu, oder nutze <code>./crb dashboard</code>.</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((b) => <BoxCard key={b.name} box={b} now={now} />)}
        </div>
      )}
    </main>
  );
}

/** Waiting first, then running, then setup, then offline. */
function score(b: BoxesResponse['boxes'][number]): number {
  if (!b.up) return 0;
  if (b.sessions.some((s) => s.state === 'waiting')) return 4;
  if (b.phase === 'running') return 3;
  return 2;
}
