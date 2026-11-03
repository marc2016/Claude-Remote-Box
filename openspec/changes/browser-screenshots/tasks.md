# Tasks

## 1. Spikes

- [ ] 1.1 Verify that Claude Code 2.1.316 loads `/etc/claude-code/CLAUDE.md` in sessions started through `claude remote-control` (D4): build a throwaway image with a marker sentence in that file, start a session from the phone, and ask Claude to quote its managed instructions. If it is not loaded, pick the fallback from D4, record the choice in design.md, and adjust task 2.3.
- [x] 1.2 Check that `npx playwright@<candidate> install-deps chromium` supports Debian 13 on amd64 and arm64 (D1): run it as root in `node:26-trixie-slim` for both platforms (`docker run --platform ...`). Record the chosen `PLAYWRIGHT_DEPS_VERSION`, or switch to the explicit package list fallback and record that in design.md.

## 2. Image

- [x] 2.1 Add the Chromium dependency step to the `Dockerfile` (D1): `ARG PLAYWRIGHT_DEPS_VERSION`, `install-deps chromium`, the explicit font packages, cleanup of npx cache and apt lists, and a `dev.claude-remote-box.playwright-deps.version` label. Verify the image builds for linux/amd64 and linux/arm64 with `docker buildx build --platform linux/amd64,linux/arm64 .`.
- [x] 2.2 Set `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright` and create the directory with mode 0777 (D2). Verify with `docker run --user 1234:1234 <image> sh -c 'touch $PLAYWRIGHT_BROWSERS_PATH/x'`, and record the image size before and after this change from `docker image ls` for both platforms.
- [x] 2.3 Write the screenshot guidance (D4, content as listed there) and install it at the path confirmed in 1.1, owned by root and mode 0644. Verify the file exists in the image and `docker run --user 1234:1234 <image> sh -c 'echo x >> /etc/claude-code/CLAUDE.md'` fails.

## 3. Entrypoint and compose

- [x] 3.1 Add `ulimit -c 0` at the start of `entrypoint.sh` (D3), before the command passthrough. Verify `docker run <image> sh -c 'ulimit -c'` prints `0` and that `sh -c 'kill -SEGV $$'` run inside the container leaves no `core*` file in the working directory.
- [ ] 3.2 Update `compose.example.yaml` (D2, D3): `ulimits: core: 0` in `x-box`, an optional named browser-cache volume per service, mounted at `/home/node/.cache/ms-playwright`, with a comment, and the matching top-level `volumes:` entry. Verify `docker compose -f compose.example.yaml config -q` passes and that `docker compose exec <service> sh -c 'ulimit -c'` prints `0`.

## 4. End-to-end check

- [ ] 4.1 With the new image, hardened as in `compose.example.yaml` and running under a non-1000 UID, clone FlashAgenda into `/workspace`, run `npm ci` in `frontend`, `npx playwright install chromium`, start the dev server, and take a desktop and a phone screenshot with a short Playwright script in `/tmp`. Verify: no `LD_LIBRARY_PATH` or extra packages needed, no `core*` files anywhere in `/workspace`, umlauts and emoji render as glyphs, and the same works on arm64.
- [ ] 4.2 Verify the cache (spec "Browser cache location"): with the cache volume mounted, run `docker compose down` and `up -d`, then repeat a screenshot and check from the output that no browser download happens; without the volume, check that `npx playwright install chromium` succeeds. Inspect the volume and confirm it contains only browser files.

## 5. Documentation

- [ ] 5.1 Update the README (D6): new "Screenshots" section, cache volume in "Adding a project" and in the quick-start compose excerpt, "Your project's toolchain" (dependencies included, browser not, image size from 2.2), and the security model (browser without own sandbox, any reachable URL). Verify every compose snippet in the README passes `docker compose config -q` when pasted into a test file.

## 6. Field test and release

- [ ] 6.1 Field test on the Mini-PC with the FlashAgenda service: from the phone, ask for a screenshot of the start page in desktop and phone size. Verify the images appear in the chat, Claude does not create a `pwenv.sh` or similar workaround, and `git status` in the project shows no new files. Record the result in design.md.
- [ ] 6.2 Release in the next minor version (coordinated with `guided-setup`), with release notes covering screenshots, the optional cache volume, and the size increase. Verify `docker manifest inspect` lists amd64 and arm64 for the new tag and `docker inspect` shows the Playwright deps label.
