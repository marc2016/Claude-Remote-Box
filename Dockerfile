FROM node:26-trixie-slim

ARG CLAUDE_CODE_VERSION=2.1.316
ARG OPENSPEC_VERSION=1.16.0
# Only used for its list of Chromium system dependencies; no browser is installed.
ARG PLAYWRIGHT_DEPS_VERSION=1.64.1

LABEL dev.claude-remote-box.claude-code.version="${CLAUDE_CODE_VERSION}" \
      dev.claude-remote-box.openspec.version="${OPENSPEC_VERSION}" \
      dev.claude-remote-box.playwright-deps.version="${PLAYWRIGHT_DEPS_VERSION}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/*

# System libraries and fonts for a Playwright-managed Chromium (incl. headless
# shell). Browsers are installed per project at runtime, matching its Playwright.
RUN npx -y "playwright@${PLAYWRIGHT_DEPS_VERSION}" install-deps chromium \
    && apt-get install -y --no-install-recommends \
        fonts-liberation fonts-noto-color-emoji fonts-noto-core \
    && rm -rf /var/lib/apt/lists/* /root/.npm

RUN npm install -g \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
        "@fission-ai/openspec@${OPENSPEC_VERSION}" \
    && npm cache clean --force

# Updates come from a new image tag, never from Claude Code itself.
# All persistent Claude Code state lives in CLAUDE_CONFIG_DIR (one volume).
ENV DISABLE_AUTOUPDATER=1 \
    HOME=/home/node \
    CLAUDE_CONFIG_DIR=/home/node/.claude \
    PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright

# The container may run under any host UID (compose `user:`), which has no
# passwd entry and may not own the mounted repo or its worktrees.
RUN git config --system --add safe.directory '*' \
    && mkdir -p /workspace "$CLAUDE_CONFIG_DIR" "$PLAYWRIGHT_BROWSERS_PATH" \
    && chown node:node /workspace "$CLAUDE_CONFIG_DIR" "$PLAYWRIGHT_BROWSERS_PATH" \
    && chmod 0777 /home/node /home/node/.cache "$CLAUDE_CONFIG_DIR" "$PLAYWRIGHT_BROWSERS_PATH"

# Managed CLAUDE.md: applies to every session, read-only for the container user.
COPY claude-managed.md /etc/claude-code/CLAUDE.md
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /etc/claude-code /usr/local/bin/entrypoint.sh \
    && chmod 0644 /etc/claude-code/CLAUDE.md

USER node
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
