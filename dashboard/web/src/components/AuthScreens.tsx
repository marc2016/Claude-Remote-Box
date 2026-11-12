import { useState, type ReactNode } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { enroll, signIn, type AuthFailure } from '@/lib/auth';

const LOGIN_COMMAND = './crb dashboard login';

const MESSAGES: Record<AuthFailure, string> = {
  cancelled: 'Die Anmeldung wurde nicht abgeschlossen.',
  refused: 'Die Anmeldung wurde nicht angenommen.',
  'link-expired': 'Der Link ist abgelaufen.',
  'link-invalid': 'Der Link ist nicht mehr gültig.',
  limited: 'Zu viele Versuche. Bitte in einer Minute noch einmal.',
  unsupported: 'Dieser Browser kann keine Passkeys.',
  error: 'Das hat nicht geklappt. Bitte noch einmal versuchen.',
};

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 px-6 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">claude-remote-box</p>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </main>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };
  return (
    <div className="bg-muted flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-sm">{text}</code>
      <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Befehl kopieren">
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/** A passkey exists and the page is at the public address. */
export function SignIn({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthFailure | null>(null);
  const run = async () => {
    setBusy(true);
    setProblem(null);
    const failed = await signIn().catch((): AuthFailure => 'error');
    setBusy(false);
    if (failed) setProblem(failed); else onDone();
  };
  return (
    <Screen title="Anmelden">
      <p className="text-muted-foreground text-sm">Das Dashboard zeigt deine Prompts und Claudes Antworten. Melde dich mit deinem Passkey an.</p>
      <Button size="lg" className="h-11 text-base" onClick={run} disabled={busy}>
        <KeyRound /> {busy ? 'Warte auf Passkey …' : 'Mit Passkey anmelden'}
      </Button>
      <p role="status" className="text-destructive min-h-5 text-sm">{problem ? MESSAGES[problem] : ''}</p>
      <p className="text-muted-foreground text-sm">Neues Gerät? Auf dem Host einen Link erzeugen:</p>
      <Command text={LOGIN_COMMAND} />
    </Screen>
  );
}

/** No passkey yet, or the public address is not configured: only the host can go on. */
export function SetupHint() {
  return (
    <Screen title="Noch kein Passkey">
      <p className="text-muted-foreground text-sm">Das Dashboard ist gesperrt, bis ein Passkey angelegt ist. Führe auf dem Host im Ordner der Installation aus:</p>
      <Command text={LOGIN_COMMAND} />
      <p className="text-muted-foreground text-sm">Der Befehl fragt beim ersten Mal nach der öffentlichen Adresse und druckt einen Link. Öffne ihn auf dem Gerät, mit dem du dich anmelden willst.</p>
    </Screen>
  );
}

/** The page was opened somewhere else than at the public address, where passkeys do not work. */
export function WrongAddress({ url }: { url: string }) {
  return (
    <Screen title="Bitte die öffentliche Adresse öffnen">
      <p className="text-muted-foreground text-sm">Die Anmeldung funktioniert nur unter der Adresse, für die die Passkeys angelegt sind. Hier werden keine Daten gezeigt.</p>
      <a className="text-primary text-base font-medium break-all underline underline-offset-4" href={url}>{url}</a>
    </Screen>
  );
}

/** Opened through an enrollment link: creates the passkey on this device. */
export function Enroll({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthFailure | null>(null);
  const spent = problem === 'link-expired' || problem === 'link-invalid';
  const run = async () => {
    setBusy(true);
    setProblem(null);
    const failed = await enroll(secret).catch((): AuthFailure => 'error');
    setBusy(false);
    if (failed) setProblem(failed); else onDone();
  };
  return (
    <Screen title="Passkey anlegen">
      {spent ? (
        <>
          <p role="status" className="text-destructive text-sm">{MESSAGES[problem]} Erzeuge auf dem Host einen neuen:</p>
          <Command text={LOGIN_COMMAND} />
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">Dieses Gerät bekommt einen Passkey für das Dashboard. Danach meldest du dich hier mit Face ID, Fingerabdruck oder der Geräte-PIN an.</p>
          <Button size="lg" className="h-11 text-base" onClick={run} disabled={busy}>
            <KeyRound /> {busy ? 'Warte auf das Gerät …' : 'Passkey anlegen'}
          </Button>
          <p role="status" className="text-destructive min-h-5 text-sm">{problem ? MESSAGES[problem] : ''}</p>
        </>
      )}
    </Screen>
  );
}
