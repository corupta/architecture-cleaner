# Video script (≤ 3:00), for corupta's 15-minute OK

From the storyboard's beats ([docs/storyboard.md](../docs/storyboard.md), locked with corupta Oct 7, measured beats
Oct 23, decisions 1–6). Every number on screen or in the voice-over is in [docs/numbers.md](../docs/numbers.md). The
shots are in [shots.md](shots.md); each is a scripted capture, so the cut can be re-rendered. The silent rough cut that
times this script is `video/out/cut/rough.mp4` (`node video/cut/render.mjs`).

Voice-over: about 385 spoken words in 2:57 (numbers read in full), about 130 words a minute; no beat above 140 over
its slot. Captions are the
voice-over, word for word; the lower thirds (right-hand column) are burned in. 3 s are left for the fades.

## 0:00–0:14 Hook (29 spoken words)

> In March 2024, immich's maintainers restructured their server by hand: about seventeen pull requests over two days.
> Nobody could prove a tool, or an AI, didn't change behavior.

| Shot | Lower third |
|---|---|
| `hook` (immich's own git log: the 17 PRs #8080–#8204 to server/src, Mar 20–22, 2024) | immich, March 20–22, 2024: 17 PRs restructuring server/, by hand |

Decision for corupta: the shot ends on the PR list. immich's history also shows their direction (from feature folders
under `domain/` to type folders, the opposite of ac); the 14 s can't explain it, so the video doesn't show the trees.
The voice-over doesn't say which way they went.

## 0:14–0:40 The failure (60 spoken words)

> We asked opencode, on NVIDIA Nemotron 3 Super via Nebius Token Factory, to restructure today's immich server. When
> it stopped, all 2,337 test cases still passed. But 66 test files never load, tsc reports 1,680 errors, and its longer
> run broke paths no test covers. A passing test count is not proof.

| Shot | Lower third |
|---|---|
| `g3-vitest` (the single-shot branch: Tests 2,336 passed, 1 expected fail, as at base; Test Files 66 failed) | opencode 1.18.34 + Nemotron 3 Super, single-shot: it stopped at 169 s |
| `g3-certify` (`ac certify --oracles` on that branch: FAIL K1, K3a, K4, K6, K8) | K1: 211 files added next to the originals · K6: 66 of 171 test files fail to load |
| `site-ab` (the A/B table: the tsc, unit-suite and verdict rows) | persistent run, 33 min: 2 moved files lost their migration and helmet.json paths; no test covers them, K4 flags them |

## 0:40–1:32 Ours (111 spoken words)

> Ours: Nemotron 3 Ultra, on Nebius Token Factory, edits a deterministic map, and a second call reviews it, for twenty
> cents. A codemod moves one group of files per commit and edits nothing but import paths. A separate
> checker proves, on every commit, that each import reaches the same file under the compiler, the test runner and the
> runtime; and on every stage, that tsc, all 2,337 tests and the OpenAPI spec come out the same. Sixty-three commits,
> each certified, unattended, in under two hours.
> We broke one import on purpose: the checker named it, the attempt was rolled back, and the step passed without that
> move.

| Shot | Lower third |
|---|---|
| `site-plan` (the critic's review, labeled as the model's words, and the gate's record; a placement the critic decided) | Nemotron 3 Ultra on Nebius Token Factory: $0.1998 for the plan, recorded once |
| `ours-certify` (`ac certify` on step 1 with its step certificate's checks: K0–K4, K6, K7 PASS; the digest) | K3: each import resolves as before under TypeScript, vitest and Node |
| `trailer` (the commit message and its `Ac-Certificate:` trailers: the same digest) | every commit carries its verdict and digest; the digest reproduces |
| `site-ladder` (rungs R1–R4, each PASS with the oracles; the 63 steps) | 63 commits (R1 38, R2 21, R3 3, R4 1) · tsc 0 · 2,337/2,337 · OpenAPI byte-identical · 1 h 55 m |
| `site-fault` (step 2: FAIL K3a, K3b, K3c; rolled back; `album.dto.ts` pinned; attempt 2 passed) | a seeded fault: one import left unrewritten (`--inject-fault 2:M2`) |

## 1:32–2:06 Result (71 spoken words)

> 367 of 563 files moved into 38 feature modules, 20 platform folders and a shared one. The largest import cycle grows,
> from 12 of 14 folders to 41 of 70: the layout makes the hub obvious. One base class injects 56 members into 51
> classes. Whatever the layout reveals is written down, never fixed. Boundary rules freeze today's violations, so a new
> forbidden import fails the check.

| Shot | Lower third |
|---|---|
| `site-graph` (the files flow, then the tiles: the cycle tile highlighted) | 14 folders → 38 modules, 20 platform, shared/; 196 files stay where they were |
| `site-findings` (the `BaseService` finding) | 45 findings, never fixed; 14 on immich's structure (cycles, back-edges, the hub, shared tables) |
| `boundaries` (a forbidden import added at the ladder's head; `ac boundaries --check`: 2 new violations, exit 1) | R4: 80 rules; 161 of today's violations frozen in the baseline |

## 2:06–2:45 Credibility (86 spoken words)

> Don't trust our tool either. Our checker caught our own executor; every miss we found is listed. We attacked the
> checker with 831 mutants; every one was rejected before a single test case ran. On five benchmark entries, Nemotron's
> map beats the best classic method on two and loses on two; one more win is a plan our validator rejects.
> Preliminary: the newer Nemotron 3.5 Super VL, thinking long, plans better on the scrambles, not on immich, so the
> demo keeps Ultra.

| Shot | Lower third |
|---|---|
| `card-misses` (our own misses, each with what caught it) | README "Our own misses" · docs/sessions/s4–s9 |
| `card-mutation` (831 of 831 rejected by K0–K4, K6, K7; tests run only in K8) | runs/mutation/report.md, 2026-10-20 |
| `site-bench` (the bench table: wins, kaneo's loss, the two plans the validator rejects) | MoJoFM against the original folders (immich: TurboMQ) · bench/results |
| `card-super-vl` (Super VL, thinking on, against Ultra, mean of 3 runs; immich highlighted; the limits) | preliminary: 3 runs per entry · public projects · 2.5× the cost, 6.4× the time |

## 2:45–2:57 Close (27 spoken words)

> Rebuild every commit with one command: no key, no cost. Nemotron draws the map. Code moves it. A checker proves
> nothing else changed. The links are below.

| Shot | Lower third |
|---|---|
| `replay` (`npx ac demo --replay` typed in a fresh clone) | npx ac demo --replay · no key, $0 |
| `replay-end` (its summary: 62 of 62 trees equal the recording; exit 0) | every tree equals the recording · ~11 min |
| `card-close` (the pitch line, the repo and site URLs) | — |

Not in the cut (no room in 3:00; each would need a donor): stretch S3 ("even the formatting fix is proven", over
`ac rewrap`'s commit), and the future direction ("Next: from enforced boundaries to Clean Architecture"). The cleanest
swap is the latter for "The links are below." if corupta wants it.
