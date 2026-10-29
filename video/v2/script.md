# v2 video script (≤ 2:55), from the plan

The beats, voice-over and shots of [plan.md](plan.md) after corupta's notes on animatic 1 (2026-10-29: decision 10), in the
format `video/cut/render.mjs --cut v2` reads: each beat's heading gives its slot, its quoted lines are the voice-over word
for word (the captions), its table names the shots. corupta revises the wording before he records; the times are his v1
pace (about 135 words a minute with his pauses) until his takes are in `vo/`, then `edl.json` follows them. No lower
thirds; the captions are burned into the review cuts only. Every number is in [docs/numbers.md](../../docs/numbers.md).

## 0:00–0:07.1 Hook (16 spoken words)

> Have you ever got lost in a verbose repo, trying to decide where to start refactoring?

| Shot | Lower third |
|---|---|
| `sprawl` (immich's server/src sliced by type, scrolling) | — |

## 0:07.1–0:20.5 Intro (28 spoken words)

> This is ac, architecture-cleaner.
> It moves a TypeScript backend from type folders into feature folders, one commit at a time, each with a proof that nothing else changed.

| Shot | Lower third |
|---|---|
| `glide` (the album, asset and user files glide into their feature folders; the commit, certified) | — |

## 0:20.5–0:31.6 Immich (25 spoken words)

> The maintainers of immich, a self-hosted photo and video app, did this by hand: seventeen pull requests in two days.
> Why not an AI agent?

| Shot | Lower third |
|---|---|
| `history` (immich's 17 restructure PRs as a GitHub-style list, scrolling; then 17 pull requests in 2 days, by hand) | — |

## 0:31.6–0:53.1 Trap (45 spoken words)

> We asked opencode, a popular coding agent, running NVIDIA Nemotron 3 Super on Nebius Token Factory.
> Over 2,000 test cases still passed, but 66 test files never loaded.
> And the TypeScript compiler found over a thousand errors.
> A passing test count is not proof.

| Shot | Lower third |
|---|---|
| `g3-vitest` (immich's unit suite on opencode's branch, running, in real time) | — |
| `g3-vitest-result` (its summary, a red box around test files and tests) | — |
| `card-agents` (opencode + Nemotron 3 Super: 2,337 test cases pass, but 1,680 compiler errors) | — |

## 0:53.1–1:04.7 Model (26 spoken words)

> With Nemotron 3 Ultra, it used nearly twelve million tokens, and hit the spending limit even before rewriting imports.
> It's not the model. It's the job.

| Shot | Lower third |
|---|---|
| `card-agents-ultra` (opencode + Nemotron 3 Ultra joins: 11.6M tokens, but 0 imports rewritten (spending limit reached)) | — |

## 1:04.7–1:26 Split (48 spoken words)

> So ac splits the job.
> Nemotron draws the map: which feature each file belongs to.
> Two calls on Nebius Token Factory, twenty cents.
> Plain code moves the files and updates their imports, one feature per commit.
> And a separate checker proves every import still reaches the same file.

| Shot | Lower third |
|---|---|
| `loop` (Nemotron → plain code → the checker → commit, each block current in turn; 2 calls · $0.20) | — |

## 1:26–1:40.2 Catch (31 spoken words)

> Just to test it, we broke one import on purpose.
> The checker named the file and the line.
> ac rolled the commit back and redid the step without that file.
> Certified.

| Shot | Lower third |
|---|---|
| `loop-fail` (the same picture: the checker and the roll-back path turn red) | — |
| `fault-cert` (the seeded run's certificate, a red box around the file and the line) | — |
| `fault` (attempt 1 ✗ → rolled back → album.dto.ts stays → attempt 2 ✓) | — |

## 1:40.2–1:52.1 Scale (24 spoken words)

> On immich's whole server, unattended: sixty-three commits, each certified, in under two hours.
> The compiler, every test and the API spec: exactly as before.

| Shot | Lower third |
|---|---|
| `run` (63 commits landing on the run's clock; 0 rollbacks needed) | — |
| `card-scale` (everything works exactly as before the refactor: compiler 0 errors, every test passes, API spec identical) | — |

## 1:52.1–2:11.3 Features (43 spoken words)

> With ac, every commit carries its verdict.
> You get a branch to review commit by commit,
> and a plan you can edit.
> Point the checker at any diff: opencode's fails, ours passes.
> And it all replays on your machine: no key, no cost.

| Shot | Lower third |
|---|---|
| `trailer` (the album commit's message, a red box around its Ac-Certificate verdict) | — |
| `branch-log` (the branch's 63 commits) | — |
| `plan-entry` (plan.yaml: how to edit it; the album entry) | — |
| `certify-verdicts` (opencode's branch: FAIL; ours: PASS) | — |
| `replay` (`npx ac demo --replay` in a fresh clone, its steps matching the recording, sped up) | — |

## 2:11.3–2:24.7 Future (28 spoken words)

> Preliminary results also show that the newer Nemotron 3.5 Super VL, thinking long, plans even better on tested repos, and is tied with Ultra on immich.

| Shot | Lower third |
|---|---|
| `card-super-vl` (v1's table: Nemotron 3.5 Super VL against Nemotron 3 Ultra, preliminary; immich highlighted) | — |

## 2:24.7–2:39.1 Close (28 spoken words)

> You can try it now.
> Rebuild every commit with one command.
> Nemotron draws the map.
> Code moves it.
> A checker proves nothing else changed.
> The links are below.

| Shot | Lower third |
|---|---|
| `end` (the tagline, the command, the links, v1's before/after diagram) | — |
