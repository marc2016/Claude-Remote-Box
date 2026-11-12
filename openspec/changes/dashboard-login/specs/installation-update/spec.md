# Spec Delta

## ADDED Requirements

### Requirement: Dashboard login variables reconciled
When `services/crb-dashboard.yaml` was created by `crb` and its `environment:` lacks one of `CRB_DASHBOARD_URL`, `CRB_DASHBOARD_PROXY`, `CRB_DASHBOARD_AUTH`, or `CRB_DASHBOARD_REMOTE_INGEST`, `crb update` SHALL offer to add the missing lines (default yes), SHALL add them after confirmation without changing any other line of the file, and SHALL count the dashboard as a changed service for the recreate question. It SHALL say, in the same step, that the dashboard is locked after the update until a passkey is created with `./crb dashboard login`. A service file that was not created by `crb` SHALL be left unchanged, with the lines to add printed.

#### Scenario: Variables missing
- **WHEN** the dashboard service file was written before the login existed and the user accepts
- **THEN** `docker compose config crb-dashboard` shows the four variables, every other line of the file is as before, the recreate question lists `crb-dashboard`, and the output names `./crb dashboard login`

#### Scenario: Already present
- **WHEN** the service file has all four variables
- **THEN** no question about them is asked and the file is unchanged

#### Scenario: Declined
- **WHEN** the user answers the offer with no
- **THEN** the file is unchanged and the output says that the login cannot be configured through `.env` until the lines are added
