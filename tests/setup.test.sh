#!/usr/bin/env bash
# shellcheck disable=SC2016  # checks are single-quoted on purpose and run through eval
# Tests for the entrypoint phases, setup, and the healthcheck. Builds the image
# and a variant with a fake `claude` (tests/fake/claude), then runs containers.
# Needs Docker; takes about three minutes (the healthcheck needs ~90 s).
# Usage: tests/setup.test.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
S=$(mktemp -d)
IMG=crb-test:fake
docker build -q -t crb-test:base "$ROOT" >/dev/null || exit 1
printf 'FROM crb-test:base\nUSER root\nCOPY claude /usr/local/bin/claude\nRUN chmod 755 /usr/local/bin/claude\nUSER node\n' |
  docker build -q -t "$IMG" -f - "$ROOT/tests/fake" >/dev/null || exit 1
fails=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fails=$((fails+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }
vols=() ctrs=()
# Containers and volumes are found by name prefix: helpers run in subshells.
cleanup(){
  docker ps -aq --filter name=crbc- | xargs -r docker rm -f >/dev/null 2>&1
  docker volume ls -q --filter name=crbv- | xargs -r docker volume rm >/dev/null 2>&1
  docker network rm crbt-net >/dev/null 2>&1
}
cleanup
trap 'cleanup; rm -rf "$S"' EXIT
# newvol NAME [owner]: fresh named volume for the config dir.
newvol(){ local v="crbv-$1"; docker volume rm -f "$v" >/dev/null 2>&1; docker volume create "$v" >/dev/null; vols+=("$v");
  docker run --rm -u 0 -v "$v:/c" --entrypoint sh $IMG -c "touch /c/.keep; chown ${2:-1000:1000} /c; chmod ${3:-700} /c" ; echo "$v"; }
# put VOL FILE CONTENT
put(){ docker run --rm -u 0 -v "$1:/c" --entrypoint sh $IMG -c "printf '%s' '$3' > /c/$2; chown 1000:1000 /c/$2"; }
has(){ docker run --rm -u 0 -v "$1:/c" --entrypoint test $IMG -e "/c/$2"; }
TRUST='{"projects":{"/workspace":{"hasTrustDialogAccepted":true}}}'
# start NAME VOL [env...]: background server container
start(){ local n="crbc-$1" v=$2; shift 2; docker rm -f "$n" >/dev/null 2>&1; ctrs+=("$n");
  docker run -d --name "$n" -u 1000:1000 -e CRB_NAME=demo -e CRB_SPAWN=same-dir "$@" -v "$v:/home/node/.claude" $IMG >/dev/null; echo "$n"; }
logs(){ docker logs "$1" 2>&1; }
statef(){ docker exec "$1" cat /tmp/crb-state 2>/dev/null; }
waitfor(){ local n=$1 pat=$2 t=${3:-15}; for _ in $(seq $((t*2))); do logs "$n" | grep -q "$pat" && return 0; sleep 0.5; done; return 1; }
stoptime(){ local s e; s=$(date +%s); docker stop -t 20 "$1" >/dev/null; e=$(date +%s); echo $((e-s)); }

echo "1.1 trust check"
for c in "true:$TRUST:0" "false:{\"projects\":{\"/workspace\":{\"hasTrustDialogAccepted\":false}}}:1" "missing:{\"projects\":{}}:1"; do
  name=${c%%:*}; rest=${c#*:}; want=${rest##*:}; json=${rest%:*}
  v=$(newvol "t-$name"); put "$v" .claude.json "$json"
  docker run --rm -u 1000 -v "$v:/home/node/.claude" --entrypoint sh $IMG -c '. /usr/local/lib/crb/common.sh; crb_trusted'; got=$?
  check "trust $name -> $want" '[ "$got" -eq "$want" ]'
done
v=$(newvol t-nofile)
docker run --rm -u 1000 -v "$v:/home/node/.claude" --entrypoint sh $IMG -c '. /usr/local/lib/crb/common.sh; crb_trusted'; got=$?
check "trust file missing -> 1" '[ "$got" -eq 1 ]'

echo "2.1 waiting-config"
v=$(newvol cfg 0:0 755)
n=$(start cfg "$v")
check "logs owner and chown hint" 'waitfor "$n" "owner 0:0, container runs as 1000:1000" && logs "$n" | grep -q "sudo chown -R 1000:1000"'
check "keeps running, state waiting-config" '[ "$(docker inspect -f "{{.State.Running}} {{.RestartCount}}" "$n")" = "true 0" ] && [ "$(statef "$n")" = waiting-config ]'
docker run --rm -u 0 -v "$v:/c" --entrypoint chown $IMG 1000:1000 /c
check "continues after chown" 'waitfor "$n" "config directory is writable now" 15 && [ "$(statef "$n")" = waiting-setup ]'
check "stop in waiting-setup < 5s" '[ "$(stoptime "$n")" -lt 5 ]'
v=$(newvol cfg2 0:0 755); n=$(start cfg2 "$v"); waitfor "$n" "cannot write" >/dev/null
check "stop in waiting-config < 5s" '[ "$(stoptime "$n")" -lt 5 ]'

echo "2.2 waiting-setup"
v=$(newvol ws); n=$(start ws "$v")
check "empty config waits with hint" 'waitfor "$n" "waiting for setup" && sleep 6 && [ "$(docker inspect -f "{{.State.Running}} {{.RestartCount}}" "$n")" = "true 0" ] && ! logs "$n" | grep -q Connected'
put "$v" .credentials.json '{}'; put "$v" .claude.json "$TRUST"
sleep 7
check "login+trust while waiting does not start" '! logs "$n" | grep -q Connected && [ "$(statef "$n")" = waiting-setup ]'
put "$v" .crb-setup-done ''
check "marker starts server within 10s" 'waitfor "$n" "Connected" 10 && [ "$(statef "$n")" = running ]'
check "prefix is CRB_NAME" 'logs "$n" | grep -q "prefix=demo"'
check "stop in running < 5s" '[ "$(stoptime "$n")" -lt 5 ]'
v=$(newvol legacy); put "$v" .credentials.json '{}'; put "$v" .claude.json "$TRUST"; n=$(start legacy "$v")
check "legacy login+trust starts directly" 'waitfor "$n" "Connected" 10 && logs "$n" | grep -q "existing setup found" && ! logs "$n" | grep -q "waiting for setup"'
check "legacy writes marker" 'has "$v" .crb-setup-done'

echo "2.3/2.4 restarting"
v=$(newvol rs); put "$v" .credentials.json '{}'; put "$v" .crb-setup-done ''; put "$v" .fake-rc-exit 3
n=$(start rs "$v" -e CRB_RESTART_DELAY=30)
check "failure message points to setup" 'waitfor "$n" "server exited with status 3, restarting in 30s" && logs "$n" | grep -q "run setup again: docker compose exec -it <service> setup"'
check "state restarting" '[ "$(statef "$n")" = restarting ]'
check "stop in restarting < 5s" '[ "$(stoptime "$n")" -lt 5 ]'

echo "3.1 setup"
runsetup(){ docker run --rm -u 1000:1000 -e CRB_NAME=demo -e CRB_SPAWN=same-dir -v "$1:/home/node/.claude" $IMG setup >"$S/out" 2>&1; echo $?; }
v=$(newvol s-fresh); put "$v" .fake-rc-exit 0; rc=$(runsetup "$v")
check "fresh: all three steps, marker, exit 0" '[ "$rc" -eq 0 ] && grep -q "1/3 Login with" "$S/out" && grep -q "^==> 2/3 Workspace trust$" "$S/out" && grep -q "3/3 Enable" "$S/out" && has "$v" .crb-setup-done'
check "fresh: banner shown" 'grep -q "████████████████" "$S/out"'
v=$(newvol s-done); put "$v" .fake-rc-exit 0; put "$v" .credentials.json '{}'; put "$v" .claude.json "$TRUST"; rc=$(runsetup "$v")
check "login+trust: only step 3" '[ "$rc" -eq 0 ] && grep -q "Login: already logged in, skipped" "$S/out" && grep -q "trust: already accepted, skipped" "$S/out" && ! grep -q "fake-claude auth" "$S/out" && has "$v" .crb-setup-done'
v=$(newvol s-lfail); put "$v" .fake-login-fail ''; rc=$(runsetup "$v")
check "login fails: non-zero, no marker" '[ "$rc" -ne 0 ] && ! has "$v" .crb-setup-done'
v=$(newvol s-tfail); put "$v" .fake-no-trust ''; rc=$(runsetup "$v")
check "trust unset: non-zero, no marker" '[ "$rc" -ne 0 ] && grep -q "trust was not accepted" "$S/out" && ! has "$v" .crb-setup-done'

echo "3.2 Ctrl-C ends only step 3 (SIGINT via a pty from script(1))"
v=$(newvol s-int); put "$v" .credentials.json '{}'; put "$v" .claude.json "$TRUST"
docker run --rm -i -u 1000:1000 -e CRB_NAME=demo -e CRB_SPAWN=same-dir -v "$v:/home/node/.claude" --entrypoint sh $IMG -c \
  '(sleep 4; printf "\003"; sleep 4) | script -qec "exec setup" /dev/null; echo "rc=$?"' >"$S/out" 2>&1
check "run: Connected, then setup completes with rc 0" 'grep -q Connected "$S/out" && grep -q "Setup complete" "$S/out" && grep -q "rc=0" "$S/out" && has "$v" .crb-setup-done'
v=$(newvol s-int2); n=$(start int2 "$v"); waitfor "$n" "waiting for setup" >/dev/null
put "$v" .credentials.json '{}'; put "$v" .claude.json "$TRUST"
docker exec -i "$n" sh -c '(sleep 4; printf "\003"; sleep 4) | script -qec "exec setup" /dev/null; echo "rc=$?"' >"$S/out" 2>&1
check "exec: setup completes with rc 0" 'grep -q Connected "$S/out" && grep -q "rc=0" "$S/out" && grep -q "starts within a few seconds" "$S/out"'
check "exec: waiting server starts afterwards" 'waitfor "$n" "starting Remote Control" 15'

echo "4.1 healthcheck"
check "healthcheck set" 'docker inspect -f "{{json .Config.Healthcheck.Test}}" $IMG | grep -q "crb-state"'
vw=$(newvol h-wait); nw=$(start hwait "$vw")
vr=$(newvol h-run); put "$vr" .credentials.json '{}'; put "$vr" .crb-setup-done ''; nr=$(start hrun "$vr")
sleep 100
check "waiting -> unhealthy" '[ "$(docker inspect -f "{{.State.Health.Status}}" "$nw")" = unhealthy ]'
check "running -> healthy" '[ "$(docker inspect -f "{{.State.Health.Status}}" "$nr")" = healthy ]'

echo "5. status reporting"
docker network create crbt-net >/dev/null
docker run -d --name crbc-recv --network crbt-net -u 1000:1000 -v "$ROOT/tests/receiver.js:/r.js:ro" --entrypoint node $IMG /r.js 8080 - tok >/dev/null
recv(){ docker logs crbc-recv 2>/dev/null; }
revents(){ recv | node -e 'const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean);for(const x of l){for(const e of JSON.parse(x).events)console.log(JSON.stringify(e))}' 2>/dev/null; }
rwait(){ local pat=$1 t=${2:-15}; for _ in $(seq $((t*2))); do revents | grep -q "$pat" && return 0; sleep 0.5; done; return 1; }
procs(){ docker exec "$1" sh -c 'for p in /proc/[0-9]*; do printf "%s " "$(basename "$p")"; tr "\0" " " < "$p/cmdline" 2>/dev/null; echo; done'; }
STATUS=(--network crbt-net -e CRB_STATUS_URL=http://crbc-recv:8080/api/ingest -e CRB_STATUS_TOKEN=tok)
v=$(newvol st); n=$(start st "$v" "${STATUS[@]}")
check "waiting-setup reported with token and box name" 'rwait "\"type\":\"phase\",\"phase\":\"waiting-setup\"" 15 && recv | grep -q "Bearer tok" && revents | grep -q "\"box\":\"demo\""'
check "two heartbeats within 70s" 'for _ in $(seq 70); do [ "$(revents | grep -c "\"type\":\"heartbeat\"")" -ge 2 ] && break; sleep 1; done; [ "$(revents | grep -c "\"type\":\"heartbeat\"")" -ge 2 ] && revents | grep "\"type\":\"heartbeat\"" | head -1 | grep -q "\"phase\":\"waiting-setup\""'
put "$v" .credentials.json '{}'; put "$v" .crb-setup-done ''
check "running reported, server started" 'rwait "\"phase\":\"running\"" 15 && waitfor "$n" "Connected" 10'
check "watcher and server are running" 'procs "$n" | grep -q "crb-watch.js" && procs "$n" | grep -q "remote-control"'
check "session events from the transcript" 'rwait "\"type\":\"reply\"" 30 && revents | grep -q "\"type\":\"session_start\"" && revents | grep -q "\"text\":\"Zeig mir die Startseite\"" && revents | grep -q "\"tool\":\"Bash\",\"summary\":\"npm test\"" && revents | grep -q "\"type\":\"tool_result\"" && revents | grep "\"type\":\"summary\"" | tail -1 | grep -q "\"model\":\"claude-fake\",\"tokens_in\":15"'
check "heartbeat in running phase names spawn mode" 'for _ in $(seq 40); do revents | grep "\"type\":\"heartbeat\"" | grep -q "\"phase\":\"running\"" && break; sleep 1; done; revents | grep "\"type\":\"heartbeat\"" | grep "\"phase\":\"running\"" | grep -q "\"spawn\":\"same-dir\""'
server_pid=$(procs "$n" | grep "remote-control" | head -1 | cut -d" " -f1)
docker exec "$n" sh -c 'for p in /proc/[0-9]*; do [ "$(basename "$p")" = "$$" ] && continue; grep -q crb-watch.js "$p/cmdline" 2>/dev/null && kill "$(basename "$p")"; done' >/dev/null 2>&1
sleep 8
check "watcher restarted, server kept its pid" 'procs "$n" | grep -q "crb-watch.js" && logs "$n" | grep -q "status watcher exited, restarting" && [ "$(procs "$n" | grep "remote-control" | head -1 | cut -d" " -f1)" = "$server_pid" ]'
check "stop with watcher < 5s" '[ "$(stoptime "$n")" -lt 5 ]'
v=$(newvol st2); put "$v" .credentials.json '{}'; put "$v" .crb-setup-done ''; n=$(start st2 "$v"); waitfor "$n" "Connected" 10 >/dev/null
check "no watcher and no status log without URL" '! procs "$n" | grep -q "crb-watch" && ! logs "$n" | grep -qi "status"'

echo ""
[ "$fails" -eq 0 ] && echo "All checks passed." || { echo "$fails check(s) failed."; exit 1; }
