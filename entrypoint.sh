#!/bin/sh
set -eu

# An explicit command (e.g. `claude auth login`, `bash`) replaces the server.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

if [ -z "${CRB_NAME:-}" ]; then
    echo "claude-remote-box: CRB_NAME is not set. Set it to the session name shown in the Claude app." >&2
    exit 64
fi

if [ ! -f "$CLAUDE_CONFIG_DIR/.credentials.json" ]; then
    echo "claude-remote-box: no login found. Run first:" >&2
    echo "  docker compose run --rm -it <service> claude auth login" >&2
    echo "  docker compose run --rm -it <service> claude remote-control   (answer Enable and Trust, then Ctrl-C)" >&2
fi

cd /workspace

# CRB_EXTRA_ARGS is intentionally word-split into separate flags.
# shellcheck disable=SC2086
exec claude remote-control \
    --name "$CRB_NAME" \
    --spawn "${CRB_SPAWN:-worktree}" \
    ${CRB_EXTRA_ARGS:-}
