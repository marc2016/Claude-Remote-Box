# Design

## Context

Greenfield repository: nothing exists yet besides OpenSpec scaffolding. See proposal.md for motivation.

Constraints from the current Remote Control documentation (code.claude.com/docs/en/remote-control) that shape this design:

- A `claude remote-control` server is bound to the directory it was started in. The Claude app has no directory picker, so serving several projects requires one server per project.
- Remote Control requires a full-scope claude.ai login (`claude auth login`). API keys, `setup-token`, and `CLAUDE_CODE_OAUTH_TOKEN` are rejected, as are a custom `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and `DISABLE_GROWTHBOOK`.
- On first start the server asks `Enable Remote Control? (y/n)`. Workspace trust has to be accepted beforehand: in the first field test with 2.1.316, `claude remote-control` exited with `Workspace not trusted. Please run claude in /workspace first to review and accept the workspace trust dialog.` The docs describe a trust prompt in `remote-control` itself, but that did not happen. Trust is never saved for the home directory.
- After roughly 10 minutes of network outage the server process exits.
- `--sandbox` was removed as a flag in v2.1.300.
- `--name` names the server, which the app shows as the environment ("Connected · <name>"). Sessions get auto-generated names `<prefix>-<words>`. The prefix defaults to the hostname, which in a container is the container ID. It can be set with `--remote-control-session-name-prefix` or `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX`. After a restart, the server serves its earlier sessions again, and they keep their names.
- `--spawn worktree` refuses to start when the working directory is not a Git repository (`Worktree mode requires a git repository or WorktreeCreate hooks configured`).

## Goals / Non-Goals

**Goals:**
- A user can go from `git clone` to a project session on their phone with a few commands per project.
- The image is generic. Everything project-specific lives in the user's Compose file.
- Hardening is on by default and not traded away for convenience.

**Non-Goals:**
- Egress filtering (planned follow-up as an optional proxy sidecar, see Risks).
- A read-only root filesystem.
- Language toolchains beyond Node.js. Users extend the image with `FROM`.
- Git push from inside the container. The README recommends committing in the container and pushing from the host.
- Managing several projects from one container.

## Decisions

### D1: One container per project, own config storage per container
Each project is a Compose service. `/workspace` is bound to the project, and the config lives either in a host directory `./<project>/config` (default in the example) or in a named volume `<project>-config`. The host directory is easier to back up and inspect. It must exist before the first start, because Docker would create a missing one owned by root. Its owner must match the container UID, and it should be `chmod 700` because it holds the login token. The repository's `.gitignore` excludes `/*/config/`.
- *Alternative: one container with a parent directory as cwd.* Rejected. All projects would sit in one session without per-project CLAUDE.md or settings, and nothing would isolate projects from each other.
- *Alternative: a shared config volume.* Rejected for v0.x. Several Claude processes writing the same config files concurrently is untested. Per-project storage costs one extra login per project and makes resetting a project trivial.

### D2: All state under `CLAUDE_CONFIG_DIR`
The image sets `CLAUDE_CONFIG_DIR=/home/node/.claude`, and the config storage is mounted there. Without it, onboarding, trust, and enablement state lands in `~/.claude.json` outside `~/.claude` and would be lost on container recreation.
- *Fallback if state still escapes:* mount the storage at the whole home directory, `/home/node`, instead. The spec stays unchanged ("single config location").
- *Field test (image 0.2.0, Claude Code 2.1.316, config in a host directory):* login, trust, and enablement survive container restarts and `docker compose down`/`up`. Because only the config directory persists across recreation, the trust state lives there too. The fallback is not needed.

### D3: Thin entrypoint script, env-driven
`ENTRYPOINT` is a small POSIX shell script:
- With arguments: `exec "$@"`. This covers `claude auth login`, `claude`, `bash`, and so on.
- Without arguments: start `claude remote-control --name "$CRB_NAME" --spawn "<mode>"` in `/workspace`.

Environment variables:
- `CRB_NAME` (required). The script exits with a clear error if it is unset.
- `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` defaults to `CRB_NAME`, so sessions are named `<name>-<words>` instead of `<container-id>-<words>`. Users can still set it themselves. The default is applied before the command passthrough, because the interactive `claude remote-control` run during setup creates the first session, and that session keeps its name.
- `CRB_SPAWN`: if set, used as is. If unset, `worktree` when `/workspace` is a Git repository, otherwise `same-dir`. The chosen mode is logged. An explicit `CRB_SPAWN=worktree` on a non-Git workspace keeps Claude Code's own error, because the user asked for it.
- `CRB_RESTART_DELAY` (default `30` seconds): if the server exits with a non-zero code, the script waits this long before exiting. This throttles the `unless-stopped` restart loop when login or trust is missing and keeps logs readable.
- `CRB_EXTRA_ARGS` (passed through for advanced flags).

Because of the restart delay, the server path no longer uses `exec`. The script runs `claude` as a child, forwards `SIGTERM`/`SIGINT` to it, and waits. That way `docker compose stop` still ends the server cleanly, and a stop during the delay ends the script at once.
- *Alternative: plain `command:` per service in Compose.* Workable, but every service would repeat the full flag set, and setup commands would need to know the server invocation. The env-driven approach keeps services to a name plus volumes.
- *Alternative: rely on Docker's restart backoff.* Rejected. The backoff starts at a fraction of a second, and the field test produced dozens of identical log blocks within a minute.
- The permission mode is deliberately not exposed as a first-class variable. Default (prompting) mode is the product's point. `CRB_EXTRA_ARGS` remains as an escape hatch.

### D4: Image contents and pinning
- Base `node:26-trixie-slim`: Node 26 is the current LTS line with the longest security support, and naming the Debian release in the tag keeps the OS from switching silently when Debian 14 ships. Apt installs `git`, `ripgrep`, `ca-certificates`, then cleans the lists.
- Claude Code is installed with `npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` from a build arg. npm makes exact pinning simple and fits the Node base.
- The OpenSpec CLI (`@fission-ai/openspec@${OPENSPEC_VERSION}`) is installed in the same npm step, so that spec-driven workflows (`/opsx:*`) can run from the phone without a per-project install.
- `DISABLE_AUTOUPDATER=1` is baked into the image.
- The default user is `node` (UID 1000). `WORKDIR /workspace`.
- `git config --system safe.directory '*'` so a UID mismatch never blocks git. `/workspace` alone would not cover worktrees below it, and the container only ever sees the one mounted project.
- The image must not set `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK`, or `ANTHROPIC_BASE_URL`.

### D5: Arbitrary UID via Compose `user:`, no root entrypoint
Compose sets `user: "${UID:-1000}:${GID:-1000}"`. The image makes `/home/node` and `/home/node/.claude` writable for any UID (mode 0777). A fresh named volume inherits that mode from the image directory on first mount. A bind-mounted config directory does not, so its owner must match. `HOME=/home/node` is set explicitly because an arbitrary UID has no passwd entry.
- *Alternative: start as root, then remap and drop privileges with gosu/setpriv.* Rejected. It needs SETUID/SETGID/CHOWN capabilities and so breaks `cap_drop: ALL`.
- Trade-off: a world-writable home inside a single-purpose, single-user container. Acceptable.

### D6: Example Compose file with YAML anchor
The repository ships `compose.example.yaml` with an `x-box` anchor that holds image, restart, hardening, user, and environment defaults, plus one example service. Users copy it to `compose.yaml` (or `compose.yml`) and add a service block per project: `<<: *box`, `CRB_NAME`, the bind mount, and the config storage. Configuration lives in the Compose file because a list of mounts cannot be passed through a single environment variable. The repository's `.gitignore` covers both file names and `.env`.

### D7: Spawn mode default `worktree` for Git projects
On-demand sessions get their own git worktree, so parallel sessions started from the phone do not edit the same files. Projects that are not Git repositories fall back to `same-dir` automatically (D3).
- *Field test (image 0.2.0):* the server starts in worktree mode on a Git repository (`Capacity: 1/32 · New sessions will be created in an isolated worktree`). A new session started from the Claude app gets its own worktree and is named `<CRB_NAME>-<words>`. Two services run side by side as separate environments in the app. Permission prompts for shell commands appear on the phone and block until approved. Without Git, an explicit `CRB_SPAWN=worktree` fails with Claude Code's own error, as specified.

### D8: Publishing and versioning
The image has its own semantic version, independent of the Claude Code version, because it bundles more than Claude Code (OpenSpec, base image, entrypoint).
- A git tag `vX.Y.Z` triggers the workflow. It publishes `ghcr.io/<owner>/claude-remote-box:X.Y.Z`, `:latest`, and `:claude-<claude-code-version>`. The `claude-` tag always points to the newest image with that Claude Code version.
- The image carries the labels `org.opencontainers.image.version=X.Y.Z` and `dev.claude-remote-box.claude-code.version=<claude-code-version>`, plus the source label that links the package to the repository.
- Builds use buildx and QEMU for `linux/amd64,linux/arm64`. Manual dispatch builds the current `main` but publishes only `:edge`, so it never moves a release tag.
- *Alternative: tag = Claude Code version, with a `-N` suffix for image-only changes.* Rejected. It turns into a mess once OpenSpec or the base image change on their own.
- *Alternative: overwrite the existing tag.* Rejected. A tag whose content changes defeats pinning.

## Risks / Trade-offs

- [Prompt injection exfiltrates the OAuth token over the network] → The user-level prompting mode blocks unapproved shell commands, and the container is scoped to one project. Full mitigation needs egress filtering (follow-up: an allowlist proxy sidecar on an `internal: true` network). The README states this risk openly.
- [Claude Code changes the config layout or moves state outside `CLAUDE_CONFIG_DIR`] → The pinned version means changes only arrive with a deliberate image bump. The persistence check from task 1 is repeated before each release.
- [First-run prompts change in a future Claude Code version] → The documented flow is interactive anyway, so users see the new prompt and answer it. The field test already showed a difference from the docs (trust through `claude`), and the README follows observed behavior.
- [Restart loop before setup is done] → `unless-stopped` restarts an unconfigured service. The entrypoint prints a hint and waits `CRB_RESTART_DELAY` before exiting, so the loop is slow and the hint is readable.
- [Old sessions keep their auto-generated names] → The prefix default only affects new sessions. The README says to rename old ones with `/rename` or archive them.
- [Worktrees accumulate inside the project directory] → They are visible on the host. The README documents where they live and how to prune them (`git worktree prune`).
- [Undocumented behavior: on-demand sessions from the app, several servers on one host] → Both verified in the field test with Claude Code 2.1.316. Repeat the check when bumping Claude Code.

## Migration Plan

The first image was published as `2.1.316` (tag = Claude Code version). From `0.2.0` on, tags follow D8. `2.1.316` stays available but is not updated. The README and example point to `0.2.0`. Existing users change the tag and run `docker compose pull && docker compose up -d`. Their config storage is unchanged.

## Open Questions

- License choice (MIT is assumed unless the owner decides otherwise).
