# Proposal

## Why

Most projects run in the box are web applications, and the fastest way to review Claude's work from the phone is a screenshot in the remote chat. That already works in principle: in the FlashAgenda box, Claude drove the project's own Playwright against the dev server, saved PNGs, and read them with `Read`, which shows them in the Claude app. But the image lacks the system libraries Chromium needs, so Claude had to assemble them without root through a hidden helper script in `/tmp` (`pwenv.sh`). That workaround is lost on every container recreation, costs time and tokens on each attempt, and Chromium crashed along the way and wrote core dumps into `/workspace`, where they could end up in a commit.

## What Changes

- The image contains the system libraries and fonts that a Playwright-managed Chromium (including the headless shell) needs on Linux, for amd64 and arm64. It does **not** contain a browser: the browser version belongs to the Playwright version of each project.
- Browsers that Claude installs at runtime (`npx playwright install chromium`) go to a fixed cache location in the home directory, which the user can optionally mount to keep them across container recreation. Without the mount, nothing fails; the browser is downloaded again when needed.
- Processes in the container do not write core dumps.
- The image ships a short instruction for Claude: browser libraries are present, where the browser cache lives, and that screenshots are shown to the user by reading the image file.
- The README documents screenshots, the optional cache mount, and the image size increase. `compose.example.yaml` shows the optional mount and disables core dumps.

Out of scope: WebKit and Firefox (much larger dependency set; Chromium device emulation covers phone and tablet views), a bundled `screenshot` command for projects without Playwright, delivering images through any channel other than the chat, and a separate image variant.

Assumption, not explicitly confirmed: the browser cache gets its own optional mount instead of living in the config directory, so the config directory keeps holding only login and settings.

## Capabilities

### New Capabilities
- `browser-screenshots`: what the image provides so that Claude can render the project's web UI in a headless Chromium and show the result in the remote chat (libraries, fonts, browser cache location, instruction for Claude, no core dumps).

### Modified Capabilities
- `project-service`: workspace isolation allows one more optional mount, the browser cache, which holds no secrets and no project files.

## Impact

- Changed files: `Dockerfile` (packages, cache directory, instruction file, core-dump limit), `entrypoint.sh` (core-dump limit), `compose.example.yaml`, `README.md`.
- New file: the instruction for Claude that the image installs.
- Image size grows by the Chromium dependency set, roughly 100 to 150 MB per platform (to be measured).
- Compatibility: no breaking change. Existing compose files keep working without the new mount.
- Independent of `guided-setup`; both touch `Dockerfile`, `entrypoint.sh`, and the README, so whichever lands second rebases.
