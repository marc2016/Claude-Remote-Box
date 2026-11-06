#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034  # checks are single-quoted on purpose and run through eval, so their variables look unused
# Tests for add-project.sh. Needs git and Docker Compose 2.20+ (only
# `docker compose config` is used, no containers are started).
# Usage: tests/add-project.test.sh

set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/add-project.sh"
EXAMPLE="$(cd "$(dirname "$0")/.." && pwd)/compose.example.yaml"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Keep the real Docker client config (contexts) while HOME points elsewhere.
export DOCKER_CONFIG="${DOCKER_CONFIG:-$HOME/.docker}"
export HOME="$WORK/home"
mkdir -p "$HOME"
git config --global user.name 'Test User'
git config --global user.email 'test@example.com'
git config --global init.defaultBranch main

# A local bare repository stands in for the Git remote.
REPO="$WORK/remote/FlashAgenda.git"
git init -q "$WORK/seed"
git -C "$WORK/seed" commit -q --allow-empty -m init
git clone -q --bare "$WORK/seed" "$REPO"

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# run DIR ANSWERS [ARGS...]: run the script in DIR with one answer per line.
run() {
  local dir=$1 answers=$2
  shift 2
  (cd "$dir" && printf '%b' "$answers" | "$SCRIPT" "$@") >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}
rc() { cat "$WORK/rc"; }
out() { cat "$WORK/out"; }
snapshot() { (cd "$1" && find . "$HOME/code" -exec ls -ld {} + 2>/dev/null; find . -type f -exec cksum {} + 2>/dev/null) | sort; }

echo "Defaults in an empty directory"
D="$WORK/t-defaults"; mkdir -p "$D"
# name, dir, spawn, browsers, git name, git email, confirm
run "$D" '\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "summary shows defaults" 'out | grep -q "Service:      flashagenda" && out | grep -q "$D/flashagenda/workspace  <- $REPO" && out | grep -q "Spawn-Modus:  worktree" && out | grep -q "Test User <test@example.com>" && out | grep -q "Volume flashagenda-browsers"'
check "repository cloned" '[ -d "$D/flashagenda/workspace/.git" ]'
check "workspace mount is relative" 'grep -q "\"../flashagenda/workspace:/workspace\"" "$D/services/flashagenda.yaml"'
check "config dir mode 700" '[ "$(ls -ld "$D/flashagenda/config" | cut -c1-10)" = "drwx------" ]'
check "box.yaml uses latest" 'grep -q "image: ghcr.io/marc2016/claude-remote-box:latest" "$D/box.yaml"'
check "base files created" '[ -f "$D/compose.yaml" ] && [ -f "$D/box.yaml" ] && [ -f "$D/.env" ] && [ -f "$D/services/flashagenda.yaml" ]'
check ".env has host UID/GID" 'grep -qx "UID=$(id -u)" "$D/.env" && grep -qx "GID=$(id -g)" "$D/.env"'
check "compose config valid" '(cd "$D" && docker compose config -q)'
check "only flashagenda is a service" '[ "$(cd "$D" && docker compose config --services)" = "flashagenda" ]'
CFG=$(cd "$D" && docker compose config flashagenda)
check "hardening applied" 'echo "$CFG" | grep -q -- "- ALL" && echo "$CFG" | grep -q "no-new-privileges:true" && ! echo "$CFG" | grep -q "ports:"'
check "CRB_NAME and git identity" 'echo "$CFG" | grep -q "CRB_NAME: flashagenda" && echo "$CFG" | grep -q "GIT_AUTHOR_EMAIL: test@example.com"'
check "no CRB_SPAWN for worktree" '! echo "$CFG" | grep -q CRB_SPAWN'
check "exactly three mounts" '[ "$(echo "$CFG" | grep -c "target:")" -eq 3 ] && echo "$CFG" | grep -q "target: /workspace" && echo "$CFG" | grep -q "target: /home/node/.claude" && echo "$CFG" | grep -q "target: /home/node/.cache/ms-playwright"'
check "next steps printed" 'out | grep -q "docker compose up -d flashagenda" && out | grep -q "docker compose exec -it flashagenda setup"'

