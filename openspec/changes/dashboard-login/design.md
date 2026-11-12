# Design

## Context

See proposal.md for the motivation. What the code looks like today:

- `dashboard/server/index.js` is one `node:http` server without a framework. `createServer(store, options)` routes by method and path: `POST /api/ingest` (bearer token), `GET /api/boxes`, `GET /api/sessions/<id>/events`, `GET /api/events` (SSE, the response objects are kept in a `clients` set), `GET /api/health`, and static files with a fallback to `index.html`. Nothing but ingest checks anything.
- `dashboard/server/db.js` opens SQLite through `node:sqlite` in WAL mode. A table named `sessions` already exists and holds Claude sessions.
- The runtime stage of `dashboard/Dockerfile` copies `package.json`, `shared`, `server`, and the built web app, and no `node_modules`: the server has no runtime dependency. The packages under `dependencies` in `package.json` (`radix-ui`, `streamdown`, `@shadcn/react`, `cn`) are used by the web app only and are bundled by Vite.
- The web app uses the URL fragment for the open box (`#janus-note-vs`); `web/src/lib/api.ts` has three calls (`fetchBoxes`, `fetchTimeline`, `subscribe`) and treats every non-200 as an error to retry.
- `crb dashboard` writes `services/crb-dashboard.yaml` with a header line `# Created by crb.` and one environment variable, `CRB_STATUS_TOKEN`. `crb update` already reconciles `box.yaml` (`status_lines_missing`, `add_status_lines`) and recreates changed services after a question. `crb` never runs a command inside the dashboard container so far.
- `dashboard/demo.mjs` and the `dev` script start the server with environment variables they set themselves; `test/server.test.js` calls `createServer(store, { token, webDir })`.
- Deployment the user described: a reverse proxy in a DMZ terminates TLS and forwards to the dashboard's published port on the host `core`; no authentication service exists there. The dashboard is to be reachable from the internet later.

Decided with the user: login inside the dashboard, passkeys instead of a password or TOTP, enrollment through a one-time link from the host, everything through the public address.

## Goals / Non-Goals

**Goals:**
- No secret the user types, so nothing that can be guessed or phished.
- The host stays the root of trust: whoever can run `crb` in the installation can enroll, sign everyone out, and reset. There is no recovery path through the web.
- The data routes fail closed: a missing or wrong configuration locks the page, it never opens it.
- The login can be read in one sitting: one server module, one admin script, three small screens.

**Non-Goals:**
- Telling a legitimate proxy from a forged one beyond one configured address list.
- Protecting the dashboard against someone with access to the host, the data volume, or the Compose network.
- A content security policy. The Markdown renderer's needs are not known well enough to set one without breaking the conversation view; it can follow on its own.

## Decisions

### D1: WebAuthn through `@simplewebauthn/server`
Registration and assertion responses are verified with `@simplewebauthn/server`, pinned to an exact version like every other package in `package.json`. The browser side needs no library: `navigator.credentials.create/get` with base64url conversion is a few lines.
- Own verification with `node:crypto` (a CBOR reader, COSE key import, signature check, flag and counter checks) would keep the server free of dependencies, but it is a few hundred lines of security-critical parsing at the only door to the internet. A maintained library is the smaller risk.
- Consequence for the image: the runtime stage runs `npm ci --omit=dev`. So that this installs only what the server needs, the four web-only packages move from `dependencies` to `devDependencies`; Vite bundles them either way.
- Options used: resident (discoverable) credentials so that no user name is needed, `userVerification: 'required'`, attestation `none`, algorithms ES256 and RS256. The relying party id is the host name of `CRB_DASHBOARD_URL`, the expected origin is that URL.

### D2: Three tables, secrets stored as hashes
In the existing database, with the prefix `auth_` because `sessions` is taken:
- `auth_passkeys`: credential id, public key, counter, transports, label (derived from the user agent at enrollment, for the count and for logs), created, last used.
- `auth_sessions`: SHA-256 of the cookie value, created, last used, passkey id. The cookie value is 32 random bytes, base64url.
- `auth_enroll`: SHA-256 of the link secret, issued at. At most one row: issuing replaces it, using deletes it.

High-entropy random values need no slow hash; SHA-256 is enough to make a copied database useless for signing in. Sessions older than 30 days since last use and enrollment rows older than 10 minutes are deleted in the existing pruning run and are also rejected at read time. "Last used" is written at most once per minute per session to keep the read routes cheap.

