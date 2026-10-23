# Video script (≤ 3:00), draft for corupta's 15-minute OK

From the storyboard's beats ([docs/storyboard.md](../docs/storyboard.md), locked Oct 9, measured beats Oct 20, decision 6
on Oct 23). Every number on screen or in the voice-over is in [docs/numbers.md](../docs/numbers.md). The shots are
in [shots.md](shots.md); each is a scripted capture, so the cut can be re-rendered.

Voice-over pace: about 130 words a minute, 350–370 words in all, leaving room to breathe. Captions are the
voice-over, word for word; the lower-third lines (in the right column) are burned in.

## 0:00–0:15 Hook (32 words)

> In March 2024, immich's maintainers restructured their server by hand: about seventeen pull requests in two days.
> Nobody lets a tool, or an AI, do that, because nobody can prove it didn't change behavior.

| Shot | Lower third |
|---|---|
| `hook` (immich's own git log, Mar 20–22, 2024) | immich, March 20–22, 2024: about 17 layout PRs, by hand |

Note for corupta: the same tape can go on to show immich's tree before and after. It shows they moved *from* feature
folders under `domain/` *to* type folders, the opposite of what ac does. The voice-over doesn't say which way they went.
Recommended: end the shot on the PR list, so the picture doesn't raise a question the 15 seconds can't answer.

## 0:15–0:40 The failure (55 words)

> We gave the same job to opencode, running NVIDIA Nemotron 3 Super on Nebius Token Factory. All 2,337 test cases
> still pass. But 66 of its test files never load, and tsc reports 1,680 errors: it copied 211 files and corrupted
> every import it rewrote. A green test count is not proof.

| Shot | Lower third |
|---|---|
| `g3-vitest` (the single-shot branch: 2,337 cases pass, one an expected failure as at base; 66 of 171 files fail to load) | opencode 1.18.34 + Nemotron 3 Super, single-shot, no human input |
| `g3-certify` (`ac certify` on that branch: FAIL K1, K3a, K4, K6, K8) | tsc: 1,680 errors · 66 of 171 test files never load |
| `site-ab` (the A/B table: the tsc, unit-suite and verdict rows) | runs/g3/ · docs/gates.md |

## 0:40–1:30 Ours (110 words)

> Here's ours. Nemotron 3 Ultra draws the map: it edits a draft that deterministic code drew from the repository, and a
> second call reviews it. A codemod moves the files, one feature per commit, and changes nothing but import paths.
> Then a separate checker proves nothing else changed, on every commit: every import still reaches the same file under
> the compiler, the test runner and the runtime. And on every rung: tsc, all 2,337 tests, and the OpenAPI spec, byte
> for byte. Sixty-three commits, each one certified, unattended, in under two hours.
> And when a step is wrong? We broke one import on purpose. The checker names the file, the commit is rolled back, and
> the step is planned again without it.

| Shot | Lower third |
|---|---|
| `site-plan` (the critic's review; a placement the critic decided) | Nemotron 3 Ultra on Nebius Token Factory: $0.20 for the plan, recorded once |
| `ours-certify` (`ac certify` on step 1, static checks: K0–K7 PASS, the recorded digest again) | K3: TypeScript, vitest and Node resolve every import to the same file |
| `trailer` (the commit message and its `Ac-Certificate:` trailers) | every commit carries its certificate |
| `site-ladder` (rungs R1–R4 PASS with the oracles; the 63 steps) | 63 commits · whole PR PASS · tsc 0 · 2,337/2,337 · OpenAPI byte-identical · 1 h 55 m |
| `site-fault` (step 2: FAIL K3a, K3b, K3c; rolled back; `album.dto.ts` pinned; attempt 2 passed) | a seeded wrong move: `--inject-fault 2:M2` |

## 1:30–2:05 Result (78 words)

> The result: 38 feature modules, 20 platform folders and a shared one. It isn't a cleaner graph, and we don't pretend
> it is: the largest import cycle grows from 12 folders to 41. The new layout doesn't hide the hub, it makes it obvious:
> one base class injects 56 members into 51 services. Bugs the layout reveals are written down, never fixed. And
> boundary rules freeze today's violations, so a new forbidden import fails.

| Shot | Lower third |
|---|---|
| `site-graph` (the tiles, then the files flow) | 14 type folders → 38 modules, 20 platform, shared/ |
| `site-findings` (the `BaseService` finding) | 45 findings, recorded and never fixed |
| `boundaries` (a forbidden import added; `ac boundaries --check` fails) | R4: 80 rules, 161 of today's violations frozen |

## 2:05–2:42 Credibility (82 words)

> Don't trust our tool either. The checker once caught our own executor; that's the point. We attacked the checker
> with 831 mutants, and every one was rejected before a single test ran. On benchmarks, the map beats the best classic
> method on 3 of 5 repos, and we show where it loses. NVIDIA's newer Nemotron 3.5 Super VL plans better on the
> benchmarks, but not on immich, so the demo keeps Ultra. Whichever model draws the map, the certificate checks every
> commit.

| Shot | Lower third |
|---|---|
| `card-misses` (our own misses, each with how it was caught) | the checker caught our executor (S4) · the bench caught our planner (S7) |
| `card-mutation` (831 of 831 killed by the static checks) | runs/mutation/report.md |
| `site-bench` (the bench table: wins, losses, the plans our validator rejects) | MoJoFM against the original folders · bench/results |
| `card-super-vl` (Super VL thinking on vs Ultra, with the limits) | preliminary: 3 runs per entry · public projects · 2.5× the cost, 6.4× the time |

## 2:42–2:57 Close (28 words)

> Nemotron draws the map. Code moves it. A checker proves nothing else changed. Replay all of it with one command: no
> key, no cost. The links are below.

| Shot | Lower third |
|---|---|
| `replay` (`npx ac demo --replay` from a fresh clone, sped up; exit 0) | `npx ac demo --replay` · no key, $0 |
| `card-close` (the pitch line, the repo and site URLs) | — |

Optional, about 5 s, only if the cut has room (storyboard: stretch S3, and the future direction): "Even the formatting
fix is proven" over `rewrap`; or "Next: from enforced boundaries to Clean Architecture."
