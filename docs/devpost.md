# Devpost submission (draft for corupta's review)

Field by field, ready to paste. Every number is in [numbers.md](numbers.md), the ones S10 added in its S10 section;
the feedback field is [feedback.md](feedback.md). corupta reviews both and submits (S10, step 4). Push `main` before
submitting, so the links resolve.

## Project name

architecture-cleaner

## Elevator pitch (≤ 200 characters)

Nemotron draws the map. Code moves it. A checker proves nothing else changed. An unattended agent restructures a
TypeScript backend into feature modules, one certified commit at a time.

## Track

Coding and Agentic Engineering.

## Links

- **Demo URL (the replay site):** https://corupta.github.io/architecture-cleaner/
- **Repository:** https://github.com/corupta/architecture-cleaner (MIT)
- **Video:** VIDEO_URL (public on YouTube; the same link as the README's)
- **Test build:** `git clone https://github.com/corupta/architecture-cleaner.git && cd architecture-cleaner && npm ci && npx ac demo --replay`
  (Node ≥ 22.12, git and network access for npm and one fetch of immich; no key, $0, about 11 minutes on our
  12-core machine)

## About the project

### The problem

Many TypeScript backends are sliced by technical type, so every feature is spread over `controllers/`, `services/`,
`repositories/` and `dtos/`. Moving to feature modules is mechanical, but it touches hundreds of files at once, so it
gets done by hand or it stalls halfway. Unleash started moving to feature folders in October 2023 (PR #4994); of the
controller that PR left behind, a reviewer wrote "we can move it any time", and three years later it is still in
`src/lib/routes/`, with `src/lib/features/` beside `src/lib/services/`. n8n's `packages/cli` has `modules/` beside
`controllers/` and `services/`. Even a reorganization maintainers want is hand work: in March 2024, immich's
maintainers reorganized their server in 17 pull requests over two days.

Moving the files isn't the hard part; trusting the diff is, and a green test run isn't enough. We gave this job to a
generic coding agent on Nemotron 3 Super: all 2,337 of immich's test cases still passed, yet 66 test files never
loaded and tsc reported 1,680 errors.

`ac` is for maintainers who want feature modules without doing the move by hand, and for anyone reviewing a large
move made by an agent or a person: `ac certify` checks a diff it didn't make.

### What it does

`ac` restructures a TypeScript backend sliced by technical type into feature modules (`modules/<feature>/`,
`platform/<concern>/`, `shared/`), one commit per step, without changing behavior, and a separate checker certifies
every commit.

`ac run` is the agent, and it runs unattended: it plans with Nemotron, writes each step's commit with a compiler-API
executor, runs the target's own tests (a baseline first, then tsc, the unit suite and immich's OpenAPI spec on every
rung and on the whole PR) and certifies every commit. When a certificate fails, it rolls the commit back, pins the file
the certificate names and runs the step again without it; it does that at most twice, then pins the whole step and
logs a finding. `--resume` continues after a crash. Nemotron makes the calls a deterministic tool can't; it writes no
code, so every changed byte is written by deterministic code and checked by the certificate.

- **Plan.** Deterministic code reads the repository (imports, DI wiring, tables, routes) and draws a draft map.
  Nemotron 3 Ultra edits the draft and then reviews the result; a validator ranks the edits and drops any review
  change that adds a warning or joins a group without evidence (an import edge, a table, a route). The plan is a
  `plan.yaml` you can read and edit.
- **Move.** An executor on the TypeScript compiler API moves one group of files per commit and rewrites only the
  import specifiers that point at them. Every other byte stays identical.
- **Certify.** `ac certify`, a separate program that never imports the executor, checks every commit: the move set is
  complete; only specifier bytes changed; every import resolves to the same file under TypeScript, the test runner
  and the runtime; no config or path string still names an old path; the test inventory and the emit layout are the
  same. On each rung of the ladder and on the whole PR (not on each move step), it also runs the target's own oracles
  (tsc, the unit suite, immich's OpenAPI spec), which must agree with the base commit. It certifies any diff: ours,
  another agent's, a person's. Each certificate also lists what it can't see: consumers outside the repository, files
  read at runtime, environment-dependent resolution such as `NODE_PATH`, stack-trace text, and CI triggers or
  CODEOWNERS keyed by path.
- **Enforce.** The last rung adds dependency-cruiser boundary rules with today's violations frozen in a baseline, so
  a new forbidden import fails the check.
- **Make the bugs obvious, then resist.** Whatever the new layout reveals is written down as a finding and never
  fixed: on immich, an import cycle through 41 of 70 folders (42 of 73 in R4's count, which splits nested folders),
  and a base class that injects 56 members into 51 services.
- **What you get.** A branch of small commits you can review or bisect, each with its certificate's verdict and
  digest in a trailer; `plan.md` to read and `plan.yaml` to edit; the findings log; an HTML report; and, for a
  repository it can't certify, a refusal with the reasons before any branch or commit exists.

### On immich

On immich's server, unattended: 63 commits, each certified, in 1 h 55 m. 367 of 563 files moved into 38 feature
modules, 20 platform folders and `shared/`. tsc reports 0 errors, 105/105 test files and 2,337/2,337 cases are equal
to base, and the OpenAPI spec is byte-identical. From a fresh clone, with immich's dependencies installed, the replay
reproduces the digests of three sampled step certificates and of the whole-PR certificate, byte for byte.

No step failed in that run, so to show the loop recovering we seeded a wrong move: `ac run --inject-fault 2:M2`
replaces step 2's commit with one that leaves one import unrewritten. The certificate fails it (K3a, K3b, K3c), the
commit is rolled back, `album.dto.ts` is pinned, the step passes without it, and the R1 rung then passes with the
oracles (13 m 37 s; `runs/immich-fault` on the replay site).

### The same task, given to a generic agent

opencode 1.18.34 on Nemotron 3 Super, the same task with a fixed prompt and no human input. Its single-shot run copied
211 files and left the originals: 2,337/2,337 cases pass, but 66 of 171 test files never load, and tsc reports 1,680
errors. Its persistent run moved 297 files, copied 562 more into a `src.backup/` tree, and left 768 tsc errors, with 5
of 105 test files loading. Is it just the better model? On Nemotron 3 Ultra, the model `ac` plans with (opencode at
the model's default effort, with its own $2 and $12 caps): the single-shot run ran `ls` on the same two folders 38
times in 48 tool calls and changed nothing ($0.55 billed; its $2 cap, counted at the full input price, stopped it at $1.86); the persistent run
moved 374 files, rewrote not one import, and hit its $12 cap after 9 min 26 s ($2.55 billed: 90% of its input came from the prompt cache, which our caps counted at the full
price). `ac certify` fails every branch that
changed something (Ultra's single-shot run changed nothing, so there was nothing to certify), and says exactly why; it
passes ours.

### Try it

- **In two minutes, on the replay site:** the A/B page (https://corupta.github.io/architecture-cleaner/ab/) puts the
  generic agent's branches and ours side by side under the same checker; `immich-fault`
  (https://corupta.github.io/architecture-cleaner/runs/immich-fault/) shows the loop rolling back a seeded bad
  commit; `immich-ladder` (https://corupta.github.io/architecture-cleaner/runs/immich-ladder/) has all 63
  certificates and the 45 findings. Nothing on the site calls a model.
- **The test build:** `npx ac demo --replay` in a fresh clone replays the plan from the cassette, executes all 62 move
  steps and R4's rules commit again, checks that each commit's tree equals the recording, and certifies a sample
  again. No key, $0, about 11 minutes. With immich checked out and its dependencies and SDK builds installed (the
  README's full reproduction, under Node 24.21.0), `--env <checkout> --oracles` reproduces the digests of the three
  sampled certificates and of the whole-PR certificate byte for byte (about 20 minutes).

### How we use Nemotron on Nebius Token Factory, and what it cost

Nemotron plans and narrates; it never edits code. A model's mistake can only be a bad plan or a wrong sentence in the
findings log (one is on record, below), and neither can change code: a bad plan meets the validator, and every commit
made from it meets the certificate.

- **Nemotron 3 Ultra** (`medium_effort`) edits the deterministic draft: three candidates in one `n=3` call, under a
  strict `json_schema`, ranked by the validator. A second call reviews the winning plan like a staff engineer, and
  the gate drops any suggestion that adds a warning or joins a group without evidence. immich's whole plan: 2 calls,
  **$0.1998**.
- **Nemotron 3.5 Lightning** (thinking off) narrates the findings log, one or two sentences per finding, under a
  lexical guard that drops any narration naming something its evidence doesn't contain: **$0.0010**.
- **Why edit a draft instead of asking for the map?** In our first gate, asked to list every file's group, Nemotron 3
  Super and Ultra dropped 10–15% of hoppscotch's 189 files and 26–45% of kaneo's 456, and the literature finds
  classic clustering ahead of LLM decompositions. So the draft is deterministic and complete, and Nemotron supplies
  the judgment on top of it: names, contested files, feature or platform. Our benchmarks below show where that wins
  and where it doesn't.
- **The same model, two jobs.** In a generic agent loop, Nemotron 3 Ultra read 11.6 million input tokens in nine
  minutes and left every import of the files it moved dangling (1,638). In `ac` it makes two planning calls for
  $0.20, code does the moves, and the checker proves them.
- **Every call `ac` makes goes through one gateway** over Token Factory's OpenAI-compatible API: strict schemas,
  reasoning set through `chat_template_kwargs`, hard budget caps checked before each call, and a cassette of every
  request and response. That's why the replay needs no key, costs nothing and never calls Token Factory: the plan,
  every commit's tree and the findings log come out identical to the recording.
- **Where Token Factory sped the work up:** one key and one OpenAI-compatible client for every Nemotron tier, so each
  model comparison was a model id (Super VL's longest answers also needed streaming, past the 10-minute limit for
  non-streamed calls); strict `json_schema` on every Nemotron model we used, so every finished answer parses against
  its schema on the first try, with no repair loop; and `n=3` with the prompt billed once (details in the README).

All of it, from the gate probes to both baseline arms and the Super VL experiments, came to **$24.40** on Token
Factory's bill, of our $50 cap, and our ledger reconciles with that bill to the cent.

### Benchmarks, losses included

`ac scramble` flattens a feature-modular repository into type folders, in one commit our checker checks (three
scrambles pass; kaneo's fails closed), so the original folders are the ground truth. Against the best deterministic
method (MoJoFM, 0–100), the planner's map wins on hoppscotch (87.59 against 81.38 in the recorded run; three fresh
Ultra runs of the same request scored 81.38 to 84.83, mean 83.22) and on hoppscotch with opaque file names (83.45
against 81.38), and loses on kaneo (50.65 against 66.90) and on immich (TurboMQ 10.07 against 10.50). It also scores
higher on ghostfolio (86.81 against 84.72), but our own validator rejects that plan, so counting only accepted plans
it wins on 2 of 5.

Preliminary: Nemotron 3.5 Super VL, with thinking on and 256k tokens to reason, beat Ultra on all four scrambles
(hoppscotch 91.26 against Ultra's 83.22 mean) at 2.5 times the cost (at the full input price; 2.7 times as billed) and 6.4 times the time, and showed no difference
on immich. The limits: three runs per entry, possible recall of these public projects, and Ultra compared only at
`medium_effort`. The demo keeps Ultra: immich shows no gain, and the recorded run reproduces byte for byte.

### What's new, and what isn't

Moving TypeScript files with their imports rewritten is a commodity (ts-morph, IDE refactorings), and so is an LLM
deciding while a deterministic engine moves: the closest tool we found, `@demlik/structure-sweep` (first published on
npm on 2026-09-24), asks an LLM for each file's feature and rewrites the imports with ts-morph. The ideas under our
checker are old too: translation validation (Pnueli, Siegel and Singerman 1998; Necula 2000) and refactorings that
preserve name binding (Schäfer et al.). What we didn't find in our search (2026-10-01/02): a checker, separate from the
tool that made the change, that certifies each step of a module move by translation validation (the move set
complete, only specifier bytes changed, every import resolving to the same file under the compiler, the test runner
and the runtime) and certifies any diff, ours or another agent's; and findings recorded and never fixed, as a
contract.

### Our own misses

The checker exists to catch mistakes, ours included, so we list ours. Our executor's first immich step left coverage
globs naming the moved files, and the certifier caught it. An early full run passed, but under load vitest had exited
0 after reporting 54 of 105 test files, and the baseline had quarantined 61 of them; a run that stops short is now
replaced. Our own benchmark scrambles failed our certifier on false positives, each fixed with a proof, while kaneo's
still fails closed. One of those fixes introduced a false pass, and our review caught it before it shipped. Four
adversarial reviews confirmed 79 defects in our own code, each fixed with a regression test. And one narration our
guard let through stays in the findings log as recorded, labeled as the model's words.

### How we built it

- A mutation harness that attacks the checker: 831 mutants over 7 fixtures, 2 synthetic repositories, openhab-cloud,
  two immich steps and 53 hunt cases, all 831 killed by the static checks alone, before a single test case runs.
- A static replay site, rendered from the committed run artifacts, byte-identical across builds, on GitHub Pages.
- Built by corupta with Claude Code (over Paseo, with Claude Opus 5.5 at the ultracode effort setting) doing most of
  the implementation; corupta set the direction, made the decisions and reviewed. Every session's report is in
  `docs/sessions/`. Every run, the oracles and the video were made on an NVIDIA Jetson AGX Orin 64 GB (JetPack 6.2), on its CPU
  (the models ran on Token Factory).
- Every number in the README, the storyboard, the site and the video is listed with its source and how it was checked
  ([numbers.md](https://github.com/corupta/architecture-cleaner/blob/main/docs/numbers.md)): 2,489 at the freeze, and
  an S10 section for the ones added since.

### What's next: Clean Architecture

The hackathon version stops at feature modules with enforced boundaries. The frozen baseline of violations is the
work list for the next part: for each violation, a port and an adapter, proposed as a report first, then applied one
port per step. Inverting a dependency changes call sites and wiring, so a static certificate can't cover it; each
step will need a behavioral oracle (golden-master or differential runs, the target's tests, contract diffs such as
immich's OpenAPI spec), on the same ladder, under the same never-fix rule.

## Built with

typescript, node.js, nvidia-nemotron, nemotron-3-ultra, nemotron-3.5-lightning, nemotron-3-super,
nemotron-3.5-super-vl, nebius-token-factory, openai-sdk, undici, zod, yaml, dependency-cruiser, graphology, vitest,
git, github-pages, github-actions, playwright, vhs, ffmpeg, nvidia-jetson-agx-orin, claude-code, paseo

(The Jetson AGX Orin 64 GB, JetPack 6.2 (L4T R36.4.3), ran every run, the oracles and the video on its 12 Cortex-A78AE
CPU cores; its GPU, DLA and PVA were not used.)

## Feedback on Nebius Token Factory, AI Cloud and NVIDIA tools

Paste [feedback.md](feedback.md)'s opening paragraph and "The ten we'd fix first", then link the full write-up:
https://github.com/corupta/architecture-cleaner/blob/main/docs/feedback.md
