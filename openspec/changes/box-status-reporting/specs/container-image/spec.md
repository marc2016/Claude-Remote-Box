# Spec Delta

## ADDED Requirements

### Requirement: Status watcher next to the server
When started without a command and `CRB_STATUS_URL` is set, the container SHALL run the status watcher as a second supervised process next to the Remote Control server, reading the transcripts in the config directory and reporting as described in `status-reporting`. The watcher SHALL be part of the image, SHALL need no additional packages, and SHALL NOT change what the server does or how the healthcheck reads the state file.

#### Scenario: Two processes
- **WHEN** a configured container is in the `running` phase
- **THEN** `ps` inside the container shows the Remote Control server and the watcher, and the healthcheck reports healthy

#### Scenario: Image unchanged for the rest
- **WHEN** a container runs without `CRB_STATUS_URL`
- **THEN** its process list and behavior are the same as before this change
