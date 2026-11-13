#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034  # checks are single-quoted on purpose and run through eval, so their variables look unused
# Tests for crb (add, update, dashboard, git). Needs git and Docker Compose 2.20+ (only
# `docker compose config` is run for real; pull and up are stubbed).
# Usage: tests/crb.test.sh

set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/crb"
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
  (cd "$dir" && printf '%b' "$answers" | "$SCRIPT" add "$@") >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}
rc() { cat "$WORK/rc"; }
out() { cat "$WORK/out"; }
snapshot() { (cd "$1" && find . "$HOME/code" -exec ls -ld {} + 2>/dev/null; find . -type f -exec cksum {} + 2>/dev/null) | sort; }

echo "Defaults in an empty directory"
D="$WORK/t-defaults"; mkdir -p "$D"
# name, dir, spawn, permission, phone, browsers, git name, git email, confirm
run "$D" '\n\n\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "summary shows defaults" 'out | grep -q "Service:      flashagenda" && out | grep -q "$D/flashagenda/workspace  <- $REPO" && out | grep -q "Spawn-Modus:  worktree" && out | grep -q "Permission:   default" && out | grep -q "Handy-Modus:  an (./flashagenda/config/CLAUDE.md)" && out | grep -q "Test User <test@example.com>" && out | grep -q "Volume flashagenda-browsers"'
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
check "no CRB_EXTRA_ARGS for default mode" '! echo "$CFG" | grep -q CRB_EXTRA_ARGS'
check "phone-mode file written" 'grep -q "on a phone" "$D/flashagenda/config/CLAUDE.md" && grep -q "AskUserQuestion" "$D/flashagenda/config/CLAUDE.md" && out | grep -q "CLAUDE.md angelegt"'
check "exactly three mounts" '[ "$(echo "$CFG" | grep -c "target:")" -eq 3 ] && echo "$CFG" | grep -q "target: /workspace" && echo "$CFG" | grep -q "target: /home/node/.claude" && echo "$CFG" | grep -q "target: /home/node/.cache/ms-playwright"'
check "next steps printed" 'out | grep -q "docker compose up -d flashagenda" && out | grep -q "docker compose exec -it flashagenda setup"'

echo "Invalid and duplicate names, then declined summary"
before=$(snapshot "$D")
# names: invalid, invalid, taken, ok; dir, spawn; permission: invalid, invalid, auto; phone n; browsers, git name, git email, decline
run "$D" 'Flash Agenda\n-x\nflashagenda\nother\n\n\n4\nbypassPermissions\n3\nn\n\n\n\nn\n' "$REPO"
check "invalid name re-prompted" '[ "$(out | grep -c "Erlaubt sind")" -eq 2 ]'
check "duplicate name re-prompted" 'out | grep -q "flashagenda.* ist schon vergeben"'
check "invalid permission re-prompted" '[ "$(out | grep -c "Bitte 1, 2 oder 3")" -eq 2 ] && out | grep -q "Permission:   auto" && out | grep -q "Handy-Modus:  aus"'
check "declined: exit 0" '[ "$(rc)" -eq 0 ] && out | grep -q "nichts geändert"'
check "declined: nothing changed" '[ "$(snapshot "$D")" = "$before" ]'

echo "Second project is inserted under include:"
# no argument: url, name, dir, spawn same-dir, permission auto, phone n, no browsers, git name, git email, confirm
run "$D" "$REPO\nsecond\n\n2\n3\nn\nn\n\n\ny\n"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "both services" '[ "$(cd "$D" && docker compose config --services | sort | tr "\n" " ")" = "flashagenda second " ]'
CFG=$(cd "$D" && docker compose config second)
check "same-dir written, no browser volume" 'echo "$CFG" | grep -q "CRB_SPAWN: same-dir" && [ "$(echo "$CFG" | grep -c "target:")" -eq 2 ]'
check "auto mode passed as flag" 'echo "$CFG" | grep -q "CRB_EXTRA_ARGS: --permission-mode auto"'
check "no phone-mode file on n" '[ -d "$D/second/config" ] && [ ! -e "$D/second/config/CLAUDE.md" ]'

echo "Existing checkout is reused"
D="$WORK/t-reuse"; mkdir -p "$D" "$WORK/existing" "$D/flashagenda/config"; echo keep >"$WORK/existing/marker"
echo '# mine' >"$D/flashagenda/config/CLAUDE.md"
# name, dir, reuse y, spawn, permission, phone, browsers, git name, git email, confirm config reuse, confirm
run "$D" "\n$WORK/existing\ny\n\n\n\n\n\n\ny\ny\n" "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "not cloned" '[ ! -d "$WORK/existing/.git" ] && [ -f "$WORK/existing/marker" ]'
check "mounted as workspace" '(cd "$D" && docker compose config flashagenda) | grep -q "source: $WORK/existing"'
check "existing phone-mode file kept" '[ "$(cat "$D/flashagenda/config/CLAUDE.md")" = "# mine" ] && out | grep -q "bleibt unverändert"'

echo "Re-run after removing the setup reuses the clone"
D="$WORK/t-rerun"; mkdir -p "$D/again"
git clone -q "$REPO" "$D/again/workspace"
git -C "$D/again/workspace" remote set-url origin "${REPO%.git}/"
echo keep >"$D/again/workspace/local-change"
run "$D" 'again\n\n\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "no question, reused" '! out | grep -q "Ohne Klonen" && out | grep -q "enthält dieses Repository schon" && out | grep -q "vorhanden, wird nicht geklont"'
check "local change kept" '[ -f "$D/again/workspace/local-change" ]'

echo "Empty target directory is cloned into"
D="$WORK/t-empty"; mkdir -p "$D/hollow/workspace"
run "$D" 'hollow\n\n\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "cloned into it" '[ -d "$D/hollow/workspace/.git" ] && ! out | grep -q "Ohne Klonen"'

echo "Empty directory without write access (left by Docker) is replaced"
D="$WORK/t-docker"; mkdir -p "$D/dock/workspace" "$D/dock/config"; chmod 555 "$D/dock/workspace" "$D/dock/config"
run "$D" 'dock\n\n\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "removed and cloned" 'out | grep -q "vermutlich von Docker angelegt" && [ -d "$D/dock/workspace/.git" ] && [ -w "$D/dock/workspace" ]'
check "empty config replaced" '[ "$(ls -ld "$D/dock/config" | cut -c1-10)" = "drwx------" ]'

echo "Declined reuse asks for another directory"
D="$WORK/t-other"; mkdir -p "$D/busy/workspace"; echo x >"$D/busy/workspace/file"
# name, dir (default, busy), decline reuse, other dir, spawn, permission, phone, browsers, git name, git email, confirm
run "$D" 'busy\n\nn\n./busy/code\n\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "cloned into the other directory" '[ -d "$D/busy/code/.git" ] && [ ! -d "$D/busy/workspace/.git" ]'

echo "Image tag can be overridden"
D="$WORK/t-edge"; mkdir -p "$D"
(cd "$D" && printf 'edge\n\n\n\n\n\n\n\ny\n' | CRB_VERSION=edge "$SCRIPT" add "$REPO") >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "box.yaml uses edge" 'grep -q "image: ghcr.io/marc2016/claude-remote-box:edge" "$D/box.yaml" && out | grep -q "box.yaml (Image ghcr.io/marc2016/claude-remote-box:edge)"'

echo "Project folder around the config is refused"
D="$WORK/t-nest"; mkdir -p "$D"
# name, dir: current dir, own name dir, config dir, then default; spawn, permission, phone, browsers, git name, git email, decline
run "$D" "nest\n.\n./nest\nnest/config/x\n\n\n\n\n\n\n\nn\n" "$REPO"
check "three paths refused" '[ "$(out | grep -c "dürfen nicht ineinander liegen")" -eq 3 ]'
check "default accepted after" 'out | grep -q "$D/nest/workspace  <- $REPO"'

echo "Existing single-file setup with x-box"
D="$WORK/t-single"; mkdir -p "$D"; cp "$EXAMPLE" "$D/compose.yaml"; printf 'UID=1000\nGID=1000\n' >"$D/.env"
old=$(cd "$D" && docker compose config my-project)
run "$D" 'single\n\n\n\n\n\n\n\ny\n' "$REPO"
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "my-project unchanged" '[ "$(cd "$D" && docker compose config my-project)" = "$old" ]'
check "new service included" '(cd "$D" && docker compose config --services) | grep -qx single'

echo "Existing setup without .env keeps its user"
D="$WORK/t-noenv"; mkdir -p "$D"; cp "$EXAMPLE" "$D/compose.yaml"
old=$(cd "$D" && docker compose config my-project)
run "$D" 'noenv\n\n\n\n\n\n\n\ny\n' "$REPO"
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
run "$D" 'rb\n\n\n\n\n\n\n\ny\n' "$REPO"
check "exit non-zero" '[ "$(rc)" -ne 0 ]'
check "compose.yaml restored exactly" 'cmp -s "$D/compose.yaml" "$WORK/compose.orig"'
check "service file removed" '[ ! -e "$D/services/rb.yaml" ]'
check "clone and config kept" '[ -d "$D/rb/workspace/.git" ] && [ -d "$D/rb/config" ] && [ -f "$D/rb/config/CLAUDE.md" ]'

# --- update ------------------------------------------------------------------
# `docker compose config` runs for real; pull and up are recorded in a log.
REAL_DOCKER=$(command -v docker)
STUB="$WORK/stub"; mkdir -p "$STUB"
cat >"$STUB/docker" <<EOF
#!/bin/sh
echo "docker \$*" >> "\$DOCKER_LOG"
case "\$1 \$2" in "compose pull"|"compose up") exit 0 ;; esac
exec "$REAL_DOCKER" "\$@"
EOF
chmod +x "$STUB/docker"
# update DIR ANSWERS: runs a private copy of crb (self-update may replace it)
# with CRB_SOURCE pointing at that copy unless the caller sets it.
update() {
  local dir=$1 answers=$2
  mkdir -p "$WORK/bin"; cp "$SCRIPT" "$WORK/bin/crb"; chmod 755 "$WORK/bin/crb"
  : >"$WORK/docker.log"
  (cd "$dir" && printf '%b' "$answers" | DOCKER_LOG="$WORK/docker.log" PATH="$STUB:$PATH" CRB_SOURCE="${CRB_SOURCE:-$WORK/bin/crb}" "$WORK/bin/crb" update) >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}
dlog() { cat "$WORK/docker.log"; }

echo "Update: installation with missing settings"
D="$WORK/t-upd"; mkdir -p "$D"
run "$D" 'p1\n\n\n\n\n\n\n\ny\n' "$REPO"            # default mode, phone on
run "$D" 'p2\n\n\n3\nn\nn\n\n\ny\n' "$REPO"         # auto, phone off
mkdir -p "$D/p3/config"
cat >"$D/services/p3.yaml" <<'EOF'
# hand-written, with other extra args
services:
  p3:
    extends:
      file: ../box.yaml
      service: box
    environment:
      CRB_NAME: "p3"
      CRB_EXTRA_ARGS: "--capacity 4"
    volumes:
      - "../p3/config:/home/node/.claude"
EOF
printf '  - services/p3.yaml\n' >>"$D/compose.yaml"
sed -i.bak 's/claude-remote-box:latest/claude-remote-box:0.2.0/' "$D/box.yaml"; rm -f "$D/box.yaml.bak"
expected_box=$(sed 's/claude-remote-box:0.2.0/claude-remote-box:latest/' "$D/box.yaml")
# tag y; p1: mode 3; p2: phone y; p3: mode 2, phone y; apply y; recreate (default no)
update "$D" '\n3\n\n2\n\ny\n\n'
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "tag switched, rest of box.yaml unchanged" '[ "$(cat "$D/box.yaml")" = "$expected_box" ]'
check "p1 got auto" '(cd "$D" && docker compose config p1) | grep -q "CRB_EXTRA_ARGS: --permission-mode auto"'
check "p2 not asked, file added" 'out | grep -q "Permission:   auto (bleibt)" && [ -f "$D/p2/config/CLAUDE.md" ]'
check "p3 flag appended" 'grep -q "CRB_EXTRA_ARGS: \"--capacity 4 --permission-mode acceptEdits\"" "$D/services/p3.yaml" && [ -f "$D/p3/config/CLAUDE.md" ]'
check "compose config valid" '(cd "$D" && docker compose config -q)'
check "pulled, recreate declined with hint" 'dlog | grep -q "docker compose pull" && ! dlog | grep -q "compose up" && out | grep -q "Später: docker compose up -d p1 p3"'

echo "Update: second run has nothing to do"
before=$(snapshot "$D")
update "$D" ''
check "exit 0" '[ "$(rc)" -eq 0 ]'
check "reports up to date, still pulls" 'out | grep -q "Installation ist aktuell" && ! out | grep -q "Anwenden?" && dlog | grep -q "docker compose pull"'
check "nothing changed" '[ "$(snapshot "$D")" = "$before" ]'

