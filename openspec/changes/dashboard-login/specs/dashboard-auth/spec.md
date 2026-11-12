# Spec Delta

## Purpose
Who may read the status dashboard: a single user who signs in with a passkey that was created through a one-time link issued on the host, and the sessions, sign-out, and locked states that follow from it.

## ADDED Requirements

### Requirement: Passkey sign-in
The dashboard SHALL authenticate its user with passkeys (WebAuthn) and SHALL NOT offer a password or any other secret typed by the user. The sign-in screen SHALL offer one control that starts the passkey sign-in without asking for a user name. A successful sign-in SHALL start a session and show the dashboard; a failed or cancelled one SHALL leave the sign-in screen with a short message and SHALL NOT reveal whether a passkey exists for the device. Every passkey sign-in SHALL require user verification (biometrics or the device PIN).

#### Scenario: Sign in
- **WHEN** a passkey exists and the user opens the dashboard on that device without a session, taps the sign-in control, and confirms with Face ID
- **THEN** the cards are shown and the browser holds a session cookie

#### Scenario: Cancelled
- **WHEN** the user dismisses the device's passkey dialog
- **THEN** the sign-in screen stays, says that the sign-in did not complete, and no session exists

#### Scenario: Unknown passkey
- **WHEN** a sign-in is attempted with a passkey that the dashboard does not know or that was removed
- **THEN** the sign-in is refused with the same message as any other failed sign-in and no session exists

### Requirement: Enrollment through a one-time link
A passkey SHALL be created only through an enrollment link issued on the host. The link SHALL be usable once, SHALL expire 10 minutes after it was issued, and SHALL carry its secret in the URL fragment so that it is not sent to the server or the proxy when the page is loaded. Opening a valid link SHALL show a screen that creates a passkey on the device; after the passkey is stored, the link SHALL be spent and the device SHALL be signed in. An expired, spent, or unknown link SHALL create nothing and SHALL say that a new link is needed. Issuing a new link SHALL invalidate links issued before it that were not used. Further passkeys SHALL be added the same way; existing passkeys and sessions SHALL stay valid.

#### Scenario: First passkey
- **WHEN** no passkey exists, the user runs `./crb dashboard login`, opens the printed link on the phone, and confirms creating the passkey
- **THEN** the dashboard stores the passkey, the phone is signed in and shows the cards, and the link cannot be used again

#### Scenario: Link used twice
- **WHEN** a link that already created a passkey is opened again
- **THEN** no passkey is created and the screen says that the link is no longer valid and how to get a new one

#### Scenario: Link expired
- **WHEN** a link is opened 11 minutes after it was issued
- **THEN** no passkey is created and the screen says that the link has expired

#### Scenario: Second device
- **WHEN** a passkey exists and a new link is opened on a laptop
- **THEN** the laptop gets its own passkey and session, and the phone stays signed in

#### Scenario: Secret not in request logs
- **WHEN** an enrollment link is opened
- **THEN** the request for the page that reaches the proxy and the dashboard does not contain the link's secret in its path or query

### Requirement: Sessions and sign-out
A session SHALL be carried by a cookie that scripts cannot read, that is sent only over HTTPS, and that is not sent with requests initiated by other sites. It SHALL stay valid for 30 days after its last use and SHALL end at sign-out. The page SHALL offer a sign-out control that ends the session of that browser only. A session SHALL survive a restart of the dashboard. The dashboard SHALL store neither the session secret nor the enrollment secret in a form that lets someone who reads the database sign in.

#### Scenario: Stays signed in
- **WHEN** the user signed in 20 days ago and used the dashboard yesterday
- **THEN** the dashboard opens without a sign-in

#### Scenario: Expires
- **WHEN** a session was not used for 31 days
- **THEN** the next request is answered as without a session and the sign-in screen is shown

#### Scenario: Sign out
- **WHEN** the user taps "Abmelden" on the phone while the laptop is also signed in
- **THEN** the phone shows the sign-in screen, its old cookie is no longer accepted, and the laptop stays signed in

#### Scenario: Restart
- **WHEN** the dashboard container is recreated with the same volume
- **THEN** signed-in browsers stay signed in and stored passkeys still work

### Requirement: Locked states
Without a valid session the dashboard SHALL NOT return any box, session, or event data, and the page SHALL show, instead of the cards, exactly one of: the sign-in screen when at least one passkey exists and the page was opened at the public address; the setup hint with the command `./crb dashboard login` when no passkey exists; or the hint to open the public address, as a link, when the page was opened at any other address. When no public address is configured, the page SHALL show the setup hint. The page shell, its static files, the health check, and the routes needed to sign in and to enroll SHALL be reachable without a session. A browser whose session ends while the page is open SHALL switch to the matching locked screen without a reload.

