#!/usr/bin/env bash
# shellcheck disable=SC2016  # checks are single-quoted on purpose and run through eval
# Tests for crb-watch.js: parsing (dry run), sender with spool and backoff,
# waiting heuristic, backfill, git state. Needs only node and git; no Docker.
# Usage: tests/watch.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WATCH="$ROOT/crb-watch.js"
RECV="$ROOT/tests/receiver.js"
WORK=$(mktemp -d)
PORT=$((20000 + RANDOM % 10000))
OUT="$WORK/received.jsonl"
pids=()
cleanup() { for p in "${pids[@]+"${pids[@]}"}"; do { kill "$p" && wait "$p"; } 2>/dev/null; done; rm -rf "$WORK"; }
trap cleanup EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
# events: all received events as one JSON line each, in order
events() { node -e 'const fs=require("fs");for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)){for(const e of JSON.parse(l).events)console.log(JSON.stringify(e))}' "$OUT" 2>/dev/null; }
types() { events | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.split("\n").filter(Boolean).map(l=>JSON.parse(l).type).join(" ")))'; }
waitfor() { local pat=$1 t=${2:-10}; for _ in $(seq $((t * 4))); do events | grep -q "$pat" && return 0; sleep 0.25; done; return 1; }

echo "Dry run against the fixture"
DRY=$(node "$WATCH" --dry-run "$ROOT/tests/fixtures/transcript.jsonl")
check "event order" '[ "$(echo "$DRY" | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(s.split(\"\\n\").filter(Boolean).map(l=>JSON.parse(l).type).join(\" \")))")" = "session_start prompt tool summary tool_result reply summary tool summary" ]'
check "session start fields" 'echo "$DRY" | head -1 | grep -q "\"cwd\":\"/workspace\"" && echo "$DRY" | head -1 | grep -q "\"branch\":\"main\"" && echo "$DRY" | head -1 | grep -q "\"claude_version\":\"2.1.316\"" && echo "$DRY" | head -1 | grep -q "\"permission_mode\":\"default\""'
check "tool summaries" 'echo "$DRY" | grep -q "\"tool\":\"Bash\",\"summary\":\"npx playwright screenshot http://localhost:3000 start.png\"" && echo "$DRY" | grep -q "\"tool\":\"Edit\",\"summary\":\"/workspace/src/nav.css\""'
LAST=$(echo "$DRY" | grep '"type":"summary"' | tail -1)
check "summary totals" 'echo "$LAST" | grep -q "\"model\":\"claude-opus-5-5\"" && echo "$LAST" | grep -q "\"tokens_in\":47" && echo "$LAST" | grep -q "\"tokens_out\":180" && echo "$LAST" | grep -q "\"cache_read\":61100" && echo "$LAST" | grep -q "\"cache_write\":600" && echo "$LAST" | grep -q "\"context\":20705" && echo "$LAST" | grep -q "\"turns\":3" && echo "$LAST" | grep -q "\"tool_calls\":2"'
check "cost and lines from cost-state" 'echo "$LAST" | grep -q "\"cost_usd\":0.42" && echo "$LAST" | grep -q "\"lines_added\":12" && echo "$LAST" | grep -q "\"lines_removed\":3"'
FIRST=$(echo "$DRY" | grep '"type":"summary"' | head -1)
check "no cost before cost-state" '! echo "$FIRST" | grep -q cost_usd'
check "bad line skipped, box and seq present" 'echo "$DRY" | head -1 | grep -q "\"box\":" && echo "$DRY" | head -1 | grep -q "\"seq\":1"'
printf '{"type":"assistant","sessionId":"s2","timestamp":"2026-11-06T12:00:00Z","message":{"role":"assistant","model":"m","content":[{"type":"text","text":"%s"}],"usage":{"input_tokens":1,"output_tokens":1}}}\n' "$(head -c 5000 /dev/zero | tr '\0' x)" >"$WORK/long.jsonl"
check "long reply truncated" '[ "$(node "$WATCH" --dry-run "$WORK/long.jsonl" | grep "\"type\":\"reply\"" | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(JSON.parse(s).text.length))")" -eq $((4000 + 13)) ]'

