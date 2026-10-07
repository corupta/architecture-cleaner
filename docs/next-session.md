# Next session: S6 (orchestrator R0–R4, findings log, boundary rules, end to end on immich)

Opening prompt for S6, from [sessions/s5.md](sessions/s5.md). Paste it as the first message.

```
Session S6 for architecture-cleaner: the orchestrator (R0–R4), the findings log, boundary rules, and the whole ladder end to end on immich.

Read CLAUDE.md, docs/sessions/s5.md, docs/sessions/s4.md (item 10, carry-overs), docs/plan.md §2.3–2.5, §3.2, §3.4 and §3.5, docs/plans/immich/plan.md and docs/storyboard.md. Use docs/plans/immich/plan.yaml as committed, unedited: the demo runs unattended (corupta, 2026-10-07). Mode: execution, high autonomy, branch s6/orchestrator from main; merge when the exit criteria hold. LLM calls only through src/gateway, under a new budget run s6 (add it to budget/runs.json, cap $3); the plan replays from cassettes/s5-immich.jsonl unless it has to change.

Build:
1. src/orchestrator/, `ac run <repo> --profile <name>`:
   - R0 preflight and baseline: inventory, tsc, tests ×2 with flaky quarantine, the §2.5 declines.
   - Then plan.yaml → steps (`ac steps`). For each step: `ac move`, commit, `ac certify` (static checks; --oracles at the end of each rung), and the certificate trailers on the commit.
   - On FAIL: roll back and replan the step at most twice (pin the offending files and log a finding), else pin and log.
   - Rungs: R1 is the module steps; R2 is the platform and shared/ steps `ac plan` already emits; R3 is filename normalization with its observability guard (§2.3); R4 is boundary rules.
2. src/findings/: the findings log, recorded and never fixed:
   - deterministic findings: module cycles, back-edges, multi-writer tables, BaseService's god injection, K4's findings, the validator's plan warnings;
   - Lightning narration, text only;
   - rendered for the PR body and the report.
3. R4: a dependency-cruiser config with
   - a module DAG allow-list from the plan's quotient graph;
   - barrel-less public files;
   - shared is a leaf;
   - platform ↛ modules;
   - controller ↛ persistence;
   - folder-scope cycles.
   Today's violations are frozen with --baseline. An anti-vacuity check proves each rule fires on a synthetic violation in a scratch copy.
4. End to end on immich server/ @ 02063972e8: the whole ladder on a branch in ~/ac-targets/immich, every commit certified, with the run's timeline and cost.
5. S4 carry-overs (s4.md item 10):
   - executor: the config-reference decline sees package-root-relative globs (the coverage miss); unwrap parenthesized and cast loader calls; read tsx/bun/deno shebangs and jest*.json; apply .js→.ts to Vite/Jest mock specifiers;
   - certifier: K3b for vitest modules outside the project root; repeated baseline runs for flaky K8 tests; ambiguity findings list the alternatives; K5/K7 if time allows.
   Take storyboard decision 2 (the single-step fallback) at the end of S6.
6. S5 carry-overs (s5.md):
   - The planner's ranking is a heuristic: keep every candidate visible.
   - Consider a sub-feature warning for platform concerns (http-response extends http) and folding one-file platform concerns.
   - The critic introduced 3 of the reviewer-level misplacements in the committed plan: metadata (EXIF extraction) merged into system-metadata, a one-file move-history module, and app.repository and api.service put in platform/registry. Tighten its gate in the tool: a registry holds only role-registry files; a critic merge needs evidence, an edge or a shared role, not just a shared word.
   - The Lightning one-liners for ambiguous files (plan §3.5) aren't built.
   - Check the Nebius console bill against the ledger: n>1 billing, cache hits.
   - Gateway gaps the review left open: a connection that drops after the send but before the headers arrive is still retried at $0; a stale ledger lock is only taken over after 30 s.

Exit criteria: the full ladder on immich (every R1 module step, R2, R3, R4), every commit certified PASS by the static checks and the last commit of each rung by --oracles too; the findings log rendered; the anti-vacuity check green; docs/sessions/s6.md (10 lines) ending with the S7 opening prompt (reporter and replay site v1, scramble tool, benchmark runner and runs, the judges' --replay build).
Log weird-but-not-blocking observations with /log-anomaly.
```