#### Scenario: Fresh update
- **WHEN** an installation without passkeys is updated to a version with the login and the page is opened
- **THEN** no card is shown, the API returns no box data, and the page names `./crb dashboard login`

#### Scenario: Direct port in the LAN
- **WHEN** a passkey exists and the page is opened at `http://core:8080` while the public address is `https://crb.example.org`
- **THEN** the page shows no data and no sign-in control, and links to `https://crb.example.org`

#### Scenario: Session ends while open
- **WHEN** the dashboard is open in a browser and all sessions are ended on the host
- **THEN** within a few seconds the page shows the sign-in screen instead of the cards, without the user reloading

### Requirement: Public address
The dashboard SHALL take its public address from `CRB_DASHBOARD_URL`, an `https://` origin without a path. Passkeys SHALL be bound to that address's host name, and enrollment and sign-in SHALL be accepted only when the browser performed them at that origin. A value that is not an `https://` origin SHALL be reported at start and treated as not configured; `http://localhost` with a port SHALL be accepted for development. Changing the host name SHALL make existing passkeys unusable, which the documentation SHALL state.

#### Scenario: Wrong origin
- **WHEN** a sign-in response was produced by a browser at an origin other than the configured one
- **THEN** it is refused and no session is started

#### Scenario: Not configured
- **WHEN** `CRB_DASHBOARD_URL` is empty
- **THEN** no enrollment and no sign-in is possible, the API returns no data, and the page shows the setup hint

### Requirement: Limits on attempts
The dashboard SHALL limit enrollment and sign-in requests per client to 10 per minute and answer further ones with `429` until the minute has passed. The client SHALL be identified by the address of the connection, or, when the connection comes from an address listed in `CRB_DASHBOARD_PROXY`, by the client address that this proxy reports. A forwarded client address from a connection that is not listed there SHALL be ignored. The limit SHALL NOT apply to requests with a valid session.

#### Scenario: Too many attempts
- **WHEN** one client sends 11 sign-in requests within a minute
- **THEN** the eleventh is answered with `429` and a client at another address can still sign in

#### Scenario: Forged forwarded address
- **WHEN** a client that is not the configured proxy sends requests with changing `X-Forwarded-For` values
- **THEN** they count against that client's own connection address

### Requirement: Login switched off
With `CRB_DASHBOARD_AUTH=off` the dashboard SHALL serve the read API without a session, as before this capability existed, SHALL NOT show a sign-in or sign-out control, and SHALL log at start that the login is off. Any other value, or none, SHALL mean that the login is on. The demo and the development mode SHALL run with the login off.

#### Scenario: Off
- **WHEN** the dashboard runs with `CRB_DASHBOARD_AUTH=off`
- **THEN** `/api/boxes` answers `200` without a cookie and the page shows the cards at any address

#### Scenario: Demo
- **WHEN** `npm run demo` is started on a machine without any configuration
- **THEN** the page shows the demo boxes without a sign-in

### Requirement: Host commands
`crb dashboard login` SHALL make sure that `CRB_DASHBOARD_URL` is set in `.env`, asking for it when it is missing and for `CRB_DASHBOARD_PROXY` once (empty allowed), SHALL, when it changed `.env`, recreate the dashboard service after confirmation, and SHALL then print an enrollment link at the public address, its lifetime, and the number of passkeys that exist. `crb dashboard logout` SHALL end every session and say how many it ended. `crb dashboard reset` SHALL, after a confirmation with no as the default, remove every passkey and end every session. All three SHALL fail with a message that names the cause when the dashboard service does not exist or is not running, and SHALL change nothing in that case.

#### Scenario: First login
- **WHEN** `.env` has no `CRB_DASHBOARD_URL` and the user runs `./crb dashboard login`, enters `https://crb.example.org`, an empty proxy address, and confirms the recreate
- **THEN** `.env` holds the address, the dashboard runs with it, and a link that starts with `https://crb.example.org/#` is printed with the note that it is valid for 10 minutes

#### Scenario: Further device
- **WHEN** the address is configured, one passkey exists, and the user runs `./crb dashboard login`
- **THEN** no question is asked, nothing is recreated, a new link is printed, and the output says that 1 passkey exists

#### Scenario: Logout
- **WHEN** two browsers are signed in and the user runs `./crb dashboard logout`
- **THEN** the output says that 2 sessions were ended, both browsers show the sign-in screen, and the passkeys still work

#### Scenario: Reset declined
- **WHEN** the user runs `./crb dashboard reset` and answers the confirmation with Enter
- **THEN** no passkey and no session is removed

#### Scenario: Dashboard not running
- **WHEN** the dashboard container is stopped and the user runs `./crb dashboard login`
- **THEN** the command says that the dashboard is not running and how to start it, prints no link, and exits non-zero
