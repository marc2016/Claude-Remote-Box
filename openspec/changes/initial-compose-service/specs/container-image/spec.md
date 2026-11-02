# Spec Delta

## Purpose

Defines the prebuilt claude-remote-box container image: what it contains, how its Claude Code version is fixed, and how it starts a Remote Control server that is configured through environment variables.

## ADDED Requirements

### Requirement: Pinned Claude Code version
The image SHALL contain exactly one Claude Code version, fixed at build time, and SHALL NOT update Claude Code by itself at runtime.

#### Scenario: No self-update
- **WHEN** the container has been running across a new upstream Claude Code release
- **THEN** the Claude Code version inside the container is unchanged

### Requirement: Release versioning
Each release SHALL be published under an immutable project version tag `X.Y.Z` that is never reused for different content. Each release SHALL also be published as `latest` and as `claude-<claude-code-version>`, and SHALL carry an image label stating the contained Claude Code version. Releases SHALL be available for linux/amd64 and linux/arm64.

#### Scenario: Version discoverable
- **WHEN** a user pulls `claude-remote-box:X.Y.Z` and runs `claude --version` in it
- **THEN** the reported Claude Code version equals the version in the image label and in the `claude-<version>` tag published with that release

#### Scenario: Release tag is stable
- **WHEN** a later release is published
- **THEN** the image digest behind an earlier `X.Y.Z` tag is unchanged

### Requirement: Base tooling
The image SHALL provide Node.js 26, Git, ripgrep, and the OpenSpec CLI in addition to Claude Code. The OpenSpec CLI version SHALL be fixed at build time.

#### Scenario: Tools available
- **WHEN** a user runs `node --version`, `git --version`, `rg --version`, and `openspec --version` in the container
- **THEN** each command succeeds

### Requirement: Non-root execution
The image SHALL run its processes as a non-root user by default.

#### Scenario: Default user
- **WHEN** a container is started from the image without a user override
- **THEN** `id -u` inside the container reports a non-zero UID

### Requirement: Arbitrary UID support
The image SHALL work when started under any non-root UID/GID supplied at runtime, so that files it creates in a bind-mounted directory are owned by that UID/GID on the host. Git operations in `/workspace` SHALL NOT fail because of a repository-ownership check.

#### Scenario: Host UID differs from default
- **WHEN** the container runs as UID 1001 with an empty named config volume and a project directory owned by UID 1001
- **THEN** Claude Code can write its configuration, files created in `/workspace` are owned by UID 1001 on the host, and `git status` in `/workspace` succeeds

### Requirement: Remote Control server by default
When started without a command, the container SHALL run Claude Code in Remote Control server mode with `/workspace` as its working directory, in the default (prompting) permission mode. The server name SHALL come from a required environment variable.

#### Scenario: Named environment
- **WHEN** the container starts with the name variable set to `projekt-a`
- **THEN** the Claude app shows the server as connected under the name `projekt-a`

#### Scenario: Name missing
- **WHEN** the container starts without the name variable
- **THEN** it exits with a non-zero code and an error message naming the missing variable

#### Scenario: Permission prompts reach the phone
- **WHEN** Claude in a remote session wants to run a shell command that is not pre-approved
- **THEN** the permission request is shown on the connected device and the command does not run until the user approves it

### Requirement: Readable session names
New sessions SHALL be named with the server name as prefix unless the user configures a different prefix. Sessions SHALL NOT be named after the container ID.

#### Scenario: Default prefix
- **WHEN** a container with name `projekt-a` and no prefix setting creates a new session
- **THEN** the session name starts with `projekt-a-`

#### Scenario: Custom prefix
- **WHEN** the user sets the session-name prefix to `pa`
- **THEN** new sessions are named starting with `pa-`

### Requirement: Spawn mode selection
The spawn mode SHALL be configurable through an environment variable. When it is not set, the container SHALL use worktree mode if `/workspace` is a Git repository and same-directory mode otherwise, and SHALL log the chosen mode. When worktree mode is set explicitly, the container SHALL NOT silently switch to another mode.

#### Scenario: Git project, no setting
- **WHEN** `/workspace` is a Git repository and no spawn mode is set
- **THEN** the server starts in worktree mode and the log names that mode

#### Scenario: Non-Git project, no setting
- **WHEN** `/workspace` is not a Git repository and no spawn mode is set
- **THEN** the server starts in same-directory mode and the log names that mode

#### Scenario: Explicit worktree on non-Git project
- **WHEN** `/workspace` is not a Git repository and worktree mode is set explicitly
- **THEN** the server does not start and the log shows that worktree mode needs a Git repository

### Requirement: Throttled restart on failure
When the Remote Control server exits with an error, the container SHALL wait a configurable delay (default 30 seconds) before exiting, so that an automatic restart does not loop rapidly. A stop request SHALL end the container promptly, also during that delay.

#### Scenario: Missing login
- **WHEN** a service without login is started with automatic restart
- **THEN** the setup hint and the login error appear at most once per delay period in the logs

#### Scenario: Stop during delay
- **WHEN** the user runs `docker compose stop` while the container waits after a failure
- **THEN** the container stops within a few seconds, without waiting for the delay to end

#### Scenario: Clean stop of a running server
- **WHEN** the user runs `docker compose stop` while the server is running
- **THEN** the server receives the stop signal and the container stops without being killed after the timeout

### Requirement: Command override for setup
When started with an explicit command, the container SHALL run that command in place of the Remote Control server, with the same user, environment, and mounts.

#### Scenario: Interactive login
- **WHEN** a user runs `docker compose run --rm -it <service> claude auth login`
- **THEN** the login flow runs interactively and the resulting credentials are stored in the service's config storage

### Requirement: Single config location
The image SHALL direct all persistent Claude Code state (credentials, settings, onboarding state, workspace trust, Remote Control enablement) into a single directory intended to be mounted as a volume.

#### Scenario: State survives container recreation
- **WHEN** a user has logged in and confirmed Remote Control and workspace trust, then runs `docker compose down` and `docker compose up -d`
- **THEN** the Remote Control server starts without asking for login, enablement, or trust again
