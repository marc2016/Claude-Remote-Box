#!/bin/bash
# Entrypoint of the agent image. OpenSSH refuses a UID without a passwd entry,
# and the service runs under the host user's UID: give it one through
# nss_wrapper (the root file system is read-only, /tmp is a tmpfs).
set -euo pipefail

if ! getent passwd "$(id -u)" >/dev/null 2>&1; then
  printf 'agent:x:%s:%s:crb agent:%s:/bin/bash\n' "$(id -u)" "$(id -g)" "$HOME" > /tmp/passwd
  printf 'agent:x:%s:\n' "$(id -g)" > /tmp/group
  export LD_PRELOAD=libnss_wrapper.so NSS_WRAPPER_PASSWD=/tmp/passwd NSS_WRAPPER_GROUP=/tmp/group
fi

if [ -n "${CRB_DIR-}" ]; then
  cd "$CRB_DIR" || { echo "Installationsordner $CRB_DIR ist nicht eingebunden." >&2; exit 1; }
fi
exec "$@"
