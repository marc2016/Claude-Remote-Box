import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LogOut, TriangleAlert, WifiOff } from 'lucide-react';
import type { BoxesResponse, GitState } from '@shared/types';
import { BoxCard } from '@/components/BoxCard';
import { DetailView } from '@/components/DetailView';
import { Enroll, SetupHint, SignIn, WrongAddress } from '@/components/AuthScreens';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchBoxes, subscribe } from '@/lib/api';
import { fetchGit } from '@/lib/git';
import { enrollSecret, fetchAuthState, signOut, UnauthorizedError, type AuthState } from '@/lib/auth';

const REFRESH_MS = 30000;
const TICK_MS = 5000;

/** `#<box>` opens a box, `#<box>/git` its Git sheet on top. A box name has no slash. */
function fromHash(): { box: string | null; git: boolean } {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const i = h.indexOf('/');
  return { box: (i < 0 ? h : h.slice(0, i)) || null, git: i >= 0 && h.slice(i + 1) === 'git' };
}

/** Runs a state change inside a view transition where the browser has it; `type` selects the CSS (open/close). */
function transition(update: () => void, type: 'open' | 'close') {
  const d = document as Document & { startViewTransition?: (arg: unknown) => unknown };
  if (typeof d.startViewTransition !== 'function') { update(); return; }
  const cb = () => flushSync(update);
  try { d.startViewTransition({ update: cb, types: [type] }); }
  catch { d.startViewTransition(cb); } // older signature: callback only
}

/** Decides between the dashboard and the screens of the login. */
export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [failed, setFailed] = useState(false);
  // The enrollment link's secret, until its passkey is stored.
  const [secret, setSecret] = useState<string | null>(enrollSecret);

  const check = useCallback(() => {
    fetchAuthState().then((s) => { setAuth(s); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    check();
    if (!failed) return;
    const retry = setInterval(check, 5000);
    return () => clearInterval(retry);
  }, [check, failed]);

  if (!auth) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-4 py-4">
        {failed ? <p className="text-destructive text-sm">Server nicht erreichbar.</p> : <Skeleton className="h-48 rounded-xl" />}
      </main>
    );
  }
  if (auth.auth === 'off') return <Dashboard />;
  if (secret) return <Enroll secret={secret} onDone={() => { setSecret(null); check(); }} />;
  if (auth.signedIn) return <Dashboard onUnauthorized={check} onSignOut={() => { signOut().catch(() => {}).finally(check); }} />;
  if (!auth.configured || !auth.passkeys) return <SetupHint />;
  if (auth.url !== location.origin) return <WrongAddress url={auth.url} />;
  return <SignIn onDone={check} />;
}

