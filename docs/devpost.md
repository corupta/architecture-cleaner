# Devpost submission (draft for corupta's review)

Field by field, ready to paste. Every number is in [numbers.md](numbers.md), the ones S10 added in its S10 section;
the feedback field is [feedback.md](feedback.md). corupta reviews both and submits (S10, step 4). Push `main` before
submitting, so the links resolve.

# Project name

architecture-cleaner

# Elevator pitch (≤ 200 characters)

Nemotron draws the map. Code moves it. A checker proves nothing else changed. An unattended agent restructures a TypeScript backend into feature slices, one certified commit at a time.

# Track

Coding and Agentic Engineering.

# Links

- **Demo URL (the replay site):** https://corupta.github.io/architecture-cleaner/
- **Repository:** https://github.com/corupta/architecture-cleaner (MIT)
- **Video:** https://youtu.be/VJoate5NmEM (public on YouTube, 2:52.7, English captions, chapters; the same link as the README's; it replaced the first video, youtu.be/C1lzr74Ozd4, on 2026-10-30)
- **Test build:** `git clone https://github.com/corupta/architecture-cleaner.git && cd architecture-cleaner && npm ci && npx ac demo --replay`
  (Node ≥ 22.12, git and network access for npm and one fetch of immich; no key, $0, about 11 minutes on our
  12-core machine)

# About the project

## The problem

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

## What it does

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

## On immich

On immich's server, unattended: 63 commits, each certified, in 1 h 55 m. 367 of 563 files moved into 38 feature
modules, 20 platform folders and `shared/`. tsc reports 0 errors, 105/105 test files and 2,337/2,337 cases are equal
to base, and the OpenAPI spec is byte-identical. From a fresh clone, with immich's dependencies installed, the replay
reproduces the digests of three sampled step certificates and of the whole-PR certificate, byte for byte.

No step failed in that run, so to show the loop recovering we seeded a wrong move: `ac run --inject-fault 2:M2`
replaces step 2's commit with one that leaves one import unrewritten. The certificate fails it (K3a, K3b, K3c), the
commit is rolled back, `album.dto.ts` is pinned, the step passes without it, and the R1 rung then passes with the
oracles (13 m 37 s; `runs/immich-fault` on the replay site).

## The same task, given to a generic agent

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

## Try it

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

## How we use Nemotron on Nebius Token Factory, and what it cost

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

## Benchmarks, losses included

`ac scramble` flattens a feature-modular repository into type folders, in one commit our checker checks (three
scrambles pass; kaneo's fails closed), so the original folders are the ground truth. Against the best deterministic
method (MoJoFM, 0–100), the planner's map wins on hoppscotch (87.59 against 81.38 in the recorded run; three fresh
Ultra runs of the same request scored 81.38 to 84.83, mean 83.22) and on hoppscotch with opaque file names (83.45
against 81.38), and loses on kaneo (50.65 against 66.90) and on immich (MoJoFM 88.37 against 93.02). It also scores
higher on ghostfolio (86.81 against 84.72), but our own validator rejects that plan, so counting only accepted plans
it wins on 2 of 5.