### D3: Cookie
`crb_session`, with `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`, set again whenever "last used" is written, so that 30 days count from the last use.
- `Secure` is unconditional. The dashboard therefore does not need to know whether a request arrived over TLS and does not read `X-Forwarded-Proto`. A browser at `http://core:8080` never sends the cookie, which is exactly the rule "everything through the public address". Browsers treat `http://localhost` as a secure context, so development works.
- `SameSite=Strict` is safe here because the page is a single-page app: a link from another app loads the shell without the cookie and the shell's own requests carry it.
- State-changing auth routes (`POST`) additionally require `Content-Type: application/json` and an `Origin` header equal to the public address.

### D4: Routes and the guard
One function `sessionOf(req)` returns the session row or nothing. In the router, `/api/boxes`, `/api/sessions/…`, and `/api/events` call it first and answer `401 {"error":"unauthorized"}` without it. New routes:

| Route | Session | Purpose |
|---|---|---|
| `GET /api/auth/state` | no | `{auth: on|off, signedIn, configured, passkeys: boolean, url}`; the page decides its screen from this |
| `POST /api/auth/login/options` | no | challenge for a sign-in |
| `POST /api/auth/login/verify` | no | verifies the assertion, sets the cookie |
| `POST /api/auth/enroll/options` | no, link secret in the body | challenge for creating a passkey |
| `POST /api/auth/enroll/verify` | no, link secret in the body | stores the passkey, deletes the enrollment row, sets the cookie |
| `POST /api/auth/logout` | yes | deletes the session, clears the cookie |

- `state` tells an anonymous caller only whether at least one passkey exists (needed to choose between the sign-in screen and the setup hint), not how many or which.
- Challenges live in memory for 5 minutes, keyed by a random id returned with the options; at most 100 at a time, oldest dropped. A restart loses pending challenges, which costs one retry.
- With `CRB_DASHBOARD_AUTH=off`, `sessionOf` is bypassed and `state` reports `auth: off`. `createServer` takes the settings through `options` (`auth`, `url`, `proxy`, `remoteIngest`) with the environment as the default; the existing tests pass `auth: 'off'` and stay as they are, new tests run with the login on.
- An invalid `CRB_DASHBOARD_URL` is logged at start and treated as empty: `configured: false`, nothing can be enrolled, the data routes stay closed.

### D5: Enrollment link
`https://<public address>/#enroll=<secret>`: 32 random bytes, base64url. The fragment is never sent to the server, so the secret appears in neither the proxy's nor the dashboard's request log and is not part of a referrer. The page reads it, removes it from the address bar with `history.replaceState` before doing anything else, and posts it in the body of the two enrollment calls. Box names cannot contain `=`, so the fragment cannot be mistaken for an open box.
- The secret is checked on `options` and again on `verify`, and deleted only when the passkey is stored, so that a cancelled device dialog does not spend the link.
- A path or query parameter would be simpler to read on the server but would be logged by every proxy in between.

### D6: Host commands through an admin script in the container
`dashboard/server/admin.js` with the subcommands `enroll`, `logout`, `reset`, and `status`, each printing one line of JSON. `crb` calls it with `docker compose exec -T crb-dashboard node server/admin.js <cmd>` and formats the German output. The script opens the same SQLite file (WAL allows the second process; it sets a busy timeout) and needs nothing from the network.
- An admin route in the server, reachable only from loopback, was the alternative. It would put an "issue an enrollment link" endpoint on the same port that the proxy forwards to and make its safety depend on how the address of a connection looks under each Docker network mode; with host networking a proxy on the same machine would arrive from loopback. The script has no network surface at all.
- The server does not cache auth rows: it reads passkeys, sessions, and the enrollment row from the database on each use, so the script's changes take effect immediately. Open event streams are re-checked against their session every 5 seconds by the existing ping timer's sibling and closed when the session is gone; that is what makes `crb dashboard logout` visible in an open page.
- The link is only printed when the admin script reports the same public address as `.env`: after the recreate `crb` retries `enroll` for up to 15 seconds until the new container answers with it, and fails with the reported value otherwise. A dashboard that runs with `CRB_DASHBOARD_AUTH=off` gets no link either.
- `crb dashboard login`: checks that the service file exists and the container is running (`docker compose ps --status running -q crb-dashboard`); if `.env` lacks `CRB_DASHBOARD_URL` it asks for it (validated as an `https://` origin without a path) and once for `CRB_DASHBOARD_PROXY`, writes `.env`, asks, and runs `docker compose up -d crb-dashboard`, then waits for the health check; then `enroll` and prints the link. If the service file lacks the variable lines it stops and points to `./crb update`.