echo "Update: declined summary and accepted recreate"
D="$WORK/t-upd2"; mkdir -p "$D"
run "$D" 'q1\n\n\n\n\n\n\n\ny\n' "$REPO"
before=$(snapshot "$D")
update "$D" '3\nn\n'
check "declined: exit 0, nothing changed, no pull" '[ "$(rc)" -eq 0 ] && out | grep -q "nichts geändert" && [ "$(snapshot "$D")" = "$before" ] && ! dlog | grep -q "compose pull"'
update "$D" '3\ny\ny\n'
check "accepted recreate runs up -d" '[ "$(rc)" -eq 0 ] && dlog | grep -q "docker compose up -d q1"'

echo "Update: self-update replaces the script and re-runs"
D="$WORK/t-self"; mkdir -p "$D"
run "$D" 's1\n\n\n3\n\n\n\n\ny\n' "$REPO"
mkdir -p "$WORK/new"
awk '{ print } /^cmd_update\(\) \{/ { print "  echo crb-test-marker" }' "$SCRIPT" >"$WORK/new/crb"
CRB_SOURCE="$WORK/new/crb" update "$D" ''
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "replaced and re-run once" 'out | grep -q "Skript aktualisiert" && out | grep -q "crb-test-marker" && cmp -s "$WORK/new/crb" "$WORK/bin/crb" && [ ! -e "$WORK/bin/crb.old" ] && [ "$(out | grep -c "Skript aktualisiert")" -eq 1 ]'
check "mode kept" '[ -x "$WORK/bin/crb" ]'
CRB_SOURCE="$WORK/does-not-exist" update "$D" ''
check "fetch failure warns and continues" '[ "$(rc)" -eq 0 ] && out | grep -q "konnte nicht geladen werden" && out | grep -q "Fertig"'
printf 'not a script\n' >"$WORK/new/bad"
CRB_SOURCE="$WORK/new/bad" update "$D" ''
check "bogus download is ignored" '[ "$(rc)" -eq 0 ] && out | grep -q "sieht nicht wie crb aus" && cmp -s "$SCRIPT" "$WORK/bin/crb"'

echo "Update: invalid result is restored"
D="$WORK/t-updbad"; mkdir -p "$D"
run "$D" 'ok\n\n\n3\n\n\n\n\ny\n' "$REPO"
mkdir -p "$D/pbad/config"
cat >"$D/services/pbad.yaml" <<'EOF'
services:
  pbad:
    extends:
      file: ../box.yaml
      service: box
    environment:
        CRB_NAME: "pbad"
    volumes:
      - "../pbad/config:/home/node/.claude"
EOF
printf '  - services/pbad.yaml\n' >>"$D/compose.yaml"
cp "$D/services/pbad.yaml" "$WORK/pbad.orig"
# pbad: mode 3, phone y; apply y
update "$D" '3\n\ny\n'
check "exit non-zero with compose error" '[ "$(rc)" -ne 0 ] && out | grep -q "wiederhergestellt"'
check "service file restored, CLAUDE.md kept" 'cmp -s "$D/services/pbad.yaml" "$WORK/pbad.orig" && [ -f "$D/pbad/config/CLAUDE.md" ] && ! dlog | grep -q "compose pull"'

echo "Update: single-file setup is not edited"
D="$WORK/t-updsingle"; mkdir -p "$D"; cp "$EXAMPLE" "$D/compose.yaml"; printf 'UID=1000\nGID=1000\n' >"$D/.env"
update "$D" ''
check "exit 0, hint per service, file untouched, pulled" '[ "$(rc)" -eq 0 ] && out | grep -q "my-project:" && cmp -s "$EXAMPLE" "$D/compose.yaml" && dlog | grep -q "docker compose pull"'

echo "Update: refuses a directory without compose.yaml"
D="$WORK/t-updnone"; mkdir -p "$D"
update "$D" ''
check "exit non-zero naming compose.yaml" '[ "$(rc)" -ne 0 ] && out | grep -q "keine compose.yaml"'

# dashboard DIR ANSWERS: runs `crb dashboard` (real docker compose config, nothing is pulled).
dashboard() {
  local dir=$1 answers=$2
  (cd "$dir" && printf '%b' "$answers" | "$SCRIPT" dashboard ${3:+"$3"}) >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}

echo "Dashboard: added to an installation with two boxes"
D="$WORK/t-dash"; mkdir -p "$D"
run "$D" 'd1\n\n\n\n\n\n\n\ny\n' "$REPO"
run "$D" 'd2\n\n\n3\nn\nn\n\n\ny\n' "$REPO"
before=$(snapshot "$D")
dashboard "$D" 'n\n'
check "declined: exit 0, nothing changed" '[ "$(rc)" -eq 0 ] && out | grep -q "nichts geändert" && [ "$(snapshot "$D")" = "$before" ]'
dashboard "$D" 'y\n'
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "next step named, no word of a missing login" 'out | grep -q "./crb dashboard login" && ! out | grep -qi "kein Login" && ! grep -qi "no login" "$D/services/crb-dashboard.yaml"'
check "token in .env, service file, include" 'grep -qE "^CRB_STATUS_TOKEN=[A-Za-z0-9]{32}$" "$D/.env" && [ -f "$D/services/crb-dashboard.yaml" ] && grep -q "services/crb-dashboard.yaml" "$D/compose.yaml"'
TOKEN=$(sed -n "s/^CRB_STATUS_TOKEN=//p" "$D/.env")
check "boxes wired with URL and token" '(cd "$D" && docker compose config d1) | grep -q "CRB_STATUS_URL: http://crb-dashboard:8080/api/ingest" && (cd "$D" && docker compose config d2) | grep -q "CRB_STATUS_TOKEN: $TOKEN" && (cd "$D" && docker compose config d1) | grep -q "CRB_EXTRA_ARGS\|CRB_NAME: d1"'
CFG=$(cd "$D" && docker compose config crb-dashboard)
check "dashboard: loopback port, one mount, hardened, config valid" 'echo "$CFG" | grep -q "host_ip: 127.0.0.1" && echo "$CFG" | grep -q "published: \"8080\"" && [ "$(echo "$CFG" | grep -c "target: /")" -eq 1 ] && echo "$CFG" | grep -q "target: /data" && echo "$CFG" | grep -q -- "- ALL" && (cd "$D" && docker compose config -q)'
check "login variables wired from .env, empty by default" '(cd "$D" && CRB_DASHBOARD_URL=https://crb.example.org docker compose config crb-dashboard) | grep -q "CRB_DASHBOARD_URL: https://crb.example.org" && [ "$(echo "$CFG" | grep -cE "CRB_DASHBOARD_(URL|PROXY|AUTH|REMOTE_INGEST): \"\"")" -eq 4 ]'
check "CRB_DASHBOARD_BIND honored" '(cd "$D" && CRB_DASHBOARD_BIND=0.0.0.0:9000 docker compose config crb-dashboard) | grep -q "published: \"9000\""'
before=$(snapshot "$D")
dashboard "$D" ''
check "second run: already present, nothing changed" '[ "$(rc)" -eq 0 ] && out | grep -q "schon vorhanden" && [ "$(snapshot "$D")" = "$before" ]'

dashboard "$D" '' foo
check "unknown argument: usage, non-zero, nothing changed" '[ "$(rc)" -ne 0 ] && out | grep -q "Usage:" && out | grep -q "dashboard login" && [ "$(snapshot "$D")" = "$before" ]'

echo "Dashboard: single-file setup gets a hint"
D="$WORK/t-dashsingle"; mkdir -p "$D"; cp "$EXAMPLE" "$D/compose.yaml"
dashboard "$D" ''
check "hint, file untouched" '[ "$(rc)" -eq 0 ] && out | grep -q "Von Hand eintragen" && cmp -s "$EXAMPLE" "$D/compose.yaml"'

echo "Update: reconciles the status variables"
D="$WORK/t-dash"
sed -i.bak -e "/CRB_STATUS_URL/d" -e "/CRB_STATUS_TOKEN/d" "$D/box.yaml"; rm -f "$D/box.yaml.bak"
check "precondition: variables removed" '! grep -q CRB_STATUS "$D/box.yaml"'
# status y; d1: mode (default, keep), phone exists; d2: mode present, phone y; apply y; recreate n
update "$D" '\n\n\ny\nn\n'
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "variables back in every box, all boxes listed for recreate" '(cd "$D" && docker compose config d1) | grep -q "CRB_STATUS_URL" && (cd "$D" && docker compose config d2) | grep -q "CRB_STATUS_TOKEN: $TOKEN" && out | grep -q "Später: docker compose up -d d1 d2"'
# d1 still asks for its mode (default, keep); nothing else
update "$D" '\n'
check "already wired: no question, dashboard not treated as a project" '[ "$(rc)" -eq 0 ] && ! out | grep -q "Status-Variablen" && out | grep -q "Boxen angebunden" && ! out | grep -q "crb-dashboard: nicht von crb"'

echo "Update: reconciles the dashboard's login variables"
D="$WORK/t-dash"; DF="$D/services/crb-dashboard.yaml"
cp "$DF" "$WORK/dash.new"
sed -i.bak -E "/CRB_DASHBOARD_(URL|PROXY|AUTH|REMOTE_INGEST):/d" "$DF"; rm -f "$DF.bak"
cp "$DF" "$WORK/dash.old"
check "precondition: a service file from before the login" '! grep -qE "CRB_DASHBOARD_(URL|PROXY|AUTH|REMOTE_INGEST):" "$DF" && grep -q CRB_STATUS_TOKEN "$DF"'
# login variables n; d1: mode (default, keep)
update "$D" 'n\n\n'
check "declined: file unchanged, consequence named" '[ "$(rc)" -eq 0 ] && cmp -s "$DF" "$WORK/dash.old" && out | grep -q "nicht über .env einstellen" && out | grep -q "keine, die Installation ist aktuell"'
# login variables yes (default); d1: mode; apply y; recreate n
update "$D" '\n\ny\nn\n'
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "the four lines are added, every other line as before" 'cmp -s "$DF" "$WORK/dash.new"'
check "config shows the variables, dashboard listed for recreate, locked state named" '[ "$( (cd "$D" && docker compose config crb-dashboard) | grep -cE "CRB_DASHBOARD_(URL|PROXY|AUTH|REMOTE_INGEST):")" -eq 4 ] && out | grep -q "Später: docker compose up -d crb-dashboard" && out | grep -q "gesperrt, bis mit ./crb dashboard login"'
update "$D" '\n'
check "already present: no question, file unchanged" '[ "$(rc)" -eq 0 ] && ! out | grep -q "Login-Variablen" && cmp -s "$DF" "$WORK/dash.new"'
sed -e "1s/.*/# My own dashboard service./" "$WORK/dash.old" >"$DF"; cp "$DF" "$WORK/dash.own"
update "$D" '\n'
# shellcheck disable=SC2016
check "not created by crb: byte-identical, lines printed" '[ "$(rc)" -eq 0 ] && cmp -s "$DF" "$WORK/dash.own" && out | grep -qF "CRB_DASHBOARD_URL: \"\${CRB_DASHBOARD_URL:-}\"" && out | grep -qF "CRB_DASHBOARD_REMOTE_INGEST: \"\${CRB_DASHBOARD_REMOTE_INGEST:-}\"" && ! out | grep -q "Login-Variablen in"'
cp "$WORK/dash.new" "$DF"

# Stub for the login commands: `compose ps`, `up`, and `exec` are answered from
# files in $STUB_DIR (exec: the file named like the admin command); the rest is real.
LSTUB="$WORK/lstub"; mkdir -p "$LSTUB" "$WORK/answers"
cat >"$LSTUB/docker" <<EOF
#!/bin/sh
echo "docker \$*" >> "\$DOCKER_LOG"
case "\$1 \$2" in
  "compose ps") cat "\$STUB_DIR/ps" 2>/dev/null; exit 0 ;;
  "compose up") exit 0 ;;
  "compose exec") for a in "\$@"; do cmd=\$a; done; cat "\$STUB_DIR/\$cmd" 2>/dev/null || exit 1; exit 0 ;;
esac
exec "$REAL_DOCKER" "\$@"
EOF
chmod +x "$LSTUB/docker"
# dlogin DIR SUBCOMMAND ANSWERS: runs `crb dashboard SUBCOMMAND` against the stub.
dlogin() {
  local dir=$1 sub=$2 answers=$3
  : >"$WORK/docker.log"
  (cd "$dir" && printf '%b' "$answers" | DOCKER_LOG="$WORK/docker.log" STUB_DIR="$WORK/answers" CRB_WAIT_S=0 PATH="$LSTUB:$PATH" "$SCRIPT" dashboard "$sub") >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}
