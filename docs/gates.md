# Gate memo (session S2, 2026-10-02): build/pivot/stop for Tue Oct 6

**Recommendation: PIVOT, as plan §6 defines it, then build.**
- Deterministic seeds decide where files go. Nemotron edits the seed draft: it names and merges groups, moves contested files with a rationale, and writes the findings narration and the critic review.
- The certificate stays the hero. G3 makes it stronger than we planned.
- G2 passes, so **immich stays the demo repo.**
- One input is still yours: rate the immich plan in [gates/immich-plan.md](gates/immich-plan.md) from 1 to 5. ≥3 keeps the pivot; <3 means stop under plan §6.

| Gate | Verdict | Numbers |
|---|---|---|
| TF probes | done, $0.025 | Strict `json_schema` is enforced on all Nemotron models; `chat_template_kwargs` passes through; **Super decodes greedily unless `temperature` is set**; `n=K` bills input once. Details: [gates/tf-probes.md](gates/tf-probes.md), feedback items 18–29. |
| G2 repo health | **PASS** (all 3 bars) | immich 2,337/2,337 unit cases offline, twice, plus a byte-identical OpenAPI oracle; openhab-cloud 454/454; benchmark repos green: hoppscotch, ghostfolio, realworld (kaneo after quarantine) |
| G1 boundary spike | **FAIL on criterion 1**; criterion 2 is your rating | The LLM beats the best deterministic baseline by ≥5 MoJoFM on 1 of 3 repos (H1 +5.5; hoppscotch +1.4; kaneo −12.3). It never reaches +15 on hard files. |
| G3 generic agent | **MESSY**, so the pitch holds | 4 of 4 runs incomplete; tsc goes from 0 errors to 101–1,680; test files fail to load in every run; the OpenAPI build is broken on immich |

Spend: **$7.54 of the $11.25 session cap.** By run: probes $0.025, G1 $1.70 (cap $3), G3 immich $4.93 (cap $5, stopped by the hard cap), G3 mcphub $0.86 (cap $3), smoke $0.014. Ledger: `spike/llm/ledger.jsonl`.

## G2: repo health (no LLM; offline = Node preload refusing non-loopback TCP/DNS plus a dead proxy)

| Repo | Node | tsc | Unit suite, run 1 (run 2 identical unless noted) | Verdict |
|---|---|---|---|---|
| immich `server/` | 24.21.0 | 0 errors (TS 7.0.2; TS 6.0.3 via `tsc6` also 0) | vitest: 105/105 files, **2,337/2,337** cases, 154 s; 0 flaky | green; OpenAPI spec regenerates byte-identical, twice |
| Dokploy | 24.4.0 | 0 errors (TS 7 tsgo, 4 packages) | 114/116 files, 1,092/1,097 cases (2 files and 5 cases skip without Docker) | green |
| mcphub | 22.23.3 | 0 errors | jest: 218/226 files, 1,952/1,986 | green after quarantine: 7 files need DNS or npm; 1 timing flake |
| openhab-cloud | 22.23.3 | 0 errors | mocha: 31/31 files, 454/454 | green |
| hoppscotch backend | 24.21.0 | 0 errors with `tsconfig.build.json`; the full project has a stable 67 errors in specs | jest: 19/19 files, 761/761 | green |
| ghostfolio `apps/api` | 22.23.3 | 0 errors | jest: 56/57 files, 280/281 (1 skipped by design) | green |
| kaneo `apps/api` | 24.21.0 | 0 errors (TS 7) | vitest: 111/112 files, 848/849 | green after quarantine. The one hard failure was our preload blocking an IP-literal lookup (fixed); 2 files time out under load |
| mikro-orm realworld | 22.23.3 | 0 errors | 3/3 files, 13/13 | green |

**immich 2024 recovery benchmark: feasible but secondary.**
- Only 53 files in 25 features carry a human label, and 49 of the 53 give their feature away in the file name.
- Scores: name-token 91.7, seeds + label propagation 93.8, Super v1 93.8 (2 samples: 93.8 and 91.7).
- It goes in the deck as a face-validity check, not as a headline number.

