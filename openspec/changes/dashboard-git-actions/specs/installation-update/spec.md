# Spec Delta

## ADDED Requirements

### Requirement: Agent variable reconciled
When `services/crb-dashboard.yaml` was created by `crb` and its `environment:` lacks `CRB_AGENT_TOKEN`, `crb update` SHALL offer to add the line (default yes), SHALL add it after confirmation without changing any other line of the file, and SHALL count the dashboard as a changed service for the recreate question. It SHALL NOT create the token and SHALL NOT set up the agent; it SHALL say, in the same step, that Git actions in the dashboard need `./crb agent install`. A service file that was not created by `crb` SHALL be left unchanged, with the line to add printed.

#### Scenario: Variable missing
- **WHEN** the dashboard service file was written before the agent existed and the user accepts
- **THEN** `docker compose config crb-dashboard` shows `CRB_AGENT_TOKEN`, every other line of the file is as before, the recreate question lists `crb-dashboard`, and the output names `./crb agent install`

#### Scenario: Already present
- **WHEN** the service file has the variable
- **THEN** no question about it is asked and the file is unchanged

#### Scenario: Hand-written service file
- **WHEN** the dashboard service file was not created by `crb`
- **THEN** it is unchanged and the output shows the line to add

### Requirement: Agent service is not a project
`crb update`, `crb dashboard`, and `crb git` SHALL treat `services/crb-agent.yaml` like the dashboard's service file: not as a project, without project questions, without a row in the Git overview. `crb update` SHALL pull the agent's image with the others, and a running agent SHALL continue with the replaced script on its own (see `host-agent`).

#### Scenario: Update with agent
- **WHEN** `./crb update` runs in an installation with the agent's service
- **THEN** no question names `crb-agent`, the agent's image is pulled, and the agent's log shows that it continues with the new script

#### Scenario: Overview with agent
- **WHEN** `./crb git --list` runs in an installation with the agent's service
- **THEN** no row names `crb-agent`
