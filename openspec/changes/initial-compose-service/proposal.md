# Proposal

## Why

Running Claude Code on a headless home server and steering it from a phone today means SSH, tmux, open ports, or an all-in-one sandbox tool that often defaults to skipping permission prompts. claude-remote-box offers a lean alternative: a prebuilt image and a Docker Compose service per project, controlled from the Claude app through Remote Control, with real permission prompts landing on the phone and the code staying on the user's own machine.

## What Changes

- Add a prebuilt container image (published to GHCR, multi-arch) with Claude Code and the OpenSpec CLI pinned to specific versions, Git, ripgrep, and a non-root user. Auto-update is disabled; updating means pulling a new image tag. Releases have their own semantic version, and the contained Claude Code version is visible in a tag and a label.
- The image starts `claude remote-control` in server mode by default, configured through environment variables (server name, session-name prefix, spawn mode). It picks worktree mode for Git projects and same-directory mode otherwise, and slows down restarts when setup is missing. Any other command (for example `claude auth login`) can be run in its place for one-time setup.
- Add an example Compose file in which each project is its own service, with one project directory mounted at `/workspace` and its own config storage (named volume or host directory), hardened (`cap_drop: ALL`, `no-new-privileges`, no published ports, no Docker socket) and restarted automatically.
- Add a documented first-run flow per project: log in with a claude.ai account, accept workspace trust in an interactive Claude session, confirm "Enable Remote Control" once, then run detached.
- Support running the container under the host user's UID/GID so files written into the mounted project keep the right owner.
- Add a README that focuses on what sets the project apart (a lean Compose service, controllable from the phone, with real permission prompts), states that the project is unofficial and not affiliated with Anthropic, and explains how to extend the image with a project toolchain.
- Add a CI workflow that builds and publishes the image for amd64 and arm64.

Out of scope for this change (possible follow-ups): egress allowlist proxy, read-only root filesystem, language-specific image variants, automated Claude Code version bumps, a Claude-side sandbox inside the container.

## Capabilities

### New Capabilities
- `container-image`: the published image. Its contents, version pinning, default behavior (Remote Control server driven by environment variables), command override for setup, and running under an arbitrary UID.
- `project-service`: running one project as a Compose service. Workspace isolation, per-project config persistence, hardening, restart behavior, and the first-run setup flow.

### Modified Capabilities
<!-- none: no existing specs -->

## Impact

- New files: `Dockerfile`, entrypoint script, `compose.example.yaml`, `README.md`, `LICENSE`, `.github/workflows/` image build.
- External dependencies: `node:26-trixie-slim` base image, `@anthropic-ai/claude-code` and `@fission-ai/openspec` npm packages (pinned), GHCR as the registry, GitHub Actions.
- Requirements for users: a Claude subscription that includes Remote Control (an API key or `setup-token` is not enough) and Docker with Compose v2. Projects that are Git repositories get isolated worktrees per session; others run in same-directory mode.
