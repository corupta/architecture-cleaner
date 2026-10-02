#!/bin/bash
# Re-run only the OpenAPI oracle on an immich G3 ref (the full measure-oracles.sh had an output-dir bug).
set -u
ref=$1 out=$2
checkout=$HOME/ac-targets/g3/immich
worktree="$checkout/../.openapi-$(git -C "$checkout" rev-parse --short "$ref")"
rm -rf "$worktree"; git -C "$checkout" worktree add -f --detach "$worktree" "$ref" > /dev/null 2>&1
for d in node_modules server/node_modules packages/plugin-sdk/node_modules packages/plugin-sdk/dist packages/sdk/node_modules packages/sdk/build; do [ -e "$checkout/$d" ] && [ ! -e "$worktree/$d" ] && mkdir -p "$(dirname "$worktree/$d")" && ln -s "$checkout/$d" "$worktree/$d"; done
rm -rf "$out/openapi"; mkdir -p "$out/openapi/server" "$out/openapi/open-api"
(
  . /workspace/architecture-cleaner/spike/g2/env.sh 24.21.0
  ac_offline "$out/net-openapi.jsonl"
  cd "$worktree/server" && rm -rf dist && timeout 900 ./node_modules/.bin/nest build > "$out/nest-build.log" 2>&1; echo "build_exit=$?" > "$out/openapi.env"
  ls dist/bin/sync-open-api.js > /dev/null 2>&1 && echo "dist_emitted=yes" >> "$out/openapi.env" || echo "dist_emitted=no" >> "$out/openapi.env"
  cd "$out/openapi/server" && timeout 300 node "$worktree/server/dist/bin/sync-open-api.js" > "$out/openapi.log" 2>&1; echo "sync_exit=$?" >> "$out/openapi.env"
)
git -C "$checkout" show "$(git -C "$checkout" rev-list --max-parents=0 "$ref" | tail -1):open-api/immich-openapi-specs.json" > "$out/openapi/base-spec.json"
if [ -f "$out/openapi/open-api/immich-openapi-specs.json" ]; then
  cmp -s "$out/openapi/open-api/immich-openapi-specs.json" "$out/openapi/base-spec.json" && echo "spec=identical" >> "$out/openapi.env" || { echo "spec=different" >> "$out/openapi.env"; diff <(jq -S . "$out/openapi/base-spec.json") <(jq -S . "$out/openapi/open-api/immich-openapi-specs.json") | head -40 > "$out/openapi.diff"; }
else echo "spec=missing" >> "$out/openapi.env"; fi
git -C "$checkout" worktree remove --force "$worktree" > /dev/null 2>&1
cat "$out/openapi.env" | tr '\n' ' '; echo