echo "Git event"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com GIT_CONFIG_GLOBAL=/dev/null
G="$WORK/git"; GW="$G/ws"; mkdir -p "$G" "$WORK/plain"
git init -q -b main "$G/seed"; echo one >"$G/seed/f.txt"; git -C "$G/seed" add f.txt; git -C "$G/seed" commit -q -m init
git clone -q --bare "$G/seed" "$G/origin.git"; git clone -q "$G/origin.git" "$GW"; git clone -q "$G/origin.git" "$G/other"
for b in feat merged; do git -C "$GW" branch -q "$b"; git -C "$GW" push -q -u origin "$b" >/dev/null 2>&1; done
git -C "$GW" worktree add -q "$GW/.wt/x" feat
git -C "$GW" worktree add -q "$GW/.wt/gone" merged
git -C "$GW" worktree add -q -b fresh "$GW/.wt/new"
git -C "$GW/.wt/x" commit -q --allow-empty -m "First"
echo two >>"$GW/.wt/x/f.txt"; git -C "$GW/.wt/x" commit -q -a -m "Add nav"
echo three >>"$GW/.wt/x/f.txt"
git -C "$GW/.wt/new" commit -q --allow-empty -m "Fresh work"
# gitf BRANCH FIELD: one field of a checkout in the event $GEV; fetched_at is per event.
gitf() { node -e 'const e=JSON.parse(process.argv[1]);const w=e.worktrees.find((x)=>x.branch===process.argv[2])||{};console.log(JSON.stringify(process.argv[3]==="fetched_at"?e.fetched_at:w[process.argv[3]]))' "$GEV" "$1" "$2"; }
GEV=$(node "$WATCH" --git "$GW")
check "all checkouts listed, workspace first" '[ "$(node -e "console.log(JSON.parse(process.argv[1]).worktrees.map((w)=>w.branch).join(\" \"))" "$GEV")" = "main merged fresh feat" ] && [ "$(gitf main path)" = "\"$(cd "$GW" && pwd -P)\"" ]'
check "worktree with commits: ahead, dirty, lines, subject" '[ "$(gitf feat ahead)" = 2 ] && [ "$(gitf feat dirty)" = 1 ] && [ "$(gitf feat added)" = 1 ] && [ "$(gitf feat subject)" = "\"Add nav\"" ] && gitf feat committed | grep -q "^\"20"'
check "unpushed commits against the upstream" '[ "$(gitf feat remote)" = "\"ok\"" ] && [ "$(gitf feat upstream)" = "\"origin/feat\"" ] && [ "$(gitf feat unpushed)" = 2 ] && [ "$(gitf feat behind)" = 0 ]'
check "branch not on origin: none and nulls" '[ "$(gitf fresh remote)" = "\"none\"" ] && [ "$(gitf fresh upstream)" = null ] && [ "$(gitf fresh unpushed)" = null ] && [ "$(gitf fresh behind)" = null ] && [ "$(gitf fresh ahead)" = 1 ]'
check "never fetched" '[ "$(gitf main fetched_at)" = null ] && [ "$(gitf main behind)" = 0 ]'
# The host fetches; the box only reads what that left behind.
for i in 1 2 3; do git -C "$G/other" commit -q --allow-empty -m "remote $i"; done
git -C "$G/other" push -q origin main; git -C "$G/other" push -q origin --delete merged
git -C "$GW" fetch -q --prune origin
GEV=$(node "$WATCH" --git "$GW")
check "after a host fetch: behind and fetch time" '[ "$(gitf main behind)" = 3 ] && [ "$(gitf main unpushed)" = 0 ] && gitf main fetched_at | grep -q "^\"20"'
check "distance to the default branch: stale branch 3, default_branch main" '[ "$(gitf feat behind_default)" = 3 ] && [ "$(gitf fresh behind_default)" = 3 ] && [ "$(node -e "console.log(JSON.parse(process.argv[1]).default_branch)" "$GEV")" = main ]'
git -C "$GW/.wt/new" merge -q --no-edit origin/main >/dev/null 2>&1
check "up to date with the default branch: 0" '[ "$(node "$WATCH" --git "$GW" | node -e "let s=\"\";process.stdin.on(\"data\",(d)=>s+=d).on(\"end\",()=>console.log(JSON.parse(s).worktrees.find((w)=>w.branch===\"fresh\").behind_default))")" = 0 ]'
check "upstream deleted on origin: gone" '[ "$(gitf merged remote)" = "\"gone\"" ] && [ "$(gitf merged unpushed)" = null ]'
git -C "$GW" branch -q --unset-upstream feat
GEV=$(node "$WATCH" --git "$GW")
check "no upstream configured: origin/<branch> is the counterpart" '[ "$(gitf feat remote)" = "\"ok\"" ] && [ "$(gitf feat upstream)" = "\"origin/feat\"" ] && [ "$(gitf feat unpushed)" = 2 ]'
mv "$G/origin.git" "$G/origin.away"
before=$(git -C "$GW" for-each-ref; git -C "$GW" status --porcelain)
check "works without the remote, same numbers" '[ "$(node "$WATCH" --git "$GW")" = "$GEV" ]'
check "read-only" '[ "$(git -C "$GW" for-each-ref; git -C "$GW" status --porcelain)" = "$before" ]'
git init -q -b main "$G/lonely"; git -C "$G/lonely" commit -q --allow-empty -m init
check "no origin: behind_default and default_branch are null" '[ "$(node "$WATCH" --git "$G/lonely" | node -e "let s=\"\";process.stdin.on(\"data\",(d)=>s+=d).on(\"end\",()=>console.log(((e)=>e.worktrees[0].behind_default+\"_\"+e.default_branch)(JSON.parse(s))))")" = "null_null" ]'
check "plain directory: no git event" '[ -z "$(node "$WATCH" --git "$WORK/plain")" ]'
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

