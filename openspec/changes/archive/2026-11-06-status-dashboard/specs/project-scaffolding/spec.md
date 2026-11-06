# Spec Delta

## ADDED Requirements

### Requirement: Dashboard subcommand
`crb dashboard` SHALL add the status dashboard to the installation in the current directory: generate a random `CRB_STATUS_TOKEN` into `.env` when none exists, write `services/crb-dashboard.yaml` (dashboard image with the same tag scheme as the box, data volume, port from `CRB_DASHBOARD_BIND` defaulting to `127.0.0.1:8080`, hardening as in `box.yaml`), add it to `include:` in `compose.yaml`, and add `CRB_STATUS_URL: http://crb-dashboard:8080/api/ingest` and `CRB_STATUS_TOKEN: ${CRB_STATUS_TOKEN}` to the `environment:` of the `box` service in `box.yaml` so that every box reports. It SHALL show a summary and change nothing before confirmation, SHALL validate with `docker compose config -q` and roll back on failure like `add`, and SHALL print the commands to start the dashboard and to recreate the boxes. When the dashboard service already exists, it SHALL say so and exit without changes.

#### Scenario: Add dashboard
- **WHEN** the user runs `./crb dashboard` in an installation with two boxes and confirms
- **THEN** `.env` has a `CRB_STATUS_TOKEN`, `services/crb-dashboard.yaml` exists, `compose.yaml` includes it, `docker compose config` shows both boxes with `CRB_STATUS_URL` and the token, and `docker compose config -q` succeeds

#### Scenario: Already present
- **WHEN** `services/crb-dashboard.yaml` exists
- **THEN** the command reports that and changes nothing

#### Scenario: Single-file setup
- **WHEN** the installation has no `box.yaml`
- **THEN** the command prints the service block and the two environment lines to add by hand and changes nothing
