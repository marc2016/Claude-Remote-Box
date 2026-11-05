# Spec Delta

## MODIFIED Requirements

### Requirement: Throttled restart on failure
When the Remote Control server exits with an error, the container SHALL wait a configurable delay (default 30 seconds) before exiting, so that an automatic restart does not loop rapidly. A missing setup SHALL NOT count as such an error, because the container waits for setup instead of starting the server. A stop request SHALL end the container promptly, also during that delay.

#### Scenario: Missing login
- **WHEN** a service without login is started with automatic restart
- **THEN** the container does not exit or restart, and waits for setup as described in "Waiting for setup"

#### Scenario: Server failure
- **WHEN** the server of a set-up service exits with an error under automatic restart
- **THEN** the error and the restart notice appear at most once per delay period in the logs

#### Scenario: Stop during delay
- **WHEN** the user runs `docker compose stop` while the container waits after a failure
- **THEN** the container stops within a few seconds, without waiting for the delay to end

#### Scenario: Clean stop of a running server
- **WHEN** the user runs `docker compose stop` while the server is running
- **THEN** the server receives the stop signal and the container stops without being killed after the timeout

## ADDED Requirements

### Requirement: Waiting for setup
When started without a command and setup is not complete, the container SHALL keep running without starting the Remote Control server, SHALL log how to run setup at start and then at regular intervals, and SHALL start the server on its own once setup is marked complete. A service whose config already holds a login and an accepted workspace trust when the container starts SHALL count as set up.

#### Scenario: Started before setup
- **WHEN** a service with an empty config directory is started with `docker compose up -d`
- **THEN** the container keeps running, does not restart, and its log shows the `setup` command to run

#### Scenario: Setup completed while waiting
- **WHEN** the user completes `setup` in the waiting container
- **THEN** the container starts the Remote Control server within a few seconds, without a restart, and the service shows as connected in the Claude app

#### Scenario: Existing installation
- **WHEN** a container starts with a config that already holds a login and an accepted workspace trust, but was set up before this change
- **THEN** the server starts directly, without waiting

#### Scenario: Stop while waiting
- **WHEN** the user runs `docker compose stop` while the container waits for setup
- **THEN** the container stops within a few seconds

### Requirement: Guided setup command
The image SHALL provide a `setup` command that runs the first-run steps in this order: log in, accept workspace trust in an interactive Claude session, confirm Remote Control enablement in an interactive server run. Before each step it SHALL explain what the user has to do, including that the last step is ended with Ctrl-C once "Connected" appears. It SHALL skip the login step when a login exists and the trust step when trust is already accepted. After the last step it SHALL mark setup as complete. The command SHALL work both in a running container and as a one-off container, and SHALL apply the same session-name prefix as the server.

#### Scenario: Fresh setup in a running container
- **WHEN** the user runs `docker compose exec -it <service> setup` on a service without login
- **THEN** the command guides through login, trust, and enablement, and afterwards reports that setup is complete

#### Scenario: Repeated setup
- **WHEN** the user runs `setup` again on a service that is already logged in and trusted
- **THEN** login and trust are skipped, and only the enablement step runs

#### Scenario: Ctrl-C ends only the last step
- **WHEN** the user presses Ctrl-C during the enablement step
- **THEN** the server run ends, and `setup` still marks setup as complete and exits normally

#### Scenario: Failed login
- **WHEN** the login step fails or is aborted
- **THEN** `setup` stops with a non-zero exit code and does not mark setup as complete

#### Scenario: One-off container
- **WHEN** the user runs `docker compose run --rm -it <service> setup` while the service is not running
- **THEN** the same guided steps run, and a later `docker compose up -d` starts the server directly

#### Scenario: Session name during setup
- **WHEN** the enablement step creates a session for a service named `projekt-a`
- **THEN** that session's name starts with `projekt-a-`

### Requirement: Config directory check
When started without a command, the container SHALL check that it can write to its config directory. If it cannot, it SHALL log the directory, its current owner, the UID/GID the container runs as, and the command to fix the ownership on the host, and SHALL keep waiting and re-checking instead of exiting.

#### Scenario: Directory owned by root
- **WHEN** the config directory is owned by root and the container runs as UID 1000
- **THEN** the log names the directory, owner `0:0`, UID/GID `1000:1000`, and a `chown 1000:1000` command, and the container keeps running

#### Scenario: Fixed while waiting
- **WHEN** the user fixes the ownership on the host while the container waits
- **THEN** the container continues with the setup check without a restart

### Requirement: Health state
The image SHALL report a container health state that is healthy only while the Remote Control server is running, and unhealthy while the container waits for setup or for a writable config directory.

#### Scenario: Waiting service
- **WHEN** a service waits for setup
- **THEN** `docker compose ps` shows it as unhealthy or starting, not healthy

#### Scenario: Running service
- **WHEN** the server of a set-up service is running
- **THEN** `docker compose ps` shows it as healthy
