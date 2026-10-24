# architecture-cleaner

Entry for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/), Coding and Agentic Engineering track. corupta is entering solo with limited hours; Claude does most of the building.

**Working idea:** an agent that restructures a legacy TypeScript repo sliced by technical type (`controllers/`, `services/`, `models/`) into feature modules with enforced boundaries, without changing behavior, and proves it didn't.

**Direction after the hackathon: Clean Architecture.** The frozen violation inventory is the starting point. From there we'd add dependency inversion through ports, checked against a behavioral oracle, since that step can't be certified mechanically. See [docs/plan.md §2.7](docs/plan.md).

## Status

Planning finished on 2026-10-02. [docs/plan.md](docs/plan.md) owns scope, architecture, budget, gates and timeline. The raw research behind it is in `docs/research/`, and [docs/kickoff.md](docs/kickoff.md) is history.

The gate session (S2) ran on 2026-10-02; [docs/gates.md](docs/gates.md) has the numbers. G2 passed. G1 failed criterion 1, and corupta rated the immich plan 3.1/5, so the planner follows the plan §6 **pivot**: deterministic seeds decide, Nemotron edits the draft. G3 came out messy, so the certificate pitch holds. Spike code and the budget ledger are on branch `spike/gates`.

S3 ran on 2026-10-02/03; [docs/sessions/s3.md](docs/sessions/s3.md) has the report. It shipped the scaffold, the analyzer and the move executor. On immich, a 292-file R1-style step passed every oracle offline, with the OpenAPI spec byte-identical.

S4 ran on 2026-10-03/04; [docs/sessions/s4.md](docs/sessions/s4.md) has the report. It shipped `ac certify` (K0–K4, K6, K8; K5 and K7 not built), the mutation harness and the hunt corpus. Our three branches certify PASS with every check, the four G3 branches FAIL, and no mutant survives the static checks. The storyboard draft for corupta's Oct 9 review is [docs/storyboard.md](docs/storyboard.md).

S5 ran on 2026-10-07; [docs/sessions/s5.md](docs/sessions/s5.md) has the report. It shipped the in-process LLM gateway (cassettes, budget ledger in `budget/`), facts, seeds, the Ultra draft editor and critic behind the validator, and `ac plan` / `ac steps`. The immich plan ([docs/plans/immich/plan.md](docs/plans/immich/plan.md)) cost $0.20 and replays byte-identically offline. All 58 of its steps dry-run clean, and the auth step certifies PASS with oracles. An adversarial review confirmed 16 defects, and all are fixed. corupta keeps the plan as committed, with no hand edits, so the tool runs unattended.

S6 ran on 2026-10-07/14; [docs/sessions/s6.md](docs/sessions/s6.md) has the report. It shipped `ac run` (R0–R4 with rollback, replan and resume), certificate v2 on trees, R3 renames, R4 dependency-cruiser rules with an anti-vacuity check, and the findings log. Unattended on immich it made 63 commits, each certified, with every rung and the whole PR PASS with oracles, in 1 h 55 m (branch `ac/s6-ladder`, run dir `~/ac-work/s6/final`). The planner's stricter critic gate regenerated the immich plan (now 59 groups, still the tool's own output). An adversarial review confirmed 17 defects, and all are fixed. Storyboard decision 2 is taken: no single-step fallback.

S7 ran on 2026-10-17/18; [docs/sessions/s7.md](docs/sessions/s7.md) has the report.
- It shipped `ac report` and the replay site v1 (`ac site`, offline, deterministic) and the judges' `ac demo --replay`.
- From a fresh clone with no key, `npx ac demo --replay` takes 12 minutes. Every tree equals the recording, and with `--env` the digests reproduce.
- It also shipped `ac scramble`, `ac bench`, and a recorded `--inject-fault` run (`runs/immich-fault`).
- Benchmarks: the planner beats the best deterministic baseline on 1 of 5 entries (hoppscotch +6.2), and loses on H1, kaneo, ghostfolio and immich's TurboMQ.
- The H1 bench caught a planner regression. Certifying our own scrambles found certifier false positives, which are fixed with proofs; kaneo's scramble fails closed.
- An adversarial review confirmed 18 defects, including a K4 false pass round 2 had introduced, and all are fixed. S7 spent $1.12.

