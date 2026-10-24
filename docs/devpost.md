# Devpost submission (draft for corupta's review)

Field by field, ready to paste. Every number is in [numbers.md](numbers.md) (or, for the ones S10 added, in its S10
section); the feedback field is [feedback.md](feedback.md). corupta reviews both and submits (S10, step 4).

## Project name

architecture-cleaner

## Elevator pitch (≤ 200 characters)

Nemotron draws the map. Code moves it. A checker proves nothing else changed. Restructure a TypeScript backend into
feature modules, one certified commit at a time.

## Track

Coding and Agentic Engineering.

## Links

- **Demo URL (the replay site):** https://corupta.github.io/architecture-cleaner/
- **Repository:** https://github.com/corupta/architecture-cleaner (MIT)
- **Video:** VIDEO_URL
- **Test build:** `git clone https://github.com/corupta/architecture-cleaner.git && cd architecture-cleaner && npm ci && npx ac demo --replay`
  (Node ≥ 22.12 and git; no key, $0, about 11 minutes)

## About the project

### The problem

In March 2024, immich's maintainers restructured their server by hand: 17 pull requests over two days. Big
restructures get done by hand, or not at all, because nobody can prove that a tool, or an AI, didn't change behavior.
A green test run isn't that proof. We gave the same job to a generic coding agent on Nemotron: all 2,337 of immich's
test cases still passed, yet 66 test files never loaded and tsc reported 1,680 errors.

### What it does

`ac` restructures a TypeScript backend sliced by technical type (`controllers/`, `services/`, `repositories/`,
`dtos/`) into feature modules (`modules/<feature>/`, `platform/<concern>/`, `shared/`), one commit per step, without
changing behavior, and it proves that each commit didn't.

- **Plan.** Deterministic code reads the repository (imports, DI wiring, tables, routes) and draws a draft map.
  Nemotron 3 Ultra edits the draft and then reviews the result; a validator gate keeps only changes with evidence.
  The plan is a `plan.yaml` you can read and edit.
- **Move.** An executor on the TypeScript compiler API moves one group of files per commit and rewrites only the
  import specifiers that point at them. Every other byte stays identical. No model writes code.
- **Certify.** `ac certify`, a separate program that never imports the executor, checks every commit: the move set is
  complete; only specifier bytes changed; every import resolves to the same file under TypeScript, the test runner
  and the runtime; no config or path string still names an old path; the test inventory and the emit layout are the
  same. On every stage of the ladder it also runs the target's own oracles (tsc, the unit suite, immich's OpenAPI
  spec), which must agree with the base commit. A failing step is rolled back and replanned. It certifies any diff:
  ours, another agent's, a person's.
- **Enforce.** The last rung adds dependency-cruiser boundary rules with today's violations frozen in a baseline, so
  a new forbidden import fails the check.
- **Make the bugs obvious, then resist.** Whatever the new layout reveals is written down as a finding and never
  fixed: on immich, an import cycle through 42 folders, and a base class that injects 56 members into 51 services.

On immich's server, unattended: 63 commits, each certified, in 1 h 55 m. 367 of 563 files moved into 38 feature
modules, 20 platform folders and `shared/`. tsc reports 0 errors, 105/105 test files and 2,337/2,337 cases are equal
to base, and the OpenAPI spec is byte-identical. Every commit carries its certificate's verdict and digest in a
trailer, and the digests reproduce from a fresh clone.

### How we use Nemotron on Nebius Token Factory, and what it cost

Nemotron plans and narrates; it never edits code. A model's mistake can only be a bad plan, and a bad plan can't
change behavior unnoticed: the validator and the certificate are in its way.

- **Nemotron 3 Ultra** (`medium_effort`) edits the deterministic draft: three candidates in one `n=3` call, under a
  strict `json_schema`, ranked by the validator. A second call reviews the winning plan like a staff engineer, and
  the gate drops any suggestion that adds a warning or joins a group without evidence. immich's whole plan: 2 calls,
  **$0.1998**.
- **Nemotron 3.5 Lightning** (thinking off) narrates the findings log, one or two sentences per finding, under a
  lexical guard that drops any narration naming something its evidence doesn't contain: **$0.0010**.
- **Why edit a draft instead of asking for the map?** Our first gate and the literature agree that classic
  clustering beats an LLM drawing a decomposition from nothing. So the draft is deterministic, and Nemotron supplies
  the judgment on top of it: names, contested files, feature or platform. Our benchmarks below show where that wins
  and where it doesn't.
- **The same model, two jobs.** In a generic agent loop, Nemotron 3 Ultra read 11.6 million input tokens in nine
  minutes and left every import of the files it moved dangling (1,638). In `ac` it makes two planning calls for $0.20, code does
  the moves, and the checker proves them.
- **Every call goes through one gateway** over Token Factory's OpenAI-compatible API: strict schemas, reasoning set
  through `chat_template_kwargs`, hard budget caps checked before each call, and a cassette of every request and
  response. That's why the whole demo replays byte for byte, with no key and no cost, for as long as judging runs.
- **Where Token Factory sped the work up:** one key and one client for every Nemotron tier, so comparing models (the
  gates, the generic-agent baseline on Super and then on Ultra, the Super VL bench) was a model id, not an
  integration; strict `json_schema` enforced on every Nemotron model we used, so plans parse on the first try;
  three candidates for the price of one prompt; and a bill that matched our ledger, so the budget caps could be
  trusted.

