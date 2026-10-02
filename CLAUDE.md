# architecture-cleaner

Entry for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/), Coding and Agentic Engineering track. corupta is entering solo with limited hours; Claude does most of the building.

**Working idea:** an agent that restructures a legacy TypeScript repo sliced by technical type (`controllers/`, `services/`, `models/`) into feature modules with enforced boundaries, without changing behavior, and proves it didn't.

**Direction after the hackathon: Clean Architecture.** The frozen violation inventory is the starting point. From there we'd add dependency inversion through ports, checked against a behavioral oracle, since that step can't be certified mechanically. See [docs/plan.md §2.7](docs/plan.md).

## Status

Planning finished on 2026-10-02. [docs/plan.md](docs/plan.md) owns scope, architecture, budget, gates and timeline. The raw research behind it is in `docs/research/`, and [docs/kickoff.md](docs/kickoff.md) is history.

The gate session (S2) ran on 2026-10-02; [docs/gates.md](docs/gates.md) has the numbers. G2 passed. G1 failed criterion 1, and corupta rated the immich plan 3.1/5, so the planner follows the plan §6 **pivot**: deterministic seeds decide, Nemotron edits the draft. G3 came out messy, so the certificate pitch holds. Spike code and the budget ledger are on branch `spike/gates`.

Next is S3 (scaffold, analyzer, executor, openhab-cloud bring-up), whose prompt is in [docs/next-session.md](docs/next-session.md). Feature freeze is **Oct 20** and submission **Oct 28**.

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
- **Models (after G1):** Nemotron 3 Ultra (`medium_effort`) edits the deterministic seeds draft and critiques it. 3.5 Lightning fans out (it replaces Nano). Super is the G3 generic-agent baseline model, and a planner sample only with an explicit temperature and a reasoning cap.
- **Form factor:** CLI, a static replay site as the demo URL, and a `--replay` test build. No live endpoint on our key.
- **Demo target:** immich `server/`, provisional until the Oct 6 gate. Backups: Dokploy, mcphub.
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