### D7: Client address and the proxy
`CRB_DASHBOARD_PROXY` is a comma-separated list of addresses or CIDR ranges. `clientOf(req)` returns the connection's address unless that address is in the list; then it walks `X-Forwarded-For` from the right and returns the first entry that is not in the list. The result is used for the attempt limit (D8) and for log lines, nowhere else: no decision about access depends on it.
- Without the setting, every request through the proxy counts as one client, so one stranger could exhaust the ten attempts per minute for everyone. That is a denial of sign-in, not a break-in; the README says to set the variable when a proxy is used.
- The ingest rule (specs, "Ingest endpoint") deliberately does not use this list: any `X-Forwarded-For` or `Forwarded` header refuses the request. A proxy adds the header to what it forwards and a caller from outside cannot remove it, so the rule holds even when `CRB_DASHBOARD_PROXY` was forgotten.

### D8: Attempt limit
A fixed window per client address in memory: 10 requests per minute across the four `options` and `verify` routes, `429` with `Retry-After` beyond that; entries are dropped when their window has passed, and the map is capped at 10 000 clients (oldest dropped). With passkeys nothing can be guessed, so this is protection against being used as a load generator and against filling the challenge store, not against brute force.

### D9: Screens
`App.tsx` asks `/api/auth/state` first and renders one of four things: the cards (signed in or auth off), `SignIn`, `SetupHint` (no passkey or not configured: the command in a copyable code line), `WrongAddress` (the public address as a link; shown when `location.origin` differs from `state.url`). A fragment `#enroll=…` renders `Enroll` instead, in every state. `api.ts` turns a `401` into a callback that makes `App` ask for the state again; the SSE `onerror` path does the same before it retries, which covers sessions that end while the page is open. The sign-out control goes into the page header next to the connection indicator; it is not rendered with auth off. All texts are German, as in the rest of the page, and the screens follow the device's light or dark mode through the existing tokens.

### D10: Service file and update
The generated service file passes the four variables with empty defaults (`CRB_DASHBOARD_URL: "${CRB_DASHBOARD_URL:-}"` and so on), so that all login configuration lives in `.env`. `crb update` adds missing lines after the `CRB_STATUS_TOKEN` line of a file that starts with `# Created by crb.`, the same way `add_status_lines` edits `box.yaml`, and changes no other line: the header comment of an older file keeps its "No login" sentence, because the spec requires every other line to stay as it was. A file without that header is left alone and the lines are printed. `compose.example.yaml` gets the same four lines in its commented block.

## Risks / Trade-offs

- [An update locks a dashboard that was fine on a VPN] → `crb update` says so before it recreates the service and names both ways out: `./crb dashboard login` or `CRB_DASHBOARD_AUTH=off` in `.env`. The release notes repeat it.
- [The public host name changes and every passkey stops working] → documented; the fix is a new link from the host, no reset needed.
- [The phone is lost] → a synced passkey is protected by the device's biometrics and the platform account; `./crb dashboard reset` removes all passkeys in one step. Removing a single passkey is not offered in this change.
- [The address the dashboard sees for the proxy is not the proxy's] → depending on the Docker network setup the container may see the bridge gateway instead of the DMZ address. Then `CRB_DASHBOARD_PROXY` does not match and all proxied clients share one limit. The server logs the connection address of the first forwarded request it does not trust, once, so that the right value can be read from `docker compose logs`; the field test (task 6.1) checks it on the real setup.
- [The enrollment link is shown in a terminal and could be read from scrollback] → it is valid for 10 minutes, once, and a newer link invalidates it.
- [A new dependency in the runtime image] → pinned exactly, covered by the lock file, and the only one; the image grows by its few transitive packages.
- [Two processes write the same SQLite file] → WAL is already on; the admin script sets a busy timeout and does single-statement writes.
- [`SameSite=Strict` and a home-screen web app] → standalone web apps on iOS keep their own cookie store, so the passkey sign-in has to be done once inside the web app as well; covered in the field test.
- [No content security policy] → named as a non-goal; the three headers of this change do not depend on it.

## Migration Plan

1. Merge and release both images (the box image is unchanged in behavior but shares the version).
2. On an installation: `./crb update` adds the four variable lines to the dashboard service file and recreates it; the page is locked from then on.
3. `./crb dashboard login`: enter the public address and the proxy's address, confirm the recreate, open the link on the phone.
4. Point the reverse proxy at the dashboard's port and exclude `/api/ingest` there as well (defense in depth; the dashboard refuses it anyway).

Rollback: the previous image tag ignores the new tables and variables and serves the page without a login, so before rolling back the port has to be taken off the proxy. `CRB_DASHBOARD_AUTH=off` gives the old behavior without a rollback.

## Open Questions

- Which reverse proxy runs in the DMZ. It does not change the design; the README example and the field test use whatever it is.
