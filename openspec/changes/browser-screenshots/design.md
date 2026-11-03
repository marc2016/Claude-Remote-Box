# Design

## Context

See proposal.md - Why. Relevant current state:

- The image is `node:26-trixie-slim` (Debian 13) with `ca-certificates`, `git`, and `ripgrep` from apt, and Claude Code plus OpenSpec from npm. Root is only available at build time; at runtime the container runs as an arbitrary UID with `cap_drop: ALL` and `no-new-privileges`.
- `HOME=/home/node` (mode 0777), `CLAUDE_CONFIG_DIR=/home/node/.claude` is the only state mount. `~/.cache` is not persisted.
- Field observation (FlashAgenda, Playwright ^1.62): Claude required the project's `node_modules/playwright`, sourced a self-made `pwenv.sh` from its scratchpad in `/tmp/claude-<uid>/…`, mocked the API with `page.route`, wrote six PNGs to the scratchpad, read them, and removed `core.<pid>` files from `/workspace/frontend` afterwards. The PNGs appeared in the chat.
- Each Playwright release pins its own browser build and downloads it to `PLAYWRIGHT_BROWSERS_PATH` (default `~/.cache/ms-playwright`). Playwright launches Chromium without its own sandbox by default and passes `--disable-dev-shm-usage`.
- Images are built for linux/amd64 and linux/arm64 in `.github/workflows/image.yml`.

## Goals / Non-Goals

**Goals:**
- A project's own Playwright runs in the container after `npx playwright install chromium`, with no further setup.
- No change for users who do not take screenshots, apart from image size.

**Non-Goals:**
- Pinning or shipping a browser version in the image.
- Making `npx playwright install --with-deps` work at runtime (needs root).
- Sharing one browser cache between projects.

## Decisions

### D1: Install dependencies with Playwright's own list, at build time
A build step runs `npx -y playwright@${PLAYWRIGHT_DEPS_VERSION} install-deps chromium` as root, then removes the npx cache and the apt lists. `PLAYWRIGHT_DEPS_VERSION` is a build `ARG` and an image label, like the Claude Code and OpenSpec versions. The step also installs `fonts-liberation`, `fonts-noto-color-emoji`, and `fonts-noto-core` explicitly, so the font requirement does not depend on what one Playwright version happens to list.
- `install-deps chromium` covers both the full Chromium and the headless shell, which is what Playwright uses for headless screenshots.
- *Alternative: a hand-maintained apt package list.* Rejected as the primary path: it drifts silently when Chromium gains a dependency, and Playwright already maintains this list per distribution. It stays the fallback if `install-deps` does not support Debian 13 for the pinned version (see Risks).
- *Alternative: derive the list from the field `pwenv.sh`.* Useful as a cross-check, not as the source: it reflects only what one crash-prone attempt needed on one platform.

### D2: Browser cache at a fixed path, optional named volume per service
The image sets `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright` and creates that directory with mode 0777, as it already does for the config directory. `compose.example.yaml` shows an optional named volume mounted exactly there, one per service.
- Mounting only `ms-playwright`, not all of `~/.cache`, keeps the storage limited to browser binaries, as the modified workspace-isolation requirement demands.
- A named volume is initialized from the image directory, including its mode, so it works for any UID without a `mkdir`/`chown` step. A host directory is possible but has the same root-ownership trap as the config directory; the README mentions it only briefly.
- *Alternative: inside the config directory.* Rejected: it mixes 150+ MB of replaceable binaries into the directory that holds the login and is meant to be backed up.
- *Alternative: one cache shared by all services.* Rejected: a session in one project could replace a browser binary that another project's sessions then execute, which crosses the per-project isolation boundary.

### D3: Disable core dumps in two places
The entrypoint runs `ulimit -c 0` before anything else, so it applies to the server, every session it spawns, and passthrough commands. `compose.example.yaml` additionally sets `ulimits: core: 0` in the shared `x-box` block, which also covers `docker compose exec` shells. Lowering the soft and hard limit needs no capability.
- The entrypoint part makes existing compose files safe without edits; the compose part covers the one path that bypasses the entrypoint.

### D4: Guidance as managed CLAUDE.md
The image installs a short instruction file at Claude Code's managed-policy memory location for Linux, `/etc/claude-code/CLAUDE.md`, readable by all users and not writable by the container user. It applies to every session independently of `/workspace` and of the mounted config. Content, in a few lines: Chromium libraries and fonts are installed; use the project's Playwright if present, otherwise `npx playwright` in a scratch directory; run `npx playwright install chromium` (never `--with-deps`); browsers are cached in `PLAYWRIGHT_BROWSERS_PATH`; write screenshots and helper scripts to the scratchpad or `/tmp`, not to `/workspace`; show a screenshot by reading the PNG with the Read tool.
- Whether Claude Code 2.1.316 loads this file in Remote Control sessions is verified first (task 1.1). If it does not, the fallback is the same text as a managed skill or a system-prompt flag in `entrypoint.sh`, whichever that version supports; the requirement does not change.
- *Alternative: rely on Claude figuring it out.* It did once, but spent effort on a workaround it would now not need, and without the hint it may try `--with-deps` or `apt-get` first.

### D5: No `shm_size`, no sandbox changes
Playwright already passes `--disable-dev-shm-usage` and disables the Chromium sandbox, so the compose defaults stay as they are. The field crash is attributed to the patched-together libraries; task 4.1 checks that no crash occurs with proper libraries. If it does, `shm_size` is reconsidered then.

### D6: Documentation
The README gains a "Screenshots" section (ask for it from the phone; works with the project's Playwright; first use downloads Chromium; optional cache volume), adds the cache volume to the per-project example, updates "Your project's toolchain" (Chromium dependencies included, browser not), and adds to the security model that the browser runs without its own sandbox, so the container is the only boundary for page content, and that Claude can open any URL the network allows.

## Risks / Trade-offs

- [`install-deps` for the pinned Playwright version does not recognise Debian 13 or fails on arm64] → Pin a Playwright version that lists Debian 13; otherwise fall back to an explicit package list taken from Playwright's native-deps table for Debian 13, cross-checked with the field `pwenv.sh`. Tasks verify both platforms.
- [A future project Playwright needs a library the image lacks] → Chromium fails with a clear missing `.so` error. The next image release bumps `PLAYWRIGHT_DEPS_VERSION`; the managed CLAUDE.md tells Claude to report a missing library instead of patching around it.
- [Image size grows] → Measured in task 2.2 and stated in the README and release notes. No separate variant (decided during exploration: the box is used mostly for web projects).
- [Browser without sandbox renders hostile content] → Same boundary as any command Claude runs: the hardened container. Documented in the security model.
- [Managed CLAUDE.md conflicts with a project's own instructions] → The text is short and only about screenshots; project instructions take precedence by content, and nothing in it forbids project-specific screenshot workflows.

## Findings

- Task 1.2: `npx playwright@1.64.1 install-deps chromium` succeeds as root in `node:26-trixie-slim` on linux/arm64 (190 packages installed afterwards) and linux/amd64 (192). `PLAYWRIGHT_DEPS_VERSION=1.64.1`; the explicit-list fallback is not needed.
- Task 1.1 (static part): the Claude Code 2.1.316 linux binary resolves the managed memory file as `<managed dir>/CLAUDE.md`, with `/etc/claude-code` as the managed directory on Linux. Loading in a Remote Control session is still to be confirmed from the phone.

## Migration Plan

Ships in the next minor release after `guided-setup` (or together with it). Existing users change the tag and run `docker compose pull && docker compose up -d`; nothing else is required. Adding the cache volume is optional. Rollback is the previous tag.
