# project-scaffolding Specification

## Purpose
An interactive host script that adds a project to a claude-remote-box installation: it clones the repository, creates the per-project config storage, and registers a hardened Compose service, so that the user only has to start it and run setup.

## Requirements

### Requirement: Interactive prompts with defaults
The script SHALL ask for its inputs interactively, show a default in square brackets where one exists, and accept the default on empty input. It SHALL ask for: the Git URL (optionally given as first argument instead), the service name, the clone directory, the spawn mode as a numbered choice, whether to add a browser cache, and the Git author name and email. Defaults SHALL be: the service name derived from the repository name, the clone directory `./<service name>/workspace`, worktree spawn mode, a browser cache, and the host's global Git identity. The clone directory SHALL NOT contain the config directory or lie inside it.

#### Scenario: Accept all defaults
- **WHEN** the user starts the script with `git@github.com:marc2016/FlashAgenda.git` as argument and presses Enter at every prompt
- **THEN** the summary shows service `flashagenda`, clone directory `./flashagenda/workspace`, spawn mode worktree, a browser cache, and the host's Git name and email

#### Scenario: URL as argument
- **WHEN** the Git URL is given as first argument
- **THEN** the script does not ask for it

### Requirement: Valid and unique service name
The service name SHALL be used unchanged as Compose service name, as `CRB_NAME`, and as the name of the project's config directory. The derived default SHALL be the repository name in lower case with every character outside `a-z`, `0-9`, `-`, `_` removed. The script SHALL reject a name that is empty, does not start with a letter or digit, contains other characters, or is already used by a service in the current compose setup or by an existing `services/<name>.yaml`, and SHALL ask again.

#### Scenario: Invalid name
- **WHEN** the user enters `Flash Agenda`
- **THEN** the script explains the allowed characters and asks again

#### Scenario: Name already taken
- **WHEN** a service `looptalk` exists and the user enters `looptalk`
- **THEN** the script says the name is in use and asks again

### Requirement: Confirmation before changes
The script SHALL make no change on disk before the user confirms a summary of all inputs and of the files and directories it will create. Answering anything other than yes SHALL end the script without changes.

#### Scenario: Declined summary
- **WHEN** the user answers the final question with Enter or `n`
- **THEN** the script exits, and no clone, directory, compose file, or include entry was created

### Requirement: Project files and directories
After confirmation the script SHALL clone the repository into the clone directory, create `./<name>/config` with mode 700 owned by the invoking user, write `services/<name>.yaml`, and add `services/<name>.yaml` to the `include:` list of `compose.yaml`. It SHALL print each step with a counter in the style `1/4`.

If the clone directory already exists, the script SHALL clone into it when it is empty, SHALL use it without cloning and without asking when it is a Git checkout whose `origin` is the given repository (HTTPS and SSH forms count as equal), and SHALL otherwise ask before using it without cloning and ask for another clone directory if the user declines. If the config directory already exists and is not empty, the script SHALL ask before reusing it.

#### Scenario: Fresh project
- **WHEN** the user confirms the summary for a new project
- **THEN** the repository is cloned, `./<name>/config` exists with mode 700, `services/<name>.yaml` exists, and `compose.yaml` lists it under `include:`

#### Scenario: Existing checkout
- **WHEN** the clone directory already contains a checkout and the user agrees to use it
- **THEN** the script does not clone and uses that directory as `/workspace` of the new service

#### Scenario: Re-run with the same repository
- **WHEN** the script runs again after the setup files were removed, and the clone directory still holds a checkout of the same repository
- **THEN** the script uses it without asking and keeps local changes in it

#### Scenario: Empty clone directory
- **WHEN** the clone directory exists and is empty
- **THEN** the script clones into it without asking

#### Scenario: Empty directory left by Docker
- **WHEN** the clone directory or the config directory exists, is empty, and is not writable by the user (typically created as root by Docker for a missing bind-mount source)
- **THEN** the script removes it after the summary is confirmed and creates it anew, owned by the user

#### Scenario: Reuse declined
- **WHEN** the clone directory holds other content and the user declines to use it
- **THEN** the script asks for another clone directory

### Requirement: Generated service
The generated service SHALL extend the shared base service from `box.yaml`, so that it gets the image, restart policy, user mapping, dropped capabilities, `no-new-privileges`, and core-dump limit defined there. It SHALL set `CRB_NAME` to the service name, set the spawn mode only when it differs from the default, set the Git identity when one was given, mount the clone directory at `/workspace` and `./<name>/config` at `/home/node/.claude`, and, when chosen, mount a named volume `<name>-browsers` at `/home/node/.cache/ms-playwright`. It SHALL mount nothing else.

#### Scenario: Generated service matches the hardening
- **WHEN** a service created by the script is inspected with `docker compose config <name>`
- **THEN** it has `cap_drop: [ALL]`, `no-new-privileges`, no ports, the expected `CRB_NAME`, and only the workspace, config, and optional browser-cache mounts

### Requirement: First use creates the base layout
When `compose.yaml` or `box.yaml` do not exist in the current directory, the script SHALL create them: `compose.yaml` with an `include:` list and `box.yaml` with the base service. It SHALL create `.env` with the invoking user's UID and GID only when neither `.env` nor `compose.yaml` exists, so that the user of existing services never changes. When `compose.yaml` exists but `.env` does not, the script SHALL leave `.env` absent and print a hint that services run as UID/GID 1000 unless `.env` sets them. It SHALL NOT overwrite any of these files when they exist. When an existing `compose.yaml` has no `include:` key, the script SHALL add one without changing the existing content.

#### Scenario: Empty directory
- **WHEN** the script runs in an empty directory and the user confirms
- **THEN** `compose.yaml`, `box.yaml`, `.env`, `services/<name>.yaml`, and `./<name>/config` exist, and `docker compose config -q` succeeds

#### Scenario: Existing single-file setup
- **WHEN** `compose.yaml` already defines services with the `x-box` anchor and has no `include:` key
- **THEN** after the script those services are unchanged, the new service is included, and `docker compose config -q` succeeds

#### Scenario: Existing setup without .env
- **WHEN** `compose.yaml` exists, `.env` does not, and the user confirms
- **THEN** no `.env` is created, the effective user of the existing services is unchanged, and the output contains a hint about UID/GID

### Requirement: Validated result
After writing, the script SHALL run `docker compose config -q`. If it fails, the script SHALL remove the include entry and `services/<name>.yaml` it added, keep the clone and the config directory, show the Compose error, and exit with a non-zero code. On success it SHALL print the commands to start the service and to run its setup.

#### Scenario: Invalid result is rolled back
- **WHEN** the compose check fails after the files were written
- **THEN** `compose.yaml` no longer lists the new file, `services/<name>.yaml` does not exist, and the script exits non-zero with the Compose error

#### Scenario: Next steps
- **WHEN** the check succeeds
- **THEN** the script prints `docker compose up -d <name>` and `docker compose exec -it <name> setup`

### Requirement: Subcommand invocation
The host script SHALL be named `crb` and SHALL take a subcommand as its first argument: `add [git-url]` runs the project scaffolding described in this capability, `update` runs the installation update, and no subcommand or an unknown one SHALL print a usage line listing both and exit non-zero. `crb add` SHALL behave exactly as the scaffolding script did, including its printed next steps.

#### Scenario: Add with URL
- **WHEN** the user runs `./crb add git@github.com:marc2016/FlashAgenda.git`
- **THEN** the scaffolding questions start with the service name, as before

#### Scenario: No subcommand
- **WHEN** the user runs `./crb`
- **THEN** the usage with `add` and `update` is printed and the exit code is non-zero
