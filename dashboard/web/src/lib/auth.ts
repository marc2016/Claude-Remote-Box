// Login: state of the page, passkey sign-in, enrollment through the one-time
// link, sign-out. The server side is server/auth.js.

export interface AuthState {
  auth: 'on' | 'off';
  signedIn: boolean;
  configured: boolean;
  passkeys: boolean;
  url: string;
}

/** Thrown by the API calls when the server answers 401: the session is missing or has ended. */
export class UnauthorizedError extends Error {
  constructor() { super('unauthorized'); }
}

/**
 * The secret of an enrollment link (`/#enroll=<secret>`). It is taken out of
 * the address bar right away, so it stays out of the history and of anything
 * that reads the URL later.
 */
function takeEnrollSecret(): string | null {
  const m = /^#enroll=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return m[1];
}
export const enrollSecret = takeEnrollSecret();

export async function fetchAuthState(): Promise<AuthState> {
  const r = await fetch('/api/auth/state', { cache: 'no-store' });
  if (!r.ok) throw new Error(`auth: ${r.status}`);
  return r.json();
}

/** Why an attempt did not complete, as the screens show it. */
export type AuthFailure = 'cancelled' | 'refused' | 'link-expired' | 'link-invalid' | 'limited' | 'unsupported' | 'error';

async function post(route: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`/api/auth/${route}`, {
    method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = await r.json(); } catch { /* an empty or non-JSON body counts as no details */ }
  return { status: r.status, body: parsed };
}

function failure(status: number, body: Record<string, unknown>): AuthFailure {
  if (status === 429) return 'limited';
  if (status === 410) return body.error === 'link expired' ? 'link-expired' : 'link-invalid';
  if (status === 400 || status === 401) return 'refused';
  return 'error';
}

const fromB64 = (s: string): ArrayBuffer => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const toB64 = (buf: ArrayBuffer | null): string => {
  let bin = '';
  for (const b of new Uint8Array(buf ?? new ArrayBuffer(0))) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

type OptionsJSON = Record<string, unknown> & { challenge: string };
type Descriptor = { id: string; type: 'public-key'; transports?: AuthenticatorTransport[] };
const descriptors = (list: unknown): PublicKeyCredentialDescriptor[] | undefined =>
  Array.isArray(list) ? (list as Descriptor[]).map((c) => ({ ...c, id: fromB64(c.id) })) : undefined;

const supported = () => typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials);

/** The device dialog was dismissed, timed out, or the passkey is not on this device. */
const dismissed = (e: unknown) => e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError');

/** Signs in with a passkey of this device. Resolves to null on success. */
export async function signIn(): Promise<AuthFailure | null> {
  if (!supported()) return 'unsupported';
  const start = await post('login/options', {});
  if (start.status !== 200) return failure(start.status, start.body);
  const o = start.body.options as OptionsJSON;
  let credential: PublicKeyCredential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: { ...o, challenge: fromB64(o.challenge), allowCredentials: descriptors(o.allowCredentials) } as PublicKeyCredentialRequestOptions,
    }) as PublicKeyCredential | null;
  } catch (e) {
    return dismissed(e) ? 'cancelled' : 'error';
  }
  if (!credential) return 'cancelled';
  const a = credential.response as AuthenticatorAssertionResponse;
  const done = await post('login/verify', {
    id: start.body.id,
    response: {
      id: credential.id, rawId: toB64(credential.rawId), type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: toB64(a.clientDataJSON), authenticatorData: toB64(a.authenticatorData), signature: toB64(a.signature),
        userHandle: a.userHandle ? toB64(a.userHandle) : undefined,
      },
    },
  });
  return done.status === 200 ? null : failure(done.status, done.body);
}

/** Creates a passkey on this device with the secret of an enrollment link. Resolves to null on success. */
export async function enroll(secret: string): Promise<AuthFailure | null> {
  if (!supported()) return 'unsupported';
  const start = await post('enroll/options', { secret });
  if (start.status !== 200) return failure(start.status, start.body);
  const o = start.body.options as OptionsJSON & { user: { id: string } };
  let credential: PublicKeyCredential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        ...o, challenge: fromB64(o.challenge), user: { ...o.user, id: fromB64(o.user.id) }, excludeCredentials: descriptors(o.excludeCredentials),
      } as PublicKeyCredentialCreationOptions,
    }) as PublicKeyCredential | null;
  } catch (e) {
    return dismissed(e) ? 'cancelled' : 'error';
  }
  if (!credential) return 'cancelled';
  const a = credential.response as AuthenticatorAttestationResponse;
  const done = await post('enroll/verify', {
    secret, id: start.body.id,
    response: {
      id: credential.id, rawId: toB64(credential.rawId), type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: toB64(a.clientDataJSON), attestationObject: toB64(a.attestationObject),
        transports: typeof a.getTransports === 'function' ? a.getTransports() : undefined,
      },
    },
  });
  return done.status === 200 ? null : failure(done.status, done.body);
}

export async function signOut(): Promise<void> {
  await post('logout', {});
}
