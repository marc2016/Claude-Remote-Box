# Proposal

## Why

Settings that `add-project.sh` asks for at creation time (permission mode, phone mode, and whatever comes next) never reach projects that already exist, and updating an installation today means remembering four separate steps: fetch the newer script, change the image tag, `docker compose pull`, `up -d`. With two or three projects on a headless machine this is already the kind of thing that gets done half-way. One command should bring the script, the image, and every project up to date, asking only about what is missing.

## What Changes

- `add-project.sh` becomes `crb`, one host script with subcommands: `crb add <git-url>` is today's script unchanged in behavior, `crb update` is new, and `crb` without a subcommand prints the usage. The old file name is dropped; README, CI workflow, and the test file are renamed. **BREAKING** for the documented quick start and for anyone who typed `./add-project.sh`; nothing in a running installation changes.
- `crb update` works as a reconciliation, not as a version migration: it looks at what the installation has and offers only what is missing. In order: fetch the newest `crb` and replace itself if it differs (then re-run with the new version); offer to switch a pinned image tag in `box.yaml` to `latest`; for every `services/<name>.yaml`, ask for the permission mode when none is set and offer the phone-mode file when `./<name>/config/CLAUDE.md` is missing, reusing the same menu and template as `add`; show a summary of everything that would change and ask for confirmation before writing; then `docker compose pull` and offer to recreate the services whose files changed, warning that this ends their running sessions.
- Single-file setups (services inside `compose.yaml` with the `x-box` anchor) are not edited: `update` prints which line belongs where, as the README's "By hand" sections do today.
- The README gets an "Updating" section built around `./crb update`, replacing the manual tag-and-pull instructions, and every `add-project.sh` mention becomes `crb add`.

Out of scope: `crb remove`, a `crb setup <name>` shortcut, converting single-file setups to the `include:` layout, and anything that changes files inside the container.

## Capabilities

### New Capabilities

- `installation-update`: the `crb update` command: self-update of the script, image tag and pull, per-project reconciliation of settings introduced after the project was created, confirmation before writing, and the optional recreate of changed services.

### Modified Capabilities

- `project-scaffolding`: the script is invoked as `crb add <git-url>` instead of `./add-project.sh <git-url>`; the printed next steps and all other behavior stay. This capability is a delta in the in-flight change `add-project-script` and is modified again by `phone-friendly-projects`; this change must be archived after both.

## Impact

- `add-project.sh` → `crb`: argument parsing with subcommands, the questions and the phone-mode template factored into functions that both subcommands use, new `update` flow.
- `tests/add-project.test.sh` → `tests/crb.test.sh`: existing scenarios call `crb add`; new scenarios for `update` against installations created by `add` (settings missing, settings present, pinned tag, single-file setup, declined summary), with the self-update step pointed at a local file through an environment variable so tests do not touch the network.
- `.github/workflows/scripts.yml`: new file names.
- `README.md`: quick start, "Adding a project", "Versions and updating", "Phone mode" (the by-hand instructions become "or run `./crb update`").
- No image change.