## G1: boundary spike ($1.70; virtual scramble, ground truth = the original feature folders)

The best deterministic baseline is the maximum over B0 type folders, name-token (two variants), export-token, seeds + label propagation (two seed sources) and Louvain at resolutions 1/2/4 × 5 seeds. That's a strict bar: Louvain's resolution was picked after seeing the results. On the LLM side, each cell is the best of all its samples, which flatters the LLM.

| Bench (feature files / modules / hard) | Best deterministic | Draft the LLM starts from | v0: list every file | v1: edit the draft | v1b: Super `low_effort`, no evaluate round |
|---|---|---|---|---|---|
| realworld (smoke, 28/4/3) | 91.7 | 91.7 | 100 | 95.8 | not run |
| hoppscotch (157/25/46) | 82.2 | 80.8 | 67.1 | **83.6** (+1.4) | 82.9 |
| kaneo (401/47/234) | 64.8 (Louvain r=4) | 51.2 | 42.0 | **52.5** (−12.3) | 51.2 |
| hoppscotch-H1, opaque file names (157/25/46) | 82.2 (export-token seeds) | 82.2 | 84.3 | **88.4** (+6.2; best final 87.7, +5.5) | 88.4 |
| Hard files (best LLM vs best baseline) | — | — | −8 / −31 / −8 | −16 / −27 / −8 | −18 / −30 / −13 |

What we learned:
1. **v0 breaks once a repo has ≥157 files.** Asked to list every file id, Super and Ultra dropped 26–45% of kaneo's 456 files and duplicated up to 248 ids (on immich). In the follow-up round they returned an empty plan or put all 456 files in one group. v0 is also unstable: two hoppscotch runs gave Super anywhere from 17.8 to 80.8.
2. **v1 never drops a file and adds a little:** +1 to +6 MoJoFM over its own draft.
   - **Ultra** on `medium_effort` produced the best hoppscotch and H1 plans and the only immich plan that really edits the draft.
   - Super at default effort matched Ultra on H1 (88.4) when it finished, but it often didn't: 7 G1 calls hit `finish_reason: length` at 32k–64k tokens.
   - Super on `low_effort` mostly returns the draft untouched (0 moves on kaneo and immich).
3. **The evaluate round is unreliable.** Over 17 samples it improved 8, left 3 unchanged and hurt 6, four of them by more than 10 points (down to 6.5). The validator's cycle and cross-edge feedback pushes the model to merge groups.
4. **We can't pick the best candidate without ground truth yet.** On immich, TurboMQ ranks the unedited draft highest, so the plan shown for rating is Ultra's (65 groups, 26 moves). The immich graph is dominated by `BaseService` injecting 55 repositories and by registry barrels; any grouping inherits both.
5. The LLM's clearest win is H1 (+6.2), where file names are opaque and it has to read symbol and table semantics. That is exactly the "contested file" case the pivot gives to Nemotron.

## G3: generic agent (opencode 1.18.34 + Nemotron 3 Super on TF, fixed prompt, no human input)

Single-shot means `opencode run` with the fixed prompt. Persistent means that whenever the agent stops, an automated reply (no human) reports typecheck/test pass-fail plus the output tail and asks it to continue. Persistent runs stop on green checks, at 90 minutes, at 25 turns, or at the budget cap.

