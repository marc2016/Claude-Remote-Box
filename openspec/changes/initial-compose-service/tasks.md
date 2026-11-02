# Tasks

## 1. Spike: verify undocumented behavior

- [ ] 1.1 In a throwaway `node:26-trixie-slim` container with `CLAUDE_CONFIG_DIR` on a named volume, run `claude auth login` and then `claude remote-control` interactively (answer Enable and Trust), then recreate the container and start `claude remote-control` without a TTY. Verify that it comes up without any prompt. If it does not, switch to the D2 fallback (volume on `/home/node`) and repeat.
- [ ] 1.2 With the server running, open the Claude app and check whether a new session can be started into the server. Verify that it gets its own worktree with `--spawn worktree`. If no app-side creation exists, set the D7 default to `same-dir` and note it in design.md.
- [ ] 1.3 Run two containers with different project directories and session names at the same time. Verify that both show as online in the Claude app and can be messaged independently.
- [ ] 1.4 Record the findings (works / fallback taken) as a short note in design.md, under Decisions D2 and D7.

## 2. Image

- [x] 2.1 Write the `Dockerfile` (D4): `node:26-trixie-slim`, git, ripgrep, ca-certificates, `CLAUDE_CODE_VERSION` build arg, `DISABLE_AUTOUPDATER=1`, `CLAUDE_CONFIG_DIR`, `HOME`, `WORKDIR /workspace`, system `safe.directory`, writable home (D5), `USER node`. Verify that `docker build` succeeds and that `claude --version` matches the build arg.
- [x] 2.2 Write the entrypoint script (D3): pass explicit commands through, otherwise start `claude remote-control` from `CRB_NAME`/`CRB_SPAWN`/`CRB_EXTRA_ARGS`, exit with an error when `CRB_NAME` is unset, and print a setup hint when no credentials exist. Verify by running `docker run <img> bash -c 'id'` (passthrough) and running without `CRB_NAME` (the error message appears).
- [x] 2.3 Verify arbitrary UID support: run with `--user 1001:1001`, a fresh volume, and a project directory owned by 1001. Check that `claude --version` works, that a file created in `/workspace` is owned by 1001 on the host, and that `git status` succeeds.

## 3. Compose service

- [x] 3.1 Write `compose.example.yaml` (D6): an `x-box` anchor with image, `restart: unless-stopped`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `user: "${UID:-1000}:${GID:-1000}"`, no ports, plus one example service with a `/workspace` bind mount and a `<project>-config` named volume. Verify with `docker compose -f compose.example.yaml config`.
- [ ] 3.2 End-to-end check with the built image and two services: run the documented first-run flow for each, then `up -d`. Verify that both sessions appear in the Claude app, that a shell-command permission prompt appears on the phone and blocks until approved, and that both survive `down` and `up -d` without new prompts.
- [x] 3.3 Verify hardening and restart: `docker inspect` shows CapDrop ALL, no-new-privileges, and no published ports. `docker compose stop` keeps the service stopped, and killing the claude process causes a restart.

## 4. Publishing

- [ ] 4.1 Add a GitHub Actions workflow (D8): multi-arch buildx to GHCR, tagged with the Claude Code version and `latest`, triggered by a version tag and manual dispatch. Verify that a manual run publishes both architectures (`docker manifest inspect` lists amd64 and arm64).

## 5. Documentation

- [ ] 5.1 Write `README.md`: what sets the project apart, an "unofficial, not affiliated with Anthropic" notice, requirements (subscription with Remote Control, no API key or setup-token, projects must be Git repos), quick start with the per-project first-run flow, adding a project, setting UID/GID, extending the toolchain with `FROM`, updating by changing the image tag, worktree cleanup, push from the host, and the security model including the open egress risk. Verify by following the quick start on a clean host and reaching an online session.
- [x] 5.2 Add a `LICENSE` file (MIT unless decided otherwise) and verify that the README references it.