echo "Emit and heartbeat through the receiver"
node "$RECV" "$PORT" "$OUT" secret 2>/dev/null & pids+=($!)
sleep 0.5
CFG="$WORK/cfg"; mkdir -p "$CFG/projects/-workspace"
export CRB_STATUS_URL="http://127.0.0.1:$PORT/api/ingest" CRB_STATUS_TOKEN=secret CRB_NAME=testbox CLAUDE_CONFIG_DIR="$CFG" CRB_STATE="$WORK/state" CRB_SPOOL="$WORK/spool.jsonl" CRB_EMIT_SEQ="$WORK/emit-seq" CRB_IMAGE_VERSION=test
echo waiting-setup >"$WORK/state"
node "$WATCH" --emit type=phase phase=waiting-setup
check "phase event with token and emit run suffix" 'events | grep -q "\"type\":\"phase\",\"phase\":\"waiting-setup\"" && grep -q "\"authorization\":\"Bearer secret\"" "$OUT" && events | grep -q "\"box\":\"testbox\"" && events | grep -qE "\"run\":\"[0-9a-f]{8}\\.e\"" && [ -f "$CFG/.crb-watch.json" ]'
node "$WATCH" --emit type=heartbeat
check "heartbeat carries phase and image" 'events | grep "\"type\":\"heartbeat\"" | grep -q "\"phase\":\"waiting-setup\"" && events | grep "\"type\":\"heartbeat\"" | grep -q "\"image\":\"test\""'
: >"$OUT"
CRB_STATUS_URL= node "$WATCH" --emit type=phase phase=x
check "no URL: nothing sent" '[ ! -s "$OUT" ]'

echo "Hook mode"
: >"$OUT"
printf '{"session_id":"hs","hook_event_name":"Notification","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash"}' | CRB_HOOK_LOG="$WORK/hook.log" node "$WATCH" --hook
check "permission prompt -> waiting from hook, logged" 'events | grep "\"type\":\"waiting\"" | grep -q "\"source\":\"hook\"" && events | grep -q "\"session\":\"hs\"" && grep -q permission_prompt "$WORK/hook.log"'
: >"$OUT"
printf '{"session_id":"hs","hook_event_name":"Notification","notification_type":"idle_prompt","message":"waiting for input"}' | CRB_HOOK_LOG="$WORK/hook.log" node "$WATCH" --hook
check "other notification -> logged only" '[ ! -s "$OUT" ] && grep -q idle_prompt "$WORK/hook.log"'

echo "Daemon: live events, waiting heuristic, spool"
T="$CFG/projects/-workspace/live.jsonl"
: >"$OUT"; rm -f "$WORK/spool.jsonl"
export CRB_WORKSPACE="$GW"
node "$WATCH" 2>"$WORK/watch.log" & pids+=($!)
sleep 1
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
printf '{"type":"user","sessionId":"live","cwd":"/workspace","timestamp":"%s","message":{"role":"user","content":"hallo"}}\n' "$(now)" >>"$T"
printf '{"type":"assistant","sessionId":"live","timestamp":"%s","message":{"role":"assistant","model":"m","content":[{"type":"tool_use","id":"c1","name":"Bash","input":{"command":"sleep 30"}}],"usage":{"input_tokens":1,"output_tokens":1}}}\n' "$(now)" >>"$T"
check "git event next to the heartbeat" 'waitfor "\"type\":\"git\"" 10 && events | grep "\"type\":\"git\"" | grep -q "\"branch\":\"feat\"" && events | grep "\"type\":\"git\"" | grep -q "\"fetched_at\":\"20"'
check "prompt and tool arrive, with run id" 'waitfor "\"type\":\"tool\"" 10 && events | grep -q "\"type\":\"prompt\"" && events | grep -q "\"text\":\"hallo\"" && events | grep "\"type\":\"prompt\"" | grep -qE "\"run\":\"[0-9a-f]{8}\""'
check "waiting after ~10s" 'waitfor "\"type\":\"waiting\"" 15 && events | grep "\"type\":\"waiting\"" | grep -q "\"summary\":\"sleep 30\""'
printf '{"type":"user","sessionId":"live","timestamp":"%s","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"c1","content":"done"}]}}\n' "$(now)" >>"$T"
check "resumed after result" 'waitfor "\"type\":\"resumed\"" 10 && events | grep -q "\"type\":\"tool_result\",\"session\":\"live\",\"call_id\":\"c1\",\"ok\":true"'
# Endpoint down: 20 events must arrive in order afterwards.
touch "$OUT.pause"
for i in $(seq 1 20); do
  printf '{"type":"user","sessionId":"live","timestamp":"%s","message":{"role":"user","content":"msg %02d"}}\n' "$(now)" "$i" >>"$T"