Preliminary: Nemotron 3.5 Super VL, with thinking on and 256k tokens to reason, beat Ultra on all four scrambles
(hoppscotch 91.26 against Ultra's 83.22 mean) at 2.5 times the cost (at the full input price; 2.7 times as billed) and 6.4 times the time, and showed no difference
on immich. The limits: three runs per entry, possible recall of these public projects, and Ultra compared only at
`medium_effort`. The demo keeps Ultra: on immich there is no measurable difference, and the recorded run reproduces byte for byte.

## What's new, and what isn't

Moving TypeScript files with their imports rewritten is a commodity (ts-morph, IDE refactorings), and so is an LLM
deciding while a deterministic engine moves: the closest tool we found, `@demlik/structure-sweep` (first published on
npm on 2026-09-24), asks an LLM for each file's feature and rewrites the imports with ts-morph. The ideas under our
checker are old too: translation validation (Pnueli, Siegel and Singerman 1998; Necula 2000) and refactorings that
preserve name binding (Schäfer et al.). What we didn't find in our search (2026-10-01/02): a checker, separate from the
tool that made the change, that certifies each step of a module move by translation validation (the move set
complete, only specifier bytes changed, every import resolving to the same file under the compiler, the test runner
and the runtime) and certifies any diff, ours or another agent's; and findings recorded and never fixed, as a
contract.

## Our own misses

The checker exists to catch mistakes, ours included, so we list ours. Our executor's first immich step left coverage
globs naming the moved files, and the certifier caught it. An early full run passed, but under load vitest had exited
0 after reporting 54 of 105 test files, and the baseline had quarantined 61 of them; a run that stops short is now
replaced. Our own benchmark scrambles failed our certifier on false positives, each fixed with a proof, while kaneo's
still fails closed. One of those fixes introduced a false pass, and our review caught it before it shipped. Four
adversarial reviews confirmed 79 defects in our own code, each fixed with a regression test. And one narration our
guard let through stays in the findings log as recorded, labeled as the model's words.

## How we built it

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

## What's next: Clean Architecture

The hackathon version stops at feature modules with enforced boundaries. The frozen baseline of violations is the
work list for the next part: for each violation, a port and an adapter, proposed as a report first, then applied one
port per step. Inverting a dependency changes call sites and wiring, so a static certificate can't cover it; each
step will need a behavioral oracle (golden-master or differential runs, the target's tests, contract diffs such as
immich's OpenAPI spec), on the same ladder, under the same never-fix rule.

# Built with

typescript, node.js, nvidia-nemotron, nemotron-3-ultra, nemotron-3.5-lightning, nemotron-3-super,
nemotron-3.5-super-vl, nebius-token-factory, openai-sdk, undici, zod, yaml, dependency-cruiser, graphology, vitest,
git, github-pages, github-actions, playwright, vhs, ffmpeg, nvidia-jetson-agx-orin, claude-code, paseo

(The Jetson AGX Orin 64 GB, JetPack 6.2 (L4T R36.4.3), ran every run, the oracles and the video on its 12 Cortex-A78AE
CPU cores; its GPU, DLA and PVA were not used.)

# Thumbnail and gallery

**Project thumbnail (3:2):** `thumbnail-devpost.png` (1080×720; `cards/thumbnail.html?layout=devpost`, rendered by
`node video/diagram/render.mjs`).

**Gallery** (3:2, 1920×1280, from the video's own captures, in story order), with captions:
1. `01-thumbnail.png`: Nemotron draws the map. Code moves it. A checker proves nothing else changed.
2. `02-what-ac-does.png`: What ac does: immich's real files, sliced by type before, by feature after 63 certified commits.
3. `03-ab-super.png`: A generic agent (opencode on Nemotron 3 Super) on the same task: its tests pass, its certificate fails.
4. `04-ab-ultra.png`: The same agent on Nemotron 3 Ultra: 374 files moved, no import rewritten, $2.55 billed when its cap stopped it.
5. `05-plan.png`: The plan: Nemotron 3 Ultra's placements for immich, each with its rationale; $0.1998 for the whole plan.
6. `06-certificate.png`: A step's certificate: every check passes, and its digest is the one in the commit's trailer.
7. `07-ladder.png`: The ladder: 63 commits on immich, each certified; every rung passes with tsc, the 2,337 tests and the OpenAPI spec.
8. `08-seeded-fault.png`: A seeded wrong move: the certificate fails it, the commit is rolled back, the file pinned, the step passes without it.
9. `09-graph.png`: Before and after: 367 of 563 files moved into 38 feature modules; the largest import cycle grows from 12 of 14 folders to 41 of 70.
10. `10-findings.png`: Findings, recorded and never fixed: a base class injects 56 members into 51 classes.
11. `11-boundaries.png`: Boundary rules: a new forbidden import fails the check; 161 of today's violations are frozen.
12. `12-mutation.png`: We attacked the checker: 831 mutants, all 831 rejected by the static checks before a test runs.
13. `13-bench.png`: Benchmarks with the losses: the planner against the best classic method on five entries.
14. `14-super-vl.png`: Preliminary: Nemotron 3.5 Super VL with room to think, against Ultra; three runs per entry.
15. `15-replay.png`: The test build, no key and no cost: npx ac demo --replay rebuilds every commit, and every tree equals the recording.

# Feedback on Nebius Token Factory, AI Cloud and NVIDIA tools

The form's Additional info questions (below) carry it: condensed answers in the text fields, and the full write-up
([feedback.md](feedback.md)), the running log and these answers in the uploaded `architecture-cleaner-feedback.zip`.

# Additional info (for judges and organizers)

The form's fields, in its order. The ratings are corupta's call; the numbers are suggestions with the reasons. The
same answers, the full feedback write-up and the running log go in the uploaded file (`architecture-cleaner-feedback.zip`).

**Upload a file:** `architecture-cleaner-feedback.zip`: the feedback write-up (36 items, each with evidence, request
ids and a fix), the running log (items 1–66, with our earlier log re-checked on 2026-10-24) and these answers, as
Markdown and PDF.

**Submitter type:** Individual. **Organization:** N/A. **Country:** Turkey. **Canada province:** N/A.
**Track:** Coding and agentic engineering. **New or existing:** New.

**Repository:** https://github.com/corupta/architecture-cleaner
**Demo:** https://corupta.github.io/architecture-cleaner/

**Which model(s) did you use, and why did you choose that size/variant?**

Nemotron 3 Ultra (550B-A55B), at medium effort, is the planner: it edits a deterministic draft map of the repository and then reviews its own plan. We chose the largest model because this is a judgment call over a whole repository (which feature a contested file belongs to, what to call a module), made twice per run, so quality matters more than price: immich's whole plan cost $0.20. Medium effort keeps its reasoning bounded (finished edits peak near 25k tokens), which made unattended runs under hard budget caps predictable. 

Nemotron 3.5 Lightning, thinking off, narrates the findings log: many short, grounded paraphrases, where speed and cost matter and a lexical guard checks each one ($0.0010 for immich). 

Nemotron 3 Super (120B-A12B) runs our baseline, the generic coding agent we compare against. 

We also measured Nemotron 3.5 Super VL as the planner: with thinking on and 256k tokens per answer it beat Ultra on all four of our scramble benchmarks at 2.5 times the cost and 6.4 times the time, and showed no difference on immich, so the demo keeps Ultra (preliminary: three runs per entry).

**How would you rate Nemotron's output quality for your use case? (1–10)** Suggested: **7**.

What worked well: instruction-following inside a strict schema. Every finished answer in our recordings (214 of 214) validated against its JSON schema, including schemas with 114 required keys. Ultra's judgment on top of a deterministic draft (names, contested files, feature or platform) is where it adds value, and its review of its own plan raises real points (6 of its 12 suggestions on immich passed our evidence gate). 

What fell short: asked to place every file from scratch, Super and Ultra dropped 10–15% of hoppscotch's 189 files and 26–45% of kaneo's 456, so the model never draws the map alone; 5 of Ultra's 128 paid answers looped until the token cap; on our benchmarks the planner beats the best classic method on 2 of 5 entries, counting only plans our validator accepts; and in a generic agent loop at its default settings, Ultra ran "ls" on the same two folders 38 times in 48 tool calls.

**Did you fine-tune, prompt-engineer, or use Nemotron out of the box? What was your approach?**

Out of the box, no fine-tuning. 

The approach is structure more than prompting. Deterministic code reads the repository (imports, DI wiring, tables, routes) and draws a draft map. Ultra edits it in one n=3 call (three candidates) under a strict "json_schema" with one required key per draft group, so it can't skip a group; a validator ranks the candidates; a second call reviews the winning plan, and a gate keeps only changes backed by evidence (an import edge, a table, a route). Reasoning is set through "chat_template_kwargs" ("medium_effort" for Ultra, thinking off for Lightning). Every request and response is recorded, so the demo replays byte for byte with no key. Plan quality improves in the tool (validator rules, the critic's gate), never by editing a plan by hand. No model writes code: a compiler-API executor moves the files, and a separate checker certifies every commit.

**How did Nemotron's performance compare to other models you've used for similar tasks?**

We compared within the Nemotron family and against classic methods, not against other vendors' models. Ultra at "medium_effort" gave the best edits in our first gate; Super matched it on one benchmark when it finished, but often stopped at its 32,768-token output limit; Super VL with room to think planned better than Ultra on our scrambles (above).

Against classic clustering (Louvain) and our deterministic draft, the fair baseline for drawing module boundaries, Nemotron's edits win on 2 of 5 entries and lose on 2, which matches the literature (classic methods beat LLM decompositions). That's why Nemotron edits a deterministic draft instead of drawing the map, and why a checker, not the plan, carries the proof. The sharpest comparison is the same model in two jobs: in a generic agent loop, Ultra moved 374 files and rewrote no import within its spending limit; in "ac" it makes two planning calls for $0.20 and every commit is certified.

**Which Nebius platform capabilities were most valuable to your project and how?**

Token Factory's serverless, OpenAI-compatible API, with no GPU instances: we used no Nebius AI Cloud compute, since "ac"s own work (moving files, certifying, running the target's tests) is CPU work, done on our own machine (an NVIDIA Jetson AGX Orin). 

Most valuable: one key and one client for every Nemotron tier, so each model comparison was a model id, not an integration; strict "json_schema" on every Nemotron model we used; n=3 with the prompt billed once; "chat_template_kwargs" for reasoning effort; streaming, which let Super VL reason past the 10-minute limit for non-streamed calls; the implicit prompt cache and its new price (our Ultra baseline was billed $3.15 instead of $13.70); and a bill that reconciles with our usage-based ledger to the cent ($24.40 for the whole hackathon), so our hard budget caps could be trusted.

**How likely are you to recommend running Nemotron on Nebius to other developers? (1–10)** Suggested: **8**.

For: quick to integrate and reliable (857 chat completions over 22 days, never a 429; every long streamed answer completed), strict structured output, every Nemotron tier behind one key, a bill you can reconcile. 

Against: documentation gaps we found by measuring (the 600 s limit on non-streamed calls, which answers with an HTML 504; Super's silent 32,768-token output limit; rate-limit headers that count characters, not tokens; undocumented reasoning controls) and a serverless prompt cache that the docs say is shared across organizations. The full write-up is in the uploaded file.

**How would you rate your experience running Nemotron inference on Nebius compared to previous cloud or local
development environments? (1–10)** Suggested: **8**.

Compared with hosting open models ourselves: nothing to deploy, and a 550B model is out of reach locally, while Token Factory served it at $0.20 per plan. Compared with other hosted APIs: OpenAI compatibility meant our client, our recordings and the baseline agent worked unchanged. What kept it from higher is the limits and behaviors we had to discover by measuring (the uploaded write-up lists each with its evidence).

**What additional features or improvements would have made the Nemotron on Nebius experience more effective?**

The ten we'd fix first (details, evidence and request ids in the uploaded write-up):
1. Scope the serverless prompt cache per organization, or offer an opt-out, and say so in the ZDR terms.
2. A dated pricing changelog (cached input became 80–88% cheaper mid-hackathon with no effective date).
3. Document the 600 s limit on non-streamed calls, and answer it with a JSON error and a request id.
4. Publish max output tokens per model, and reject or visibly clamp a larger "max_tokens" (Super stops at 32,768).
5. Document what the rate-limit counter counts, and enforce or flag over-limit traffic as documented.
6. Bound whitespace under strict "json_schema" (three answers ran to their cap on whitespace).
7. One reasoning parser for every model (Ultra returns truncated reasoning as "content").
8. Document the reasoning controls, and a reasoning budget for Super VL.
9. Tag structured output on the Nemotron models in the catalog.
10. Code samples on served models, with one Nemotron sample using reasoning controls and strict "json_schema".

**What do you most hope to see from the Nemotron team next?**

A documented reasoning budget, a token target the model plans within rather than a hard cut, for Super VL above all: with room to think it planned better than Ultra on our scrambles, but needed a median of about 118k tokens per answer. 
Published evaluations in common agent harnesses at their default settings. 
Complete coverage on long lists under structured output (no dropped or duplicated ids). 
Guidance against repetition loops with reasoning plus strict JSON. 
And more mid-size models: Ultra's judgment at Super VL's price would let us plan every step, not once per run.

**Did you use Tavily?** No. **IRL event city:** none.

**Which AI tools have you leveraged while working on this project?**

Claude Code (Anthropic), over Paseo, with Claude Opus 5.5 at the ultracode effort setting, did most of the implementation under my direction; I set the direction, made the decisions and reviewed. 
NVIDIA Nemotron (3 Ultra and 3.5 Lightning in the product; 3 Super and 3.5 Super VL in experiments) on Nebius Token Factory at runtime.
opencode, as the baseline agent we compare against, not in the product. 
Vosk, offline speech recognition, to time the video's captions.

**Level of learning:** Significant. **AI value for your career:** Yes.
