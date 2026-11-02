FROM node:26-trixie-slim

ARG CLAUDE_CODE_VERSION=2.1.316

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force

# Updates come from a new image tag, never from Claude Code itself.
# All persistent Claude Code state lives in CLAUDE_CONFIG_DIR (one volume).
ENV DISABLE_AUTOUPDATER=1 \
    HOME=/home/node \
    CLAUDE_CONFIG_DIR=/home/node/.claude

# The container may run under any host UID (compose `user:`), which has no
# passwd entry and may not own the mounted repo or its worktrees.
RUN git config --system --add safe.directory '*' \
    && mkdir -p /workspace "$CLAUDE_CONFIG_DIR" \
    && chown node:node /workspace "$CLAUDE_CONFIG_DIR" \
    && chmod 0777 /home/node "$CLAUDE_CONFIG_DIR"

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

USER node
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
