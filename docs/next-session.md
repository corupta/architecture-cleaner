# Next session: S3 (scaffold + analyzer + executor)

Opening prompt for S3, from [gates.md](gates.md). Paste it as the first message.

```
Session S3 for architecture-cleaner: scaffold the product repo, port the analyzer, build the executor, bring up one openhab-cloud module end to end.

Read CLAUDE.md, docs/gates.md (all of it; the decisions are final unless corupta's Oct 6 call changed them, and he will say so), then docs/plan.md §2.2–2.5, §3.3, §3.4 (K1–K3 only), §3.7. Spike code to port, not copy blindly: spike/g1/analyzer.mjs (TS 6.0.3 Program, symbol-level edges through barrels, reference sites incl. jest/vi mocks, unresolved internal specifiers), spike/g2/{env.sh,block-net.cjs} (target toolchains and offline oracles). Target recipes: ~/ac-work/g2/<repo>/commands.sh.

Mode: execution, high autonomy, on branch s3/scaffold created from main; commit freely; merge to main when the exit criteria hold. No LLM calls in S3. The spike code lives only on branch spike/gates. Read it with `git show spike/gates:spike/<path>` or a worktree (`git worktree add ~/ac-work/spike-gates spike/gates`); port it, don't merge it. The G2 recipes source /workspace/architecture-cleaner/spike/g2/env.sh, which exists only on spike/gates. Run them from that worktree after adjusting the path, or port env.sh and block-net.cjs first: they belong in the product's oracle runner anyway.

Build:
1. Scaffold per plan §3.7: TypeScript 6.0.x, Node 22, vitest, feature folders src/{cli,preflight,analyzer,executor,certificate,...}; MIT LICENSE; `ac` bin.
2. Analyzer (TS): inventory from git ls-files grouped by tsconfig option set (with the TS 6 shim), every reference site with its exact span (import/export/import type/import =/import()/typeof import/require/require.resolve/jest.* and vi.* mocks with the virtual flag/declare module/triple-slash/asset specifiers), resolution via ts.resolveModuleName plus Jest moduleNameMapper/Vite alias semantics for test-runner sites.
3. Executor per plan §3.3: pathMap + co-move bundles → respecify with ts.moduleSpecifiers.updateModuleSpecifier → keep the form class (relative stays relative, alias key stays, .js ending and /index style stay) → edit inside the quotes only (BOM/CRLF safe) → git mv → self-verify on a virtual post-move host (after == map(before), unresolved stays unresolved).
4. Fixtures: one small fixture repo per capability row (relative CJS, NodeNext .js endings, tsconfig paths alias, Jest moduleNameMapper + jest.mock, vitest alias + vi.mock, barrel re-exports, dynamic import, triple-slash), each with a golden pathMap and expected edits; plus the GEFR differential (TS getEditsForFileRename) on them.
5. Bring-up: openhab-cloud @76966b546b (CJS, mocha, no aliases; G2 recipe in ~/ac-work/g2/openhab-cloud/commands.sh, extra tests typecheck in extra-oracles.sh). Move one module's files end to end with our executor on a branch in ~/ac-targets/openhab-cloud, then run the oracles offline: tsc 0 errors, the out-of-repo tests typecheck with no new errors against its 58-error baseline, and mocha 31/31 files and 454/454 cases. `git diff -M` must show only renames plus in-quote specifier edits. Note: its package.json test glob is unquoted (dash expands ** as *), so moving tests to another depth silently drops them. Pin test files, and record it as a finding (never fix it).

Exit criteria: fixtures green including the GEFR differential; the openhab-cloud module move green on all three oracles above; a 10-line report in docs/sessions/s3.md; the S4 opening prompt (certifier K0–K4, K6, K8; mutation harness ≥20 operators; ac certify on the four G3 branches in ~/ac-targets/g3/{immich,mcphub}) at its end.
Log weird-but-not-blocking observations with /log-anomaly.
```