| | immich single-shot | immich persistent | mcphub single-shot | mcphub persistent |
|---|---|---|---|---|
| Outcome | stopped after 169 s; asked the user to run its sed commands | **budget cap** ($4.93/$5) after 5 turns, 33 min | stopped after 48 s; asked the user which approach to take | 25 turns, 24 min; tool calls in only 3 of 25 turns, and the same refusal text 16 times (Super decodes greedily) |
| Cost and input | $0.30, 0.98M input tokens, 51 calls | $4.63, 15.3M input tokens, 200 calls | $0.04 | $0.82, 2.7M input tokens |
| File operations | 211 files **copied** to `src/features/`, originals kept | 297 moved, 562 copied (incl. a `src.backup/` tree), 68 modified | 89 moved, **0 importers rewritten** | 287 copied, 5 new re-export facades |
| Non-specifier lines in moved or copied files | 1,104 (2.4%): every rewritten import corrupted, e.g. `from ["']src/features/activity.controller.js/…["']` | 0; plus 926 in modified files | 0 | 256 (0.4%) |
| New dangling specifiers | 0 (copies still import the originals) | 2,923 (e.g. `src/features/None/…`) | 1,102 (720 imports, 367 `jest.mock`) | 891 |
| tsc errors (base 0) | 1,680 | 768 (`nest build`: 4,675) | 908 | 101 |
| Unit tests, offline (base: immich 105 files / 2,337 cases; mcphub 226 files / 1,986 cases) | 171 files (+66 duplicated specs), 66 fail to load; cases still 2,337/2,337 | 5/105 files pass, 52 cases | 96/226 files, 800 cases | 222/264 files (+38 duplicates), 1,971/2,004 cases |
| OpenAPI oracle | `nest build` fails | `nest build` fails | n/a | n/a |

Messy on every criterion that applies: tsc and tests regress in 4 of 4 runs, and all 4 are incomplete. The >5% non-specifier-line criterion isn't met in any run (max 2.4%), but the criteria are "any of", so that doesn't change the verdict. The worst case for us is the immich single-shot: vitest still reports **2,337/2,337 cases passing** while 66 spec files never load. A case-level "green" is not proof, which is plan §3.4 K6 (per-file inventory) in one picture. Behavior-relevant changes that the tests don't catch, from an adversarially verified review: see the "G3 review" addendum below.

Branches and transcripts, all outside this tree:
- Branches: `~/ac-targets/g3/{immich,mcphub}`, on `g3/opencode-super` (single-shot) and `g3/opencode-super-persistent`.
- opencode events and session exports: `~/ac-work/g3/<target>[-persistent]/`.
- Every API request and response: `~/ac-work/cassettes/g3-{immich,mcphub}.jsonl`.

## Demo repo: immich `server/` @ `02063972e8`, confirmed

- G2 green with the largest offline suite we found.
- The OpenAPI byte-diff oracle works offline.
- G3's failures on immich are vivid and fully on the record.

Backups are unchanged: Dokploy (green, but it typechecks with TS 7 tsgo only) and mcphub (needs the 7-file quarantine or a DNS stub).

Correct the pitch hook. The March 2024 reorg was **about 17 layout PRs over ~50 h (Mar 20–22)**, not "14 one-move PRs in ~30 h":
- #8080 only rewrote imports.
- #8118, #8131, #8138 and #8201 merge or split files.
- Only the domain layer was feature-sliced before.

## Plan corrections (applied to docs/plan.md)

1. **§3.5 Planner → pivot design.**
   - Seeds + label propagation decide.
   - Nemotron edits the draft (names and merges groups, moves contested files with a rationale) and never lists every file.
   - Ultra (`medium_effort`) is the editor. Super runs only with an explicit `temperature` and a reasoning cap.
   - The evaluate round is off until a validator objective stops rewarding merges.
   - K candidates come from `n=K` at T=1.0. GT-free selection is an open problem: TurboMQ alone prefers the unedited draft.
2. **§3.6 Gateway.** Primary structured output is `json_schema` strict. Reasoning control goes through `chat_template_kwargs`; never `reasoning_effort`. On `finish_reason: length`, never parse `content`. Always send `temperature`. TF sends no rate-limit headers.
3. **§6 G3 protocol.** The persistent auto-reply variant is the reference baseline, because single-shot runs quit within 1–3 minutes.
4. **§2.6 Repos.**
   - Corrected test counts: immich 2,337; mcphub 1,986; Dokploy 1,097; hoppscotch 761; kaneo 849; openhab-cloud 454.
   - Corrected hook (above).
   - The recovery benchmark is demoted to a face-validity check.
   - Per-repo oracle hazards are recorded: hoppscotch `tsconfig.build.json`; immich `sync-open-api` writes a tracked file, so run it from a scratch cwd; duplicate test names mean test identity is file + name + ordinal; `HUSKY=0`; `incremental` tsbuildinfo.
