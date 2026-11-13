# Spec Delta

## ADDED Requirements

### Requirement: Agent variable reconciled
When `services/crb-dashboard.yaml` was created by `crb` and its `environment:` lacks `CRB_AGENT_TOKEN`, `crb update` SHALL offer to add the line (default yes), SHALL add it after confirmation without changing any other line of the file, and SHALL count the dashboard as a changed service for the recreate question. It SHALL NOT create the token and SHALL NOT install the agent; it SHALL say, in the same step, that Git actions in the dashboard need `./crb agent install`. A service file that was not created by `crb` SHALL be left unchanged, with the line to add printed.

#### Scenario: Variable missing
- **WHEN** the dashboard service file was written before the agent existed and the user accepts
- **THEN** `docker compose config crb-dashboard` shows `CRB_AGENT_TOKEN`, every other line of the file is as before, the recreate question lists `crb-dashboard`, and the output names `./crb agent install`

#### Scenario: Already present
- **WHEN** the service file has the variable
- **THEN** no question about it is asked and the file is unchanged

#### Scenario: Hand-written service file
- **WHEN** the dashboard service file was not created by `crb`
- **THEN** it is unchanged and the output shows the line to add
