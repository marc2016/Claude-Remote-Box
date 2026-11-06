#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2034  # checks are single-quoted on purpose and run through eval, so their variables look unused
# Tests for crb (add and update). Needs git and Docker Compose 2.20+ (only
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

echo ""
if [ "$fails" -eq 0 ]; then echo "All tests passed."; else echo "$fails test(s) failed."; exit 1; fi
