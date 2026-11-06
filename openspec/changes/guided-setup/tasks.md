# Tasks

## 1. Shared helpers

- [x] 1.1 Add a shared shell file (sourced by `entrypoint.sh` and `setup`) with the session-name prefix default, the spawn-mode selection, and the trust check from D2 (`node -e` reading `projects["/workspace"].hasTrustDialogAccepted` from the config JSON in `CLAUDE_CONFIG_DIR`). Verify with a test config JSON: trust true, false, field missing, and file missing each give the expected result.

## 2. Entrypoint

- [x] 2.1 Add the `waiting-config` phase (D3): probe-file write test on `CLAUDE_CONFIG_DIR`, log directory, owner, container UID/GID, and `chown` hint, re-check every 10 s. Verify with a config directory owned by root: the container keeps running and logs the hint, and after `chown` on the host it continues without a restart.
- [x] 2.2 Add the `waiting-setup` phase with the D1 rules (legacy check once at start, then login + marker), a setup hint at start and every 5 min, and a re-check every 5 s. Verify: an empty config waits without restarts; creating `.credentials.json` and the marker starts the server path within 10 s; a config with login and trust at start goes straight to the server path and writes the marker; login plus trust created while waiting does not start the server.
- [x] 2.3 Write `/tmp/crb-state` in every phase and make all waits interruptible (D3). Verify that `docker compose stop` ends the container within 5 s in `waiting-config`, `waiting-setup`, and `restarting`, and that the state file shows the current phase.
- [x] 2.4 Point the failure message after a server error to `setup`. Verify the message in the log of a failing server.

## 3. Setup command

- [x] 3.1 Write `/usr/local/bin/setup` (D4) with the four steps, the skip rules, the explanations, and the prefix default. Verify with a test image that replaces `claude` by a fake: a fresh config runs all three steps and writes the marker; a config with login and trust runs only step 3; a failing login stops with a non-zero code and no marker; a trust step that leaves trust unset stops without a marker.
- [x] 3.2 Make Ctrl-C end only step 3 (`trap ':' INT`). Verify with the fake `claude` under `docker run -it` and `docker exec -it`: SIGINT to the foreground process group ends the fake server, and `setup` still writes the marker and exits 0.

## 4. Image

- [x] 4.1 Copy `setup` and the shared file into the image and add the `HEALTHCHECK` from D5. Verify with `docker inspect` that the healthcheck is set, that a waiting container turns unhealthy after the start period, and that a container in the `running` phase (fake `claude`) turns healthy.

## 5. Documentation

- [x] 5.1 Update the README (D6): quick start with `mkdir`/`chmod`, `up -d`, `exec -it <service> setup`; one-off `run --rm -it <service> setup`; the manual steps behind `setup`; troubleshooting for each waiting message; release notes for `0.3.0` including the legacy rule. Update the comment in `compose.example.yaml`. Verify that every waiting and error message from the entrypoint appears in the troubleshooting section and that `docker compose -f compose.example.yaml config -q` passes.

## 6. Field test and release

- [x] 6.1 Field test with a real login on the Mini-PC: a new project set up via `up -d` + `exec -it ... setup` connects without another command and its first session is named `<CRB_NAME>-...`; the existing LoopTalk service updated to the new image starts directly without `setup`; `docker compose ps` shows healthy for both. Record the result in design.md.
- [ ] 6.2 Bump image references to `0.3.0` and release `v0.3.0`. Verify that `docker manifest inspect` lists amd64 and arm64 for `0.3.0`.
