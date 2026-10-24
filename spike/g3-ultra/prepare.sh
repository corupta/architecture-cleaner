#!/bin/bash
# Fresh G3 checkout: depth-1 fetch of the pinned SHA (no history, so no 2024 answer key), no remote, installed
# with the G2 recipe, on branch g3/opencode-ultra. HUSKY=0 keeps repo hooks out of the agent's commits.
set -euo pipefail
target=$1 url=$2 sha=$3 node_version=$4
dir=$HOME/ac-targets/g3u/$target
rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"
git init -q && git remote add origin "$url" && git fetch -q --depth 1 origin "$sha" && git checkout -q -b g3/opencode-ultra FETCH_HEAD && git remote remove origin
git config user.name "opencode (G3 baseline)" && git config user.email g3@ac.invalid
. /home/paseo/ac-work/s9/g3u/repo/spike/g2/env.sh "$node_version"
export HUSKY=0
case $target in
  immich)
    corepack pnpm install --filter immich --frozen-lockfile > "$dir/../$target-install.log" 2>&1
    corepack pnpm --filter @immich/sdk --filter @immich/plugin-sdk --filter @immich/plugin-core install --frozen-lockfile >> "$dir/../$target-install.log" 2>&1
    corepack pnpm --filter @immich/sdk --filter @immich/plugin-sdk build >> "$dir/../$target-install.log" 2>&1 ;;
  mcphub)
    corepack pnpm install --frozen-lockfile > "$dir/../$target-install.log" 2>&1 ;;
esac
echo "$target ready at $(git rev-parse HEAD) on $(git branch --show-current); status: $(git status --porcelain | wc -l) changes"
