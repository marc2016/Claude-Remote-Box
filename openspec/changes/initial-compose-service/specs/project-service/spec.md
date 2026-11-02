# Spec Delta

## Purpose

Defines how one project runs as its own Docker Compose service: which host files Claude can reach, where its state persists, how the container is hardened and kept running, and how a user sets it up the first time.

## ADDED Requirements

### Requirement: One service per project
Each project SHALL run as its own Compose service with its own container, its own Remote Control server, and its own session name. Adding a project SHALL NOT require changing the image.

#### Scenario: Two projects side by side
- **WHEN** a user defines services `projekt-a` and `projekt-b`, each with its own project directory, and starts them
- **THEN** both appear as separate entries in the Claude app session list, and stopping one does not affect the other

### Requirement: Workspace isolation
A service SHALL mount exactly one host project directory, at `/workspace`, as its only host-file access besides its own config volume. The service SHALL NOT mount the Docker socket or any other host path.

#### Scenario: Other host files unreachable
- **WHEN** Claude in the `projekt-a` service tries to read a file of `projekt-b` or the host home directory
- **THEN** the file does not exist inside the container

### Requirement: Per-project config volume
Each service SHALL persist Claude Code state in its own named volume, not shared with other services.

#### Scenario: Independent reset
- **WHEN** a user removes the config volume of `projekt-a`
- **THEN** `projekt-a` requires login and setup again, while `projekt-b` keeps running and stays logged in

### Requirement: Container hardening
A service SHALL drop all Linux capabilities, SHALL prevent privilege escalation, and SHALL NOT publish any ports. Remote Control connectivity SHALL rely on outbound HTTPS only.

#### Scenario: Hardening in effect
- **WHEN** a user inspects a running service container
- **THEN** it has no added capabilities, `no-new-privileges` is set, and no ports are published

### Requirement: Automatic restart
A service SHALL be restarted automatically when its Remote Control server exits, unless the user stopped it explicitly.

#### Scenario: Network outage
- **WHEN** the network is down long enough that the Remote Control server gives up and exits
- **THEN** the container restarts, and once the network is back the session reappears in the Claude app without manual action

#### Scenario: Explicit stop
- **WHEN** a user runs `docker compose stop projekt-a`
- **THEN** the service stays stopped, including after the Docker daemon restarts

### Requirement: Host file ownership
A service SHALL be configurable to run as the host user's UID/GID, with UID/GID 1000 as the default.

#### Scenario: Matching ownership
- **WHEN** the service runs with the host user's UID/GID and Claude creates a file in `/workspace`
- **THEN** the file on the host is owned by that host user

### Requirement: Documented first-run setup
The project SHALL document a per-service first-run flow that works on a headless host: log in interactively with a claude.ai account, start the Remote Control server interactively once to confirm enablement and workspace trust, then start the service detached. The documentation SHALL state that API keys and `setup-token` tokens do not work for Remote Control.

#### Scenario: Setup from scratch
- **WHEN** a user follows the documented first-run steps for a new service on a host without a desktop
- **THEN** after `docker compose up -d` the service's session shows as online in the Claude app, and the user can send it a message from the phone
