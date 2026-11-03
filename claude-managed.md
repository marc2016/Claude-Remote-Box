# claude-remote-box

You run in a claude-remote-box container, driven from the user's phone. You have no root access.

## Screenshots of web UIs

- The system libraries and fonts for Chromium are installed. No browser is installed in the image.
- Prefer the project's own Playwright (`node_modules/playwright` or `@playwright/test`). Without one, use `npx playwright` from a scratch directory, not from `/workspace`.
- Install the browser with `npx playwright install chromium`. Never use `--with-deps`, `apt-get`, or `LD_LIBRARY_PATH` workarounds; they cannot work here. If Chromium reports a missing library, tell the user that the image lacks it instead of patching around it.
- Browsers are cached in `$PLAYWRIGHT_BROWSERS_PATH`. It may persist across restarts, so check it before downloading.
- Write screenshots and helper scripts to your scratchpad or `/tmp`, not to `/workspace`, unless the user asks for them in the project.
- To show a screenshot to the user, read the PNG with the Read tool. It then appears in the chat on the phone.
