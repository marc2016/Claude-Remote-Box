#!/bin/sh
set -eu

# Sessions are named <prefix>-<words>, and the default prefix is the hostname
# (the container ID). Set it before the passthrough: the interactive setup run
# of `claude remote-control` creates the first session, which keeps its name.
if [ -n "${CRB_NAME:-}" ] && [ -z "${CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX:-}" ]; then
    export CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX="$CRB_NAME"
fi

# An explicit command (e.g. `claude auth login`, `claude`, `bash`) replaces the server.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

if [ -z "${CRB_NAME:-}" ]; then
    echo "claude-remote-box: CRB_NAME is not set. Set it to the name shown in the Claude app." >&2
    exit 64
fi

if [ ! -f "$CLAUDE_CONFIG_DIR/.credentials.json" ]; then
    echo "claude-remote-box: no login found. Run first:" >&2
    echo "  docker compose run --rm -it <service> claude auth login" >&2
    echo "  docker compose run --rm -it <service> claude                  (accept trust, then /exit)" >&2
    echo "  docker compose run --rm -it <service> claude remote-control   (answer Enable, then Ctrl-C)" >&2
fi

cd /workspace

# Worktree mode refuses to start outside a Git repository. Only an explicit
# CRB_SPAWN is passed through unchanged.
if [ -n "${CRB_SPAWN:-}" ]; then
    spawn="$CRB_SPAWN"
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    spawn=worktree
else
    spawn=same-dir
fi
echo "claude-remote-box: starting Remote Control '$CRB_NAME' (spawn mode: $spawn)" >&2

# Run the server as a child instead of exec'ing it, so a failed start can be
# followed by a delay that throttles the restart loop. Signals are forwarded.
# CRB_EXTRA_ARGS is intentionally word-split into separate flags.
# shellcheck disable=SC2086
claude remote-control \
    --name "$CRB_NAME" \
    --spawn "$spawn" \
    ${CRB_EXTRA_ARGS:-} &
pid=$!

stopping=0
trap 'stopping=1; kill -TERM "$pid" 2>/dev/null || true' TERM INT

# wait returns early when a trapped signal arrives; keep waiting until the
# server has really exited to get its status.
status=0
while :; do
    if wait "$pid"; then status=0; else status=$?; fi
    kill -0 "$pid" 2>/dev/null || break
done

if [ "$status" -ne 0 ] && [ "$stopping" -eq 0 ]; then
    delay="${CRB_RESTART_DELAY:-30}"
    echo "claude-remote-box: server exited with status $status, restarting in ${delay}s" >&2
    sleep "$delay" &
    pid=$!
    trap 'stopping=1; kill -TERM "$pid" 2>/dev/null || true' TERM INT
    wait "$pid" || true
fi

exit "$status"