All of it, from the gate probes to both baseline arms and the Super VL experiments, cost **$35.96** of our $50 cap at
the full input price (Token Factory began discounting cached input during the hackathon, so the bill may be lower).

### The same task, given to a generic agent

opencode 1.18.34 on Nemotron 3 Super, the same task with a fixed prompt and no human input. Its single-shot run copied
211 files and left the originals: 2,337/2,337 cases pass, but 66 of 171 test files never load, and tsc reports 1,680
errors. Its persistent run moved 297 files, copied 562 more into a `src.backup/` tree, and left 768 tsc errors, with 5
of 105 test files loading. Is it just the better model? On Nemotron 3 Ultra, the model `ac` plans with (opencode at
the model's default effort, with its own $2 and $12 caps): the single-shot run ran `ls` on the same two folders 38
times in 48 tool calls and changed nothing ($1.86); the persistent run moved 374 files, rewrote not one import, and
hit its $12 cap after 9 min 26 s ($11.76 at the full input price; 90% of its input came from the prompt cache, which
Token Factory now prices lower). `ac certify` fails every one of those branches, and says exactly why; it passes
ours.

### Benchmarks, losses included

`ac scramble` flattens a feature-modular repository into type folders, in one commit our checker certifies, so the
original folders are the ground truth. Against the best deterministic method (MoJoFM, 0–100), Nemotron's map wins on
hoppscotch (87.59 against 81.38) and on hoppscotch with opaque file names (83.45 against 81.38), and loses on kaneo
(50.65 against 66.90) and on immich (TurboMQ 10.07 against 10.50). It also scores higher on ghostfolio (86.81 against
84.72), but our own validator rejects that plan, so counting only accepted plans it wins on 2 of 5.

Preliminary: Nemotron 3.5 Super VL, with thinking on and 256k tokens to reason, beat Ultra on all four scrambles
(hoppscotch 91.26 against 83.22) at 2.5 times the cost and 6.4 times the time, and showed no difference on immich. The
demo keeps Ultra.

### How we built it

- An executor on the TypeScript 6 compiler API with span-only edits (not ts-morph's `move()`), so a step changes
  specifier bytes and nothing else.
- A certifier that reads two git trees and resolves every import the way TypeScript, the test runner and Node would,
  plus a scan for path strings, globs and configs; it never imports the executor.
- An orchestrator: preflight and a baseline of the target's own tests, then one rung per kind of change, each step
  certified, a failed step rolled back, the file it names pinned and the step replanned; `--resume` after a crash.
- A mutation harness that attacks the checker: 831 mutants over 7 fixtures, 2 synthetic repositories, openhab-cloud,
  two immich steps and 53 hunt cases, all 831 killed by the static checks alone, before a single test case runs.
- A static replay site, rendered from the committed run artifacts, byte-identical across builds, on GitHub Pages.
- Every number in the README, the site and the video is listed with its source and how it was checked (2,489 of
  them).

### Our own misses

The checker exists to catch mistakes, ours included, so we list ours. Our executor's first immich step left coverage
globs naming the moved files, and the certifier caught it. An early full run passed while vitest, under load, had
quietly reported 54 of 105 test files; runs that stop short are now replaced. Our own benchmark scrambles failed our
certifier on false positives, each fixed with a proof, while kaneo's still fails closed. One of those fixes introduced
a false pass, and our review caught it before it shipped. Four adversarial reviews confirmed 79 defects in our own
code, each fixed with a regression test. And one narration our guard let through stays in the findings log as
recorded, labeled as the model's words.

### What's next: Clean Architecture

The hackathon version stops at feature modules with enforced boundaries. The frozen baseline of violations is the
work list for the next part: for each violation, a port and an adapter, proposed as a report first, then applied one
port per step. Inverting a dependency changes call sites and wiring, so a static certificate can't cover it; each
step will need a behavioral oracle (golden-master or differential runs, the target's tests, contract diffs such as
immich's OpenAPI spec), on the same ladder, under the same never-fix rule.

### Try it

- **The replay site:** every recorded run with its certificates and findings, the A/B, the benchmarks. Nothing on it
  calls a model.
- **The test build:** `npx ac demo --replay` in a fresh clone replays the plan from the cassette, executes all 62
  move steps again, checks that every commit's tree equals the recording, and certifies a sample again. No key, $0,
  about 11 minutes. With immich's dependencies installed, `--env <checkout> --oracles` reproduces the recorded
  certificates' digests byte for byte (about 20 minutes).

## Built with

typescript, node.js, nvidia-nemotron, nemotron-3-ultra, nemotron-3.5-lightning, nebius-token-factory, openai-sdk,
undici, zod, yaml, dependency-cruiser, graphology, vitest, git, github-pages, github-actions, playwright, vhs, ffmpeg

For corupta to decide: `nvidia-jetson-agx-orin` (every run, the oracles and the video were made on a Jetson AGX Orin
64 GB, JetPack 6.2, CPU only: L4T R36.4.3, 12 Cortex-A78AE cores, the Orin's DLA and PVA devices) and `claude-code`
(it did most of the building, CLAUDE.md).

## Feedback on Nebius Token Factory, AI Cloud and NVIDIA tools

Paste [feedback.md](feedback.md)'s summary; link the full write-up
(https://github.com/corupta/architecture-cleaner/blob/main/docs/feedback.md).
