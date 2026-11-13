# installation-update Specification

## Purpose
A host command that brings an existing claude-remote-box installation up to date: the script itself, the image, and per-project settings that were introduced after a project was created, asking only about what is missing and changing nothing before the user confirms.

## Requirements

### Requirement: Update command
The host script SHALL provide an `update` subcommand that runs in the directory holding `compose.yaml`. It SHALL refuse to run as root and SHALL stop with a message when no `compose.yaml` exists in the current directory. It SHALL perform, in this order: self-update, image tag check, per-project reconciliation, summary and confirmation, image pull, optional recreate of changed services.

#### Scenario: No installation here
- **WHEN** `crb update` runs in a directory without `compose.yaml`
- **THEN** it exits non-zero with a message that names the expected file and changes nothing

#### Scenario: Nothing to do
- **WHEN** every project already has a permission mode and a phone-mode file, the image tag is `latest`, and the script is current
- **THEN** the command reports that the installation is up to date, runs `docker compose pull`, and asks no settings question

### Requirement: Self-update
The `update` subcommand SHALL fetch the newest script from the project's source before doing anything else, compare it with the running file, and, when they differ, replace the running file with the same permissions and re-run itself with the same arguments so that the rest of the update uses the new version. It SHALL NOT re-run more than once. When the fetch fails, it SHALL say so and continue with the running version. The source location SHALL be overridable through an environment variable, so that tests and offline use do not depend on the network.

#### Scenario: Newer script available
- **WHEN** the fetched script differs from the running one
- **THEN** the file on disk is replaced, the output says the script was updated, and the update continues with the new version without a second fetch

#### Scenario: Fetch fails
- **WHEN** the source cannot be reached
- **THEN** the command prints a warning and continues with the current version

### Requirement: Image tag and pull
When `box.yaml` pins the image to a release tag other than `latest`, the `update` subcommand SHALL offer to change it to `latest` (default yes). After confirmation of the summary it SHALL run `docker compose pull` for the installation. When the image line is not in `box.yaml` (single-file setup), it SHALL print the line to change instead of editing.

#### Scenario: Pinned tag
- **WHEN** `box.yaml` has `image: ghcr.io/marc2016/claude-remote-box:0.2.0` and the user accepts the offer
- **THEN** after confirmation `box.yaml` has the `latest` tag and nothing else in the file changed

#### Scenario: Already latest
- **WHEN** `box.yaml` already uses `latest`
- **THEN** no question about the tag is asked

### Requirement: Per-project reconciliation
For every `services/<name>.yaml`, the `update` subcommand SHALL show the project's current permission mode and phone-mode state. When the service has no `--permission-mode` in its extra arguments, it SHALL ask with the same menu as `add`, `default` preselected, and SHALL add `CRB_EXTRA_ARGS: "--permission-mode <mode>"` under the service's `environment:` only for a non-default answer. When `./<name>/config/CLAUDE.md` does not exist, it SHALL offer the phone-mode file (default yes) and write the same template as `add` after confirmation. It SHALL NOT change a service that already has a permission mode and SHALL NOT overwrite an existing `CLAUDE.md`. When the service already has a `CRB_EXTRA_ARGS` without a permission mode, it SHALL append the flag to the existing value.

#### Scenario: Project without settings
- **WHEN** `services/janus.yaml` has no `CRB_EXTRA_ARGS` and `./janus/config/CLAUDE.md` is missing, and the user chooses `auto` and accepts phone mode
- **THEN** after confirmation `docker compose config janus` shows `CRB_EXTRA_ARGS: --permission-mode auto`, `./janus/config/CLAUDE.md` exists with the phone-mode content, and `docker compose config -q` succeeds

#### Scenario: Project already set
- **WHEN** a service has `--permission-mode` in `CRB_EXTRA_ARGS` and its `CLAUDE.md` exists
- **THEN** the command lists the project with its current values and asks nothing about it

#### Scenario: Existing extra arguments
- **WHEN** a service has `CRB_EXTRA_ARGS: "--capacity 4"` and the user chooses `acceptEdits`
- **THEN** the value becomes `--capacity 4 --permission-mode acceptEdits`

#### Scenario: Keep default
- **WHEN** the user presses Enter at the permission menu
- **THEN** the service file is unchanged

#### Scenario: Single-file setup
- **WHEN** `compose.yaml` defines services itself and no `services/` directory exists
- **THEN** the command does not edit `compose.yaml` and prints, per service, the `CRB_EXTRA_ARGS` line and the `CLAUDE.md` path to add by hand

### Requirement: Confirmation and recreate
Before writing, the `update` subcommand SHALL show a summary of every file it would change or create and ask for confirmation; declining SHALL end the command without changes, except for the self-update, which happens first. After writing and pulling, when at least one service file changed, it SHALL offer to run `docker compose up -d` for exactly those services (default no) with a warning that this ends their running sessions, and SHALL print the command for later when declined. After `docker compose config -q` fails on the result, it SHALL restore the changed service files and `box.yaml` from the copies it kept and exit non-zero with the Compose error.

#### Scenario: Declined summary
- **WHEN** the user answers the summary with `n`
- **THEN** no service file, `box.yaml`, or `CLAUDE.md` was changed or created, and no pull or recreate runs

#### Scenario: Recreate declined
- **WHEN** two service files changed and the user declines the recreate
- **THEN** the command prints `docker compose up -d <name1> <name2>` and exits zero

#### Scenario: Invalid result restored
- **WHEN** `docker compose config -q` fails after the files were written
- **THEN** the service files and `box.yaml` are byte-identical to before, created `CLAUDE.md` files are kept, and the command exits non-zero with the Compose error

### Requirement: Status variables reconciled
When `services/crb-dashboard.yaml` exists and the `box` service in `box.yaml` lacks `CRB_STATUS_URL` or `CRB_STATUS_TOKEN`, `crb update` SHALL offer to add them (default yes) and, after confirmation, add the missing lines to the `box` service's `environment:` and count every box as a changed service for the recreate question. When `.env` lacks `CRB_STATUS_TOKEN`, it SHALL generate one in the same step.

#### Scenario: Variables missing
- **WHEN** the dashboard service exists, `box.yaml` has no status variables, and the user accepts
- **THEN** `docker compose config <box>` shows both variables for every box and the recreate question lists every box

#### Scenario: Already wired
- **WHEN** `box.yaml` already has both variables
- **THEN** no question about them is asked

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
