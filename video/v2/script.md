# v2 video script (≤ 2:55), from the plan

The beats, voice-over and shots of [plan.md](plan.md) (v2.3, agreed with corupta on 2026-10-28), in the format
`video/cut/render.mjs --cut v2` reads: each beat's heading gives its slot, its quoted lines are the voice-over word for
word (the captions), its table names the shots. Timings are corupta's v1 pace (about 135 words a minute with his
pauses) until his takes are in `vo/`; then `edl.json` follows them. No lower thirds: labels sit in the picture
(`edl.json`), and the captions are burned into the review cuts only. Every number is in
[docs/numbers.md](../../docs/numbers.md).

## 0:00–0:07 Hook (16 spoken words)

> Have you ever got lost in a verbose repo, trying to decide where to start refactoring?

| Shot | Lower third |
|---|---|
| `sprawl` (immich's server/src sliced by type, scrolling) | — |

## 0:07–0:21 Intro (28 spoken words)

> This is ac, architecture-cleaner. It moves a TypeScript backend from type folders into feature folders, one commit at a time, each with a proof that nothing else changed.

| Shot | Lower third |
|---|---|
| `glide` (the album, asset and user files glide into their feature folders; the commit, certified) | — |

## 0:21–0:32 Immich (25 spoken words)

> The maintainers of immich, a self-hosted photo and video app, did this by hand: seventeen pull requests in two days.
> Why not an AI agent?

| Shot | Lower third |
|---|---|
| `history` (immich's 17 restructure PRs, March 20–22, 2024; the card) | — |

## 0:32–0:56 Trap (52 spoken words)

> We asked opencode, a popular coding agent, running NVIDIA Nemotron 3 Super on Nebius Token Factory.
> Over 2,000 test cases still passed.
> But it had copied the files, not moved them: 66 test files never loaded, and the compiler found over a thousand errors.
> A passing test count is not proof.

| Shot | Lower third |
|---|---|
| `g3-vitest` (immich's unit suite on opencode's branch, running, in real time) | — |
| `g3-vitest-result` (≈ 1 min later: the summary, a red box around test files and tests) | — |
| `card-agents` (opencode + Nemotron 3 Super: 2,337 / 2,337 test cases pass, but 1,680 compiler errors; Ultra's column faint) | — |

## 0:56–1:10 Model (31 spoken words)

> With Nemotron 3 Ultra, the model ac uses, it burned nearly twelve million tokens and hit its spending limit before rewriting a single import.
> It's not the model. It's the job.

| Shot | Lower third |
|---|---|
| `card-agents-ultra` (the same card, opencode + Nemotron 3 Ultra's column: 11.6M tokens, 0 imports rewritten) | — |

## 1:10–1:26 Split (35 spoken words)

> So ac splits the job.
> Nemotron draws the map: which feature each file belongs to.
> Plain code moves the files, one feature per commit, changing nothing but import paths.
> And a separate checker proves it.

| Shot | Lower third |
|---|---|
| `loop` (map → move → proof → commit) | — |

## 1:26–1:40 Nemotron (33 spoken words)

> Code places the obvious files.
> Nemotron 3 Ultra makes the calls code can't: what counts as one feature, where a contested file belongs.
> A second call reviews the plan.
> Two calls, twenty cents.

| Shot | Lower third |
|---|---|
| `nemotron` (one scene: one feature, a contested file and its reason, the review, then 2 calls · $0.20) | — |

## 1:40–1:58 Catch (40 spoken words)

> Just to test it, we broke one import on purpose.
> The checker named the file and the line: broken for the compiler, the test runner and Node.
> ac rolled the commit back and redid the step without that file.
> Certified.

| Shot | Lower third |
|---|---|
| `loop-fail` (the ✗ → roll back path lit) | — |
| `fault-cert` (the seeded run's certificate: the three lines, the verdict) | — |
| `fault` (attempt 1 ✗ → rolled back → the file stays → attempt 2 ✓) | — |

## 1:58–2:09 Scale (24 spoken words)

> On immich's whole server, unattended: sixty-three commits, each certified, in under two hours.
> The compiler, every test and the API spec: exactly as before.

| Shot | Lower third |
|---|---|
| `run` (63 commits landing on the run's clock) | — |
| `trailer` (the album commit's certificate trailer) | — |
| `card-scale` (compiler: 0 errors · every test passes · API spec identical) | — |

## 2:09–2:29 Yours (46 spoken words)

> You get a branch to review commit by commit, and a plan you can edit.
> Point the checker at any diff: opencode's fails, ours passes.
> And the map can still improve: in early tests, the newer Nemotron 3.5 Super VL already draws better ones.

| Shot | Lower third |
|---|---|
| `branch-log` (the branch's 63 commits) | — |
| `plan-entry` (plan.yaml: how to edit it; the album entry) | — |
| `certify-verdicts` (opencode's branch: FAIL; ours: PASS) | — |
| `card-supervl` (Super VL vs Ultra: better maps on 4 of 5 benchmarks, preliminary) | — |

## 2:29–2:42 Close (23 spoken words)

> Replay every commit yourself: one command, no key, no cost.
> Nemotron draws the map.
> Code moves it.
> A checker proves nothing else changed.

| Shot | Lower third |
|---|---|
| `replay` (`npx ac demo --replay`, its steps matching the recording, sped up) | — |
| `end` (the tagline, the command, the links, the picture from the intro) | — |