answer() { printf '%s\n' "$2" >"$WORK/answers/$1"; }
enroll_answer() { answer enroll "{\"passkeys\":$1,\"secret\":\"S3cret_-x\",\"minutes\":10,\"url\":\"$2\",\"auth\":\"${3:-on}\"}"; }

echo "Dashboard login: first passkey"
D="$WORK/t-dash"
answer ps "0123abcd"; enroll_answer 0 "https://crb.example.org"
cp "$D/.env" "$WORK/env.before"
dlogin "$D" login 'nonsense\n'
check "input ends after a bad address: non-zero, .env untouched, no link" '[ "$(rc)" -ne 0 ] && cmp -s "$D/.env" "$WORK/env.before" && ! out | grep -q "#enroll=" && ! dlog | grep -q "compose up"'
dlogin "$D" login 'https://crb.example.org\n\nn\n'
check "declined: nothing changed, no link" '[ "$(rc)" -eq 0 ] && out | grep -q "nichts geändert" && cmp -s "$D/.env" "$WORK/env.before" && ! out | grep -q "#enroll=" && ! dlog | grep -q "compose exec"'
dlogin "$D" login 'https://crb.example.org\n\ny\n'
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "address in .env, no proxy line, token kept" 'grep -qx "CRB_DASHBOARD_URL=https://crb.example.org" "$D/.env" && ! grep -q CRB_DASHBOARD_PROXY "$D/.env" && grep -q "^CRB_STATUS_TOKEN=$TOKEN$" "$D/.env"'
check "dashboard recreated, then the link with its lifetime" 'dlog | grep -q "docker compose up -d crb-dashboard" && out | grep -q "^   https://crb.example.org/#enroll=S3cret_-x$" && out | grep -q "10 Minuten gültig"'
check "the running dashboard gets the address" '(cd "$D" && docker compose config crb-dashboard) | grep -q "CRB_DASHBOARD_URL: https://crb.example.org"'

echo "Dashboard login: addresses that are not an https origin are asked again"
cp "$WORK/env.before" "$D/.env"
dlogin "$D" login 'http://crb.example.org\nhttps://crb.example.org/dash\ncrb.example.org\nhttps://crb.example.org/\nproxy.example\n10.0.5.2, 10.0.6.0/24\ny\n'
check "three address hints, one proxy hint, then accepted" '[ "$(rc)" -eq 0 ] && [ "$(out | grep -c "mit https:// und ohne Pfad")" -eq 3 ] && [ "$(out | grep -c "IP-Adressen oder Bereiche")" -eq 1 ]'
check "address without the trailing slash, proxy list as given" 'grep -qx "CRB_DASHBOARD_URL=https://crb.example.org" "$D/.env" && grep -qx "CRB_DASHBOARD_PROXY=10.0.5.2, 10.0.6.0/24" "$D/.env"'
dlogin "$D" login ''
check "a second run replaces nothing in .env" '[ "$(grep -c "^CRB_DASHBOARD_URL=" "$D/.env")" -eq 1 ]'

echo "Dashboard login: further device"
enroll_answer 1 "https://crb.example.org"
cp "$D/.env" "$WORK/env.before"
dlogin "$D" login ''
check "no question, nothing recreated, new link, one passkey named" '[ "$(rc)" -eq 0 ] && ! out | grep -q "Öffentliche Adresse" && ! dlog | grep -q "compose up" && out | grep -q "#enroll=S3cret_-x" && out | grep -q "Passkeys bisher: 1" && cmp -s "$D/.env" "$WORK/env.before"'

echo "Dashboard login: a dashboard that does not run with the address gives no link"
enroll_answer 1 ""
dlogin "$D" login ''
check "non-zero, cause named, no link" '[ "$(rc)" -ne 0 ] && out | grep -q "nicht übernommen" && ! out | grep -q "#enroll="'
enroll_answer 1 "https://crb.example.org" off
dlogin "$D" login ''
check "login switched off: non-zero, says so, no link" '[ "$(rc)" -ne 0 ] && out | grep -q "CRB_DASHBOARD_AUTH=off" && ! out | grep -q "#enroll="'
sed -i.bak "s#^CRB_DASHBOARD_URL=.*#CRB_DASHBOARD_URL=crb.example.org#" "$D/.env"; rm -f "$D/.env.bak"
dlogin "$D" login ''
check "a broken address in .env is reported, not used" '[ "$(rc)" -ne 0 ] && out | grep -q "CRB_DASHBOARD_URL in .env" && ! dlog | grep -q "compose exec"'
cp "$WORK/env.before" "$D/.env"

echo "Dashboard logout and reset"
answer logout '{"sessions":2}'; answer reset '{"passkeys":1,"sessions":2}'
dlogin "$D" logout ''
check "logout: says how many sessions ended, passkeys stay" '[ "$(rc)" -eq 0 ] && out | grep -q "2 Sitzung(en) beendet" && dlog | grep -q "compose exec -T crb-dashboard node server/admin.js logout"'
dlogin "$D" reset '\n'
check "reset declined with Enter: nothing removed" '[ "$(rc)" -eq 0 ] && out | grep -q "nichts geändert" && ! dlog | grep -q "compose exec"'
dlogin "$D" reset 'y\n'
check "reset confirmed: counts shown, next step named" '[ "$(rc)" -eq 0 ] && out | grep -q "1 Passkey(s) und 2 Sitzung(en) entfernt" && out | grep -q "./crb dashboard login" && dlog | grep -q "admin.js reset"'

echo "Dashboard login: dashboard not running or not there"
: >"$WORK/answers/ps"
for sub in login logout reset; do
  dlogin "$D" "$sub" 'y\n'
  check "$sub: says it is not running and how to start it, changes nothing" '[ "$(rc)" -ne 0 ] && out | grep -q "läuft nicht" && out | grep -q "docker compose up -d crb-dashboard" && ! out | grep -q "#enroll=" && ! dlog | grep -q "compose exec\|compose up" && cmp -s "$D/.env" "$WORK/env.before"'
done
answer ps "0123abcd"
cp "$WORK/dash.old" "$DF"
dlogin "$D" login ''
check "service file without the variables: points to crb update" '[ "$(rc)" -ne 0 ] && out | grep -q "./crb update" && ! dlog | grep -q "compose exec"'
cp "$WORK/dash.new" "$DF"
E="$WORK/t-nodash"; mkdir -p "$E"
run "$E" 'n1\n\n\n\n\n\n\n\ny\n' "$REPO"
dlogin "$E" login ''
check "no dashboard service: says so" '[ "$(rc)" -ne 0 ] && out | grep -q "noch nicht angelegt" && out | grep -q "./crb dashboard"'

