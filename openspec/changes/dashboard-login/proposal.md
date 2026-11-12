# Proposal

## Why

The dashboard shows prompts and Claude's replies to anyone who can reach its port; its only protection is the network it is bound to. It is now to be published through a reverse proxy in a DMZ and later reached from the internet, with no authentication service in front of it, so the dashboard has to authenticate its user itself. The README already names authentication as the next step.

## What Changes

- The dashboard gets a login with passkeys (WebAuthn). There is no password. One user; several passkeys (devices) are possible.
- A passkey is created through a one-time link that only the host can issue: `./crb dashboard login` prints a link that is valid for a few minutes and can be used once. Opening it on the phone creates the passkey and signs that device in.
- After signing in, the browser holds a session cookie (30 days after the last use). The page has "Abmelden"; `./crb dashboard logout` ends every session, `./crb dashboard reset` removes every passkey and session.
- **BREAKING**: the read API (`/api/boxes`, `/api/sessions/…/events`, `/api/events`) answers `401` without a valid session. The page then shows the sign-in screen or, while no passkey exists, the hint to run `./crb dashboard login`. An installation that is updated shows this locked screen until a passkey is created.
- **BREAKING**: signing in works only through the public address (`CRB_DASHBOARD_URL` in `.env`, an `https://` origin). Calling the port directly over HTTP, for example `http://core:8080` in the LAN, shows the locked screen with a link to the public address.
- **BREAKING**: `POST /api/ingest` is refused when the request was forwarded by a proxy, unless `CRB_DASHBOARD_REMOTE_INGEST=1` is set. Boxes on the same host report over the Compose network and are not affected; boxes on another host that report through a proxy need the setting.
- `CRB_DASHBOARD_AUTH=off` turns the login off (the behavior of today). The demo and the development mode use it; for an installation the README names it as the explicit choice for a dashboard that stays on a private network.
- `CRB_DASHBOARD_PROXY` in `.env` names the address of the reverse proxy; only from there is `X-Forwarded-For` believed, for the limit on sign-in attempts per client.
- `./crb dashboard` writes the new variables into the service file; `./crb update` adds them to an existing one.
- Responses carry `X-Content-Type-Options`, `Referrer-Policy`, and a frame ban.
- README: "Status dashboard" describes the login, the reverse proxy setup, and the commands; the security model says what the login does and does not protect.
- Not in this change: passwords, TOTP, several users or roles, a list of sessions or passkeys in the page, actions in the dashboard (pull, push, approving), TLS in the dashboard itself, and configuration of any particular proxy product.

## Capabilities

### New Capabilities
- `dashboard-auth`: who may read the dashboard: passkey enrollment through a one-time link from the host, sign-in, sessions and sign-out, the locked state, the public address, and the host commands `crb dashboard login`, `logout`, and `reset`.

### Modified Capabilities
- `status-dashboard`: "Read API and live updates" (requires a session instead of being open), "Ingest endpoint" (refused when forwarded by a proxy unless enabled), "Exposure defaults" (the documentation statement about the missing login is replaced; response headers).
- `project-scaffolding`: "Dashboard subcommand" (the service file carries the login variables; the summary no longer says "kein Login"; `login`, `logout`, and `reset` are accepted as arguments).
- `installation-update`: adds "Dashboard login variables reconciled" (`crb update` adds the login variables to an existing dashboard service file).

## Impact

- `dashboard/server/`: new modules for authentication (enrollment tokens, WebAuthn registration and assertion, sessions, attempt limit) and a small admin script run through `docker compose exec`; `index.js` guards the read routes and adds the `/api/auth/*` routes; `db.js` gets tables for passkeys, sessions, and enrollment tokens.
- `dashboard/package.json` and `dashboard/Dockerfile`: the server gets its first runtime dependency (a WebAuthn server library). The runtime image today contains no `node_modules`; it will install production dependencies, and the web-only packages that are listed under `dependencies` today move to `devDependencies` so that they do not end up in the image.
- `dashboard/web/`: sign-in screen, locked screen, enrollment screen, sign-out control; `api.ts` handles `401`.
- `dashboard/demo.mjs`, the `dev` script, `dashboard/test/`: run with the login off; new tests for the login.
- `crb`: `dashboard login|logout|reset`, the new variables in the generated service file, reconciliation in `update`, usage text. `tests/crb.test.sh` accordingly.
- `compose.example.yaml`, `README.md`.
- Both images have to be released for the change to reach an installation; the box image is unchanged in behavior.
- Exposure: the dashboard becomes reachable from the internet by intent. What stands between the internet and the stored prompts is then this login and the reverse proxy's TLS.
