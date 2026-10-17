# architecture-cleaner (`ac`)

**Nemotron draws the map. Code moves it. A checker proves nothing else changed.**

`ac` restructures a TypeScript backend that is sliced by technical type (`controllers/`, `services/`, `repositories/`,
`dtos/`) into feature modules (`modules/<feature>/`, `platform/<concern>/`, `shared/`), one commit per step, without
changing behavior. Every commit carries a certificate that says why nothing else changed. The pitch is proof, not
trust: you don't have to believe the tool, or the model, because a separate checker certifies every diff.

Entry for the Nebius x NVIDIA Global AI Hackathon, Coding and Agentic Engineering track.

## How it works

- **The plan.** Deterministic code reads the repository (imports, DI wiring, tables, routes) and draws a seeds draft.
  Nemotron 3 Ultra edits that draft and then reviews the result. Every change it suggests goes through a validator
  gate, and a change without evidence (an import edge, a table, a route) is dropped.
- **The moves.** An executor built on the TypeScript compiler API moves the files and rewrites only the import
  specifiers that point at them. Every other byte stays identical. No model writes code.
- **The ladder.** R0 preflight and a baseline of the target's own tests. R1 moves one feature module per commit. R2
  moves platform code and `shared/`. R3 normalizes file names. R4 adds dependency-cruiser boundary rules with a frozen
  baseline of today's violations.
- **The certificate.** `ac certify` is a separate program that never imports the executor, and it certifies any
  diff: ours, an agent's, a human's. It reads the two git trees and checks, among other things:
  - K0: the support envelope;
  - K1: that the move set is complete;
  - K2: that only specifier bytes changed;
  - K3: that every import resolves to the same file under TypeScript, the test runner and the runtime;
  - K4: that no path string, config or CI file still names an old path;
  - K6: that the test inventory is the same, file by file;
  - K7: that the emit layout is the same;
  - K8: the target's own oracles (tsc, the unit suite, immich's OpenAPI spec), which must agree with the base commit.

  A failing step is rolled back and replanned.
- **The findings log.** Bugs and smells that the new layout makes obvious are written down and never fixed, for
  example an import cycle through 42 folders, or a base class that injects 56 members into 51 services.

## Nemotron on Nebius Token Factory

Nemotron only plans and narrates. Code moves the files, and the certificate checks them.

| Model (Token Factory id) | What it does here | On immich |
|---|---|---|
| **Nemotron 3 Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`, `medium_effort`) | Edits the seeds draft: 3 candidates in one `n=3` call, strict `json_schema`, ranked by the validator. Then reviews the winning plan like a staff engineer; the gate keeps only evidenced changes. | 2 calls, **$0.1998**, recorded once (`runs/immich-ladder/run.json`, `cost.planRecordedUsd`) |
| **Nemotron 3.5 Lightning** (`nvidia/Nemotron-3_5-Lightning`, thinking off) | Narrates the findings log in 1–2 sentences per finding, under a lexical guard that drops any narration naming something its evidence doesn't contain. | 2 calls, **$0.0010**; 35 of 45 findings narrated, 5 dropped by the guard |
| **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`) | The baseline: a generic coding agent (opencode 1.18.34) given the same task with no help from `ac` (gate G3). | $0.30 single-shot, $4.63 persistent ([docs/gates.md](docs/gates.md)) |

Every call goes through one in-process gateway (`src/gateway/`):
- strict `json_schema` answers, explicit sampling and `max_tokens` caps;
- reasoning controlled only through `chat_template_kwargs`;
- every request and response recorded in a cassette (`cassettes/*.jsonl`), keyed by a hash of the request, so a
  replay is byte-identical, free, and needs no key;
- a budget ledger (`budget/ledger.jsonl`) with hard caps per run and overall (`budget/runs.json`): the gateway
  refuses a call whose pre-send estimate would cross a cap.

The ledger matched the Nebius console bill on 2026-10-14: **$9.31** spent in total. $6.69 of it went to Nemotron 3
Super, mostly the G3 baseline runs ($5.79); the immich plan and narration cost $0.20
([docs/sessions/s6.md](docs/sessions/s6.md)).

## Quick start: the replay (no key, $0)

```sh
git clone <this repository> architecture-cleaner && cd architecture-cleaner
npm ci                  # also builds dist/ (the prepare script)
npx ac demo --replay    # --replay is the default
```

You need Node ≥ 22.12, git, and network access for npm and for one shallow fetch of immich at the pinned commit
(`02063972e8`). The demo writes `./ac-demo/`, and its summary goes to `ac-demo/demo.md`.