echo "Invalid and duplicate names, then declined summary"
before=$(snapshot "$D")
# names: invalid, invalid, taken, ok; dir, spawn, browsers, git name, git email, decline
run "$D" 'Flash Agenda\n-x\nflashagenda\nother\n\n\n\n\n\nn\n' "$REPO"
check "invalid name re-prompted" '[ "$(out | grep -c "Erlaubt sind")" -eq 2 ]'
check "duplicate name re-prompted" 'out | grep -q "flashagenda.* ist schon vergeben"'
check "declined: exit 0" '[ "$(rc)" -eq 0 ] && out | grep -q "nichts geändert"'
check "declined: nothing changed" '[ "$(snapshot "$D")" = "$before" ]'

echo "Second project is inserted under include:"
# no argument: url, name, dir, spawn same-dir, no browsers, git name, git email, confirm
run "$D" "$REPO\nsecond\n\n2\nn\n\n\ny\n"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "both services" '[ "$(cd "$D" && docker compose config --services | sort | tr "\n" " ")" = "flashagenda second " ]'
CFG=$(cd "$D" && docker compose config second)
check "same-dir written, no browser volume" 'echo "$CFG" | grep -q "CRB_SPAWN: same-dir" && [ "$(echo "$CFG" | grep -c "target:")" -eq 2 ]'

echo "Existing checkout is reused"
D="$WORK/t-reuse"; mkdir -p "$D" "$WORK/existing"; echo keep >"$WORK/existing/marker"
run "$D" "\n$WORK/existing\ny\n\n\n\n\ny\n" "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "not cloned" '[ ! -d "$WORK/existing/.git" ] && [ -f "$WORK/existing/marker" ]'
check "mounted as workspace" '(cd "$D" && docker compose config flashagenda) | grep -q "source: $WORK/existing"'

echo "Re-run after removing the setup reuses the clone"
D="$WORK/t-rerun"; mkdir -p "$D/again"
git clone -q "$REPO" "$D/again/workspace"
git -C "$D/again/workspace" remote set-url origin "${REPO%.git}/"
echo keep >"$D/again/workspace/local-change"
run "$D" 'again\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "no question, reused" '! out | grep -q "Ohne Klonen" && out | grep -q "enthält dieses Repository schon" && out | grep -q "vorhanden, wird nicht geklont"'
check "local change kept" '[ -f "$D/again/workspace/local-change" ]'

echo "Empty target directory is cloned into"
D="$WORK/t-empty"; mkdir -p "$D/hollow/workspace"
run "$D" 'hollow\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "cloned into it" '[ -d "$D/hollow/workspace/.git" ] && ! out | grep -q "Ohne Klonen"'

echo "Declined reuse asks for another directory"
D="$WORK/t-other"; mkdir -p "$D/busy/workspace"; echo x >"$D/busy/workspace/file"
# name, dir (default, busy), decline reuse, other dir, spawn, browsers, git name, git email, confirm
run "$D" 'busy\n\nn\n./busy/code\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "cloned into the other directory" '[ -d "$D/busy/code/.git" ] && [ ! -d "$D/busy/workspace/.git" ]'

echo "Image tag can be overridden"
D="$WORK/t-edge"; mkdir -p "$D"
(cd "$D" && printf 'edge\n\n\n\n\n\ny\n' | CRB_VERSION=edge "$SCRIPT" "$REPO") >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "box.yaml uses edge" 'grep -q "image: ghcr.io/marc2016/claude-remote-box:edge" "$D/box.yaml" && out | grep -q "box.yaml (Image ghcr.io/marc2016/claude-remote-box:edge)"'

