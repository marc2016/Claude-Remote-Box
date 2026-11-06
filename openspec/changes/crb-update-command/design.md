# Design

## Context

See proposal.md for motivation. What shapes the approach:

- `add-project.sh` is one bash file fetched with `curl` and run from the directory holding `compose.yaml`. It already has `ask`, `confirm`, `confirm_yes`, `yaml_str`, the permission menu, and the phone-mode heredoc (after `phone-friendly-projects`), and it follows "ask everything, show a summary, write nothing before confirmation, validate with `docker compose config -q`, roll back on failure".
- Files the script generates have a known shape: `services/<name>.yaml` always has `environment:` with `CRB_NAME` as its first entry, and `box.yaml` has exactly one `image:` line. Single-file setups (`x-box` anchor in `compose.yaml`) were written by hand or copied from the example and are not safe to edit mechanically.
- `raw.githubusercontent.com/.../main/...` is cached for a few minutes after a push (observed today). A self-update that reads it may see the previous version briefly.
- `guided-setup` established "look at what is there, offer only what is missing, never overwrite" as the project's update philosophy. `update` follows the same rule on the host.

## Goals / Non-Goals

**Goals:**
- One file, one download, two subcommands; the questions and the template exist once.
- `update` is safe to run at any time and twice in a row; the second run changes nothing.
- The summary-then-write rule holds for `update` too, with the self-update as the single documented exception.

**Non-Goals:**
- Version-numbered migrations or a stored installation version.
- Editing single-file `compose.yaml` setups.
- Anything inside the container or the image.

## Decisions

### D1: One script `crb` with subcommands, old name dropped
`main()` dispatches on `$1`: `add` runs the existing flow, `update` the new one, anything else prints usage and exits 64. Shared pieces become functions: `ask_permission_mode` (menu, sets `permission`), `write_phone_mode <config-dir>` (template heredoc, keeps an existing file), `write_env_line <service-file> <key> <value>` (inserts under `environment:`). The old file name is not kept as a shim: nothing in a running installation calls it, and the README is the only place that names it.
- *Alternative: `update.sh` next to `add-project.sh`.* Rejected. The template and the menu would exist twice, and a self-update would have to fetch two files.
- `CRB_VERSION`/`CRB_IMAGE` and the root/Compose-version guards stay global and run for both subcommands.

### D2: Self-update first, then re-exec once
`update` downloads `$CRB_SOURCE` (default `https://raw.githubusercontent.com/marc2016/Claude-Remote-Box/main/crb?t=<epoch>`) to a temp file with `curl -fsSL`. If it is non-empty, starts with `#!/usr/bin/env bash`, and differs from `$0` (`cmp -s`), it is moved over `$0` with the original mode, and the script does `exec "$0" update --no-self-update "$@"`. The flag prevents a second fetch. A failed download prints a warning and continues.
- The `?t=<epoch>` query is meant to bypass the CDN cache. Whether raw.githubusercontent honors it is unverified; task 1.3 checks it. If it does not, the design stays and the README mentions the delay.
- `CRB_SOURCE` set to a local path (`file://` or a plain path handled with `cp`) is how the tests exercise the replace-and-re-exec path without network.
- *Alternative: fetch from the latest release tag.* Rejected for now: script fixes would need a release, while today the script and the image evolve independently.

### D3: Reconcile per project, reuse the `add` questions
Projects are the files `services/*.yaml`; the name is the file name, the config directory is `./<name>/config` (the layout `add` creates; `update` checks that the file mounts `../<name>/config` and otherwise prints the project as "not created by crb, skipped"). For each project:

```text
permission set?   (grep -- '--permission-mode' in the CRB_EXTRA_ARGS line)
  yes -> show "Permission: auto (bleibt)"
  no  -> ask_permission_mode (1 preselected = no change)
CLAUDE.md exists?
  yes -> show "Handy-Modus: an (bleibt)"
  no  -> confirm_yes "Handy-Modus anlegen?"
```

Writing a flag: if the service has no `CRB_EXTRA_ARGS`, insert `      CRB_EXTRA_ARGS: "--permission-mode <mode>"` after the `CRB_NAME` line with `awk`; if it has one, rewrite that line with the flag appended inside the quotes. Both edits are limited to the `environment:` block of the single service the file contains.
- *Alternative: a separate "keep" option in the menu.* Rejected: `default` preselected already means "no change", and the menu stays identical to `add`.

### D4: Summary, write, validate, restore
`update` collects planned actions in arrays (tag change, per-service flag, per-service file), prints them as the summary, and writes only after `confirm "Anwenden?"`. Before writing, every file to be edited is copied to a temp directory; after writing, `docker compose config -q` runs; on failure, the copies are restored, created `CLAUDE.md` files are kept (they are harmless and the user asked for them), and the Compose error is shown. This mirrors the rollback in `add`.

### D5: Pull always, recreate on request, default no
`docker compose pull` runs after a confirmed summary even when nothing else changed, because "get the newest image" is half of what "update" means to the user. Recreating services ends their sessions, including one Claude may be working in from the phone, so the question defaults to no and the exact `docker compose up -d <names>` command is printed for later. Only services whose file changed are offered; the pulled image is picked up by them too, and by the others on their next restart.
- *Alternative: default yes.* Rejected: an `update` started while a session is active would kill it on a reflexive Enter.

### D6: Single-file setups
When `services/` does not exist and `compose.yaml` defines services, `update` lists each service from `docker compose config --services` and prints the `CRB_EXTRA_ARGS` line and the `CLAUDE.md` path for it, then continues with the pull. The tag line in `compose.yaml` is also only printed. This keeps the one mechanical edit the script does (D3) to files it wrote itself.

## Risks / Trade-offs

- [Self-update replaces the script with a broken download] → size and shebang check before the move; `bash -n` on the temp file as a syntax check; the previous file is kept as `crb.old` until the re-exec succeeds, then removed.
- [CDN cache serves the previous script] → task 1.3 verifies the query-string bypass; otherwise documented delay, and the output names the version it fetched (the `CRB_VERSION` line) so the user can tell.
- [`awk` edit hits an unexpected file shape] → only files that `add` wrote (mount check in D3) are edited; everything else is printed for by-hand editing; `docker compose config -q` plus restore catches a broken result.
- [User runs `update` on the phone through a session] → not supported; the command needs a terminal on the host like `add`.
- [Rename breaks copies of the README quick start people saved] → accepted; the proposal marks it breaking.

## Migration Plan

Fetch the new script once by hand: `curl -fsSLO .../main/crb && chmod +x crb && rm add-project.sh`. From then on `./crb update` keeps it current. No container or image change; archive after `add-project-script` and `phone-friendly-projects`.

## Open Questions

- Whether `raw.githubusercontent.com` bypasses its cache for a changed query string (task 1.3). The answer changes one sentence in the README, not the design.

## Field test

2026-11-06, Mini-PC, `crb` from commit `3d01f3d`: `add-project.sh` replaced by `crb`, `./crb update` run on the installation with `janus-note-vs` and LoopTalk. The user reported the run and the result as good; the services reconnected. Not separately confirmed: the "nothing to do" message on a second run and the phone-mode behavior over several days, which `phone-friendly-projects` task 5.1 covers.