What the replay does, and what it proves:
1. **It replays the plan.** The planner's deterministic code runs again on a fresh clone of immich. Nemotron's two
   answers come from `cassettes/s6-immich.jsonl`. The resulting `plan.yaml` must have the sha256 the recorded run
   executed (`b4c7c548883c…`), and `plan.md`, `plan.json` and the four candidates must be byte-identical.
2. **It executes all 62 move steps again** (R1 38, R2 21, R3 3) with the executor, one commit each. Every commit's
   git tree must equal the recorded run's tree for that step. R3's renames are computed again from the tree after R2.
3. **It generates R4's boundary rules again.** This works without immich's node_modules. The rules commit's tree must
   equal the recorded one.
4. **It certifies a sample again** with `ac certify`: the first step, the largest step and an R3 rename (`--sample k`
   for more). Without node_modules, K0, K1, K2, K3a, K4 and K7 run, and K3b, K3c and K6 skip.
5. **It replays the findings narration** from the cassette and compares the findings log with the committed one.
   There is one allowed difference, and the demo says so: the committed log records that its narration was live, and
   the replay records that it was replayed.

The command exits 0 when everything that ran matches the recorded run, and 1 otherwise, listing each difference.
Each step takes about 10 s (measured on our machine); `--steps <n>` stops early.

What the replay does **not** re-run:
- **The oracles (K8)**: tsc, the 105-file unit suite and the OpenAPI spec, on every rung and the whole PR. They need
  immich's node_modules and Node 24.21.0; see the full reproduction below.
- **K3b, K3c and K6** on the sample. These need node_modules too.
- **The run loop**: the baseline, a certificate for every step, the rung certificates, rollback and replan.
  `ac demo --full` runs the whole loop.
- **Nemotron itself.** `ac demo --live` asks it again, on your key.

The recorded run is committed in `runs/immich-ladder/`. It holds every certificate, the rung and whole-PR
certificates, the plan, the findings log and `report.md`.

## The full reproduction

The oracles run immich's own tools under its Node version. The profile pins Node 24.21.0, looked up at
`~/ac-targets/.node/node-v24.21.0-linux-<x64|arm64>/`. This path works on Linux only.

```sh
# Node 24.21.0 for the target (x64 shown; use the arm64 tarball on arm64)
mkdir -p ~/ac-targets/.node
curl -fsSL https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz | tar -xJ -C ~/ac-targets/.node
export PATH=~/ac-targets/.node/node-v24.21.0-linux-x64/bin:$PATH

# immich at the pinned commit, with its server dependencies and the two SDK builds its unit tests import
git clone https://github.com/immich-app/immich.git ~/immich
git -C ~/immich checkout --detach 02063972e82b1bfd17b6fc2e3b3ff39936229ea5
cd ~/immich
corepack pnpm install --filter immich --frozen-lockfile
corepack pnpm --filter @immich/sdk --filter @immich/plugin-sdk --filter @immich/plugin-core install --frozen-lockfile
corepack pnpm --filter @immich/sdk --filter @immich/plugin-sdk build
cd -
```

Then, from this repository:

| Command | What it adds | Cost |
|---|---|---|
| `npx ac demo --replay --env ~/immich` | K3b, K3c and K6 on the sample: every check runs, so each certificate's digest must equal the recorded one | $0 |
| `npx ac demo --replay --env ~/immich --oracles` | the whole PR certified with the oracles (tsc, the unit suite, the OpenAPI spec on base and head), its digest compared with `runs/immich-ladder/certificate.json` | $0 |
| `npx ac demo --full --env ~/immich` | `ac run` end to end on the replayed plan: baseline, 63 certified commits, rung and whole-PR certificates, findings. 1 h 55 m on a quiet machine (S6). | $0 |
| `NEBIUS_API_KEY=… npx ac demo --live` | a new plan from Nemotron (Ultra edit and critic) on **your** Token Factory key, then its steps executed and a sample certified. It refuses to run without a key. The demo keeps its own ledger and cassette in `ac-demo/`, capped at $1. | about $0.20 on your key |

On 2026-10-17 we ran `--env --oracles` on our machine. All 62 trees and the R4 tree matched. The three sample
certificates (steps 1, 4 and 60) and the whole-PR certificate came out with **the recorded digests, byte for byte**:
`sha256:909262855d4a…`, `1b81fb81f24e…`, `b775e6f44ed8…` and `9a5b2404631c…`. In other words, the certificate was
reproduced, not just a verdict.

A live plan is a new sample: it differs from the recorded one, and the demo reports how many of its groups the
recorded plan has too.

## The demo run (runs/immich-ladder)

immich `server/` @ `02063972e8`, run unattended by `ac run` in S6 ([docs/sessions/s6.md](docs/sessions/s6.md)):

- **Plan:** 59 groups, 367 moves. This is the tool's own output, with no hand edits.
- **Commits:** 63 on `ac/s6-ladder` (R1 38, R2 21, R3 3, R4 1). Every step's static certificate passed on the first
  attempt, with 0 pins and 0 replans.
