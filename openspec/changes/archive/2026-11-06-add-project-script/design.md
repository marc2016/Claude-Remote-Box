# Design

## Context

See proposal.md - Why. Relevant current state:

- `compose.example.yaml` defines the shared hardening as a YAML anchor `x-box: &box` and one service per project with `<<: *box`. Anchors do not work across files.
- The README quick start writes `.env` with `UID`/`GID`, creates `./<project>/config` with mode 700, and edits `compose.yaml` by hand.
- `browser-screenshots` adds `ulimits: core: 0` to the shared block and an optional named volume per project at `/home/node/.cache/ms-playwright`. `guided-setup` adds the `setup` command.
- Style reference: FlashAgenda's `release.sh` (bash, `set -e`, emoji headline with `====` underline, `read -p` with `[default]`, numbered choices, `(y/N)` confirmations, step lines like `🧪 1/4 ...`, German output).
- Hosts: the Linux mini PC; the script should also run on macOS for users who keep the setup there.

## Goals / Non-Goals

**Goals:**
- A wrong answer never leaves a half-edited `compose.yaml`.
- Works in an empty directory and next to an existing single-file setup.

**Non-Goals:**
- A general YAML editor; the script only ever adds one `include:` line and new files.
- Supporting `include:` written in flow style (`include: [a, b]`); the script detects it and stops before changing anything.

## Decisions

### D1: bash in the style of `release.sh`
`#!/usr/bin/env bash`, `set -euo pipefail`. A small `ask VAR "Frage" "default"` helper wraps `read -r -p`, and `confirm "Frage"` implements `(y/N)` with `[[ $a =~ ^[Yy]$ ]]`. Output is German like the reference; code and comments are English. Only bash 3.2 features (macOS): no `${var,,}`, no associative arrays; lower-casing via `tr`. Input is read from stdin, so tests can pipe answers.

### D2: Layout with `include:` and `extends:`
```text
compose.yaml          include:
                        - services/flashagenda.yaml
box.yaml              services: { box: <image, restart, user, cap_drop, security_opt, ulimits> }
services/
  flashagenda.yaml    services:
                        flashagenda:
                          extends: { file: ../box.yaml, service: box }
                          environment: { CRB_NAME: flashagenda, ... }
                          volumes: [ <clone dir>:/workspace, ../flashagenda/config:/home/node/.claude,
                                     flashagenda-browsers:/home/node/.cache/ms-playwright ]
                      volumes: { flashagenda-browsers: {} }
```
`box.yaml` is never included itself, so `box` is not a running service; it is only an `extends` source. Relative paths in an included file resolve against that file's directory, hence `../box.yaml` and `../<name>/config`. The clone directory is written as an absolute path, so `~` handling and the working directory do not matter.
- The image tag in the generated `box.yaml` comes from a `CRB_VERSION` constant in the script, bumped with each release (part of the release checklist).
- *Alternative: append a marked block to `compose.yaml`.* Rejected by the user in favour of one file per project.

### D3: Adding the include entry with plain text tools
- `compose.yaml` missing: create it with `include:` and the entry.
- Has a line matching `^include:[[:space:]]*$`: insert `  - services/<name>.yaml` directly after that line.
- Has `include:` in any other form (flow style, inline value): stop before the summary with a message.
- No `include:` key: append a blank line, `include:`, and the entry at the end.

Edits go through a temp file plus `mv`, not `sed -i`, because GNU and BSD `sed -i` differ. The entry line is exact, so the rollback removes exactly that line.

### D4: Validation before the summary
Before asking for confirmation the script checks: required tools (`git`, `docker compose` ≥ 2.20 via `docker compose version --short`), not running as root (a root run would create root-owned config directories, the known trap), the service name rule, uniqueness against `docker compose config --services` (when `compose.yaml` exists; if that command already fails, the script stops and shows the error rather than building on a broken setup) and against `services/<name>.yaml`, and the `include:` form from D3.

### D5: Order of side effects and rollback
After confirmation: (1) clone or reuse the directory, (2) create `./<name>/config` (mode 700), (3) create missing base files, write `services/<name>.yaml`, add the include entry, (4) `docker compose config -q`. If (4) fails, undo only (3)'s service file and include line. Clone and config directory stay because they are harmless and possibly expensive to recreate; the message says so. Base files created in this run stay too; they are valid on their own.

`.env` is created only on a fresh setup (no `compose.yaml` at start). In an existing setup without `.env` the services run as 1000:1000; creating `.env` there would silently switch all of them to the invoking user, which can lock them out of their config directories. The script prints a hint instead. Found by the single-file test during implementation. A failed clone in (1) stops before anything else is written.

### D6: YAML values
Values that come from the user (Git name, email, paths) are written double-quoted with `\` and `"` escaped. Service name and spawn mode are already restricted to safe characters. Spawn mode is written only when the user picked `same-dir`, matching the entrypoint default for Git repositories.

### D7: Tests
`tests/add-project.test.sh` runs the script in temporary directories with piped answers and a local bare Git repository as URL, and asserts on created files and `docker compose config` output. It covers the spec scenarios that do not need a real remote. `shellcheck` runs on the script. Both run in a new CI workflow on pull requests.

## Risks / Trade-offs

- [Compose older than 2.20 on the host] → Checked up front with a clear message; the README states the minimum.
- [User edits `compose.yaml` so that `include:` is not at column 0 or is written oddly] → Detected by D3/D4 before any change.
- [`CRB_VERSION` in the script falls behind the image] → Release checklist item; the generated `box.yaml` is a normal file the user can edit.
- [Existing single-file users get two styles in one setup] → Allowed and tested; the README explains that both coexist.

## Migration Plan

No migration. Existing setups keep working. Users who want the new layout run the script for new projects; moving old services into `services/` by hand is described briefly in the README.

## Field test

2026-11-06, Mini-PC: the script (as `add-project.sh`, later `crb add`) added `janus-note-vs` next to the existing LoopTalk service in place of the planned FlashAgenda; `docker compose up -d janus-note-vs` and `setup` connected it in the Claude app under that name, LoopTalk kept running unchanged. Recorded in `guided-setup` design.md as well. The same run surfaced the empty root-owned `workspace` directory Docker leaves behind, which the script now replaces.