function Dashboard({ onUnauthorized, onSignOut }: { onUnauthorized?: () => void; onSignOut?: () => void }) {
  const [data, setData] = useState<BoxesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [openBox, setOpenBox] = useState<string | null>(() => fromHash().box);
  const [gitSheet, setGitSheet] = useState(() => fromHash().git);
  const [git, setGit] = useState<GitState | null>(null);
  const openRef = useRef(openBox);
  openRef.current = openBox;
  // The one card that takes part in the current transition (keeps the others off the animation layers).
  const [animBox, setAnimBox] = useState<string | null>(null);
  const [ticks, setTicks] = useState<Record<string, number>>({});

  const refresh = useCallback(() => {
    fetchBoxes().then((d) => { setData(d); setError(null); }).catch((e) => {
      // The session ended (sign-out elsewhere, logout on the host, or 30 days without use).
      if (e instanceof UnauthorizedError && onUnauthorized) onUnauthorized();
      else setError(String(e.message || e));
    });
    // A failing request leaves the last state: the boxes' request reports what is wrong.
    fetchGit().then(setGit).catch(() => {});
  }, [onUnauthorized]);

  useEffect(() => {
    refresh();
    const stop = subscribe((boxes) => {
      refresh();
      if (boxes.length) setTicks((t) => { const n = { ...t }; for (const b of boxes) n[b] = (n[b] ?? 0) + 1; return n; });
    }, (open) => {
      setLive(open);
      // The server closes the stream when the session ends; asking for the boxes shows whether that is why.
      if (!open) refresh();
    });
    const poll = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    const onHash = () => {
      const next = fromHash();
      setGitSheet(next.git);
      // Opening or closing the sheet keeps the box and must not replay its transition.
      if (openRef.current === next.box) return;
      setAnimBox((cur) => next.box ?? cur);
      transition(() => setOpenBox(next.box), next.box ? 'open' : 'close');
    };
    window.addEventListener('hashchange', onHash);
    return () => { stop(); clearInterval(poll); clearInterval(tick); window.removeEventListener('hashchange', onHash); };
  }, [refresh]);

  const open = useCallback((name: string) => {
    setAnimBox(name);
    history.pushState({ crbDetail: true }, '', `#${encodeURIComponent(name)}`);
    transition(() => setOpenBox(name), 'open');
  }, []);
  const close = useCallback(() => {
    if (history.state && (history.state as { crbDetail?: boolean }).crbDetail) history.back(); // triggers hashchange
    else { history.replaceState(null, '', location.pathname + location.search); transition(() => setOpenBox(null), 'close'); }
  }, []);

  const sheet = useCallback((show: boolean) => {
    if (show) {
      if (!openBox) return;
      history.pushState({ crbDetail: true, crbSheet: true }, '', `#${encodeURIComponent(openBox)}/git`);
      setGitSheet(true);
    } else if (history.state && (history.state as { crbSheet?: boolean }).crbSheet) history.back(); // triggers hashchange
    else { if (openBox) history.replaceState(history.state, '', `#${encodeURIComponent(openBox)}`); setGitSheet(false); }
  }, [openBox]);

  const waiting = data?.boxes.filter((b) => b.up && b.sessions.some((s) => s.state === 'waiting')).length ?? 0;
  const sorted = data ? [...data.boxes].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)) : [];
  const detail = openBox && data ? data.boxes.find((b) => b.name === openBox) ?? null : null;

  return (
    <>
      <main inert={detail ? true : undefined} className="mx-auto flex min-h-dvh w-full max-w-6xl min-w-0 flex-col gap-4 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <header className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">claude-remote-box</h1>
          <span className="text-muted-foreground text-sm">{data ? `${data.boxes.length} Box${data.boxes.length === 1 ? '' : 'en'}` : ''}{waiting > 0 ? ` · ${waiting} wartet` : ''}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            {live ? <span className="bg-success inline-block size-2 rounded-full" /> : <WifiOff className="size-3.5" />}
            {live ? 'live' : 'verbinde …'}
          </span>
          {onSignOut && (
            <Button variant="ghost" size="icon-sm" className="sm:w-auto sm:px-2.5" onClick={onSignOut} aria-label="Abmelden" title="Abmelden">
              <LogOut /> <span className="hidden sm:inline">Abmelden</span>
            </Button>
          )}
        </header>

        {error && <p className="text-destructive text-sm">Server nicht erreichbar: {error}</p>}
        {git?.enabled && git.agent.seen && !git.agent.present && (
          <p className="agent-absent bg-muted text-warning-foreground flex items-start gap-2 rounded-lg p-3 text-sm" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Der Git-Agent meldet sich nicht: kein Fetch, keine Git-Aktionen. Auf dem Host: <code className="font-mono whitespace-nowrap">./crb agent status</code></span>
          </p>
        )}

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
            {sorted.map((b) => <BoxCard key={b.name} box={b} now={now} onOpen={open} named={animBox === b.name && openBox !== b.name} />)}
          </div>
        )}
      </main>

      {detail && <DetailView box={detail} now={now} tick={ticks[detail.name] ?? 0} git={git} gitSheet={gitSheet} onGitSheet={sheet} onClose={close} />}
      {openBox && data && !detail && (
        <div className="bg-background fixed inset-0 z-40 flex items-center justify-center p-6 text-sm" role="dialog">
          <p className="text-muted-foreground">Box „{openBox}“ ist unbekannt. <button className="underline" onClick={close}>Zurück</button></p>
        </div>
      )}
    </>
  );
}

/** Waiting first, then running, then setup, then offline. */
function score(b: BoxesResponse['boxes'][number]): number {
  if (!b.up) return 0;
  if (b.sessions.some((s) => s.state === 'waiting')) return 4;
  if (b.phase === 'running') return 3;
  return 2;
}
