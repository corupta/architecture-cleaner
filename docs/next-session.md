# Next session: S5 (LLM gateway, seeds, draft-editor planner, validator, plan.yaml)

Opening prompt for S5, from [sessions/s4.md](sessions/s4.md). Paste it as the first message.

```
Session S5 for architecture-cleaner: the LLM gateway, the seeds draft, the draft-editor planner with Ultra, the validator and critic, and `ac plan` → plan.yaml.

Read CLAUDE.md, docs/sessions/s4.md, docs/plan.md §2.2, §2.4, §3.2, §3.5, §3.6 and §5, docs/gates.md (G1, the "Decided" line and "Plan corrections" 1, 2 and 6), docs/gates/immich-plan.md and docs/gates/tf-probes.md. Mode: execution, high autonomy, branch s5/planner from main; merge when the exit criteria hold. LLM calls only through the new gateway, with a ledger cap of $3 for the whole session (plan §5 "build-phase prompt iteration"); the global cap stays the hard ~$43 left.

Port, don't copy, from branch spike/gates (read with `git show spike/gates:spike/<path>`):
1. src/gateway/: the recording gateway (spike/llm/gateway.mjs, client.mjs, prices.json, runs.json) as an in-process client (no listening server; never a live endpoint on our key). openai SDK against Token Factory with NEBIUS_API_KEY from .env. Cassettes as JSONL keyed by hash(model, messages, tools, params) with record / replay (fail on a miss) / auto. A budget ledger: cost = usage × the pinned price table, a pre-send estimate refused over the run cap or the global cap. The plan §3.6 request rules: json_schema strict, reasoning only through chat_template_kwargs (never reasoning_effort), always temperature 1.0 / top_p 0.95 and max_tokens, never parse content on finish_reason length, read reasoning_content only. Tests run in replay mode only.
2. src/planner/facts.ts and seeds.ts: facts per file from src/analyzer (role, exports, resolved edges through barrels, table/repository access, pins and hazards per plan §2.4), and the seeds draft (spike/g1/baselines.mjs seedsWithPropagation: stems, name-token assignment, label propagation over import + table edges, consumer rules), with per-file confidence and a contested list.
3. src/planner/edit.ts: the draft editor (spike/g1/planner.mjs runEditPlanner, v1): Ultra with medium_effort, json_schema strict output = one entry per draft group (final bare name and kind module|shared|platform; equal names merge) plus moves for misplaced files only, each with a one-line rationale. It never lists every file. The evaluate round stays off. K candidates via n=K at T=1.0 if Ultra accepts n>1 (probe it once, cheaply; otherwise sequential).
4. src/planner/validate.ts: the deterministic validator and scorer (spike/g1/metrics: TurboMQ, cross-edge ratio, cycles; banned names; names only from the repo's own vocabulary; pins respected) and the critic (Ultra, 1 call), whose suggestions go back through the validator, never straight to execution.
5. `ac plan <repo> [--root server]` → plan.yaml (editable: groups → files, with confidence and contested flags) and plan.md (readable, like docs/gates/immich-plan.md); plan.yaml → one pathMap per module step that `ac move` consumes.
Apply corupta's notes on the G1 immich plan: move the registries out of shared/infra into platform/; merge the *-admin modules into their domains; revisit the asset / asset-media / asset-file split and the `app` module. His bar: small improvements over the planner's choices, under 10% of placements.

Exit criteria: `ac plan` on immich server/ in record mode within the cap, then reproduced byte-identically in replay mode with the network blocked; every module step's pathMap verifies with `ac move --dry-run`; one module step applied in a scratch branch and certified PASS by `ac certify --profile immich` (static checks; plus --oracles if time allows); the plan's cost in the ledger; docs/sessions/s5.md (10 lines) ending with the S6 opening prompt (orchestrator R0–R4, findings log, boundary rules, end to end on immich, plus the S4 carry-overs listed in s4.md).
Log weird-but-not-blocking observations with /log-anomaly.
```