echo "Project folder around the config is refused"
D="$WORK/t-nest"; mkdir -p "$D"
# name, dir: current dir, own name dir, config dir, then default; spawn, browsers, git name, git email, decline
run "$D" "nest\n.\n./nest\nnest/config/x\n\n\n\n\n\nn\n" "$REPO"
check "three paths refused" '[ "$(out | grep -c "dürfen nicht ineinander liegen")" -eq 3 ]'
check "default accepted after" 'out | grep -q "$D/nest/workspace  <- $REPO"'

echo "Existing single-file setup with x-box"
D="$WORK/t-single"; mkdir -p "$D"; cp "$EXAMPLE" "$D/compose.yaml"; printf 'UID=1000\nGID=1000\n' >"$D/.env"
old=$(cd "$D" && docker compose config my-project)
run "$D" 'single\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "my-project unchanged" '[ "$(cd "$D" && docker compose config my-project)" = "$old" ]'
check "new service included" '(cd "$D" && docker compose config --services) | grep -qx single'

echo "Existing setup without .env keeps its user"
D="$WORK/t-noenv"; mkdir -p "$D"; cp "$EXAMPLE" "$D/compose.yaml"
old=$(cd "$D" && docker compose config my-project)
run "$D" 'noenv\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "no .env created" '[ ! -e "$D/.env" ]'
check "my-project unchanged" '[ "$(cd "$D" && docker compose config my-project)" = "$old" ]'
check "UID/GID hint shown" 'out | grep -q "Keine .env vorhanden"'

echo "Flow-style include stops before any change"
D="$WORK/t-flow"; mkdir -p "$D"; printf 'include: [other.yaml]\n' >"$D/compose.yaml"
before=$(snapshot "$D")
run "$D" '' "$REPO"
check "exit non-zero with message" '[ "$(rc)" -ne 0 ] && out | grep -q "allein in seiner Zeile"'
check "nothing changed" '[ "$(snapshot "$D")" = "$before" ]'

echo "Rollback on an invalid result"
D="$WORK/t-rollback"; mkdir -p "$D"
printf 'services:\n  foo:\n    image: alpine\n' >"$D/compose.yaml"
printf 'services: {}\n' >"$D/box.yaml"
cp "$D/compose.yaml" "$WORK/compose.orig"
run "$D" 'rb\n\n\n\n\n\ny\n' "$REPO"
check "exit non-zero" '[ "$(rc)" -ne 0 ]'
check "compose.yaml restored exactly" 'cmp -s "$D/compose.yaml" "$WORK/compose.orig"'
check "service file removed" '[ ! -e "$D/services/rb.yaml" ]'
check "clone and config kept" '[ -d "$D/rb/workspace/.git" ] && [ -d "$D/rb/config" ]'

echo "Refuses root and old Compose"
FAKE="$WORK/fake"; mkdir -p "$FAKE"
printf '#!/bin/sh\nif [ "$1" = "-u" ]; then echo 0; else /usr/bin/id "$@"; fi\n' >"$FAKE/id"
printf '#!/bin/sh\necho 2.19.1\n' >"$FAKE/docker"
chmod +x "$FAKE/id" "$FAKE/docker"
D="$WORK/t-guard"; mkdir -p "$D/root" "$D/old"
mkdir -p "$FAKE/root-only" && cp "$FAKE/id" "$FAKE/root-only/"
(cd "$D/root" && PATH="$FAKE/root-only:$PATH" "$SCRIPT" "$REPO" </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "root refused" '[ "$(rc)" -ne 0 ] && out | grep -q "nicht als root"'
mkdir -p "$FAKE/old-only" && cp "$FAKE/docker" "$FAKE/old-only/"
(cd "$D/old" && PATH="$FAKE/old-only:$PATH" "$SCRIPT" "$REPO" </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "old Compose refused" '[ "$(rc)" -ne 0 ] && out | grep -q "zu alt"'
check "guards changed nothing" '[ -z "$(ls -A "$D/root" "$D/old" | grep -v :)" ]'

echo ""
if [ "$fails" -eq 0 ]; then echo "All tests passed."; else echo "$fails test(s) failed."; exit 1; fi
