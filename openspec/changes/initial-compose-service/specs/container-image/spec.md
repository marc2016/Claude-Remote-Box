# Spec Delta

## Purpose

Defines the prebuilt claude-remote-box container image: what it contains, how its Claude Code version is fixed, and how it starts a Remote Control server that is configured through environment variables.

## ADDED Requirements

### Requirement: Pinned Claude Code version
The image SHALL contain exactly one Claude Code version, fixed at build time, and SHALL NOT update Claude Code by itself at runtime. The image tag SHALL identify the contained Claude Code version.

#### Scenario: Version matches tag
- **WHEN** a user runs `claude --version` in a container started from tag `<version>`
- **THEN** the reported Claude Code version equals `<version>`

#### Scenario: No self-update
- **WHEN** the container has been running across a new upstream Claude Code release
- **THEN** the Claude Code version inside the container is unchanged

### Requirement: Base tooling
The image SHALL provide Node.js 26, Git, and ripgrep in addition to Claude Code.

#### Scenario: Tools available
- **WHEN** a user runs `node --version`, `git --version`, and `rg --version` in the container
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
When started without a command, the container SHALL run Claude Code in Remote Control server mode with `/workspace` as its working directory, in the default (prompting) permission mode. The session name SHALL be configurable through an environment variable, and the spawn mode SHALL be configurable through an environment variable that defaults to worktree mode.

#### Scenario: Named server
- **WHEN** the container starts with the session-name variable set to `projekt-a`
- **THEN** a Remote Control session named `projekt-a` appears in the user's Claude app session list

#### Scenario: Permission prompts reach the phone
- **WHEN** Claude in a remote session wants to run a shell command that is not pre-approved
- **THEN** the permission request is shown on the connected device and the command does not run until the user approves it

### Requirement: Command override for setup
When started with an explicit command, the container SHALL run that command in place of the Remote Control server, with the same user, environment, and mounts.

#### Scenario: Interactive login
- **WHEN** a user runs `docker compose run --rm -it <service> claude auth login`
- **THEN** the login flow runs interactively and the resulting credentials are stored in the service's config volume

### Requirement: Single config location
The image SHALL direct all persistent Claude Code state (credentials, settings, onboarding state, workspace trust, Remote Control enablement) into a single directory intended to be mounted as a volume.

#### Scenario: State survives container recreation
- **WHEN** a user has logged in and confirmed Remote Control and workspace trust, then runs `docker compose down` and `docker compose up -d`
- **THEN** the Remote Control server starts without asking for login, enablement, or trust again
