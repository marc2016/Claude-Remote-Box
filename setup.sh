#!/bin/sh
# Guided first-run setup, installed as /usr/local/bin/setup.
# Works in a running container (`docker compose exec -it <service> setup`)
# and as a one-off container (`docker compose run --rm -it <service> setup`).
set -eu

# shellcheck source=crb-common.sh
. /usr/local/lib/crb/common.sh

crb_apply_prefix

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nsetup: %s\nSetup is not complete. Run setup again.\n' "$*" >&2; exit 1; }

if [ -z "${CRB_NAME:-}" ]; then
    echo "setup: CRB_NAME is not set. Set it to the name shown in the Claude app." >&2
    exit 64
fi

cd /workspace
echo "claude-remote-box setup for '$CRB_NAME' (3 steps)"

# 1. Login
if crb_logged_in; then
    step "1/3 Login: already logged in, skipped"
else
    step "1/3 Login with your claude.ai account"
    echo "A URL is shown. Open it in any browser, log in, and paste the code back here."
    echo "API keys and setup-token tokens do not work for Remote Control."
    claude auth login || fail "login failed or was aborted."
    crb_logged_in || fail "no login was stored."
fi

# 2. Workspace trust
if crb_trusted; then
    step "2/3 Workspace trust: already accepted, skipped"
else
    step "2/3 Workspace trust"
    echo "Claude starts in /workspace. Answer \"Yes, I trust this folder\", then type /exit."
    claude || true
    crb_trusted || fail "the workspace trust was not accepted."
fi

# 3. Remote Control enablement
step "3/3 Enable Remote Control"
echo "The server starts once. If it asks \"Enable Remote Control?\", answer y."
echo "Wait until it shows \"Connected\" or the session URL, then press Ctrl-C."
spawn=$(crb_spawn_mode)
# A handler (unlike an ignored signal) is reset in the child: Ctrl-C ends
# claude, and this script continues.
trap ':' INT
# shellcheck disable=SC2086  # CRB_EXTRA_ARGS is split into flags on purpose
claude remote-control --name "$CRB_NAME" --spawn "$spawn" ${CRB_EXTRA_ARGS:-} || true
trap - INT

: > "$CRB_MARKER"
step "Setup complete"
if [ "$(cat "$CRB_STATE" 2>/dev/null || true)" = waiting-setup ]; then
    echo "The server of this container starts within a few seconds."
else
    echo "Start the service with: docker compose up -d"
fi