- **Each rung and the whole PR: PASS with the oracles.** tsc reports 0 errors. 105/105 test files and 2,337/2,337
  cases are equal to base. The OpenAPI spec is byte-identical. The whole-PR digest is `sha256:9a5b2404631c…`.
- **R4:** 38 modules and 80 rules. Each rule fired on a synthetic violation (80/80). There are 8 back-edges, and 161
  of today's violations are frozen in the baseline.
- **Findings:** 45, recorded and never fixed. Among them: a 42-folder import cycle; `BaseService` injects 56 members
  into 51 services, which use 5.7 of them on average; 3 tables written by several groups.
- **Time and cost:** 1 h 55 m on a quiet machine. The plan cost $0 because it was replayed ($0.1998 when it was
  recorded); the findings narration cost $0.0010.

## The same task, given to a generic agent (G3)

We gave opencode 1.18.34 with Nemotron 3 Super on Token Factory the same task, with a fixed prompt and no human input
([docs/gates.md](docs/gates.md), G3). Its branches were certified with `ac certify` (`runs/g3/`):

| immich `server/` @ `02063972e8` | ac (the demo run) | opencode + Super, single-shot | opencode + Super, persistent |
|---|---|---|---|
| What the diff is | 367 files moved into 38 modules, 20 platform concerns and `shared/`; 5 renamed | 211 files **copied**, originals kept: a dead tree that nothing imports | 297 moved, 562 copied, 68 edited, 12 Python scripts left behind |
| tsc errors (base 0) | **0** | 1,680 | 768 |
| Unit suite (base: 105 files, 2,337 cases) | **105/105 files, 2,337/2,337 cases** | 2,337/2,337 cases pass, **but 66 of 171 spec files never load** | 5/105 files, 52 cases |
| OpenAPI spec | **byte-identical** | byte-identical (the copies are dead code) | not produced |
| `ac certify` | **PASS** | FAIL | FAIL |
| Cost | $0.20 for the plan, once | $0.30, 169 s | $4.63, 33 min, stopped by the budget cap |

A green test count is not proof: the single-shot branch passes 2,337/2,337 cases, yet its restructure is a dead copy
tree with 1,680 type errors. The certificate says exactly why. The same comparison on mcphub is in `runs/g3/`; both
of its arms fail certification.

## Our own misses

We show these because the checker exists to catch them:
- **Our own executor.** Our R1 step (S3) left coverage globs in immich's `vitest.config.mjs` that still named the
  moved files. The certifier (S4) caught them in K4 and recorded them as a finding, since immich's coverage is
  ungated. The executor now sees such globs (S6).
- **The shakedown run.** In S6 a full run passed, but under load vitest had exited 0 with a 54-file report, and the
  baseline had quarantined 61 of 105 test files. Now a run that stops short is replaced, and flaky files are capped
  at max(2, 2%).
- **R4 against our own certificate.** The first real R4 made the whole-PR certificate FAIL K4 on its own rules file.
  Inert tool configs are now skipped, and only when proven inert.
- **Reviews.** An adversarial review confirmed 17 defects in S6 and refuted none, and 16 in S5. All were fixed with
  regression tests.

## Commands

| Command | What it does |
|---|---|
| `ac demo [--replay \| --live \| --full]` | the judges' path, above |
| `ac plan <repo> --profile <name>` | the plan: facts, seeds draft, Ultra edit, critic, validator (replays a cassette by default) |
| `ac steps <plan.yaml>` | step files from a plan (edit `plan.yaml` first, if you like) |
| `ac move <repo> --map <step.json>` | one step through the executor |
| `ac certify <repo> <base>..<head> [--profile <name>] [--oracles]` | the certificate of any diff |
| `ac run <repo> --profile <name>` | the ladder R0–R4, unattended, with rollback, replan and `--resume` |
| `ac normalize`, `ac boundaries`, `ac findings` | R3, R4 and the findings log on their own |
| `ac report <run-dir>`, `ac site` | the HTML report of a run, and the static replay site |
| `ac scramble`, `ac bench <manifest>` | the benchmarks: type-sliced scrambles of feature-sliced repos, scored against their truth |

Run `npx ac` for every flag. Profiles of the targets live in `profiles/`.

## Repository layout

`src/` is feature-foldered: `analyzer/`, `planner/`, `gateway/`, `executor/`, `certificate/`, `orchestrator/`,
`filename-normalization/`, `boundaries/`, `findings/`, `report/`, `site/`, `scramble/`, `bench/`, `demo/`. Tests are
in `test/` (`npm test`). The plan, the gate results and the session reports are in `docs/`.

## License

MIT, see [LICENSE](LICENSE).
