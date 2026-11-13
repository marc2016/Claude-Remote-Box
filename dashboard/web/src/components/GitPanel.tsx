import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Ban, Check, CircleX, Clock, GitBranchPlus, GitMerge, Loader, RefreshCw, TriangleAlert, X } from 'lucide-react';
import type { BoxCard, GitAction, GitState, GitWorktree } from '@shared/types';
import { gitActions, gitSettling, gitStale, gitStateParts, validBranchName } from '@shared/model.js';
import { Button } from '@/components/ui/button';
import { QUEUE_MESSAGES, queueAction, type ActionRequest } from '@/lib/git';
import { cn, fmtDuration } from '@/lib/utils';

const WORKSPACE = '/workspace';
const isOpen = (a: GitAction) => a.state === 'queued' || a.state === 'running';

// Open dialogs, the top one last: Escape closes only that one.
const stack: symbol[] = [];

/** A modal dialog: closes with Escape, the close control, and a tap outside. On a phone it sits at the bottom. */
export function Modal({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const me = Symbol('modal');
    stack.push(me);
    // Capture phase: the detail view behind listens for Escape too and must not close with it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== me) return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); stack.splice(stack.indexOf(me), 1); };
  }, [onClose]);
  return (
    <div
      className="git-modal fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className={cn('bg-card text-card-foreground flex max-h-[85dvh] w-full min-w-0 flex-col gap-3 overflow-y-auto rounded-t-2xl border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-md md:rounded-2xl', className)}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-semibold break-words">{title}</h2>
          <Button variant="ghost" size="icon-sm" className="size-11 shrink-0 md:size-7" onClick={onClose} aria-label="Schließen"><X /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ACT = 'h-11 px-3 text-sm md:h-7 md:px-2.5 md:text-[0.8rem]';

function Confirm({ title, confirmLabel, onConfirm, onClose, disabled, children }: {
  title: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; disabled?: boolean; children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-muted-foreground flex flex-col gap-2 text-sm">{children}</div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" className="h-11 md:h-8" onClick={onClose} autoFocus>Abbrechen</Button>
        <Button className="h-11 md:h-8" onClick={onConfirm} disabled={disabled}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

const commits = (n: number) => `${n} Commit${n === 1 ? '' : 's'}`;

type Pending =
  | { kind: 'push' | 'pull' | 'merge'; w: GitWorktree }
  | { kind: 'sync' }
  | { kind: 'branch' };

function NewBranch({ carryCount, defaultBranch, sessionInWorkspace, onConfirm, onClose }: {
  carryCount: number; defaultBranch: string; sessionInWorkspace: boolean; onConfirm: (name: string, carry: boolean) => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [carry, setCarry] = useState(carryCount > 0);
  const trimmed = name.trim();
  const invalid = trimmed !== '' && !validBranchName(trimmed);
  return (
    <Confirm title="Neuer Branch" confirmLabel="Anlegen" onClose={onClose} disabled={!trimmed || invalid} onConfirm={() => onConfirm(trimmed, carry && carryCount > 0)}>
      <label className="text-foreground flex flex-col gap-1.5 text-sm font-medium">
        Name
        <input
          className="border-input bg-background h-11 rounded-lg border px-3 font-mono text-base font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          value={name} onChange={(e) => setName(e.target.value)} aria-invalid={invalid || undefined}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="feature/name" maxLength={100}
        />
      </label>
      <p role="status" className="text-destructive min-h-5 text-sm">{invalid ? 'Erlaubt sind Buchstaben, Ziffern und . _ / - ; kein - am Anfang.' : ''}</p>
      {carryCount > 0 && (
        <label className="text-foreground flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 shrink-0" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
          <span>{commits(carryCount)} von {defaultBranch} mitnehmen</span>
        </label>
      )}
      <p>
        {carry && carryCount > 0
          ? `Der Branch zeigt auf den jetzigen Stand, ${defaultBranch} geht zurück auf origin. Keine Datei ändert sich.`
          : `Der Branch startet bei origin/${defaultBranch} und wird im Workspace ausgecheckt. Gepusht wird nichts.`}
      </p>
      {sessionInWorkspace && !(carry && carryCount > 0) && (
        <p className="text-warning-foreground flex items-start gap-1.5"><TriangleAlert className="mt-0.5 size-4 shrink-0" /> In diesem Checkout arbeitet gerade eine Session. Ihre Dateien ändern sich.</p>
      )}
    </Confirm>
  );
}

const OUTCOME: Record<Exclude<GitAction['state'], 'queued' | 'running'>, { word: string; icon: ReactNode; tone: string }> = {
  done: { word: 'erledigt', icon: <Check className="size-4 shrink-0" />, tone: 'text-success-foreground' },
  refused: { word: 'abgelehnt', icon: <Ban className="size-4 shrink-0" />, tone: 'text-warning-foreground' },
  failed: { word: 'fehlgeschlagen', icon: <CircleX className="size-4 shrink-0" />, tone: 'text-destructive' },
  expired: { word: 'verfallen', icon: <Clock className="size-4 shrink-0" />, tone: 'text-muted-foreground' },
};

const KIND: Record<GitAction['kind'], string> = { fetch: 'Abrufen', sync: 'Synchronisieren', push: 'Pushen', pull: 'Holen', merge: 'Mergen', branch: 'Neuer Branch' };

function Progress({ a }: { a: GitAction }) {
  return (
    <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs" role="status">
      <Loader className="size-3.5 shrink-0 animate-spin" />
      <span className="truncate">{KIND[a.kind]}: {a.state === 'queued' ? 'wartet auf den Host' : 'läuft'}</span>
    </span>
  );
}

function dismissedId(box: string): string | null {
  try { return localStorage.getItem(`crb-git-dismissed:${box}`); } catch { return null; }
}

/**
 * The checkouts of a box with their actions, the box's own actions, the state
 * of queued actions and the result of the last one. The page only queues; the
 * host agent carries out and decides.
 */
export function GitPanel({ box, git, now, className }: { box: BoxCard; git: GitState | null; now: number; className?: string }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(() => dismissedId(box.name));
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const state = box.git;
  if (!state || !state.worktrees.length) return null;
  const def = state.default_branch ?? null;
  const mine = git?.actions.filter((a) => a.box === box.name) ?? [];
  const open = mine.filter(isOpen);
  const last = mine.find((a) => !isOpen(a)) ?? null; // newest first
  // After an action the box still shows the state from before it, until its next report.
  const settling = gitSettling(last, state.fetched_at, now);
  const offered = Boolean(git?.enabled && git.agent.present) && !settling;
  const workspace = state.worktrees.find((w) => w.path === WORKSPACE) ?? null;
  const carryCount = workspace && def && workspace.branch === def && workspace.remote === 'ok' ? workspace.unpushed ?? 0 : 0;
  const sessionInWorkspace = box.sessions.some((s) => s.state !== 'ended' && s.git?.path === WORKSPACE);
  const boxOpen = open.find((a) => a.kind === 'fetch' || a.kind === 'sync' || a.kind === 'branch') ?? null;
  const anyStale = state.worktrees.some((w) => gitStale(w, def));

  const send = async (action: ActionRequest) => {
    setPending(null);
    setProblem(null);
    setBusy(true);
    const out = await queueAction(action);
    if (!alive.current) return;
    setBusy(false);
    if (out !== 'queued') setProblem(QUEUE_MESSAGES[out]);
  };
  const dismiss = (id: string) => {
    setDismissed(id);
    try { localStorage.setItem(`crb-git-dismissed:${box.name}`, id); } catch { /* shown again after a reload */ }
  };

  return (
    <div className={cn('git-panel flex min-w-0 flex-col gap-2 text-xs', className)}>
      <div className="text-muted-foreground flex items-baseline justify-between gap-2 leading-4">
        <span className="text-foreground font-medium">Git</span>
        <span className="shrink-0">{state.fetched_at ? `Fetch vor ${fmtDuration(now - Date.parse(state.fetched_at))}` : 'Fetch nie'}</span>
      </div>

      {git?.enabled && !git.agent.seen && (
        <p className="text-muted-foreground leading-5">Aktionen brauchen den Host-Agenten. Auf dem Host: <code className="bg-muted rounded px-1 py-0.5 font-mono whitespace-nowrap">./crb agent install</code></p>
      )}
      {git?.enabled && git.agent.seen && !git.agent.present && (
        <p className="text-warning-foreground flex items-start gap-1.5 leading-5"><TriangleAlert className="mt-0.5 size-4 shrink-0" /> Der Host-Agent meldet sich nicht. Aktionen sind erst wieder möglich, wenn er läuft.</p>
      )}

      {last && last.id !== dismissed && last.state !== 'queued' && last.state !== 'running' && (
        <div className={cn('git-result bg-muted flex items-start gap-2 rounded-lg p-2', OUTCOME[last.state].tone)} role="status">
          {OUTCOME[last.state].icon}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{KIND[last.kind]}{last.branch || last.name ? ` ${last.branch ?? last.name}` : ''}: {OUTCOME[last.state].word}</p>
            {last.text && <pre className="text-foreground mt-1 max-h-32 overflow-y-auto font-mono text-[0.7rem] leading-4 break-words whitespace-pre-wrap">{last.text}</pre>}
          </div>
          <Button variant="ghost" size="icon-sm" className="size-11 shrink-0 md:size-6" onClick={() => dismiss(last.id)} aria-label="Ergebnis ausblenden"><X /></Button>
        </div>
      )}
      {problem && <p role="alert" className="text-destructive leading-5">{problem}</p>}

      <ul className="flex flex-col gap-2">
        {state.worktrees.map((w) => {
          const acts = gitActions(w, def);
          const stale = gitStale(w, def);
          const parts = gitStateParts(w).join(' · ');
          const running = w.branch ? open.find((a) => a.branch === w.branch) ?? null : null;
          return (
            <li key={w.path} className="flex min-w-0 flex-col gap-1.5" title={w.path}>
              <div className="text-muted-foreground flex min-w-0 items-baseline justify-between gap-2 leading-4 whitespace-nowrap">
                <span className="text-foreground min-w-0 truncate" style={{ flexShrink: 1000 }}>{w.branch ?? 'ohne Branch'}</span>
                <span className="flex min-w-0 items-baseline gap-1">
                  {stale && <span className="git-stale text-warning-foreground flex shrink-0 items-center gap-1"><TriangleAlert className="size-3 shrink-0 self-center" />{stale}{parts ? ' ·' : ''}</span>}
                  <span className="min-w-0 truncate">{parts || (stale ? '' : '–')}</span>
                </span>
              </div>
              {running ? <Progress a={running} /> : (
                <>
                  {acts.diverged && <p className="text-muted-foreground leading-4">Auseinandergelaufen. Auflösen auf dem Host: <code className="font-mono">./crb git</code></p>}
                  {offered && w.branch && (acts.push || acts.pull || acts.merge) && (
                    <div className="flex flex-wrap gap-2">
                      {acts.push && <Button variant="outline" className={ACT} disabled={busy} onClick={() => setPending({ kind: 'push', w })}><ArrowUpFromLine /> pushen</Button>}
                      {acts.pull && <Button variant="outline" className={ACT} disabled={busy} onClick={() => setPending({ kind: 'pull', w })}><ArrowDownToLine /> holen</Button>}
                      {acts.merge && def && <Button variant="outline" className={ACT} disabled={busy} onClick={() => setPending({ kind: 'merge', w })}><GitMerge /> nach {def} mergen</Button>}
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {settling && <p className="text-muted-foreground flex items-center gap-1.5 leading-4" role="status"><Loader className="size-3.5 shrink-0 animate-spin" /> Die Box meldet gleich den neuen Stand.</p>}
      {anyStale && <p className="text-muted-foreground leading-4">Hinter {def}: Die Session bringt ihren Branch selbst auf Stand, sag es ihr im Verlauf.</p>}

      {boxOpen ? <Progress a={boxOpen} /> : offered && (
        <div className="flex flex-wrap gap-2 border-t pt-2">
          <Button variant="outline" className={ACT} disabled={busy} onClick={() => send({ box: box.name, kind: 'fetch' })}><RefreshCw /> Jetzt abrufen</Button>
          <Button variant="outline" className={ACT} disabled={busy} onClick={() => setPending({ kind: 'sync' })}><ArrowUpFromLine /> Synchronisieren</Button>
          {def && <Button variant="outline" className={ACT} disabled={busy} onClick={() => setPending({ kind: 'branch' })}><GitBranchPlus /> Neuer Branch</Button>}
        </div>
      )}

      {pending?.kind === 'push' && (
        <Confirm title={`${pending.w.branch} pushen?`} confirmLabel="Pushen" onClose={() => setPending(null)} onConfirm={() => send({ box: box.name, kind: 'push', branch: pending.w.branch! })}>
          <p>{pending.w.remote === 'ok' ? `${commits(pending.w.unpushed ?? 0)} gehen nach ${pending.w.upstream}` : `Der Branch wird mit ${commits(pending.w.ahead)} auf origin angelegt`}, ohne Review.</p>
        </Confirm>
      )}
      {pending?.kind === 'pull' && (
        <Confirm title={`${pending.w.branch} holen?`} confirmLabel="Holen" onClose={() => setPending(null)} onConfirm={() => send({ box: box.name, kind: 'pull', branch: pending.w.branch! })}>
          <p>{commits(pending.w.behind ?? 0)} von {pending.w.upstream}. Die Dateien in diesem Checkout ändern sich; eine Session dort sieht das.</p>
        </Confirm>
      )}
      {pending?.kind === 'merge' && def && (
        <Confirm title={`${pending.w.branch} nach ${def} mergen?`} confirmLabel="Mergen und pushen" onClose={() => setPending(null)} onConfirm={() => send({ box: box.name, kind: 'merge', branch: pending.w.branch! })}>
          <p>{commits(pending.w.ahead)} von {pending.w.branch} kommen nach {def}. {def} wird sofort gepusht.</p>
          {pending.w.dirty > 0 && <p className="text-warning-foreground flex items-start gap-1.5"><TriangleAlert className="mt-0.5 size-4 shrink-0" /> {pending.w.dirty} nicht committete Änderung{pending.w.dirty === 1 ? ' ist' : 'en sind'} nicht dabei.</p>}
        </Confirm>
      )}
      {pending?.kind === 'sync' && (
        <Confirm title={`${box.name} synchronisieren?`} confirmLabel="Synchronisieren" onClose={() => setPending(null)} onConfirm={() => send({ box: box.name, kind: 'sync' })}>
          <p>Jeder Branch, der nur hinter origin liegt, wird geholt; jeder, der nur vorn liegt, wird gepusht, ohne Review. Auseinandergelaufene bleiben, wie sie sind.</p>
        </Confirm>
      )}
      {pending?.kind === 'branch' && def && (
        <NewBranch
          carryCount={carryCount} defaultBranch={def} sessionInWorkspace={sessionInWorkspace} onClose={() => setPending(null)}
          onConfirm={(name, carry) => send({ box: box.name, kind: 'branch', name, carry })}
        />
      )}
    </div>
  );
}
