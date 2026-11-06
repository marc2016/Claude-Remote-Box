# Design

## Context

See proposal.md for motivation. Current state, from the archived change `initial-compose-service`:

- `entrypoint.sh` passes explicit commands through with `exec "$@"`. Without a command it checks `CRB_NAME`, prints a hint when `.credentials.json` is missing, picks the spawn mode, runs `claude remote-control` as a child with signal forwarding, and waits `CRB_RESTART_DELAY` after a non-zero exit.
- All Claude Code state lives in `CLAUDE_CONFIG_DIR=/home/node/.claude`. The login is `.credentials.json`. Workspace trust lives in Claude Code's config file in that directory, under the project entry for `/workspace`: `.claude.json` → `projects["/workspace"].hasTrustDialogAccepted`, confirmed `true` on the field-test config with 2.1.316. How the answer to "Enable Remote Control?" is stored is not documented and not identified.
- The container runs with `cap_drop: ALL` and as an arbitrary UID, so it cannot fix the ownership of a mounted directory itself.
- `docker compose exec` does not go through the entrypoint. Anything the entrypoint exports (the session-name prefix) is missing in an `exec` session.
- The image has `node`, `stat`, and POSIX `sh`, but no `jq` and no `procps`.

## Goals / Non-Goals

**Goals:**
- `up -d` can come before setup, and setup can run against the running container.
- One command covers all first-run steps, and a repeated run is harmless.
- Existing installations keep working after the update without any action.

**Non-Goals:**
- Writing Claude Code's own config to pre-accept trust or enablement.
- Detecting "Connected" automatically (decided: manual Ctrl-C).
- Sharing one login between services.

## Decisions

### D1: Setup state = login present + marker file, with a legacy rule at start
`setup` writes `$CLAUDE_CONFIG_DIR/.crb-setup-done` after its last step. The server path treats the service as set up when:
- at container start, a login exists and trust for `/workspace` is accepted (legacy rule, covers installations from before this change, and writes the marker), or
- later, a login exists and the marker exists.

The legacy rule is evaluated only once at start. Evaluated continuously, it would fire right after the trust step of a running `setup`, and the server would start before the user has answered "Enable Remote Control?".
Requiring the login in both cases means that a user who deletes `.credentials.json` gets the waiting state again instead of a failing server.
- *Alternative: wait only for login and trust.* Rejected because of the race described above.
- *Alternative: detect enablement directly.* Rejected. The storage of that answer is undocumented.

### D2: Read trust with `node`, never write it
A short `node -e` snippet reads the config JSON and prints whether `projects["/workspace"].hasTrustDialogAccepted` is true. Missing files or fields count as "not trusted". The worst case of a renamed field is that `setup` asks for trust again and the legacy rule does not fire, so existing users run `setup` once. Both are visible and harmless.
- *Alternative: install `jq`.* Not needed, `node` is already there.

### D3: Entrypoint phases and a state file
The server path becomes a sequence of phases. Each phase writes its name to `/tmp/crb-state`:

```text
 prefix, passthrough, CRB_NAME check   (unchanged)
        |
 waiting-config  -- config dir not writable --> log owner + chown hint, re-check every 10 s
        |
 waiting-setup   -- not set up (D1) --> log setup hint at start and every 5 min, re-check every 5 s
        |
 running         -- claude remote-control as child, signals forwarded (unchanged)
        |
 restarting      -- non-zero exit: wait CRB_RESTART_DELAY, then exit (unchanged)
```

All waits use a background `sleep` plus `wait`, with the same `TERM`/`INT` trap as the server, so `docker compose stop` ends any phase within a few seconds.
- The writability test creates and removes a probe file. `[ -w ]` alone is not enough on some bind mounts.
- The hint names the directory as mounted in the container (`/home/node/.claude`), the owner from `stat -c %u:%g`, the container's `id -u`:`id -g`, and `chown <uid>:<gid> <host path of the config dir>`. The host path is unknown inside the container, so the hint uses a placeholder.

