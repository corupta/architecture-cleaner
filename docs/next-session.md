# Next session: gates (G1–G3)

Opening prompt for the gate session. Paste it as the first message.

```
Gate session for architecture-cleaner: run the Token Factory probes, G2, G1 and G3, then write the decision memo.

Read CLAUDE.md, then docs/plan.md in full (§6 gates, §5 budget, §3 architecture, §2.6 repos). docs/research/ holds the raw research (pinned SHAs, hazards, Token Factory facts, prior art). Consult it; don't re-research.

Mode: execution, high autonomy. corupta is needed only for the Token Factory key and the Oct 6 decision. Work on branch spike/gates and commit freely there. Merge only docs/gates.md, docs/feedback-log.md and any plan corrections into main.

Preconditions
- .env must contain NEBIUS_API_KEY. If it doesn't, do G2 first and ask corupta for the key before any LLM call.
- Clone targets into ~/ac-targets/, outside this tree, at the pinned SHAs. Fetch full SHAs via ls-remote or a full clone.
- Install target-specific Node versions project-locally (e.g. a Node 24 tarball under ~/ac-targets/.node/). Never install anything globally.
- Every LLM call goes through a minimal recording gateway with a hard budget ledger (cost from usage × the pinned price table, refusal before a cap would be crossed). Caps are in plan §5. No live endpoints.

Order
0. Token Factory probes (≤$0.25).
   - GET /v1/models?verbose=true: IDs, per-model rate limits, supported features.
   - On Super, Ultra and Lightning: enable_thinking on/off, low_effort/medium_effort, reasoning_effort, where the reasoning text lands, usage fields.
   - response_format json_schema vs a forced strict tool call.
   - Write docs/gates/tf-probes.md and append defects to docs/feedback-log.md.
1. G2 repo health (no LLM).
   - Repos (SHAs in docs/research/03a, 03b, 03c):
     - immich server/ (primary: Node 24, build @immich/plugin-sdk and @immich/sdk first, unit vitest config only)
     - Dokploy (backup)
     - mcphub (backup, Jest)
     - openhab-cloud (checker bring-up)
     - hoppscotch backend, kaneo apps/api, ghostfolio apps/api, mikro-orm realworld (benchmark)
   - For each: install, tsc, unit suite twice, offline check, timings, pass/fail per file.
   - Also check: the immich OpenAPI oracle (nest build + sync-open-api) offline, and whether the immich 2024 real-world recovery benchmark is feasible (6e93ddf2 type-sliced vs 40262c30 domain/<feature>/ ground truth).
2. G1 boundary spike (≤$3), exactly as plan §6: virtual scramble, the four deterministic baselines, planner v0 on Super (+1 Ultra sample), MoJoFM/ARI/c2c on feature files and hard files, then a one-page immich plan summary for corupta to rate 1–5.
3. G3 generic-agent baseline (≤$8): opencode on Token Factory (Super) behind a metering proxy with a hard cap, fixed prompt from plan §6, on immich ($5) and mcphub ($3). Measure everything listed in §6. Keep the branches and transcripts outside this tree, with paths recorded.
4. Write docs/gates.md: a one-page memo readable in 10 minutes.
   - per-gate verdict with numbers;
   - build/pivot/stop recommendation;
   - demo-repo recommendation;
   - plan corrections, also applied to docs/plan.md.
   - End with the opening prompt for session S3 (scaffold + analyzer + executor).

Log weird-but-not-blocking observations with /log-anomaly.
```
