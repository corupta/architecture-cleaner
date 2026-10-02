#!/bin/bash
# G3 oracle measurement of an end state, offline, in a throwaway worktree (the checkout itself may be busy).
#   spike/g3/measure-oracles.sh <target> <checkout> <ref> <out-dir>
# Writes tsc.log, tests.json (+ tests.log), openapi.txt (immich), summary.json to <out-dir>.
set -u
target=$1 checkout=$2 ref=$3 out=$4
g2=/workspace/architecture-cleaner/spike/g2
mkdir -p "$out"
worktree="$checkout/../.oracle-$target-$(git -C "$checkout" rev-parse --short "$ref")"
rm -rf "$worktree"
git -C "$checkout" worktree add -f --detach "$worktree" "$ref" > /dev/null 2>&1 || { echo "worktree failed"; exit 1; }
link() { [ -e "$checkout/$1" ] && [ ! -e "$worktree/$1" ] && mkdir -p "$(dirname "$worktree/$1")" && ln -s "$checkout/$1" "$worktree/$1"; }
case $target in
  immich)
    node_version=24.21.0
    link node_modules; link server/node_modules; link packages/plugin-sdk/node_modules; link packages/plugin-sdk/dist; link packages/sdk/node_modules; link packages/sdk/build ;;
  mcphub)
    node_version=system
    link node_modules; link frontend/node_modules ;;
esac
(
  . "$g2/env.sh" "$node_version"
  ac_offline "$out/net.jsonl"
  case $target in
    immich)
      cd "$worktree/server"
      start=$(date +%s); timeout 900 ./node_modules/.bin/tsc --noEmit --incremental false > "$out/tsc.log" 2>&1; echo "tsc_exit=$? tsc_seconds=$(( $(date +%s) - start ))" > "$out/status.env"
      start=$(date +%s); "$g2/with-test-slot.sh" timeout 1200 ./node_modules/.bin/vitest --config test/vitest.config.mjs --run --reporter=json --outputFile.json="$out/tests.json" > "$out/tests.log" 2>&1
      echo "tests_exit=$? tests_seconds=$(( $(date +%s) - start ))" >> "$out/status.env"
      rm -rf dist; start=$(date +%s); timeout 900 ./node_modules/.bin/nest build > "$out/nest-build.log" 2>&1; build=$?
      mkdir -p "$out/openapi/server" && cd "$out/openapi/server" && timeout 300 node "$worktree/server/dist/bin/sync-open-api.js" > "$out/openapi.log" 2>&1; sync=$?
      # The G3 clones are depth-1, so the root commit is the pinned base.
      git -C "$checkout" show "$(git -C "$checkout" rev-list --max-parents=0 "$ref" | tail -1):open-api/immich-openapi-specs.json" > "$out/openapi/base-spec.json"
      same=missing
      [ -f "$out/openapi/open-api/immich-openapi-specs.json" ] && { cmp -s "$out/openapi/open-api/immich-openapi-specs.json" "$out/openapi/base-spec.json" && same=identical || same=different; }
      echo "openapi_build_exit=$build openapi_sync_exit=$sync openapi_vs_base=$same openapi_seconds=$(( $(date +%s) - start ))" >> "$out/status.env" ;;
    mcphub)
      cd "$worktree"
      start=$(date +%s); timeout 900 ./node_modules/.bin/tsc > "$out/tsc.log" 2>&1; echo "tsc_exit=$? tsc_seconds=$(( $(date +%s) - start ))" > "$out/status.env"
      start=$(date +%s); "$g2/with-test-slot.sh" timeout 1200 ./node_modules/.bin/jest --ci --watchAll=false --json --outputFile="$out/tests.json" > "$out/tests.log" 2>&1
      echo "tests_exit=$? tests_seconds=$(( $(date +%s) - start ))" >> "$out/status.env" ;;
  esac
)
git -C "$checkout" worktree remove --force "$worktree" > /dev/null 2>&1
. "$out/status.env"
node -e '
const fs = require("fs");
const [out, env] = process.argv.slice(1);
const status = Object.fromEntries(fs.readFileSync(env, "utf8").trim().split(/\s+/).map((pair) => pair.split("=")));
let tests = null;
try {
  const report = JSON.parse(fs.readFileSync(out + "/tests.json", "utf8"));
  const files = report.testResults.map((file) => ({ file: file.name, status: file.status, cases: file.assertionResults.length, passed: file.assertionResults.filter((c) => c.status === "passed").length, failed: file.assertionResults.filter((c) => c.status === "failed").length }));
  tests = { files: files.length, filesPassed: files.filter((f) => f.status === "passed").length, filesFailed: files.filter((f) => f.status === "failed").length, cases: report.numTotalTests, casesPassed: report.numPassedTests, casesFailed: report.numFailedTests, perFile: files };
} catch (error) { tests = { error: String(error).slice(0, 200) }; }
const tscErrors = (fs.readFileSync(out + "/tsc.log", "utf8").match(/error TS\d+/g) ?? []).length;
fs.writeFileSync(out + "/summary.json", JSON.stringify({ ...status, tscErrors, tests }, null, 1));
console.log(JSON.stringify({ ...status, tscErrors, tests: tests && { files: tests.files, filesPassed: tests.filesPassed, cases: tests.cases, casesPassed: tests.casesPassed, casesFailed: tests.casesFailed, error: tests.error } }));
' "$out" "$out/status.env"
