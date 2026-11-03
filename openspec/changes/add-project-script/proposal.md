# Proposal

## Why

Adding a project today means editing YAML by hand: copy a service block, keep `CRB_NAME`, the service name, the workspace path, and the config path consistent, create the config directory with the right owner and mode before the first start, and clone the repository. Each of these steps went wrong at least once in the field. One interactive script on the host should do all of it, in the prompt style the user already knows from FlashAgenda's `release.sh`.

## What Changes

- New interactive host script `add-project.sh` (bash). It asks for the Git URL, derives and validates the service name (which is also the name in the Claude app), asks for the clone directory, spawn mode, optional browser cache, and Git identity, shows a summary, and acts only after confirmation.
- It clones the repository, creates the config directory with mode 700, writes one compose file per project to `services/<name>.yaml`, adds it to `compose.yaml` under `include:`, and checks the result with `docker compose config`. On a failed check it removes what it added to the compose setup.
- New recommended layout: `compose.yaml` only lists `include:` entries, `box.yaml` holds the shared hardening as a base service that each project `extends`, and every project has its own file. The script creates `compose.yaml`, `box.yaml`, and `.env` (UID/GID) when they are missing, so it also works as the first step of a fresh installation.
- README and examples describe the new layout and the script. The single-file layout with the `x-box` anchor keeps working and stays documented as the manual alternative.

Out of scope: removing or renaming projects with the script, non-interactive flags beyond an optional Git URL as first argument, running `setup` or `up` automatically, editing services that the script did not create, Windows hosts.

## Capabilities

### New Capabilities
- `project-scaffolding`: the interactive script that adds a project service, its prompts, validation, created files, compose layout, and failure behavior.

### Modified Capabilities
<!-- none: one service per project, workspace isolation, per-project config storage, and hardening stay as specified; the script produces services that satisfy them -->

## Impact

- New files: `add-project.sh`, `box.yaml` (also usable without the script), and an example `services/` file.
- Changed files: `README.md` (quick start and "Adding a project"), `compose.example.yaml` (comment pointing to the new layout).
- Requirements on the host: bash, git, Docker Compose 2.20 or newer (for `include:`).
- The script's final hint points to the setup flow; it assumes `guided-setup` (the `setup` command) is released first or together.
