# Spec Delta

## ADDED Requirements

### Requirement: Status variables reconciled
When `services/crb-dashboard.yaml` exists and the `box` service in `box.yaml` lacks `CRB_STATUS_URL` or `CRB_STATUS_TOKEN`, `crb update` SHALL offer to add them (default yes) and, after confirmation, add the missing lines to the `box` service's `environment:` and count every box as a changed service for the recreate question. When `.env` lacks `CRB_STATUS_TOKEN`, it SHALL generate one in the same step.

#### Scenario: Variables missing
- **WHEN** the dashboard service exists, `box.yaml` has no status variables, and the user accepts
- **THEN** `docker compose config <box>` shows both variables for every box and the recreate question lists every box

#### Scenario: Already wired
- **WHEN** `box.yaml` already has both variables
- **THEN** no question about them is asked