done
sleep 8
check "spooled while down" '[ -s "$WORK/spool.jsonl" ] && ! events | grep -q "msg 20"'
rm -f "$OUT.pause"
check "delivered in order after recovery" 'waitfor "msg 20" 70 && [ "$(events | grep -o "msg [0-9][0-9]" | tr "\n" " ")" = "$(seq -f "msg %02g" 1 20 | tr "\n" " ")" ]'
check "spool cleared" '[ ! -s "$WORK/spool.jsonl" ]'
kill "${pids[1]}" 2>/dev/null; sleep 0.5

echo "Spool bound and heartbeats not spooled"
: >"$OUT"; rm -f "$WORK/spool.jsonl"
node "$WATCH" 2>"$WORK/watch2.log" & pids+=($!)
sleep 1
touch "$OUT.pause"
for i in $(seq 1 700); do
  printf '{"type":"user","sessionId":"live","timestamp":"%s","message":{"role":"user","content":"bulk %03d"}}\n' "$(now)" "$i"
done >>"$T"
sleep 12
check "bounded to 500, newest kept, loss logged once" '[ "$(grep -c . "$WORK/spool.jsonl")" -eq 500 ] && grep -q "bulk 700" "$WORK/spool.jsonl" && ! grep -q "bulk 001" "$WORK/spool.jsonl" && [ "$(grep -c "spool full" "$WORK/watch2.log")" -eq 1 ]'
check "no heartbeat and no git state in spool" '! grep -q heartbeat "$WORK/spool.jsonl" && ! grep -q "\"type\":\"git\"" "$WORK/spool.jsonl"'
kill "${pids[2]}" 2>/dev/null; sleep 0.5
rm -f "$OUT.pause" "$WORK/spool.jsonl"

echo "Restart: resumes from saved state, unknown transcript gives a summary only"
: >"$OUT"; rm -f "$WORK/spool.jsonl"
RUN1=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).run)' "$CFG/.crb-watch.json")
OLD="$CFG/projects/-workspace/old.jsonl"
printf '{"type":"user","sessionId":"old","timestamp":"2020-01-01T00:00:00Z","message":{"role":"user","content":"alt"}}\n{"type":"assistant","sessionId":"old","timestamp":"2020-01-01T00:00:05Z","message":{"role":"assistant","model":"m","content":[{"type":"text","text":"antwort"}],"usage":{"input_tokens":3,"output_tokens":4}}}\n' >"$OLD"
node "$WATCH" 2>>"$WORK/watch.log" & pids+=($!)
check "old: summary with backfill, no prompt" 'waitfor "\"backfill\":true" 10 && ! events | grep -q "\"text\":\"alt\"" && events | grep "\"session\":\"old\"" | grep -q "\"turns\":1"'
printf '{"type":"user","sessionId":"live","timestamp":"%s","message":{"role":"user","content":"nach dem neustart"}}\n' "$(now)" >>"$T"
check "known file resumed: new line arrives, old lines not re-sent, same run, seq continues" 'waitfor "nach dem neustart" 10 && ! events | grep -q "msg 20" && events | grep "nach dem neustart" | grep -q "\"run\":\"$RUN1\"" && [ "$(events | grep "nach dem neustart" | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(JSON.parse(s).seq))")" -gt 700 ]'
kill "${pids[3]}" 2>/dev/null; sleep 0.5

echo "Fresh state: new run id, existing transcripts summarized only"
: >"$OUT"; rm -f "$CFG/.crb-watch.json"
export CRB_WORKSPACE="$WORK/plain"
node "$WATCH" 2>>"$WORK/watch.log" & pids+=($!)
check "summaries only, new run" 'waitfor "\"session\":\"live\"" 10 && ! events | grep -q "\"text\":" && events | grep "\"session\":\"live\"" | grep -q "\"backfill\":true" && ! events | grep -q "\"run\":\"$RUN1\""'
check "workspace is not a repository: heartbeat without a git event" 'waitfor "\"type\":\"heartbeat\"" 10 && ! events | grep -q "\"type\":\"git\""'
kill "${pids[4]}" 2>/dev/null

echo ""
if [ "$fails" -eq 0 ]; then echo "All tests passed."; else echo "$fails test(s) failed."; exit 1; fi
