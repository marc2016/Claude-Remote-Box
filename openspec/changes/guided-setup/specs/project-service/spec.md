# Spec Delta

## MODIFIED Requirements

### Requirement: Documented first-run setup
The project SHALL document a per-service first-run flow that works on a headless host: create the config directory owned by the container user, start the service detached, then run the guided `setup` command in the running container. The documentation SHALL also describe running `setup` as a one-off container, and the manual steps it performs. The documentation SHALL state that API keys and `setup-token` tokens do not work for Remote Control, and that the session-name prefix only applies to sessions created after it is set.

#### Scenario: Setup from scratch
- **WHEN** a user follows the documented first-run steps for a new service on a host without a desktop
- **THEN** after `setup` completes, the service shows as connected in the Claude app without another `docker compose` command, and the user can send a session a message from the phone

#### Scenario: Setup survives recreation
- **WHEN** a user has completed the first-run steps and runs `docker compose down` and `docker compose up -d`
- **THEN** the service shows as connected again without any new login, trust, or enablement prompt
