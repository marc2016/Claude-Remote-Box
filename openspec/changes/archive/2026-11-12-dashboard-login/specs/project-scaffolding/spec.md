# Spec Delta

## MODIFIED Requirements

### Requirement: Dashboard subcommand
`crb dashboard` without a further argument SHALL add the status dashboard to the installation in the current directory: generate a random `CRB_STATUS_TOKEN` into `.env` when none exists, write `services/crb-dashboard.yaml` (dashboard image with the same tag scheme as the box, data volume, port from `CRB_DASHBOARD_BIND` defaulting to `127.0.0.1:8080`, hardening as in `box.yaml`, and the login variables `CRB_DASHBOARD_URL`, `CRB_DASHBOARD_PROXY`, `CRB_DASHBOARD_AUTH`, and `CRB_DASHBOARD_REMOTE_INGEST` passed from `.env` with empty defaults), add it to `include:` in `compose.yaml`, and add `CRB_STATUS_URL: http://crb-dashboard:8080/api/ingest` and `CRB_STATUS_TOKEN: ${CRB_STATUS_TOKEN}` to the `environment:` of the `box` service in `box.yaml` so that every box reports. It SHALL show a summary and change nothing before confirmation, SHALL validate with `docker compose config -q` and roll back on failure like `add`, and SHALL print the commands to start the dashboard, to recreate the boxes, and to create the first passkey (`./crb dashboard login`). When the dashboard service already exists, it SHALL say so and exit without changes. With the argument `login`, `logout`, or `reset` it SHALL run the host command of that name as defined by `dashboard-auth`; any other argument SHALL print the usage and exit non-zero.

#### Scenario: Add dashboard
- **WHEN** the user runs `./crb dashboard` in an installation with two boxes and confirms
- **THEN** `.env` has a `CRB_STATUS_TOKEN`, `services/crb-dashboard.yaml` exists, `compose.yaml` includes it, `docker compose config` shows both boxes with `CRB_STATUS_URL` and the token, and `docker compose config -q` succeeds

#### Scenario: Already present
- **WHEN** `services/crb-dashboard.yaml` exists
- **THEN** the command reports that and changes nothing

#### Scenario: Single-file setup
- **WHEN** the installation has no `box.yaml`
- **THEN** the command prints the service block and the two environment lines to add by hand and changes nothing

#### Scenario: Login variables wired
- **WHEN** the dashboard was added and `.env` sets `CRB_DASHBOARD_URL=https://crb.example.org`
- **THEN** `docker compose config crb-dashboard` shows `CRB_DASHBOARD_URL: https://crb.example.org` and the other three login variables as empty

#### Scenario: Next step named
- **WHEN** the dashboard was added
- **THEN** the closing output names `./crb dashboard login` and no longer says that there is no login

#### Scenario: Unknown argument
- **WHEN** the user runs `./crb dashboard foo`
- **THEN** the usage is printed, nothing is changed, and the exit code is non-zero