S8 ran on 2026-10-20; [docs/sessions/s8.md](docs/sessions/s8.md) has the report. Feature freeze held.
- Certificates are hermetic: the certifier refuses a work dir with a `node_modules` or `package.json` on its path, and the demo defaults to one outside the clone. From a fresh clone's default layout, `npx ac demo --replay --env --oracles` reproduces the four recorded digests.
- Planner rules 2 read the prompt's ids and keys and rank 0-module plans last; immich pins rules 1. The re-planned bench ($0.11) is higher than the best deterministic method on 3 of 5, 2 of 5 counting only plans our validator accepts.
- Stretch S3 shipped (`ac rewrap`, optional rung S3, K2's layout class confined to import and export declarations); S1 was not started.
- The mutation harness kills 831/831 over every target. A review confirmed 28 of 28 findings, including 5 false passes in the first layout rule, and all are fixed. The ledger stands at $10.54.

S8b ran on 2026-10-20 evening (an addendum in [docs/sessions/s8.md](docs/sessions/s8.md)): corupta asked to try Nemotron 3.5 Super VL as the planner. With thinking on it reasoned past the 64k cap; with thinking off it costs a fifth of Ultra but scores below it on immich and, less clearly, hoppscotch-H1. The demo keeps Ultra ([bench/experiments/s8b-super-vl](bench/experiments/s8b-super-vl/README.md)).

S8c and S8d ran on 2026-10-21 (same addendum): the gateway now streams requests above 64k tokens (Token Factory cuts non-streamed calls at 600 s). With thinking on and 256k tokens per answer, Super VL reasons a median of about 118k tokens and beats Ultra `medium_effort` on all four scrambles (hoppscotch 91.26 against 83.22 MoJoFM) at 2.5 times the cost and 6.4 times the time; on immich it shows no difference. corupta decided on 2026-10-23 that the demo keeps Ultra and shows Super VL's results as preliminary, with their limits. The ledger stands at $22.26.

S9 ran on 2026-10-23; [docs/sessions/s9.md](docs/sessions/s9.md) has the report.
- Numbers frozen (tag `freeze-numbers`): 2,000+ numbers in the README, the storyboard, the site and the video checked against their primary sources by 31 agents, listed in [docs/numbers.md](docs/numbers.md). The confirmed misstatements are fixed, the site's with regression tests. Among them: opencode's vitest run is not green (2,337 cases pass, 66 test files fail to load), its 1,680 tsc errors are syntax errors, and step certificates are static (K8 runs per rung).
- The judges' path again from a fresh clone on a quiet machine: replay 11 m 08 s, `--env --oracles` 20 m 32 s, the four digests identical; the site byte-identical across builds.
- Video prep in [video/](video/script.md): the script, the shot list, scripted captures (VHS, Playwright) and a silent captioned rough cut for corupta's 15-minute OK.
- Addendum (2026-10-24, corupta's question "isn't it just the better model?"): G3's Ultra arm, the same agent, prompt and scripts on Nemotron 3 Ultra (its own caps), fails too: single-shot looped on `ls` with no change ($1.86 at the full input price, its $2 cap; $0.55 billed); persistent moved 374 files, rewrote no import, FAIL on K1, K3a–K3c, K4, K6, K8 ($11.76 at the full input price, its $12 cap, 9 min; $2.55 billed). It is the A/B page's second table and storyboard decision 7. The ledger stood at $35.96 (S10: $24.40 billed).
- The repo is public (github.com/corupta/architecture-cleaner, MIT) and the site is live at corupta.github.io/architecture-cleaner; S9 closed with its exit criteria met.

S10 runs from 2026-10-24 (the cut and the submission); [docs/sessions/s10.md](docs/sessions/s10.md) has the report so far.
- The cut's tooling (takes trimmed and timed by their pauses, `--final` at −14 LUFS), the video audited for the trademark rule, the README to the submission rule, [docs/devpost.md](docs/devpost.md) and the feedback write-up [docs/feedback.md](docs/feedback.md) (36 items, each checked by a skeptic), all reviewed and pushed.
- corupta's Nebius console export (2026-10-24): the whole hackathon cost **$24.40**. The ledger said $35.96: since 2026-10-20 at the latest Token Factory bills cached input at a lower price, and it didn't bill the 504. Reconciliation lines bring the ledger to the bill; G3's Ultra persistent run was $2.55 billed (its cap counted $11.76), so the video says "twelve million tokens", not "twelve dollars".
- Open: corupta's script OK and voice-over takes, the final cut and its upload, the Devpost review and submission. Submission is **Oct 28**.

## Decided (revisable with a reason)

- **Track and goal:** Coding and Agentic Engineering track, aiming to win it.
- **Targets:** TS only, OSI-licensed OSS repos with real test suites. The repo hunt confirmed good TS targets exist. corupta's private Sequelize JS repo comes after everything else works.
- **Pitch:** proof, not trust.
  - The hero is the per-commit certificate plus a findings log of bugs that are recorded and never fixed.
  - Nemotron only plans.
  - The hackathon deliverable makes no "Clean Architecture" claim. Clean Architecture is the stated direction after the hackathon, and it can get a future-direction slide in the demo.
- **Layout:** feature-flat: `src/modules/<singular-kebab>/`, `shared/`, `platform/`.
- **MVP ladder:** preflight → module moves → residual consolidation → filename normalization → boundary rules with a frozen baseline.
- **Executor:** built on the TS 6 compiler API with span-only edits, not ts-morph `move()`. The certifier is a separate process and can certify any diff.
- **Models (after G1):** Nemotron 3 Ultra (`medium_effort`) edits the deterministic seeds draft and critiques it. 3.5 Lightning fans out (it replaces Nano). Super is the G3 generic-agent baseline model (and since S9, Ultra too, at corupta's request), and a planner sample only with an explicit temperature and a reasoning cap.
- **Form factor:** CLI, a static replay site as the demo URL, and a `--replay` test build. No live endpoint on our key.
- **Demo target:** immich `server/`, provisional until the Oct 6 gate. Backups: Dokploy, mcphub.
- **Unattended run (2026-10-07):** the demo uses Nemotron's plan as produced, with no human edits to plan.yaml. Editing stays an optional hook. Plan quality improves in the tool (validator rules, critic gate), never by hand.
- **Planner for the demo (2026-10-23):** Nemotron 3 Ultra (`medium_effort`), the recorded S6 run as it is. Nemotron 3.5 Super VL's bench results (thinking on, 256k: better on the scrambles, no gain on immich) are shown as preliminary, with their limits and the reasons for keeping Ultra ([bench/experiments/s8b-super-vl](bench/experiments/s8b-super-vl/README.md)).
- **Timeline:** freeze Oct 20, submit Oct 28.

## Hard constraints

- Deadline **2026-10-30 10:00 PT**. The project must stay testable, free of charge, until judging ends on 2026-12-15.
- Runtime calls to Nebius Token Factory with at least one NVIDIA open model (Nemotron).
- Public repo with an OSS license file and a README that covers setup and highlights the Nemotron usage. Plus a public YouTube video of ≤3 min, and a demo URL or test build.
- Token Factory budget is **~$50 total**, a hard ceiling. Never expose a live endpoint that spends our key.

## Guiding principles (corupta's refactoring experience)

- **Make the bugs obvious. Then resist.** A great refactor makes existing bugs absurdly obvious; fixing them is never part of it.
- One transformation at a time, applied repo-wide, everything else left byte-identical. No rewrites from scratch, no bundled refactors.
- Bugs and smells outside the current step get written down as findings and left in their original form.

## Repo rules

- Never commit target repos here; clone them outside this tree.
- Secrets go in a gitignored `.env`; commit only `.env.example`.
