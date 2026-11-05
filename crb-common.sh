# shellcheck shell=sh disable=SC2034  # variables are used by the sourcing scripts
# Shared helpers for entrypoint.sh and setup (POSIX sh, sourced).
# Installed as /usr/local/lib/crb/common.sh.

CRB_MARKER="$CLAUDE_CONFIG_DIR/.crb-setup-done"
CRB_STATE=/tmp/crb-state

# Sessions are named <prefix>-<words>, and the default prefix is the hostname
# (the container ID). `docker compose exec` skips the entrypoint, so setup
# applies this default itself.
crb_apply_prefix() {
    if [ -n "${CRB_NAME:-}" ] && [ -z "${CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX:-}" ]; then
        export CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX="$CRB_NAME"
    fi
}

# Worktree mode refuses to start outside a Git repository. Only an explicit
# CRB_SPAWN is passed through unchanged.
crb_spawn_mode() {
    if [ -n "${CRB_SPAWN:-}" ]; then
        echo "$CRB_SPAWN"
    elif git -C /workspace rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo worktree
    else
        echo same-dir
    fi
}

# Clawd, the Claude Code mascot, as a greeting. Orange on a terminal,
# plain when piped or when NO_COLOR is set.
crb_banner() {
    _crb_on='' _crb_off=''
    if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
        _crb_on=$(printf '\033[38;5;173m') _crb_off=$(printf '\033[0m')
    fi
    printf '\n%s' "$_crb_on"
    printf '%s\n' \
        '    ████████████████' \
        '    ████  ████  ████' \
        '    ████  ████  ████' \
        '  ████████████████████' \
        '  ████████████████████' \
        '    ████████████████' \
        '    ██  ██    ██  ██' \
        '    ██  ██    ██  ██'
    printf '%s\n' "$_crb_off"
}

crb_logged_in() {
    [ -f "$CLAUDE_CONFIG_DIR/.credentials.json" ]
}

# True when Claude Code's config marks /workspace as trusted. Read only; a
# missing file or field counts as not trusted.
crb_trusted() {
    node -e '
        try {
            const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            const p = c && c.projects && c.projects["/workspace"];
            process.exit(p && p.hasTrustDialogAccepted === true ? 0 : 1);
        } catch (e) { process.exit(1); }
    ' "$CLAUDE_CONFIG_DIR/.claude.json" 2>/dev/null
}