echo "Refuses root and old Compose"
FAKE="$WORK/fake"; mkdir -p "$FAKE"
printf '#!/bin/sh\nif [ "$1" = "-u" ]; then echo 0; else /usr/bin/id "$@"; fi\n' >"$FAKE/id"
printf '#!/bin/sh\necho 2.19.1\n' >"$FAKE/docker"
chmod +x "$FAKE/id" "$FAKE/docker"
D="$WORK/t-guard"; mkdir -p "$D/root" "$D/old"
mkdir -p "$FAKE/root-only" && cp "$FAKE/id" "$FAKE/root-only/"
(cd "$D/root" && PATH="$FAKE/root-only:$PATH" "$SCRIPT" add "$REPO" </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "root refused" '[ "$(rc)" -ne 0 ] && out | grep -q "nicht als root"'
mkdir -p "$FAKE/old-only" && cp "$FAKE/docker" "$FAKE/old-only/"
(cd "$D/old" && PATH="$FAKE/old-only:$PATH" "$SCRIPT" add "$REPO" </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "old Compose refused" '[ "$(rc)" -ne 0 ] && out | grep -q "zu alt"'
check "guards changed nothing" '[ -z "$(ls -A "$D/root" "$D/old" | grep -v :)" ]'

# --- git ---------------------------------------------------------------------
# Bare repositories stand in for origin; nothing leaves the machine.

# gitcmd DIR [ARGS...]: runs `crb git` in DIR without a terminal.
gitcmd() {
  local dir=$1
  shift
  (cd "$dir" && "$SCRIPT" git "$@" </dev/null) >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}
# service DIR NAME SRC: hand-written service file that mounts SRC at /workspace.
service() {
  mkdir -p "$1/services"
  printf 'services:\n  %s:\n    extends:\n      file: ../box.yaml\n      service: box\n    environment:\n      CRB_NAME: "%s"\n    volumes:\n      - "%s:/workspace"\n' "$2" "$2" "$3" >"$1/services/$2.yaml"
}
ci() { git -C "$1" commit -q --allow-empty -m "$2"; }
# advance CLONE BRANCH N [FILE]: N commits on origin's BRANCH, the last one adding FILE.
advance() {
  local x=$1 b=$2 n=$3 file=${4-} i
  git -C "$x" fetch -q origin
  git -C "$x" checkout -q -B "$b" "origin/$b"
  i=0; while [ "$i" -lt "$n" ]; do i=$((i + 1)); ci "$x" "$b remote $i"; done
  if [ -n "$file" ]; then echo new >"$x/$file"; git -C "$x" add "$file"; git -C "$x" commit -q -m "$b adds $file"; fi
  git -C "$x" push -q origin "$b"
}
# container_path WORKSPACE ID RECORDED: rewrites a worktree's records to the
# path it would have inside the container.
container_path() {
  local ws=$1 id=$2 recorded=$3 host
  host=$(cat "$ws/.git/worktrees/$id/gitdir"); host=${host%/.git}
  printf '%s/.git\n' "$recorded" >"$ws/.git/worktrees/$id/gitdir"
  printf 'gitdir: /workspace/.git/worktrees/%s\n' "$id" >"$host/.git"
}
ref() { git -C "$1" rev-parse -q --verify "$2" 2>/dev/null; }
records() { (cd "$1/.git/worktrees" && find . -name gitdir -exec cksum {} + | sort); }

echo "Git: project selection"
D="$WORK/t-git"; mkdir -p "$D"
run "$D" 'ga\n\n\n\n\n\n\n\ny\n' "$REPO"
run "$D" 'gb\n\n\n\n\n\n\n\ny\n' "$REPO"
git clone -q "$REPO" "$WORK/hand-ws"
service "$D" hand "$WORK/hand-ws"
mkdir -p "$D/plain/workspace"; service "$D" plain ../plain/workspace
git clone -q "$REPO" "$HOME/tilde-ws"
# shellcheck disable=SC2088  # the literal ~ is what a hand-written service file contains
service "$D" tilde '~/tilde-ws'
printf 'services:\n  novol:\n    image: alpine\n' >"$D/services/novol.yaml"
gitcmd "$D" nope
check "unknown project: non-zero, named, no fetch" '[ "$(rc)" -ne 0 ] && out | grep -q "Unbekanntes Projekt: nope" && [ ! -e "$D/ga/workspace/.git/FETCH_HEAD" ]'
gitcmd "$D"
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "all projects in order, plain directory with its reason" '[ "$(out | grep " · " | cut -d" " -f1 | tr "\n" " ")" = "ga gb hand plain tilde " ] && out | grep -q "^plain · kein Git-Repository$" && out | grep -q "^hand · Fetch ok$" && out | grep -q "^tilde · Fetch ok$"'
check "service without workspace is not a project" '! out | grep -q novol'
check "fetched" '[ -e "$D/ga/workspace/.git/FETCH_HEAD" ]'
gitcmd "$D" gb
check "named project only" '[ "$(rc)" -eq 0 ] && out | grep -q "^gb · Fetch ok$" && ! out | grep -q "^ga "'
gitcmd "$D" sync --no-fetch
check "sync refuses --no-fetch" '[ "$(rc)" -ne 0 ] && out | grep -q "nur für die Übersicht"'
BASE=$D
S="$WORK/t-gitsingle"; mkdir -p "$S"; cp "$EXAMPLE" "$S/compose.yaml"
gitcmd "$S"
check "single-file setup gets the layout hint" '[ "$(rc)" -ne 0 ] && out | grep -q "services/-Layout"'
S="$WORK/t-gitnone"; mkdir -p "$S"
gitcmd "$S"
check "no installation here" '[ "$(rc)" -ne 0 ] && out | grep -q "keine compose.yaml"'
(cd "$D" && "$SCRIPT") >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "usage lists git and git sync" '[ "$(rc)" -ne 0 ] && out | grep -q "crb git \[projekt\]" && out | grep -q "crb git sync"'

echo "Git: overview"
D="$WORK/t-gitfx"; mkdir -p "$D"; cp "$BASE/compose.yaml" "$BASE/box.yaml" "$D/"
O="$D/origin.git"; W="$D/fx/workspace"; X="$D/other"
git init -q "$D/seed"; echo one >"$D/seed/f.txt"; git -C "$D/seed" add f.txt; git -C "$D/seed" commit -q -m init
git clone -q --bare "$D/seed" "$O"
git clone -q "$O" "$W"; git clone -q "$O" "$X"
service "$D" fx ../fx/workspace
for b in blocked feature/exactly-20ch feature/nav loose-behind merged wt-behind wt-out wt-out-ahead; do
  git -C "$W" branch -q "$b"; git -C "$W" push -q -u origin "$b" >/dev/null 2>&1
done
git -C "$W" branch -q empty-one
WT="$W/.claude/worktrees"
git -C "$W" worktree add -q "$WT/nav" feature/nav
git -C "$W" worktree add -q -b calm-clock "$WT/calm"
git -C "$W" worktree add -q "$WT/behind" wt-behind
git -C "$W" worktree add -q "$WT/blocked" blocked
git -C "$W" worktree add -q "$D/out/a" wt-out
git -C "$W" worktree add -q "$D/out/b" wt-out-ahead
ci "$WT/nav" "nav 1"; ci "$WT/nav" "nav 2"; echo changed >"$WT/nav/f.txt"
ci "$WT/calm" "calm 1"
ci "$D/out/b" "out ahead"
echo changed >"$WT/blocked/f.txt"
git -C "$W" checkout -q feature/exactly-20ch; ci "$W" "local 1"
git -C "$W" checkout -q -b feature/a-very-long-branch-name main; ci "$W" "long 1"
git -C "$W" checkout -q main
advance "$X" main 2 main-new.txt
advance "$X" feature/exactly-20ch 2
advance "$X" wt-behind 0 new.txt
advance "$X" wt-out 1
advance "$X" loose-behind 2
advance "$X" blocked 1
git -C "$X" push -q origin --delete merged
for id in nav calm behind blocked; do container_path "$W" "$id" "/workspace/.claude/worktrees/$id"; done
container_path "$W" a /nonexistent-crb/a
container_path "$W" b /nonexistent-crb/b
state() { git -C "$W" for-each-ref refs/heads; git -C "$W" status --porcelain; git -C "$O" for-each-ref; cat "$WT/nav/f.txt" "$WT/blocked/f.txt"; ls "$WT/behind" "$W"; }
before=$(state); rec_before=$(records "$W")
git -C "$W" fetch -q origin
gitcmd "$D"
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "workspace branch first, behind" '[ "$(out | sed -n 2p)" = "↓ main                 3 hinter" ]'
check "ahead with local changes" 'out | grep -Eq "^↑ feature/nav +2 vor \*$" && out | grep -q "^\* lokale Änderungen"'
check "diverged with both numbers" 'out | grep -Eq "^! feature/exactly-20ch 1 vor 2 hinter$" && out | grep -q "divergiert"'
check "new with a commit, new without" 'out | grep -Eq "^↑ calm-clock +neu, 1 Commit$" && out | grep -Eq "^= empty-one +neu, leer$"'
check "deleted on origin" 'out | grep -Eq "^! merged +Upstream fehlt$" && out | grep -q "auf origin gelöscht"'
check "behind, not checked out" 'out | grep -Eq "^↓ loose-behind +2 hinter$"'
check "container-path worktree found: behind, blocked by a local change" 'out | grep -Eq "^↓ wt-behind +1 hinter$" && out | grep -Eq "^! blocked +1 hinter$" && out | grep -q "lokale Änderungen, kein Pull"'
check "worktree outside the workspace is not reachable" 'out | grep -Eq "^! wt-out +1 hinter$" && out | grep -q "nicht erreichbar" && out | grep -Eq "^↑ wt-out-ahead +1 vor$"'
check "long name cut" 'out | grep -Eq "^↑ feature/a-very-long…  ?neu, 1 Commit$"'
UTF=$(locale -a 2>/dev/null | grep -i -m1 -E '^(C|en_US)\.utf-?8$' || true)
widest() { local l m=0; while IFS= read -r l; do if [ "${#l}" -gt "$m" ]; then m=${#l}; fi; done; echo "$m"; }
check "branch lines fit 40 columns" '[ "$(out | grep -E "^[↓↑!=] " | LC_ALL=${UTF:-C} widest)" -le 40 ] || [ -z "$UTF" ]'
check "overview is read-only" '[ "$(state)" = "$before" ] && [ "$(records "$W")" = "$rec_before" ]'
check "hint to run sync" 'out | grep -q "Ausführen: ./crb git sync"'
sleep 1; touch "$WORK/marker"
gitcmd "$D" --no-fetch
check "--no-fetch leaves FETCH_HEAD alone" '[ "$(rc)" -eq 0 ] && out | grep -q "^fx · ohne Fetch$" && [ ! "$W/.git/FETCH_HEAD" -nt "$WORK/marker" ] && out | grep -Eq "^↓ main +3 hinter$"'

echo "Git: unreachable origin"
git clone -q "$O" "$D/off/workspace"; service "$D" off ../off/workspace
git -C "$D/off/workspace" remote set-url origin "ssh://git@127.0.0.1:1/none.git"
SECONDS=0
gitcmd "$D"
check "fails fast without a prompt" '[ "$SECONDS" -le 15 ] && [ "$(rc)" -ne 0 ]'
check "entry marked as failed and outdated, state still shown" 'out | grep -q "^off · Fetch fehlgeschlagen$" && out | grep -q "Stand evtl. veraltet" && out | grep -Eq "^= main +aktuell$"'
check "other project listed normally" 'out | grep -q "^fx · Fetch ok$" && out | grep -Eq "^↓ main +3 hinter$"'
GITLOG="$WORK/git-env.log"; : >"$GITLOG"; REAL_GIT=$(command -v git); mkdir -p "$WORK/gitstub"
printf '#!/bin/sh\necho "prompt=$GIT_TERMINAL_PROMPT ssh=$GIT_SSH_COMMAND args=$*" >> "%s"\nexec "%s" "$@"\n' "$GITLOG" "$REAL_GIT" >"$WORK/gitstub/git"; chmod +x "$WORK/gitstub/git"
(cd "$D" && PATH="$WORK/gitstub:$PATH" "$SCRIPT" git off </dev/null) >"$WORK/out" 2>&1
check "fetch runs without prompts and without housekeeping" 'grep "fetch --prune" "$GITLOG" | grep -q "prompt=0 ssh=ssh -o BatchMode=yes" && grep "fetch --prune" "$GITLOG" | grep -q "args=-c gc.auto=0"'
check "every git call disables housekeeping" '! grep -v "args=-c gc.auto=0 " "$GITLOG" | grep -q .'
rm -f "$D/services/off.yaml"

echo "Git: sync"
div_before="$(ref "$W" feature/exactly-20ch) $(ref "$O" feature/exactly-20ch)"
blocked_before=$(ref "$W" blocked); out_before=$(ref "$W" wt-out)
gitcmd "$D" sync
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "main fast-forwarded in the workspace" '[ "$(ref "$W" HEAD)" = "$(ref "$O" main)" ] && [ -f "$W/main-new.txt" ] && out | grep -Eq "^✓ main +3 geholt$"'
check "branch fast-forwarded in a container-path worktree" '[ "$(ref "$W" wt-behind)" = "$(ref "$O" wt-behind)" ] && [ -f "$WT/behind/new.txt" ] && out | grep -Eq "^✓ wt-behind +1 geholt$"'
check "branch that is not checked out fast-forwarded" '[ "$(ref "$W" loose-behind)" = "$(ref "$O" loose-behind)" ]'
check "ahead pushed, modified file untouched" '[ "$(ref "$O" feature/nav)" = "$(ref "$W" feature/nav)" ] && [ "$(cat "$WT/nav/f.txt")" = changed ] && out | grep -Eq "^✓ feature/nav +2 gepusht \*$"'
check "new with a commit pushed, upstream set" '[ "$(ref "$O" calm-clock)" = "$(ref "$W" calm-clock)" ] && [ "$(git -C "$W" config branch.calm-clock.merge)" = refs/heads/calm-clock ] && [ -n "$(ref "$O" feature/a-very-long-branch-name)" ]'
check "new without a commit stays local" '[ -z "$(ref "$O" empty-one)" ]'
check "diverged unchanged on both sides" '[ "$(ref "$W" feature/exactly-20ch) $(ref "$O" feature/exactly-20ch)" = "$div_before" ] && out | grep -Eq "^! feature/exactly-20ch 1 vor 2 hinter$"'
check "deleted on origin not pushed again" '[ -z "$(ref "$O" merged)" ] && [ -n "$(ref "$W" merged)" ]'
check "local change blocks the pull" '[ "$(ref "$W" blocked)" = "$blocked_before" ] && [ "$(cat "$WT/blocked/f.txt")" = changed ] && out | grep -q "lokale Änderungen, kein Pull"'
check "unreachable worktree: behind kept, ahead pushed" '[ "$(ref "$W" wt-out)" = "$out_before" ] && [ "$(ref "$O" wt-out-ahead)" = "$(ref "$W" wt-out-ahead)" ]'
check "final line with the counts" '[ "$(out | tail -n 2 | head -n 1)" = "4 gepusht · 3 geholt · 4 offen" ]'
check "worktree records unchanged" '[ "$(records "$W")" = "$rec_before" ] && [ "$(ls "$W/.git/worktrees" | tr "\n" " ")" = "a b behind blocked calm nav " ]'
check "no local branch for remote-only branches, nothing deleted" '[ "$(git -C "$W" for-each-ref refs/heads | wc -l)" -eq 12 ]'
gitcmd "$D" sync
check "second run does nothing" '[ "$(rc)" -eq 0 ] && [ "$(out | tail -n 2 | head -n 1)" = "0 gepusht · 0 geholt · 4 offen" ]'

echo "Git: rejected push"
D="$WORK/t-gitrej"; mkdir -p "$D"; cp "$BASE/compose.yaml" "$BASE/box.yaml" "$D/"
O="$D/origin.git"; W="$D/rj/workspace"
git clone -q --bare "$WORK/seed" "$O"; git clone -q "$O" "$W"; service "$D" rj ../rj/workspace
printf '#!/bin/sh\nwhile read -r old new name; do [ "$name" = refs/heads/bad ] && { echo "bad is protected"; exit 1; }; done\nexit 0\n' >"$O/hooks/pre-receive"; chmod +x "$O/hooks/pre-receive"
git -C "$W" checkout -q -b bad; ci "$W" "bad 1"
git -C "$W" checkout -q -b good main; ci "$W" "good 1"
git -C "$W" checkout -q main
gitcmd "$D" sync
check "rejected push reported, others handled, non-zero" '[ "$(rc)" -ne 0 ] && out | grep -Eq "^✗ bad +1 vor$" && out | grep -q "bad is protected" && [ -z "$(ref "$O" bad)" ] && [ -n "$(ref "$O" good)" ] && out | grep -q "1 gepusht · 0 geholt · 0 offen · 1 Fehler"'

echo "Git: only a diverged branch"
D="$WORK/t-gitdiv"; mkdir -p "$D"; cp "$BASE/compose.yaml" "$BASE/box.yaml" "$D/"
O="$D/origin.git"; W="$D/dv/workspace"
git clone -q --bare "$WORK/seed" "$O"; git clone -q "$O" "$W"; git clone -q "$O" "$D/other"; service "$D" dv ../dv/workspace
ci "$W" "local"; advance "$D/other" main 1
gitcmd "$D" sync
check "left for the user, exit 0" '[ "$(rc)" -eq 0 ] && out | grep -Eq "^! main +1 vor 1 hinter$" && out | grep -q "0 gepusht · 0 geholt · 1 offen"'

# --- git menu ----------------------------------------------------------------
# The menu is driven through --menu with one choice per line.

# gitmenu DIR CHOICES [ARGS...]
gitmenu() {
  local dir=$1 choices=$2
  shift 2
  (cd "$dir" && printf '%b' "$choices" | "$SCRIPT" git --menu "$@") >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}
# menufx DIR: installation with project "mx" (main 2 behind, ahead-a and
# ahead-b 1 ahead, "blocked" behind in a container-path worktree with a
# modified file, an 18-character branch that is new), "nr" (no repository)
# and "off" (origin unreachable). Fixed dates, so two fixtures are identical.
menufx() {
  local D=$1 O="$1/origin.git" W="$1/mx/workspace" X="$1/other" b
  mkdir -p "$D"; cp "$BASE/compose.yaml" "$BASE/box.yaml" "$D/"
  export GIT_AUTHOR_DATE="2026-01-01T00:00:00Z" GIT_COMMITTER_DATE="2026-01-01T00:00:00Z"
  git init -q "$D/seed"; echo one >"$D/seed/f.txt"; echo one >"$D/seed/g.txt"; git -C "$D/seed" add .; git -C "$D/seed" commit -q -m init
  git clone -q --bare "$D/seed" "$O"; git clone -q "$O" "$W"; git clone -q "$O" "$X"
  service "$D" mx ../mx/workspace
  for b in ahead-a ahead-b blocked; do git -C "$W" branch -q "$b"; git -C "$W" push -q -u origin "$b" >/dev/null 2>&1; done
  git -C "$W" worktree add -q "$W/.claude/worktrees/blocked" blocked
  echo changed >"$W/.claude/worktrees/blocked/f.txt"
  for b in ahead-a ahead-b; do git -C "$W" checkout -q "$b"; ci "$W" "$b local"; done
  git -C "$W" checkout -q -b feature/eighteen-c main; ci "$W" "eighteen local"
  git -C "$W" checkout -q main
  advance "$X" main 1 main-new.txt
  advance "$X" blocked 1
  container_path "$W" blocked /workspace/.claude/worktrees/blocked
  mkdir -p "$D/nr/workspace"; service "$D" nr ../nr/workspace
  git clone -q "$O" "$D/off/workspace"; service "$D" off ../off/workspace
  git -C "$D/off/workspace" remote set-url origin "ssh://git@127.0.0.1:1/none.git"
  unset GIT_AUTHOR_DATE GIT_COMMITTER_DATE
}
mxstate() { git -C "$1/mx/workspace" for-each-ref refs/heads --format='%(refname) %(objectname)'; git -C "$1/origin.git" for-each-ref --format='%(refname) %(objectname)'; git -C "$1/mx/workspace" status --porcelain --untracked-files=no; cat "$1/mx/workspace/.claude/worktrees/blocked/f.txt"; }

echo "Git menu: when it opens"
D="$WORK/t-menu"; menufx "$D"; W="$D/mx/workspace"; O="$D/origin.git"
gitcmd "$D" --list
check "--list prints the overview and ends without a prompt" '[ "$(rc)" -ne 0 ] && out | grep -q "^mx · Fetch ok$" && out | grep -q "^↓ fast-forward" && ! out | grep -q "Auswahl:"'
gitcmd "$D"
check "no terminal: overview, no menu" 'out | grep -q "^mx · Fetch ok$" && ! out | grep -q "Auswahl:" && ! out | grep -q "^Projekte$"'
gitmenu "$D" ''
check "--menu with empty input: project list, exit 0" '[ "$(rc)" -eq 0 ] && out | grep -q "^Projekte$" && out | grep -q "Auswahl:"'
gitcmd "$D" --list --menu
check "--list with --menu refused" '[ "$(rc)" -ne 0 ] && out | grep -q "schließen sich aus"'
gitcmd "$D" sync --menu
check "sync with --menu refused" '[ "$(rc)" -ne 0 ] && out | grep -q "nicht für sync"'

echo "Git menu: screens and navigation"
before=$(mxstate "$D"); rec_before=$(records "$W")
gitmenu "$D" 'x\n1\n1\nz\nz\n2\nz\n3\nz\nq\n'
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "project list with summaries" 'out | grep -Eq "^ 1 mx +↑3 ↓1 !1$" && out | grep -Eq "^ 2 nr +kein Git-Repository$" && out | grep -Eq "^ 3 off +Fetch fehlgeschlagen$"'
check "unknown input repeats the screen with a note" 'out | grep -q "^.x. steht nicht zur Auswahl\.$" && [ "$(out | grep -c "^Projekte$")" -ge 2 ]'
check "project screen: workspace branch first, numbered" '[ "$(out | grep -A1 "^mx$" | sed -n 2p)" = " 1 ↓ main               2 hinter" ] && out | grep -Eq "^ 2 ↑ ahead-a +1 vor$" && out | grep -Eq "^ 4 ! blocked +1 hinter$" && out | grep -q "^ s Projekt synchronisieren$"'
check "branch screen: only the actions for its state" 'out | grep -q "^mx · main$" && out | grep -q "^ 1 holen (fast-forward)$" && out | grep -q "^ 2 letzte Commits zeigen$" && ! out | grep -q "pushen$"'
check "z goes back one screen, q ends" '[ "$(out | grep -c "^mx$")" -eq 2 ] && [ "$(out | grep -c "^Projekte$")" -eq 5 ]'
check "no repository: reason, no actions" 'out | grep -q "^kein Git-Repository\.$"'
check "failed fetch: stored state, actions locked" 'out | grep -q "Aktionen sind gesperrt" && out | grep -Eq "^   = main +aktuell$" && [ "$(out | grep -c "s Projekt synchronisieren")" -eq 2 ]'
check "navigating changes nothing" '[ "$(mxstate "$D")" = "$before" ] && [ "$(records "$W")" = "$rec_before" ]'
check "menu lines fit 40 columns" 'out | grep -Eq "^ 5 ↑ feature/eighteen-c neu, 1 Commit$" && { [ -z "$UTF" ] || [ "$(out | grep -E "^ *[0-9]+ [↓↑!=] " | LC_ALL=$UTF widest)" -le 40 ]; }'
gitmenu "$D" '' mx
check "one project named: starts at its branches" '[ "$(rc)" -eq 0 ] && out | grep -q "^mx$" && ! out | grep -q "^Projekte$" && ! out | grep -q "Abrufen: nr"'
gitmenu "$D" '1\n'
check "input ends after one choice: exit 0" '[ "$(rc)" -eq 0 ] && out | grep -q "^mx$"'
gitmenu "$D" 'q\n' --no-fetch
check "--no-fetch skips the first fetch" '[ "$(rc)" -eq 0 ] && out | grep -Eq "^ 3 off +aktuell$"'

echo "Git menu: actions"
gitmenu "$D" '1\ns\n\nq\n'
check "project sync declined: counts shown, nothing changed" 'out | grep -q "^3 pushen, 1 holen. Ausführen? (y/N): $" && out | grep -q "^Nichts geändert\.$" && [ "$(mxstate "$D")" = "$before" ]'
gitmenu "$D" '1\n4\n1\nq\n'
check "blocked pull: no fetch offered, reason, modified files listed" 'out | grep -q "^mx · blocked$" && out | grep -q "lokale Änderungen, kein Pull" && out | grep -q "^ 1 geänderte Dateien zeigen$" && ! out | grep -A4 "^mx · blocked$" | grep -q "holen (fast-forward)" && out | grep -q "^   M f.txt$"'
gitmenu "$D" '1\n2\n1\nz\nq\n'
check "push one branch: the other stays local" '[ "$(ref "$O" ahead-a)" = "$(ref "$W" ahead-a)" ] && [ "$(ref "$O" ahead-b)" != "$(ref "$W" ahead-b)" ] && out | grep -q "^✓ ahead-a: 1 gepusht$"'
check "screens show the new state" 'out | grep -A1 "^mx · ahead-a$" | grep -q "^aktuell$" && out | grep -Eq "^ 2 = ahead-a +aktuell$" && out | grep -Eq "^ 3 ↑ ahead-b +1 vor$"'
gitmenu "$D" '1\n1\n1\nq\n'
check "fetch one branch: workspace moved" '[ "$(ref "$W" HEAD)" = "$(ref "$O" main)" ] && [ -f "$W/main-new.txt" ] && out | grep -q "^✓ main: 2 geholt$" && out | grep -A1 "^mx · main$" | tail -n 1 | grep -q "^aktuell$"'
printf '#!/bin/sh\nwhile read -r old new name; do [ "$name" = refs/heads/ahead-b ] && { echo "ahead-b is protected"; exit 1; }; done\nexit 0\n' >"$O/hooks/pre-receive"; chmod +x "$O/hooks/pre-receive"
gitmenu "$D" '1\n3\n1\n2\nq\n'
check "rejected push: message, branch still ahead, menu keeps running" '[ "$(rc)" -eq 0 ] && out | grep -q "^✗ ahead-b: 1 vor$" && out | grep -q "ahead-b is protected" && [ "$(ref "$O" ahead-b)" != "$(ref "$W" ahead-b)" ] && out | grep -q "ahead-b local" && [ "$(out | grep -c "^mx · ahead-b$")" -eq 3 ]'
gitmenu "$D" 'f\nq\n'
check "fetch again from the project list" '[ "$(out | grep -c "^Abrufen: mx$")" -eq 2 ]'

echo "Git menu: synchronize all equals crb git sync"
A="$WORK/t-menu-a"; B="$WORK/t-menu-b"; menufx "$A"; menufx "$B"
check "fixtures identical" '[ "$(mxstate "$A")" = "$(mxstate "$B")" ]'
gitmenu "$A" 'a\ny\nq\n'
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "confirmation with counts, result counts, new summaries" 'out | grep -q "3 pushen, 1 holen. Ausführen?" && out | grep -q "^3 gepusht · 1 geholt · 1 offen$" && out | grep -Eq "^ 1 mx +!1$"'
gitcmd "$B" sync
check "same refs and files as crb git sync" '[ "$(mxstate "$A")" = "$(mxstate "$B")" ] && [ -f "$A/mx/workspace/main-new.txt" ]'
gitmenu "$A" 'a\nq\n'
check "nothing left: says so, asks nothing" 'out | grep -q "^Nichts zu pushen oder zu holen\.$" && ! out | grep -q "Ausführen?"'

# divfx DIR MODE: project "dv" whose main is 1 ahead and 1 behind. MODE clean:
# the two commits touch different files; conflict: the same line.
divfx() {
  local D=$1 mode=$2 O="$1/origin.git" W="$1/dv/workspace" X="$1/other"
  mkdir -p "$D"; cp "$BASE/compose.yaml" "$BASE/box.yaml" "$D/"
  git init -q "$D/seed"; echo one >"$D/seed/f.txt"; echo one >"$D/seed/g.txt"; git -C "$D/seed" add .; git -C "$D/seed" commit -q -m init
  git clone -q --bare "$D/seed" "$O"; git clone -q "$O" "$W"; git clone -q "$O" "$X"
  service "$D" dv ../dv/workspace
  echo local >>"$W/g.txt"; git -C "$W" commit -q -am "local g"
  if [ "$mode" = clean ]; then echo remote >>"$X/f.txt"; else echo remote >>"$X/g.txt"; fi
  git -C "$X" commit -q -am "remote change"; git -C "$X" push -q origin main
}
clean() { [ -z "$(git -C "$1" status --porcelain --untracked-files=no)" ] && [ ! -e "$1/.git/rebase-merge" ] && [ ! -e "$1/.git/rebase-apply" ] && [ ! -e "$1/.git/MERGE_HEAD" ]; }

echo "Git menu: diverged branch"
D="$WORK/t-div1"; divfx "$D" clean; W="$D/dv/workspace"; O="$D/origin.git"; o_before=$(ref "$O" main); h_before=$(ref "$W" HEAD)
gitmenu "$D" '1\n1\nq\n' dv
check "branch screen offers both sides, rebase, merge" 'out | grep -q "^1 vor 1 hinter · divergiert" && out | grep -q "^ 1 Commits beider Seiten zeigen$" && out | grep -q "^ 2 Rebase auf origin/main$" && out | grep -q "^ 3 Merge von origin/main$"'
check "both sides under their labels" '[ "$(out | grep -A1 "^lokal:$" | tail -n 1 | cut -d" " -f4-)" = "local g" ] && [ "$(out | grep -A1 "^auf origin:$" | tail -n 1 | cut -d" " -f4-)" = "remote change" ]'
gitmenu "$D" '1\n2\n\nq\n' dv
check "rebase declined: nothing changed" 'out | grep -q "^Nichts geändert\.$" && [ "$(ref "$W" HEAD)" = "$h_before" ]'
gitmenu "$D" '1\n2\ny\nq\n' dv
check "rebase without conflict: remote commit, then the local one" '[ "$(rc)" -eq 0 ] && out | grep -q "^✓ Rebase fertig\.$" && [ "$(git -C "$W" log --format=%s -n 2 | tr "\n" "|")" = "local g|remote change|" ] && clean "$W"'
check "only ahead now, push offered, origin untouched" 'out | grep -A1 "^dv · main$" | tail -n 1 | grep -q "^1 vor$" && out | grep -q "^ 1 pushen$" && [ "$(ref "$O" main)" = "$o_before" ]'
D="$WORK/t-div2"; divfx "$D" clean; W="$D/dv/workspace"; O="$D/origin.git"; o_before=$(ref "$O" main)
gitmenu "$D" '1\n3\ny\nq\n' dv
check "merge without conflict: two parents, ahead only, origin untouched" 'out | grep -q "^✓ Merge fertig\.$" && [ "$(git -C "$W" rev-list --parents -n 1 HEAD | wc -w)" -eq 3 ] && out | grep -A1 "^dv · main$" | tail -n 1 | grep -q "^2 vor$" && [ "$(ref "$O" main)" = "$o_before" ] && clean "$W"'
D="$WORK/t-div3"; divfx "$D" conflict; W="$D/dv/workspace"; h_before=$(ref "$W" HEAD)
gitmenu "$D" '1\n2\ny\nq\n' dv
check "conflicting rebase aborted: as before, file named" '[ "$(rc)" -eq 0 ] && out | grep -q "Rebase abgebrochen, Stand wie vorher" && out | grep -A1 "^Konflikt in:$" | grep -q "g.txt" && out | grep -q "^Bitte von Hand lösen\.$" && [ "$(ref "$W" HEAD)" = "$h_before" ] && clean "$W"'
gitmenu "$D" '1\n3\ny\nq\n' dv
check "conflicting merge aborted: as before, file named" 'out | grep -q "Merge abgebrochen, Stand wie vorher" && out | grep -A1 "^Konflikt in:$" | grep -q "g.txt" && [ "$(ref "$W" HEAD)" = "$h_before" ] && clean "$W"'
check "still diverged afterwards" 'out | grep -q "^1 vor 1 hinter · divergiert"'
echo edit >>"$W/f.txt"
gitmenu "$D" '1\nq\n' dv
check "local changes: neither offered, reason given" '! out | grep -q "Rebase auf" && ! out | grep -q "Merge von" && out | grep -q "Erst committen oder verwerfen" && out | grep -q "^ 2 geänderte Dateien zeigen$"'
git -C "$W" checkout -q -- f.txt; mkdir "$W/.git/rebase-merge"
gitmenu "$D" '1\nq\n' dv
check "rebase in progress: neither offered" '! out | grep -q "Rebase auf" && out | grep -q "läuft schon Rebase oder Merge"'
rmdir "$W/.git/rebase-merge"
git -C "$W" checkout -q -b parked; gitmenu "$D" '2\nq\n' dv
check "not checked out: neither offered, reason given" 'out | grep -q "^dv · main$" && ! out | grep -q "Rebase auf" && out | grep -q "Nicht ausgecheckt"'

echo "Git menu: diverged branch in a container-path worktree"
D="$WORK/t-div4"; divfx "$D" clean; W="$D/dv/workspace"; X="$D/other"
git -C "$W" branch -q wt origin/main; git -C "$W" push -q -u origin wt >/dev/null 2>&1
git -C "$W" worktree add -q "$W/.claude/worktrees/calm" wt
echo local >>"$W/.claude/worktrees/calm/g.txt"; git -C "$W/.claude/worktrees/calm" commit -q -am "wt local"
git -C "$X" fetch -q origin; git -C "$X" checkout -q -B wt origin/wt; echo remote >>"$X/f.txt"; git -C "$X" commit -q -am "wt remote"; git -C "$X" push -q origin wt
container_path "$W" calm /workspace/.claude/worktrees/calm
rec_before=$(records "$W")
gitmenu "$D" '2\n2\ny\nq\n' dv
check "rebased in the worktree on the host, record unchanged" 'out | grep -q "^dv · wt$" && out | grep -q "^✓ Rebase fertig\.$" && [ "$(git -C "$W" log --format=%s -n 2 wt | tr "\n" "|")" = "wt local|wt remote|" ] && grep -q remote "$W/.claude/worktrees/calm/f.txt" && [ "$(records "$W")" = "$rec_before" ]'

# --- git single actions ------------------------------------------------------

# sfx DIR: project "sx" with origin, workspace W on main, and a second clone X.
sfx() {
  local D=$1
  O="$D/origin.git"; W="$D/sx/workspace"; X="$D/other"
  mkdir -p "$D"; cp "$BASE/compose.yaml" "$BASE/box.yaml" "$D/"
  git init -q "$D/seed"; echo one >"$D/seed/f.txt"; echo one >"$D/seed/g.txt"; git -C "$D/seed" add .; git -C "$D/seed" commit -q -m init
  git clone -q --bare "$D/seed" "$O"; git clone -q "$O" "$W"; git clone -q "$O" "$X"
  service "$D" sx ../sx/workspace
}
# sbranch NAME FILE N: branch NAME in a worktree of W with N commits changing FILE.
sbranch() {
  local i=0
  git -C "$W" worktree add -q -b "$1" "$W/.claude/worktrees/$1" main >/dev/null 2>&1
  while [ "$i" -lt "$3" ]; do i=$((i + 1)); echo "$1 $i" >>"$W/.claude/worktrees/$1/$2"; git -C "$W/.claude/worktrees/$1" commit -q -am "$1 $i"; done
}
# rchange FILE: one commit on origin's main changing FILE.
rchange() { git -C "$X" fetch -q origin; git -C "$X" checkout -q -B main origin/main; echo remote >>"$X/$1"; git -C "$X" commit -q -am "remote $1"; git -C "$X" push -q origin main; }
sstate() { git -C "$W" for-each-ref --format='%(refname) %(objectname)' refs/heads; git -C "$O" for-each-ref --format='%(refname) %(objectname)'; git -C "$W" status --porcelain; git -C "$W" symbolic-ref HEAD; find "$W" -path "$W/.git" -prune -o -type f -exec cksum {} + | sort; }

echo "Git single actions: arguments"
D="$WORK/t-s0"; sfx "$D"; before=$(sstate)
gitcmd "$D" push
check "missing arguments: 3, usage, nothing fetched" '[ "$(rc)" -eq 3 ] && out | tr "\n" " " | grep -q "Aufruf: ./crb git push <projekt>  *<branch>" && [ ! -e "$W/.git/FETCH_HEAD" ]'
gitcmd "$D" push nope main
check "unknown project: 3" '[ "$(rc)" -eq 3 ] && out | grep -q "Unbekanntes Projekt: nope"'
for bad in "-x" "a..b" "a b" 'x; touch pwned'; do
  gitcmd "$D" branch sx "$bad"
  check "invalid name '$bad': 3, nothing changed" '[ "$(rc)" -eq 3 ] && out | grep -q "Kein gültiger Branch-Name" && [ "$(sstate)" = "$before" ] && [ ! -e "$D/pwned" ]'
done
gitcmd "$D" push sx main --carry
check "--carry only for branch" '[ "$(rc)" -eq 3 ]'
git -C "$W" remote set-url origin "ssh://git@127.0.0.1:1/none.git"
gitcmd "$D" push sx main
check "failed fetch: 1, nothing changed" '[ "$(rc)" -eq 1 ] && out | grep -q "Fetch fehlgeschlagen" && out | grep -q "Nichts geändert"'

echo "Git single actions: push and pull"
D="$WORK/t-s1"; sfx "$D"; sbranch calm-clock f.txt 2; sbranch other-b g.txt 1
gitcmd "$D" push sx calm-clock
check "push one new branch: on origin with upstream, the other not" '[ "$(rc)" -eq 0 ] && out | grep -q "^✓ calm-clock" && [ "$(ref "$O" calm-clock)" = "$(ref "$W" calm-clock)" ] && [ "$(git -C "$W" rev-parse --abbrev-ref calm-clock@{upstream})" = origin/calm-clock ] && [ -z "$(ref "$O" other-b)" ]'
gitcmd "$D" push sx main
check "nothing to push: 3, says up to date" '[ "$(rc)" -eq 3 ] && out | grep -q "Aktuell, nichts zu pushen"'
gitcmd "$D" push sx nope
check "unknown branch: 3" '[ "$(rc)" -eq 3 ] && out | grep -q "Branch nope gibt es nicht"'
rchange f.txt; echo edit >>"$W/g.txt"; git -C "$W" fetch -q origin; before=$(sstate)
gitcmd "$D" pull sx main
check "pull blocked by local changes: 3, as before" '[ "$(rc)" -eq 3 ] && out | grep -q "lokale Änderungen" && [ "$(sstate)" = "$before" ]'
git -C "$W" checkout -q -- g.txt
gitcmd "$D" pull sx main
check "pull: fast-forwarded with files" '[ "$(rc)" -eq 0 ] && [ "$(ref "$W" main)" = "$(ref "$O" main)" ] && grep -q remote "$W/f.txt"'
ci "$W" "local"; rchange g.txt; o_before=$(ref "$O" main)
gitcmd "$D" push sx main
check "diverged: 3, nothing pushed" '[ "$(rc)" -eq 3 ] && out | grep -q "divergiert" && [ "$(ref "$O" main)" = "$o_before" ]'

echo "Git single actions: merge"
D="$WORK/t-m1"; sfx "$D"; sbranch calm-clock g.txt 2; rchange f.txt; o_before=$(ref "$O" main); c_before=$(ref "$W" calm-clock)
container_path "$W" calm-clock /workspace/.claude/worktrees/calm-clock; rec_before=$(records "$W")
gitcmd "$D" merge sx calm-clock
check "merge commit with both parents on origin" '[ "$(rc)" -eq 0 ] && out | grep -q "^✓ calm-clock *in main gemergt" && out | grep -q "2 Commits · Merge-Commit · gepusht" && [ "$(git -C "$O" rev-list --parents -n 1 main)" = "$(ref "$O" main) $o_before $c_before" ]'
check "workspace on main follows with files, branch and records as before" '[ "$(ref "$W" main)" = "$(ref "$O" main)" ] && grep -q "calm-clock 2" "$W/g.txt" && grep -q remote "$W/f.txt" && [ -z "$(git -C "$W" status --porcelain --untracked-files=no)" ] && [ "$(ref "$W" calm-clock)" = "$c_before" ] && [ "$(records "$W")" = "$rec_before" ]'
gitcmd "$D" merge sx calm-clock
check "nothing left to merge: 3" '[ "$(rc)" -eq 3 ] && out | grep -q "hat nichts, was main fehlt"'
gitcmd "$D" merge sx main
check "default branch itself: 3" '[ "$(rc)" -eq 3 ]'
gitcmd "$D" merge sx nope
check "unknown branch: 3" '[ "$(rc)" -eq 3 ] && out | grep -q "Branch nope gibt es nicht"'

D="$WORK/t-m2"; sfx "$D"; sbranch calm-clock g.txt 2; o_before=$(ref "$O" main)
echo wip >>"$W/.claude/worktrees/calm-clock/f.txt"
gitcmd "$D" merge sx calm-clock
check "fast-forward: no merge commit, uncommitted work stays out and in place" '[ "$(rc)" -eq 0 ] && out | grep -q "Fast-Forward" && [ "$(ref "$O" main)" = "$(ref "$W" calm-clock)" ] && [ "$(ref "$W" main)" = "$(ref "$O" main)" ] && ! git -C "$O" show main:f.txt | grep -q wip && grep -q wip "$W/.claude/worktrees/calm-clock/f.txt"'

D="$WORK/t-m3"; sfx "$D"; sbranch calm-clock g.txt 1; rchange g.txt; git -C "$W" fetch -q origin; before=$(sstate)
gitcmd "$D" merge sx calm-clock
check "conflict: 3, file named, nothing changed" '[ "$(rc)" -eq 3 ] && out | grep -q "Konflikt" && out | grep -q "g.txt" && [ "$(sstate)" = "$before" ]'

D="$WORK/t-m4"; sfx "$D"; sbranch calm-clock g.txt 1; rchange f.txt; git -C "$W" checkout -q -b feature/nav; files_before=$(cat "$W/f.txt" "$W/g.txt")
gitcmd "$D" merge sx calm-clock
check "default branch not checked out: ref moved, workspace files unchanged" '[ "$(rc)" -eq 0 ] && [ "$(ref "$W" main)" = "$(ref "$O" main)" ] && [ "$(cat "$W/f.txt" "$W/g.txt")" = "$files_before" ] && [ "$(git -C "$W" symbolic-ref --short HEAD)" = feature/nav ]'

D="$WORK/t-m5"; sfx "$D"; sbranch calm-clock g.txt 1; echo edit >>"$W/f.txt"; m_before=$(ref "$W" main)
gitcmd "$D" merge sx calm-clock
check "workspace with local changes: origin moved, local main and files as before, said so" '[ "$(rc)" -eq 0 ] && [ "$(ref "$O" main)" = "$(ref "$W" calm-clock)" ] && [ "$(ref "$W" main)" = "$m_before" ] && grep -q edit "$W/f.txt" && out | grep -q "main lokal jetzt hinter" && out | grep -q "lokale Änderungen"'

D="$WORK/t-m6"; sfx "$D"; sbranch calm-clock g.txt 1; ci "$W" "own"; before=$(sstate)
gitcmd "$D" merge sx calm-clock
check "unpushed commits on main: 3, nothing changed" '[ "$(rc)" -eq 3 ] && out | grep -q "eigene" && out | grep -q "Erst pushen oder in einen Branch" && [ "$(sstate)" = "$before" ]'

D="$WORK/t-m7"; sfx "$D"; sbranch calm-clock g.txt 1; rchange f.txt; git -C "$W" fetch -q origin
printf '#!/bin/sh\necho "policy says no" >&2\nexit 1\n' >"$O/hooks/pre-receive"; chmod +x "$O/hooks/pre-receive"; before=$(sstate)
gitcmd "$D" merge sx calm-clock
check "rejected push: 1, message shown, nothing changed" '[ "$(rc)" -eq 1 ] && out | grep -q "Push abgelehnt" && out | grep -q "policy says no" && [ "$(sstate)" = "$before" ]'

echo "Git single actions: branch"
D="$WORK/t-b1"; sfx "$D"; rchange f.txt; rchange f.txt; rchange f.txt; m_before=$(ref "$W" main)
gitcmd "$D" branch sx feature/nav
check "fresh branch at origin/main, checked out, main untouched, not pushed, no upstream" '[ "$(rc)" -eq 0 ] && [ "$(git -C "$W" symbolic-ref --short HEAD)" = feature/nav ] && [ "$(ref "$W" HEAD)" = "$(ref "$O" main)" ] && [ "$(ref "$W" main)" = "$m_before" ] && [ -z "$(ref "$O" feature/nav)" ] && ! git -C "$W" rev-parse -q --verify "feature/nav@{upstream}" >/dev/null 2>&1'
gitcmd "$D" branch sx feature/nav
check "name taken locally: 3" '[ "$(rc)" -eq 3 ] && out | grep -q "gibt es schon"'
git -C "$X" push -q origin main:refs/heads/on-origin
gitcmd "$D" branch sx on-origin
check "name taken on origin: 3" '[ "$(rc)" -eq 3 ] && out | grep -q "gibt es schon" && [ -z "$(ref "$W" refs/heads/on-origin)" ]'
echo edit >>"$W/g.txt"; before=$(sstate)
gitcmd "$D" branch sx second
check "local changes without carry: 3, as before" '[ "$(rc)" -eq 3 ] && out | grep -q "Lokale Änderungen" && [ "$(sstate)" = "$before" ]'

D="$WORK/t-b2"; sfx "$D"; echo a >>"$W/f.txt"; git -C "$W" commit -q -am "own 1"; echo b >>"$W/f.txt"; git -C "$W" commit -q -am "own 2"; echo edit >>"$W/g.txt"
h_before=$(ref "$W" HEAD); files_before=$(cat "$W/f.txt" "$W/g.txt")
gitcmd "$D" branch sx rescue --carry
check "carry: same commit and files, main back on origin, commits on the new branch" '[ "$(rc)" -eq 0 ] && out | grep -q "2 Commits von main mitgenommen" && [ "$(git -C "$W" symbolic-ref --short HEAD)" = rescue ] && [ "$(ref "$W" HEAD)" = "$h_before" ] && [ "$(cat "$W/f.txt" "$W/g.txt")" = "$files_before" ] && [ "$(ref "$W" main)" = "$(ref "$O" main)" ] && [ "$(git -C "$W" log --format=%s -n 2 rescue | tr "\n" "|")" = "own 2|own 1|" ]'
check "carry: nothing unreachable" '! git -C "$W" fsck --unreachable --no-reflogs 2>/dev/null | grep -q "unreachable commit"'
gitcmd "$D" branch sx again --carry
check "carry from another branch: 3" '[ "$(rc)" -eq 3 ] && out | grep -q "Mitnehmen geht nur" && [ -z "$(ref "$W" refs/heads/again)" ]'
D="$WORK/t-b3"; sfx "$D"; before=$(sstate)
gitcmd "$D" branch sx rescue --carry
check "carry without own commits: 3, nothing changed" '[ "$(rc)" -eq 3 ] && out | grep -q "keine eigenen Commits" && [ "$(sstate)" = "$before" ]'
git -C "$W" checkout -q --detach
gitcmd "$D" branch sx fresh
check "detached workspace: 3" '[ "$(rc)" -eq 3 ] && out | tr "\n" " " | grep -q "kein Branch  *ausgecheckt"'
check "single actions fit 40 columns" '[ "$(out | widest)" -le 40 ]'

# --- agent -------------------------------------------------------------------
# A curl stub plays the dashboard: the Nth request for work is answered from
# $CURL_DIR/next.N (first line the HTTP code, 000 for "not reachable", then the
# body); without that file it answers 204 after a moment. Reported outcomes
# land in $CURL_DIR/report.<id>.
ASTUB="$WORK/astub"; mkdir -p "$ASTUB"
cat >"$ASTUB/curl" <<'STUB'
#!/bin/sh
out=/dev/null; data=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift ;;
    --data-binary) data=${2#@}; shift ;;
    -K|-w|--max-time|-X|-H) shift ;;
    -sS) ;;
    *) url=$1 ;;
  esac
  shift
done
case "$url" in
  */api/agent/next)
    n=$(cat "$CURL_DIR/count" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" >"$CURL_DIR/count"
    if [ -f "$CURL_DIR/next.$n" ]; then
      code=$(head -n 1 "$CURL_DIR/next.$n"); sed 1d "$CURL_DIR/next.$n" >"$out"
      if [ "$code" = 000 ]; then exit 7; fi
      printf '%s' "$code"
    else
      sleep 0.3; printf 204
    fi ;;
  */api/agent/actions/*) cp "$data" "$CURL_DIR/report.${url##*/}"; printf 204 ;;
