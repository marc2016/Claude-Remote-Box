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
  (cd "$dir" && printf '%b' "$answers" | "$SCRIPT" dashboard) >"$WORK/out" 2>&1
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
check "token in .env, service file, include" 'grep -qE "^CRB_STATUS_TOKEN=[A-Za-z0-9]{32}$" "$D/.env" && [ -f "$D/services/crb-dashboard.yaml" ] && grep -q "services/crb-dashboard.yaml" "$D/compose.yaml"'
TOKEN=$(sed -n "s/^CRB_STATUS_TOKEN=//p" "$D/.env")
check "boxes wired with URL and token" '(cd "$D" && docker compose config d1) | grep -q "CRB_STATUS_URL: http://crb-dashboard:8080/api/ingest" && (cd "$D" && docker compose config d2) | grep -q "CRB_STATUS_TOKEN: $TOKEN" && (cd "$D" && docker compose config d1) | grep -q "CRB_EXTRA_ARGS\|CRB_NAME: d1"'
CFG=$(cd "$D" && docker compose config crb-dashboard)
check "dashboard: loopback port, one mount, hardened, config valid" 'echo "$CFG" | grep -q "host_ip: 127.0.0.1" && echo "$CFG" | grep -q "published: \"8080\"" && [ "$(echo "$CFG" | grep -c "target: /")" -eq 1 ] && echo "$CFG" | grep -q "target: /data" && echo "$CFG" | grep -q -- "- ALL" && (cd "$D" && docker compose config -q)'
check "CRB_DASHBOARD_BIND honored" '(cd "$D" && CRB_DASHBOARD_BIND=0.0.0.0:9000 docker compose config crb-dashboard) | grep -q "published: \"9000\""'
before=$(snapshot "$D")
dashboard "$D" ''
check "second run: already present, nothing changed" '[ "$(rc)" -eq 0 ] && out | grep -q "schon vorhanden" && [ "$(snapshot "$D")" = "$before" ]'

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
git clone -q "$REPO" "$HOME/tilde-ws"; service "$D" tilde '~/tilde-ws'
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

echo "Git: refuses root"
(cd "$BASE" && PATH="$FAKE/root-only:$PATH" "$SCRIPT" git </dev/null) >"$WORK/out" 2>&1; echo $? >"$WORK/rc"
check "root refused" '[ "$(rc)" -ne 0 ] && out | grep -q "nicht als root"'

echo ""
if [ "$fails" -eq 0 ]; then echo "All tests passed."; else echo "$fails test(s) failed."; exit 1; fi