5. **§3.4 K6.** Test inventory is compared per file, by file-load status as well as case counts.
6. **§5 Budget.** G3 immich used the whole $5. With no caching discount, a 33-minute agent run resends 15M input tokens.
7. **§7 Benchmarks.** Baselines include export-token seeds and Louvain at several resolutions. Research 03b's "degenerate partitions score 14.29" is wrong: they score 0 (brute-force checked).
8. **§12.** Closed: pass-through, `json_schema`, per-model limits, offline-ability of immich unit tests and the OpenAPI oracle on aarch64/Node 24, recovery feasibility. Still open: batch discount, Sandboxes pricing, promo expiry, the TS 6 spike items, dependency-cruiser attribution through barrels.

## Opening prompt for session S3 (scaffold + analyzer + executor)

```
Session S3 for architecture-cleaner: scaffold the product repo, port the analyzer, build the executor, bring up one openhab-cloud module end to end.

Read CLAUDE.md, docs/gates.md (all of it; the decisions are final unless corupta's Oct 6 call changed them, and he will say so), then docs/plan.md §2.2–2.5, §3.3, §3.4 (K1–K3 only), §3.7. Spike code to port, not copy blindly: spike/g1/analyzer.mjs (TS 6.0.3 Program, symbol-level edges through barrels, reference sites incl. jest/vi mocks, unresolved internal specifiers), spike/g2/{env.sh,block-net.cjs} (target toolchains and offline oracles). Target recipes: ~/ac-work/g2/<repo>/commands.sh.

Mode: execution, high autonomy, on branch s3/scaffold; commit freely; merge to main when the exit criteria hold. No LLM calls in S3.

Build:
1. Scaffold per plan §3.7: TypeScript 6.0.x, Node 22, vitest, feature folders src/{cli,preflight,analyzer,executor,certificate,...}; MIT LICENSE; `ac` bin.
2. Analyzer (TS): inventory from git ls-files grouped by tsconfig option set (with the TS 6 shim), every reference site with its exact span (import/export/import type/import =/import()/typeof import/require/require.resolve/jest.* and vi.* mocks with the virtual flag/declare module/triple-slash/asset specifiers), resolution via ts.resolveModuleName plus Jest moduleNameMapper/Vite alias semantics for test-runner sites.
3. Executor per plan §3.3: pathMap + co-move bundles → respecify with ts.moduleSpecifiers.updateModuleSpecifier → keep the form class (relative stays relative, alias key stays, .js ending and /index style stay) → edit inside the quotes only (BOM/CRLF safe) → git mv → self-verify on a virtual post-move host (after == map(before), unresolved stays unresolved).
4. Fixtures: one small fixture repo per capability row (relative CJS, NodeNext .js endings, tsconfig paths alias, Jest moduleNameMapper + jest.mock, vitest alias + vi.mock, barrel re-exports, dynamic import, triple-slash), each with a golden pathMap and expected edits; plus the GEFR differential (TS getEditsForFileRename) on them.
5. Bring-up: openhab-cloud @76966b546b (CJS, mocha, no aliases; G2 recipe in ~/ac-work/g2/openhab-cloud/commands.sh). Move one module's files end to end with our executor on a branch in ~/ac-targets/openhab-cloud, then run its tsc and mocha suite offline: both must stay green, and `git diff -M` must show only renames plus in-quote specifier edits. Note: its package.json test glob is unquoted (dash expands ** as *), so moving tests to another depth silently drops them: pin test files or fix nothing and record it as a finding.

Exit criteria: fixtures green including the GEFR differential; openhab-cloud module move green on tsc + 454/454 mocha offline; a 10-line report in docs/sessions/s3.md; the S4 opening prompt (certifier K0–K4, K6, K8; mutation harness ≥20 operators; ac certify on the four G3 branches) at its end.
Log weird-but-not-blocking observations with /log-anomaly.
```

## Addendum: G3 review (adversarially verified)

Filled in from the g3-branch-review workflow.