esac
STUB
chmod +x "$ASTUB/curl"
REAL_GIT=$(command -v git)
printf '#!/bin/sh\necho "$*" >>"$GIT_LOG"\nexec "%s" "$@"\n' "$REAL_GIT" >"$ASTUB/git"; chmod +x "$ASTUB/git"
ALOG="$WORK/agent.log"
# agent_start DIR [CRB]: starts the agent in the background; its PID is in $APID.
agent_start() {
  CURL_DIR="$1/curl"; mkdir -p "$CURL_DIR"; : >"$ALOG"; : >"$WORK/git.log"
  (cd "$1" && exec env CURL_DIR="$CURL_DIR" GIT_LOG="$WORK/git.log" PATH="$ASTUB:$PATH" CRB_AGENT_FETCH_SECONDS="${AFETCH:-3600}" CRB_AGENT_PAUSE_MAX=0 "${2:-$SCRIPT}" agent) >"$ALOG" 2>&1 &
  APID=$!
}
# agent_wait CONDITION [TENTHS]: waits until the condition holds.
agent_wait() { local i=0; while ! eval "$1" 2>/dev/null; do i=$((i + 1)); if [ "$i" -gt "${2:-100}" ]; then return 1; fi; sleep 0.1; done; }
agent_stop() { kill -TERM "$APID" 2>/dev/null; wait "$APID" 2>/dev/null; }
# job N CODE [LINE]: scripts the Nth request for work.
job() { printf '%s\n' "$2" >"$CURL_DIR/next.$1"; if [ $# -gt 2 ]; then printf '%b\n' "$3" >>"$CURL_DIR/next.$1"; fi; }

echo "Agent: preconditions"
D="$WORK/t-a0"; sfx "$D"
(cd "$D" && "$SCRIPT" agent </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "no token: non-zero, names crb agent install" '[ "$(rc)" -ne 0 ] && out | grep -q "./crb agent install" && [ ! -e "$D/.crb-agent.lock" ]'
(cd "$D" && "$SCRIPT" agent nope </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "unknown argument: usage, non-zero, nothing started" '[ "$(rc)" -eq 64 ] && out | grep -q "crb agent install|uninstall|status" && [ ! -e "$D/.crb-agent.lock" ]'
(cd "$D" && PATH="$FAKE/root-only:$PATH" "$SCRIPT" agent </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "root refused" '[ "$(rc)" -ne 0 ] && out | grep -q "nicht als root"'
(cd "$D" && "$SCRIPT" agent status </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "status without an agent: non-zero, says so" '[ "$(rc)" -ne 0 ] && out | grep -q "Agent:     läuft nicht"'

echo "Agent: carries out actions in order and reports them"
D="$WORK/t-a1"; sfx "$D"; sbranch calm-clock g.txt 2; sbranch other-b f.txt 1
echo 'CRB_AGENT_TOKEN=Agent0123456789Agent0123456789Agent01' >"$D/.env"
CURL_DIR="$D/curl"; mkdir -p "$CURL_DIR"
job 1 200 'id1\tpush\tsx\tcalm-clock\t-\t0'
job 2 200 'id2\tmerge\tsx\tother-b\t-\t0'
job 3 200 'id3\tbranch\tsx\t-\trescue\t0'
job 4 200 'id4\tfetch\tsx\t-\t-\t0'
agent_start "$D"
check "all four reported" 'agent_wait "[ -f \"$CURL_DIR/report.id4\" ]" 300'
check "push: done with the line of the command, branch on origin" '[ "$(head -n 1 "$CURL_DIR/report.id1")" = done ] && grep -q "^✓ calm-clock" "$CURL_DIR/report.id1" && [ "$(ref "$O" calm-clock)" = "$(ref "$W" calm-clock)" ]'
check "merge: done, on origin" '[ "$(head -n 1 "$CURL_DIR/report.id2")" = done ] && grep -q "in main gemergt" "$CURL_DIR/report.id2" && [ "$(ref "$O" main)" = "$(ref "$W" other-b)" ]'
check "branch: done, checked out" '[ "$(head -n 1 "$CURL_DIR/report.id3")" = done ] && [ "$(git -C "$W" symbolic-ref --short HEAD)" = rescue ]'
check "fetch: done with the overview" '[ "$(head -n 1 "$CURL_DIR/report.id4")" = done ] && grep -q "^sx · Fetch ok" "$CURL_DIR/report.id4"'
check "one log line per action, in the order queued, without the token" '[ "$(grep -n -- "-> " "$ALOG" | cut -d" " -f3- | tr "\n" "|")" = "push sx calm-clock -> done|merge sx other-b -> done|branch sx rescue -> done|fetch sx  -> done|" ] && ! grep -q Agent0123456789 "$ALOG"'
check "one fetch round logged at start" '[ "$(grep -c " Fetch: 1 ok$" "$ALOG")" -eq 1 ]'
(cd "$D" && "$SCRIPT" agent </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "second agent: non-zero, says so, the first keeps running" '[ "$(rc)" -ne 0 ] && out | grep -q "läuft schon ein Agent" && kill -0 "$APID"'
(cd "$D" && "$SCRIPT" agent status </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "status with an agent: 0, fetch and dashboard shown" '[ "$(rc)" -eq 0 ] && out | grep -q "Agent:     läuft (PID $APID)" && out | grep -q "Fetch:     vor 0 min" && out | grep -q "Dashboard: erreichbar"'
agent_stop
check "stopped: says so, lock gone" 'grep -q "Agent beendet" "$ALOG" && [ ! -e "$D/.crb-agent.lock" ]'

echo "Agent: refuses what it does not know, without running Git"
D="$WORK/t-a2"; mkdir -p "$D/plain"; cp "$BASE/compose.yaml" "$BASE/box.yaml" "$D/"; service "$D" sx ../plain
echo 'CRB_AGENT_TOKEN=Agent0123456789Agent0123456789Agent01' >"$D/.env"
CURL_DIR="$D/curl"; mkdir -p "$CURL_DIR"
job 1 200 'id1\tpush\tnope\tmain\t-\t0'
job 2 200 'id2\tdelete\tsx\tmain\t-\t0'
job 3 200 "id3\tbranch\tsx\t-\tx; touch $D/pwned\t0"
job 4 200 'id4\tpush\t../plain\tmain\t-\t0'
job 5 200 'bad id\tpush\tsx\tmain\t-\t0'
job 6 200 'id6\tpush\tcrb-dashboard\tmain\t-\t0'
agent_start "$D"
check "all reported" 'agent_wait "[ -f \"$CURL_DIR/report.id6\" ]" 200'
agent_stop
check "unknown project refused, named" '[ "$(head -n 1 "$CURL_DIR/report.id1")" = refused ] && grep -q "Unbekanntes Projekt: nope" "$CURL_DIR/report.id1"'
check "unknown kind refused" '[ "$(head -n 1 "$CURL_DIR/report.id2")" = refused ] && grep -q "Unbekannte Aktion: delete" "$CURL_DIR/report.id2"'
check "hostile name refused, nothing executed" '[ "$(head -n 1 "$CURL_DIR/report.id3")" = refused ] && [ ! -e "$D/pwned" ]'
check "path as a project and the dashboard as a project refused" '[ "$(head -n 1 "$CURL_DIR/report.id4")" = refused ] && [ "$(head -n 1 "$CURL_DIR/report.id6")" = refused ]'
check "action without a usable id dropped" 'grep -q "ohne gültige Kennung" "$ALOG" && [ "$(ls "$CURL_DIR" | grep -c "^report\.")" -eq 5 ]'
check "no Git command ran" '[ ! -s "$WORK/git.log" ]'

echo "Agent: finishes the running action when it is stopped"
D="$WORK/t-a3"; sfx "$D"; sbranch calm-clock g.txt 1
echo 'CRB_AGENT_TOKEN=Agent0123456789Agent0123456789Agent01' >"$D/.env"
printf '#!/bin/sh\nsleep 2\nexit 0\n' >"$O/hooks/pre-receive"; chmod +x "$O/hooks/pre-receive"
CURL_DIR="$D/curl"; mkdir -p "$CURL_DIR"
job 1 200 'id1\tpush\tsx\tcalm-clock\t-\t0'
agent_start "$D"
agent_wait 'grep -q "push.*calm-clock" "$WORK/git.log"' 100; sleep 0.3
agent_stop
check "push finished and reported, then the agent ended" '[ "$(ref "$O" calm-clock)" = "$(ref "$W" calm-clock)" ] && [ "$(head -n 1 "$CURL_DIR/report.id1")" = done ] && grep -q "Agent beendet" "$ALOG"'

echo "Agent: dashboard not reachable, token rejected"
D="$WORK/t-a4"; sfx "$D"
echo 'CRB_AGENT_TOKEN=Agent0123456789Agent0123456789Agent01' >"$D/.env"
CURL_DIR="$D/curl"; mkdir -p "$CURL_DIR"
for i in 1 2 3 4 5 6 7 8 9 10; do job "$i" 000; done
job 11 204; job 12 401; job 13 401; job 14 401; job 15 204
AFETCH=1 agent_start "$D"
check "reaches the end of the script" 'agent_wait "[ \"\$(cat \"$CURL_DIR/count\")\" -ge 16 ]" 300'
agent_wait '[ "$(grep -c " Fetch: 1 ok$" "$ALOG")" -ge 2 ]' 50
agent_stop
check "one line per change of state, not per attempt" '[ "$(grep -c "Dashboard nicht erreichbar" "$ALOG")" -eq 1 ] && [ "$(grep -c "Dashboard erreichbar" "$ALOG")" -eq 2 ] && [ "$(grep -c "lehnt das Token ab" "$ALOG")" -eq 1 ]'
check "keeps fetching meanwhile" '[ "$(grep -c " Fetch: 1 ok$" "$ALOG")" -ge 2 ]'
D="$WORK/t-a5"; sfx "$D"; git -C "$W" remote set-url origin "ssh://git@127.0.0.1:1/none.git"
echo 'CRB_AGENT_TOKEN=Agent0123456789Agent0123456789Agent01' >"$D/.env"
agent_start "$D"
check "a failed fetch is logged with the project and the agent keeps running" 'agent_wait "grep -q \"Fetch: 0 ok, 1 fehlgeschlagen\" \"$ALOG\"" 300 && grep -q "Fetch sx fehlgeschlagen: " "$ALOG" && kill -0 "$APID"'
agent_stop

echo "Agent: picks up a new script"
D="$WORK/t-a6"; sfx "$D"; sbranch calm-clock g.txt 1
echo 'CRB_AGENT_TOKEN=Agent0123456789Agent0123456789Agent01' >"$D/.env"
mkdir -p "$WORK/abin"; cp "$SCRIPT" "$WORK/abin/crb"; chmod 755 "$WORK/abin/crb"
agent_start "$D" "$WORK/abin/crb"
agent_wait 'grep -q "Agent gestartet" "$ALOG"' 100
sed 's/Agent gestartet:/Agent neu gestartet:/' "$SCRIPT" >"$WORK/abin/crb.new"; chmod 755 "$WORK/abin/crb.new"; mv "$WORK/abin/crb.new" "$WORK/abin/crb"
check "continues as the new script, same process, lock held" 'agent_wait "grep -q \"Agent neu gestartet\" \"$ALOG\"" 100 && kill -0 "$APID" && [ "$(cat "$D/.crb-agent.lock/pid")" = "$APID" ]'
job "$(( $(cat "$CURL_DIR/count" 2>/dev/null || echo 0) + 2 ))" 200 'id1\tpush\tsx\tcalm-clock\t-\t0'
check "and still carries out actions" 'agent_wait "[ -f \"$CURL_DIR/report.id1\" ]" 100 && [ "$(head -n 1 "$CURL_DIR/report.id1")" = done ]'
agent_stop

echo "Agent: token and service installation"
check "a new dashboard service passes the agent token, empty by default" 'grep -qF "CRB_AGENT_TOKEN: \"\${CRB_AGENT_TOKEN:-}\"" "$WORK/dash.new"'
SSTUB="$WORK/sstub"; mkdir -p "$SSTUB"
cat >"$SSTUB/systemctl" <<'STUB'
#!/bin/sh
echo "systemctl $*" >>"$SYS_LOG"
case "$*" in
  "--user show-environment") [ -z "${NO_USER_MANAGER-}" ] || exit 1 ;;
  "--user is-active"*) echo active ;;
esac
exit 0
STUB
printf '#!/bin/sh\necho "loginctl $*" >>"$SYS_LOG"\necho "${LINGER:-no}"\n' >"$SSTUB/loginctl"
chmod +x "$SSTUB/systemctl" "$SSTUB/loginctl"
UNIT="$HOME/.config/systemd/user/crb-agent.service"
# agentcmd DIR ANSWERS ARG: runs `crb agent ARG` with the service manager and docker stubbed.
agentcmd() {
  local dir=$1 answers=$2
  : >"$WORK/docker.log"; : >"$WORK/sys.log"
  printf 'running\n' >"$WORK/answers/ps"
  (cd "$dir" && printf '%b' "$answers" | DOCKER_LOG="$WORK/docker.log" STUB_DIR="$WORK/answers" SYS_LOG="$WORK/sys.log" PATH="$SSTUB:$LSTUB:$PATH" "$SCRIPT" agent "$3") >"$WORK/out" 2>&1
  echo $? >"$WORK/rc"
}
D="$WORK/t-agent"; cp -R "$WORK/t-dash" "$D"; DF="$D/services/crb-dashboard.yaml"; cp "$WORK/dash.new" "$DF"
sed -i.bak "/CRB_AGENT_TOKEN:/d" "$DF"; rm -f "$DF.bak"; cp "$DF" "$WORK/dash.noagent"; cp "$D/.env" "$WORK/env.before"
agentcmd "$D" '\n' install
check "declined: .env, service file and services as before" '[ "$(rc)" -eq 0 ] && out | grep -q "Nichts geändert" && cmp -s "$D/.env" "$WORK/env.before" && cmp -s "$DF" "$WORK/dash.noagent" && [ ! -e "$UNIT" ] && ! grep -q "enable\|restart" "$WORK/sys.log"'
check "plan lists token, service file, restart and unit" 'out | grep -q "CRB_AGENT_TOKEN wird erzeugt" && out | grep -q "services/crb-dashboard.yaml: CRB_AGENT_TOKEN" && out | grep -q "Dashboard wird neu gestartet" && out | grep -q "Dienst: $UNIT"'
agentcmd "$D" 'y\n' install
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "token created: 32+ characters, not the status token" '[ "$(sed -n "s/^CRB_AGENT_TOKEN=//p" "$D/.env" | wc -c)" -gt 32 ] && [ "$(sed -n "s/^CRB_AGENT_TOKEN=//p" "$D/.env")" != "$(sed -n "s/^CRB_STATUS_TOKEN=//p" "$D/.env")" ]'
check "service file: the line added, every other line as before" 'cmp -s "$DF" "$WORK/dash.new"'
check "token reaches the dashboard and no box" '[ "$( (cd "$D" && docker compose config) | grep -c "CRB_AGENT_TOKEN")" -eq 1 ] && (cd "$D" && docker compose config crb-dashboard) | grep -q "CRB_AGENT_TOKEN: $(sed -n "s/^CRB_AGENT_TOKEN=//p" "$D/.env")"'
check "dashboard recreated, unit written and started" 'dlog | grep -q "compose up -d crb-dashboard" && grep -q "^WorkingDirectory=$D$" "$UNIT" && grep -q "^ExecStart=$D/crb agent$" "$UNIT" && grep -q "^Restart=always$" "$UNIT" && grep -q "systemctl --user enable crb-agent.service" "$WORK/sys.log" && grep -q "systemctl --user restart crb-agent.service" "$WORK/sys.log"'
check "lingering off: the command is printed, not run" 'out | grep -q "sudo loginctl enable-linger $(id -un)" && ! grep -q "enable-linger" "$WORK/sys.log"'
agentcmd "$D" 'y\n' install
check "second run: nothing to create, dashboard not recreated" '[ "$(rc)" -eq 0 ] && ! out | grep -q "wird erzeugt" && ! dlog | grep -q "compose up"'
D2="$WORK/t-agent2"; cp -R "$WORK/t-dash" "$D2"; cp "$D2/.env" "$WORK/env2.before"
agentcmd "$D2" 'y\n' install
check "second installation: nothing changed, the other directory named" '[ "$(rc)" -ne 0 ] && out | grep -q "$D" && cmp -s "$D2/.env" "$WORK/env2.before" && grep -q "^WorkingDirectory=$D$" "$UNIT"'
agentcmd "$D" '' uninstall
check "uninstall: unit gone, stopped, token stays" '[ "$(rc)" -eq 0 ] && [ ! -e "$UNIT" ] && grep -q "systemctl --user disable --now crb-agent.service" "$WORK/sys.log" && grep -q "^CRB_AGENT_TOKEN=" "$D/.env" && cmp -s "$DF" "$WORK/dash.new"'
agentcmd "$D" '' status
check "status after uninstall: non-zero" '[ "$(rc)" -ne 0 ] && out | grep -q "Dienst:    nicht installiert"'
sed -e "1s/.*/# My own dashboard service./" "$WORK/dash.noagent" >"$D2/services/crb-dashboard.yaml"; cp "$D2/services/crb-dashboard.yaml" "$WORK/dash.own2"
agentcmd "$D2" 'y\n' install
# shellcheck disable=SC2016
check "hand-written service file: unchanged, line shown, token created" '[ "$(rc)" -eq 0 ] && cmp -s "$D2/services/crb-dashboard.yaml" "$WORK/dash.own2" && out | grep -qF "CRB_AGENT_TOKEN: \"\${CRB_AGENT_TOKEN:-}\"" && grep -q "^CRB_AGENT_TOKEN=" "$D2/.env"'
rm -f "$UNIT"; D3="$WORK/t-agent3"; cp -R "$WORK/t-dash" "$D3"
(cd "$D3" && printf 'y\n' | NO_USER_MANAGER=1 DOCKER_LOG="$WORK/docker.log" STUB_DIR="$WORK/answers" SYS_LOG="$WORK/sys.log" PATH="$SSTUB:$LSTUB:$PATH" "$SCRIPT" agent install) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "no user service manager: token steps done, says that no service was installed" '[ "$(rc)" -eq 0 ] && grep -q "^CRB_AGENT_TOKEN=" "$D3/.env" && out | grep -q "Kein Dienst installiert" && out | grep -q "./crb agent$" && [ ! -e "$UNIT" ]'

echo "Update: reconciles the agent variable"
D="$WORK/t-dash"; DF="$D/services/crb-dashboard.yaml"; cp "$WORK/dash.noagent" "$DF"
# agent variable n; d1: mode (default, keep)
update "$D" 'n\n\n'
check "declined: file unchanged" '[ "$(rc)" -eq 0 ] && cmp -s "$DF" "$WORK/dash.noagent" && out | grep -q "./crb agent install"'
# agent variable yes (default); d1: mode; apply y; recreate n
update "$D" '\n\ny\nn\n'
check "exit 0" '[ "$(rc)" -eq 0 ] || { out; false; }'
check "the line is added, every other line as before" 'cmp -s "$DF" "$WORK/dash.new"'
check "config shows it, dashboard listed for recreate, agent install named, no token created" '(cd "$D" && docker compose config crb-dashboard) | grep -q "CRB_AGENT_TOKEN:" && out | grep -q "Später: docker compose up -d crb-dashboard" && out | grep -q "./crb agent install" && ! grep -q "^CRB_AGENT_TOKEN=" "$D/.env"'
update "$D" '\n'
check "already present: no question, file unchanged" '[ "$(rc)" -eq 0 ] && ! out | grep -q "CRB_AGENT_TOKEN" && cmp -s "$DF" "$WORK/dash.new"'
sed -e "1s/.*/# My own dashboard service./" "$WORK/dash.noagent" >"$DF"; cp "$DF" "$WORK/dash.own3"
update "$D" '\n'
# shellcheck disable=SC2016
check "not created by crb: byte-identical, line printed" '[ "$(rc)" -eq 0 ] && cmp -s "$DF" "$WORK/dash.own3" && out | grep -qF "CRB_AGENT_TOKEN: \"\${CRB_AGENT_TOKEN:-}\"" && ! out | grep -q "CRB_AGENT_TOKEN in "'
cp "$WORK/dash.new" "$DF"

echo "Git: refuses root"
(cd "$BASE" && PATH="$FAKE/root-only:$PATH" "$SCRIPT" git </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "root refused" '[ "$(rc)" -ne 0 ] && out | grep -q "nicht als root"'

echo ""
if [ "$fails" -eq 0 ]; then echo "All tests passed."; else echo "$fails test(s) failed."; exit 1; fi
