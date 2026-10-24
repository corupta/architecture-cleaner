#!/bin/bash
# G3, persistent variant: the strongest fair version of the generic-agent baseline.
# Same fixed prompt as run-opencode.sh. Whenever opencode stops, an automated check runs the repo's typecheck
# and unit tests; if either fails, a fixed auto-reply (no human input) carries pass/fail plus the output tail
# and the session continues. Stops on green checks, the 90-minute wall cap, the gateway budget cap, or 25 turns.
#   spike/g3/run-persistent.sh <target> <checkout-dir> <workdir-inside-checkout> <node-version|system> <base-sha>
set -u
target=$1 checkout=$2 workdir=$3 node_version=$4 base=$5
run_id="g3u-$target-persistent"
out="$HOME/ac-work/g3u/$target-persistent"
wall_cap_seconds=$((90 * 60))
max_turns=25
mkdir -p "$out/xdg"/{config,data,state,cache}
prompt="Restructure this repository from technical-type folders (controllers/services/repositories…) into a feature-oriented Clean Architecture layout. Do not change behavior. Make sure the type check and the tests pass."
cat > "$out/xdg/config/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": { "nebius": { "options": { "baseURL": "http://127.0.0.1:8787/run/$run_id/v1", "apiKey": "metered-by-gateway" } } },
  "model": "nebius/nvidia/Nemotron-3-Ultra-550b-a55b",
  "small_model": "nebius/nvidia/Nemotron-3-Ultra-550b-a55b",
  "permission": { "edit": "allow", "bash": "allow", "webfetch": "deny", "external_directory": "deny" },
  "autoupdate": false,
  "share": "disabled"
}
JSON
export XDG_CONFIG_HOME="$out/xdg/config" XDG_DATA_HOME="$out/xdg/data" XDG_STATE_HOME="$out/xdg/state" XDG_CACHE_HOME="$out/xdg/cache"
export OPENCODE_CONFIG="$out/xdg/config/opencode.json" NEBIUS_API_KEY=metered-by-gateway HUSKY=0
. /home/paseo/ac-work/s9/g3u/repo/spike/g2/env.sh "$node_version"
unset CI
cd "$checkout" && git checkout -q -B g3/opencode-ultra-persistent "$base" && git clean -fdq && cd "$checkout/$workdir" || exit 1

run_checks() {
  local log=$1
  case $target in
    immich)
      (cd "$checkout/server" && timeout 600 ./node_modules/.bin/tsc --noEmit --incremental false) > "$log.tsc" 2>&1; tsc_status=$?
      (cd "$checkout/server" && timeout 900 ./node_modules/.bin/vitest --config test/vitest.config.mjs --run) > "$log.test" 2>&1; test_status=$? ;;
    mcphub)
      (cd "$checkout" && timeout 600 corepack pnpm backend:build) > "$log.tsc" 2>&1; tsc_status=$?
      (cd "$checkout" && timeout 900 node_modules/.bin/jest --ci --watchAll=false) > "$log.test" 2>&1; test_status=$? ;;
  esac
}

budget_exhausted() {
  local status refused
  status=$(curl -s 127.0.0.1:8787/status)
  refused=$(jq -s --arg r "$run_id" --arg since "$started_iso" '[.[] | select(.runId == $r and .refused == true and .ts >= $since)] | length' /home/paseo/ac-work/s9/g3u/repo/spike/llm/ledger.jsonl)
  [ "$(echo "$status" | jq --arg r "$run_id" '(.runs[$r].spent + .runs[$r].reserved) >= (.runs[$r].cap * 0.98)')" = true ] || [ "$refused" -gt 0 ]
}

echo "$prompt" > "$out/prompt.txt"
start=$(date +%s)
started_iso=$(date -u +%FT%T.000Z)
echo "{\"target\":\"$target\",\"variant\":\"persistent\",\"checkout\":\"$checkout\",\"branch\":\"g3/opencode-ultra-persistent\",\"workdir\":\"$workdir\",\"node\":\"$(node -v)\",\"opencode\":\"$(opencode --version < /dev/null)\",\"startedAt\":\"$started_iso\",\"base\":\"$base\"}" > "$out/run-meta.json"
message=$prompt
continue_flag=()
outcome=max-turns
for turn in $(seq 1 $max_turns); do
  remaining=$((wall_cap_seconds - ($(date +%s) - start)))
  if [ "$remaining" -le 30 ]; then outcome=wall-cap; break; fi
  if budget_exhausted; then outcome=budget-cap; break; fi
  echo "$message" > "$out/message-$turn.txt"
  timeout --signal=INT --kill-after=30 "$remaining" opencode run --pure --auto --format json "${continue_flag[@]}" \
    --model nebius/nvidia/Nemotron-3-Ultra-550b-a55b "$message" < /dev/null > "$out/events-$turn.jsonl" 2> "$out/stderr-$turn.log" &
  agent_pid=$!
  while kill -0 "$agent_pid" 2>/dev/null; do
    if budget_exhausted; then
      echo "turn $turn: budget cap, stopping agent" >> "$out/watchdog.log"
      kill -INT "$agent_pid"; sleep 20; kill -KILL "$agent_pid" 2>/dev/null
    fi
    sleep 10
  done
  wait "$agent_pid"; agent_status=$?
  continue_flag=(--continue)
  if budget_exhausted; then outcome=budget-cap; break; fi
  if [ $(( $(date +%s) - start )) -ge "$wall_cap_seconds" ]; then outcome=wall-cap; break; fi
  run_checks "$out/check-$turn"
  echo "{\"turn\":$turn,\"agentExit\":$agent_status,\"tsc\":$tsc_status,\"tests\":$test_status,\"elapsedSeconds\":$(( $(date +%s) - start ))}" >> "$out/turns.jsonl"
  if [ "$tsc_status" -eq 0 ] && [ "$test_status" -eq 0 ]; then outcome=checks-green; break; fi
  verdict() { [ "$1" -eq 0 ] && echo PASS || echo FAIL; }
  tail_text=$( (tail -c 1500 "$out/check-$turn.tsc"; echo; tail -c 1500 "$out/check-$turn.test") | tr -d '\000')
  message="Automated check (no human is available to answer questions): the task is not complete yet. Type check: $(verdict $tsc_status). Unit tests: $(verdict $test_status). Output tail:
\`\`\`
$tail_text
\`\`\`
Continue the restructuring yourself without asking questions, and make sure the type check and the tests pass."
done
end=$(date +%s)
jq --arg outcome "$outcome" --argjson seconds "$((end - start))" --argjson turns "$turn" '. + {outcome: $outcome, wallSeconds: $seconds, turns: $turns, finishedAt: (now | todate)}' "$out/run-meta.json" > "$out/run-meta.tmp" && mv "$out/run-meta.tmp" "$out/run-meta.json"
session=$(opencode session list --format json < /dev/null 2>/dev/null | jq -r '.[0].id // empty')
[ -n "$session" ] && opencode export "$session" < /dev/null > "$out/session-export.json" 2> /dev/null
cd "$checkout" && git add -A && git commit -q -m "G3 persistent end state ($outcome after $turn turns, opencode + Nemotron 3 Ultra, automated replies only)" && echo "committed $(git rev-parse --short HEAD)"
echo "done: $outcome after $turn turns, $((end - start))s; transcript $out"
