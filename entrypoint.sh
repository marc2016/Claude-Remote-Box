#!/bin/sh
set -eu

# No core dumps: a crashing browser would otherwise drop core.<pid> files into
# /workspace, where they could end up in a commit. Inherited by every child.
# shellcheck disable=SC3045  # dash supports ulimit -c
ulimit -c 0

# shellcheck source=crb-common.sh
. /usr/local/lib/crb/common.sh

# Set the session-name prefix before the passthrough: a manual
# `claude remote-control` run creates the first session, which keeps its name.
crb_apply_prefix

# An explicit command (e.g. `setup`, `claude auth login`, `bash`) replaces the server.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

log() { echo "claude-remote-box: $*" >&2; }
state() { crb_report_phase "$1"; }

if [ -z "${CRB_NAME:-}" ]; then
    log "CRB_NAME is not set. Set it to the name shown in the Claude app."
    exit 64
fi

# Every wait runs as a background child, so a stop request ends it at once.
pid=""
hb_pid=""
watch_pid=""
stopping=0
trap 'stopping=1; for p in $pid $hb_pid $watch_pid; do kill -TERM "$p" 2>/dev/null || true; done' TERM INT

# --- status reporting (only when CRB_STATUS_URL is set) -------------------------

# While waiting, a heartbeat loop keeps the box visible; in the running phase
# the watcher takes over and the loop is stopped.
start_heartbeat() {
    [ -n "${CRB_STATUS_URL:-}" ] || return 0
    (
        trap 'exit 0' TERM INT
        while :; do
            crb_emit type=heartbeat
            sleep 30 & wait $! || true
        done
    ) &
    hb_pid=$!
}
stop_heartbeat() {
    if [ -n "$hb_pid" ]; then kill -TERM "$hb_pid" 2>/dev/null || true; hb_pid=""; fi
}

# The watcher reads the session transcripts and reports them. It is restarted
# after 5 s if it exits; the server is not affected either way.
start_watcher() {
    [ -n "${CRB_STATUS_URL:-}" ] || return 0
    if [ -z "${CRB_STATUS_TOKEN:-}" ]; then log "CRB_STATUS_TOKEN is empty, status events are sent without a token"; fi
    (
        w=""
        trap 'if [ -n "$w" ]; then kill -TERM "$w" 2>/dev/null || true; fi; exit 0' TERM INT
        while :; do
            node "$CRB_WATCH" &
            w=$!
            wait "$w" || true
            w=""
            log "status watcher exited, restarting in 5s"
            sleep 5 & wait $! || true
        done
    ) &
    watch_pid=$!
}
stop_watcher() {
    if [ -n "$watch_pid" ]; then kill -TERM "$watch_pid" 2>/dev/null || true; watch_pid=""; fi
}

start_heartbeat

pause() {
    sleep "$1" &
    pid=$!
    wait "$pid" 2>/dev/null || true
    pid=""
    if [ "$stopping" -eq 1 ]; then exit 0; fi
}

# --- waiting-config: the config directory must be writable -------------------

config_writable() {
    probe="$CLAUDE_CONFIG_DIR/.crb-probe.$$"
    if (: > "$probe") 2>/dev/null; then
        rm -f "$probe"
        return 0
    fi
    return 1
}

config_hint() {
    owner=$(stat -c %u:%g "$CLAUDE_CONFIG_DIR" 2>/dev/null || echo unknown)
    me="$(id -u):$(id -g)"
    log "cannot write to the config directory $CLAUDE_CONFIG_DIR (owner $owner, container runs as $me)."
    log "fix it on the host, then the container continues by itself:"
    log "  sudo chown -R $me <host path of the config directory>"
}

if ! config_writable; then
    state waiting-config
    config_hint
    waited=0
    until config_writable; do
        pause 10
        waited=$((waited + 10))
        if [ "$waited" -ge 300 ]; then config_hint; waited=0; fi
    done
    log "config directory is writable now"
fi

# --- waiting-setup: login + marker, or login + trust at start (legacy) --------

setup_hint() {
    log "waiting for setup. Run on the host:"
    log "  docker compose exec -it <service> setup"
}

# The legacy rule is checked only here, at start: checked while waiting, it
# would fire right after the trust step of a running setup, before the user
# has answered "Enable Remote Control?".
if crb_logged_in && [ ! -f "$CRB_MARKER" ] && crb_trusted; then
    : > "$CRB_MARKER"
    log "existing setup found (login and workspace trust), marked as complete"
fi

if ! { crb_logged_in && [ -f "$CRB_MARKER" ]; }; then
    state waiting-setup
    setup_hint
    waited=0
    until crb_logged_in && [ -f "$CRB_MARKER" ]; do
        pause 5
        waited=$((waited + 5))
        if [ "$waited" -ge 300 ]; then setup_hint; waited=0; fi
    done
    log "setup complete"
fi

# --- running -------------------------------------------------------------------

cd /workspace
spawn=$(crb_spawn_mode)
export CRB_SPAWN_EFFECTIVE="$spawn"
log "starting Remote Control '$CRB_NAME' (spawn mode: $spawn)"
stop_heartbeat
state running
start_watcher

# Run the server as a child instead of exec'ing it, so a failed start can be
# followed by a delay that throttles the restart loop. Signals are forwarded.
# CRB_EXTRA_ARGS is intentionally word-split into separate flags.
# shellcheck disable=SC2086
claude remote-control \
    --name "$CRB_NAME" \
    --spawn "$spawn" \
    ${CRB_EXTRA_ARGS:-} &
pid=$!

# wait returns early when a trapped signal arrives; keep waiting until the
# server has really exited to get its status.
status=0
while :; do
    if wait "$pid"; then status=0; else status=$?; fi
    kill -0 "$pid" 2>/dev/null || break
done
pid=""

# --- restarting ----------------------------------------------------------------

if [ "$status" -ne 0 ] && [ "$stopping" -eq 0 ]; then
    state restarting
    delay="${CRB_RESTART_DELAY:-30}"
    log "server exited with status $status, restarting in ${delay}s."
    log "if this repeats, run setup again: docker compose exec -it <service> setup"
    pause "$delay"
fi

stop_watcher
exit "$status"
