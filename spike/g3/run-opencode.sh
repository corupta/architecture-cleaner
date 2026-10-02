#!/bin/bash
# G3 generic-agent baseline (plan §6): opencode on Token Factory (Super) through the budget gateway.
#   spike/g3/run-opencode.sh <target> <checkout-dir> <workdir-inside-checkout> <node-version|system>
# Isolated XDG dirs (no user config/plugins), --pure, 90-min wall cap, and a watchdog that kills the
# agent when the gateway run is within 2% of its cap or starts refusing calls.
set -u
target=$1 checkout=$2 workdir=$3 node_version=$4
run_id="g3-$target"
out="$HOME/ac-work/g3/$target"
mkdir -p "$out/xdg"/{config,data,state,cache}
prompt="Restructure this repository from technical-type folders (controllers/services/repositories…) into a feature-oriented Clean Architecture layout. Do not change behavior. Make sure the type check and the tests pass."
cat > "$out/xdg/config/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": { "nebius": { "options": { "baseURL": "http://127.0.0.1:8787/run/$run_id/v1", "apiKey": "metered-by-gateway" } } },
  "model": "nebius/nvidia/nemotron-3-super-120b-a12b",
  "small_model": "nebius/nvidia/nemotron-3-super-120b-a12b",
  "permission": { "edit": "allow", "bash": "allow", "webfetch": "deny", "external_directory": "deny" },
  "autoupdate": false,
  "share": "disabled"
}
JSON
export XDG_CONFIG_HOME="$out/xdg/config" XDG_DATA_HOME="$out/xdg/data" XDG_STATE_HOME="$out/xdg/state" XDG_CACHE_HOME="$out/xdg/cache"
export OPENCODE_CONFIG="$out/xdg/config/opencode.json" NEBIUS_API_KEY=metered-by-gateway
. /workspace/architecture-cleaner/spike/g2/env.sh "$node_version"
unset CI
cd "$checkout/$workdir" || exit 1
echo "$prompt" > "$out/prompt.txt"
start=$(date +%s)
echo "{\"target\":\"$target\",\"checkout\":\"$checkout\",\"workdir\":\"$workdir\",\"node\":\"$(node -v)\",\"opencode\":\"$(opencode --version)\",\"startedAt\":\"$(date -u +%FT%TZ)\",\"headBefore\":\"$(git -C "$checkout" rev-parse HEAD)\"}" > "$out/run-meta.json"
timeout --signal=INT --kill-after=60 90m opencode run --pure --auto --format json --model nebius/nvidia/nemotron-3-super-120b-a12b "$prompt" < /dev/null > "$out/events.jsonl" 2> "$out/stderr.log" &
agent_pid=$!
(
  while kill -0 "$agent_pid" 2>/dev/null; do
    status=$(curl -s 127.0.0.1:8787/status)
    over=$(echo "$status" | jq --arg r "$run_id" '(.runs[$r].spent + .runs[$r].reserved) >= (.runs[$r].cap * 0.98)')
    refused=$(jq -s --arg r "$run_id" '[.[] | select(.runId == $r and .refused == true)] | length' /workspace/architecture-cleaner/spike/llm/ledger.jsonl)
    if [ "$over" = true ] || [ "$refused" -gt 0 ]; then
      echo "watchdog: cap reached (over=$over refused=$refused), stopping agent" >> "$out/watchdog.log"
      pkill -INT -P "$agent_pid"; kill -INT "$agent_pid"; sleep 30; pkill -KILL -P "$agent_pid"; kill -KILL "$agent_pid"
      break
    fi
    sleep 10
  done
) &
watchdog_pid=$!
wait "$agent_pid"
exit_code=$?
kill "$watchdog_pid" 2>/dev/null
end=$(date +%s)
jq --argjson exit "$exit_code" --argjson seconds "$((end - start))" '. + {exitCode: $exit, wallSeconds: $seconds, finishedAt: (now | todate)}' "$out/run-meta.json" > "$out/run-meta.tmp" && mv "$out/run-meta.tmp" "$out/run-meta.json"
session=$(opencode session list --format json < /dev/null 2>/dev/null | jq -r '.[0].id // empty')
[ -n "$session" ] && opencode export "$session" < /dev/null > "$out/session-export.json" 2> /dev/null
echo "done: exit $exit_code after $((end - start))s; transcript $out"