### D4: `setup` as its own script in `/usr/local/bin/setup`
A POSIX `sh` script, so it works with `docker compose exec` (no entrypoint) and with `docker compose run` (entrypoint passthrough).
- It applies the session-name prefix default itself, because `exec` skips the entrypoint.
- Step 1, login: skipped if `.credentials.json` exists. Otherwise `claude auth login`. A non-zero exit stops `setup` without a marker.
- Step 2, trust: skipped if D2 reports trust. Otherwise `claude` in `/workspace`, with the instruction to accept trust and type `/exit`. Afterwards D2 must report trust, otherwise `setup` stops without a marker.
- Step 3, enablement: always runs `claude remote-control` in `/workspace`, with the same `--name` and spawn mode logic as the server. The instruction says to answer "y" if asked and to press Ctrl-C once "Connected" appears. While this step runs, the script sets `trap ':' INT`. A handler, unlike an ignored signal, is reset for the child, so Ctrl-C still reaches `claude` while the script survives and continues. The exit code of this step is ignored.
- Step 4: write the marker and print that the server starts within a few seconds (in a running container) or on the next `up -d`.
- *Alternative: a subcommand of `entrypoint.sh`.* Rejected. `exec` would need the full path and arguments, and the two concerns stay easier to read apart.
- Spawn-mode selection moves into a small shared shell file sourced by both scripts, so step 3 and the server agree.

### D5: Healthcheck from the state file
`HEALTHCHECK --interval=30s --start-period=10s CMD test "$(cat /tmp/crb-state 2>/dev/null)" = running`. A waiting container shows as unhealthy after the start period, a running server as healthy. Passthrough runs (`run --rm ... setup`) never write the file and are short-lived, so their health state does not matter.

### D6: Documentation
The quick start becomes `mkdir` + `chmod`, `up -d`, `exec -it <service> setup`. The README keeps a short section with the manual steps that `setup` runs, and the troubleshooting section maps each waiting message to its fix. The comment in `compose.example.yaml` mentions `setup`.

## Risks / Trade-offs

- [Claude Code renames or moves the trust field] → D2 fails safe: `setup` asks for trust again, and existing installations wait until `setup` is run once. A field check is part of the tasks, and the release notes mention the fallback.
- [The Ctrl-C handling differs between `exec -it` and `run -it`] → Both give the process group a TTY, so SIGINT reaches script and child. Tested in both modes before release.
- [Marker present, but enablement was never answered, e.g. `setup` aborted in step 3 with a second Ctrl-C] → The server fails, and the existing restart delay applies. The failure message points to `setup`.
- [A one-off `run ... setup` and the waiting service share the config directory] → Intended: the waiting service sees the marker and starts. Both only read Claude Code's files, and only `setup` writes the marker.
- [Behavior change: a missing setup no longer causes restarts] → Monitoring that expected a failing container now sees an unhealthy one. The health state makes this visible.

## Migration Plan

Release as `0.3.0`. Existing users change the tag and run `docker compose pull && docker compose up -d`. Their services start directly through the legacy rule (D1). If the trust field cannot be read for some reason, the service waits and the log tells them to run `setup` once.

## Verification

Tasks 1.1 to 4.1 are covered by `tests/setup.test.sh`. It builds the image plus a variant with a fake `claude` (`tests/fake/claude`) and runs real containers: trust check for true, false, missing field and missing file; `waiting-config` with a root-owned config volume, continuing after `chown` without a restart; `waiting-setup` with the D1 rules (login plus trust created while waiting does not start the server, the marker does, the legacy rule fires at start and writes the marker); the state file and stop within 5 s in every phase; the failure message after a server error; `setup` for a fresh config, a config with login and trust, a failing login and a missing trust; Ctrl-C in step 3 through a pty under `docker run` and `docker exec`; the healthcheck. A waiting container turns unhealthy only after three failed checks, about 90 s after start, not right after the start period.

Field test on the Mini-PC, 2026-11-06, with the `edge` image built from `186c042`: the new project `janus-note-vs` was added with `add-project.sh`, started with `up -d`, and set up with `exec -it janus-note-vs setup`. It connected without another command, shows up in the Claude app with its first session named `janus-note-vs-...`, and `docker compose ps` shows it healthy. The existing LoopTalk service, updated to the same image, started directly without `setup` and is healthy.
