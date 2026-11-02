# Design

## Context

Greenfield repository: nothing exists yet besides OpenSpec scaffolding. See proposal.md for motivation.

Constraints from the current Remote Control documentation (code.claude.com/docs/en/remote-control) that shape this design:

- A `claude remote-control` server is bound to the directory it was started in. The Claude app has no directory picker, so serving several projects requires one server per project.
- Remote Control requires a full-scope claude.ai login (`claude auth login`). API keys, `setup-token`, and `CLAUDE_CODE_OAUTH_TOKEN` are rejected, as are a custom `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and `DISABLE_GROWTHBOOK`.
- On first start the server asks `Enable Remote Control? (y/n)` and `Trust <dir>? [y/N]`. Without a TTY it exits with `Workspace not trusted`. Trust is never saved for the home directory.
- After roughly 10 minutes of network outage the server process exits.
- `--sandbox` was removed as a flag in v2.1.300.
- Starting a brand-new session from the app into a running server is only implied by the docs, not described explicitly. The server pre-creates one session in its directory by default (`--create-session-in-dir`).

## Goals / Non-Goals

**Goals:**
- A user can go from `git clone` to a project session on their phone with three commands per project.
- The image is generic. Everything project-specific lives in the user's Compose file.
- Hardening is on by default and not traded away for convenience.

**Non-Goals:**
- Egress filtering (planned follow-up as an optional proxy sidecar, see Risks).
- A read-only root filesystem.
- Toolchains beyond Node.js. Users extend the image with `FROM`.
- Git push from inside the container. The README recommends committing in the container and pushing from the host.
- Managing several projects from one container.

## Decisions

### D1: One container per project, one named config volume per container
Each project is a Compose service: `/workspace` is bound to the project and a named volume `<project>-config` holds the config.
- *Alternative: one container with a parent directory as cwd.* Rejected. All projects would sit in one session without per-project CLAUDE.md or settings, and nothing would isolate projects from each other.
- *Alternative: a shared config volume.* Rejected for v0.1. Several Claude processes writing the same config files concurrently is untested. Per-project volumes cost one extra login per project and make resetting a project trivial.

### D2: All state under `CLAUDE_CONFIG_DIR`
The image sets `CLAUDE_CONFIG_DIR=/home/node/.claude`, and the volume is mounted there. Without it, onboarding, trust, and enablement state lands in `~/.claude.json` outside `~/.claude` and would be lost on container recreation.
- *Fallback if the spike (task 1) shows state still escaping:* mount the volume at the whole home directory, `/home/node`, instead. The spec stays unchanged ("single config location").

### D3: Thin entrypoint script, env-driven
`ENTRYPOINT` is a small POSIX shell script:
- With arguments: `exec "$@"`. This covers `claude auth login`, `bash`, and so on.
- Without arguments: `exec claude remote-control --name "$CRB_NAME" --spawn "$CRB_SPAWN"` in `/workspace`.

Environment variables: `CRB_NAME` (required; the script exits with a clear error if it is unset), `CRB_SPAWN` (default `worktree`), and `CRB_EXTRA_ARGS` (passed through for advanced flags). The `CRB_` prefix avoids clashes with Claude Code's own variables.
- *Alternative: plain `command:` per service in Compose.* Workable, but every service would repeat the full flag set, and setup commands would need to know the server invocation. The env-driven approach keeps services to a name plus volumes.
- The permission mode is deliberately not exposed as a first-class variable. Default (prompting) mode is the product's point. `CRB_EXTRA_ARGS` remains as an escape hatch.

### D4: Image contents and pinning
- Base `node:26-trixie-slim`: Node 26 is the current LTS line with the longest security support, and naming the Debian release in the tag keeps the OS from switching silently when Debian 14 ships. Apt installs `git`, `ripgrep`, `ca-certificates`, then cleans the lists.
- Claude Code is installed with `npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` from a build arg. npm makes exact pinning simple and fits the Node base.
- `DISABLE_AUTOUPDATER=1` is baked into the image.
- The default user is `node` (UID 1000). `WORKDIR /workspace`.
- `git config --system safe.directory '*'` so a UID mismatch never blocks git. `/workspace` alone would not cover worktrees below it, and the container only ever sees the one mounted project.
- The image must not set `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK`, or `ANTHROPIC_BASE_URL`.

### D5: Arbitrary UID via Compose `user:`, no root entrypoint
Compose sets `user: "${UID:-1000}:${GID:-1000}"`. The image makes `/home/node` and `/home/node/.claude` writable for any UID (mode 0777). A fresh named volume inherits that mode from the image directory on first mount. `HOME=/home/node` is set explicitly because an arbitrary UID has no passwd entry.
- *Alternative: start as root, then remap and drop privileges with gosu/setpriv.* Rejected. It needs SETUID/SETGID/CHOWN capabilities and so breaks `cap_drop: ALL`.
- Trade-off: a world-writable home inside a single-purpose, single-user container. Acceptable.

### D6: Example Compose file with YAML anchor
The repository ships `compose.example.yaml` with an `x-box` anchor that holds image, restart, hardening, user, and environment defaults, plus one example service. Users copy it to `compose.yaml` and add a service block per project: `<<: *box`, `CRB_NAME`, the bind mount, and the config volume. Configuration lives in the Compose file because a list of mounts cannot be passed through a single environment variable.

### D7: Spawn mode default `worktree`
On-demand sessions get their own git worktree, so parallel sessions started from the phone do not edit the same files. This requires the project to be a Git repository, which the README states.
- If the spike shows that the app cannot start on-demand sessions, the default changes to `same-dir` through `CRB_SPAWN`. No spec change is needed.

### D8: Publishing
A GitHub Actions workflow uses buildx and QEMU for `linux/amd64,linux/arm64` and pushes to `ghcr.io/<owner>/claude-remote-box` with tags `<claude-code-version>` and `latest`. It runs on push of a version tag and on manual dispatch.

## Risks / Trade-offs

- [Prompt injection exfiltrates the OAuth token over the network] → The user-level prompting mode blocks unapproved shell commands, and the container is scoped to one project. Full mitigation needs egress filtering (follow-up: an allowlist proxy sidecar on an `internal: true` network). The README states this risk openly.
- [Claude Code changes the config layout or moves state outside `CLAUDE_CONFIG_DIR`] → The pinned version means changes only arrive with a deliberate image bump. The persistence check from task 1 is repeated before each release.
- [First-run prompts change in a future Claude Code version] → The documented flow is interactive anyway, so users see the new prompt and answer it.
- [Restart loop before setup is done] → An unconfigured service exits immediately, and `unless-stopped` restarts it repeatedly. The README tells users to run setup before `up -d`. The entrypoint prints a clear hint when no credentials are found.
- [Worktrees accumulate inside the project directory] → They are visible on the host. The README documents where they live and how to prune them (`git worktree prune`).
- [Undocumented behavior: on-demand sessions from the app, several servers on one host] → Verified in the spike before anything else is built (task 1). D7 has a fallback.

## Migration Plan

Not applicable. This is the first release.

## Open Questions

- Exact Claude Code version for the first release. Pick the current stable version at implementation time.
- License choice (MIT is assumed unless the owner decides otherwise).
