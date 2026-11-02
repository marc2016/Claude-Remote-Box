# Tasks

## 1. Spike: verify undocumented behavior

- [x] 1.1 With the published image and config storage mounted at `CLAUDE_CONFIG_DIR`, run `claude auth login`, then `claude` interactively (accept trust, `/exit`), then `claude remote-control` interactively (answer Enable), then `docker compose up -d`. Run `docker compose down` and `up -d` and verify that the service shows as connected again without any prompt, and check that the trust state lives inside the config storage. If it does not, switch to the D2 fallback (storage on `/home/node`) and repeat. (Field test so far: login persists across restarts, trust via `claude` works, server connects.)
- [x] 1.2 With the server running, open the Claude app and check whether a new session can be started into the server. Verify that it gets its own worktree with `--spawn worktree`. If no app-side creation exists, set the D7 default to `same-dir` and note it in design.md.
- [x] 1.3 Run two containers with different project directories and session names at the same time. Verify that both show as online in the Claude app and can be messaged independently.
- [x] 1.4 Record the final findings (works / fallback taken) in design.md under D2 and D7, replacing the "Not yet verified" notes.

## 2. Image

- [x] 2.1 Write the `Dockerfile` (D4): `node:26-trixie-slim`, git, ripgrep, ca-certificates, `CLAUDE_CODE_VERSION` build arg, `DISABLE_AUTOUPDATER=1`, `CLAUDE_CONFIG_DIR`, `HOME`, `WORKDIR /workspace`, system `safe.directory`, writable home (D5), `USER node`. Verify that `docker build` succeeds and that `claude --version` matches the build arg.
- [x] 2.2 Write the entrypoint script (D3): pass explicit commands through, otherwise start `claude remote-control` from `CRB_NAME`/`CRB_SPAWN`/`CRB_EXTRA_ARGS`, exit with an error when `CRB_NAME` is unset, and print a setup hint when no credentials exist. Verify by running `docker run <img> bash -c 'id'` (passthrough) and running without `CRB_NAME` (the error message appears).
- [x] 2.3 Verify arbitrary UID support: run with `--user 1001:1001`, a fresh volume, and a project directory owned by 1001. Check that `claude --version` works, that a file created in `/workspace` is owned by 1001 on the host, and that `git status` succeeds.
- [x] 2.4 Install the OpenSpec CLI pinned through an `OPENSPEC_VERSION` build arg. Verify that `openspec --version` in the container matches the build arg, including when running as UID 1001.

- [x] 2.5 Entrypoint: default `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` to `CRB_NAME` unless set (D3). Apply it before the command passthrough, so the interactive setup run gets it too. Verify that `docker run -e CRB_NAME=x <img> sh -c 'echo $CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX'` prints `x`, that an explicitly set prefix wins, and in the field test that a new session is named `x-...`.
- [x] 2.6 Entrypoint: choose the spawn mode (D3). If `CRB_SPAWN` is unset, use `worktree` for a Git workspace and `same-dir` otherwise, and log the choice. Verify with a non-Git and a Git workspace without login: the log names the chosen mode, followed by the login error rather than the worktree error. With `CRB_SPAWN=worktree` on a non-Git workspace, verify that the worktree error appears.
- [x] 2.7 Entrypoint: run the server as a child with `SIGTERM`/`SIGINT` forwarding, and wait `CRB_RESTART_DELAY` (default 30 s) after a non-zero exit (D3). Verify without login: two consecutive log blocks are at least 30 s apart, `docker stop` during the delay finishes in under 5 s, and the container exit code is the server's.

## 3. Compose service

- [x] 3.1 Write `compose.example.yaml` (D6): an `x-box` anchor with image, `restart: unless-stopped`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `user: "${UID:-1000}:${GID:-1000}"`, no ports, plus one example service with a `/workspace` bind mount and a `./<project>/config` config directory (named volume documented as alternative). Verify with `docker compose -f compose.example.yaml config`.
- [x] 3.2 End-to-end check with the built image and two services: run the documented first-run flow for each, then `up -d`. Verify that both sessions appear in the Claude app, that a shell-command permission prompt appears on the phone and blocks until approved, and that both survive `down` and `up -d` without new prompts.
- [x] 3.3 Verify hardening and restart: `docker inspect` shows CapDrop ALL, no-new-privileges, and no published ports. `docker compose stop` keeps the service stopped, and killing the claude process causes a restart.

## 4. Publishing

- [x] 4.1 Add a GitHub Actions workflow (D8): multi-arch buildx to GHCR, tagged with the Claude Code version and `latest`, triggered by a version tag and manual dispatch. Verify that a manual run publishes both architectures (`docker manifest inspect` lists amd64 and arm64).

- [x] 4.2 Switch the workflow to project versions (D8): `v*` tags publish `X.Y.Z`, `latest`, and `claude-<version>` with version labels; manual dispatch publishes only `edge`. Point `compose.example.yaml` and the README to `0.2.0`. Release `v0.2.0` and verify that `docker manifest inspect` lists amd64 and arm64 for `0.2.0` and `claude-2.1.316`, and that the Claude Code label matches `claude --version`.

## 5. Documentation

- [x] 5.1 Write `README.md`: what sets the project apart, an "unofficial, not affiliated with Anthropic" notice, requirements (subscription with Remote Control, no API key or setup-token, projects must be Git repos), quick start with the per-project first-run flow, adding a project, setting UID/GID, extending the toolchain with `FROM`, updating by changing the image tag, worktree cleanup, push from the host, and the security model including the open egress risk. Verify by following the quick start on a clean host and reaching an online session.
- [x] 5.2 Add a `LICENSE` file (MIT unless decided otherwise) and verify that the README references it.
- [x] 5.3 Update the README with the field-test findings: first-run flow with `claude` for trust and `claude remote-control` for Enable, session naming (environment vs. session, prefix applies only to new sessions, `/rename`), spawn fallback for non-Git projects, restart delay, config as host directory (`chmod 700`, owner must match UID) as an alternative to a named volume, and the `0.2.0` tag. Add `compose.yml` to `.gitignore`. Verify by checking each item against the README and `git check-ignore compose.yml`.
