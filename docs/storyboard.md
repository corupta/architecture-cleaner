# Storyboard (locked with corupta Oct 9; measured beats updated Oct 20 for the Oct 22–23 script)

≤3:00, a pitch, not a tutorial (plan §9). Every number below is measured, offline, on the pinned SHAs; the source is in brackets.

## Lead: the same task, two outcomes

| immich `server/` @ `02063972e8` | **ac**, one R1 step (`ac/s3-r1`) | opencode + Nemotron 3 Super, single-shot (G3) | the same, persistent (G3) |
|---|---|---|---|
| What the diff is | 292 files moved into 100 modules; 1,445 specifier edits in 386 files; every other byte identical | 211 files **copied** into `src/features/`, originals kept; every rewritten import corrupted | 297 moved, 562 copied (a `src.backup/` tree), 68 edited, 12 Python scripts left behind |
| tsc (base: 0) | **0** | 1,680 | 768 |
| Unit suite (base: 105 files, 2,337 cases) | **105/105 files, 2,337/2,337** | 2,337/2,337 cases pass, **but 66 of 171 spec files never load** | 5/105 files, 52 cases |
| OpenAPI spec (947,932 bytes) | **byte-identical** | byte-identical (the copies are dead code) | not produced |
| `ac certify` | **PASS**, every check (K0–K4, K6, K8) | **FAIL**: K1 (211 files added), K3a, K4, K6 (66 of 171 spec files don't load), K8 (tsc 1,680) | **FAIL** on K1, K3a, K3b, K3c, K4, K6 and K8 (K0 and K2 pass: its edits land in added files, which K1 counts): 614 added, 2,168 TypeScript resolutions changed, 2,802 imports dangling under vitest, `import.meta.dirname` in the moved repositories, 100 of 105 spec files don't load |
| Cost and time | executor 14 s; certificate: static checks 139 s (vitest collection 91 s of it), oracles 146 s; $0 | $0.30, 169 s | $4.63, 33 min, stopped by the budget cap |

[R1: docs/sessions/s3.md; G3: docs/gates.md; certificates: runs/g3/]

The contrast is the video: **a green test count is not proof.** The single-shot branch passes 2,337/2,337 cases while its restructure is a dead copy tree with 1,680 type errors; the certificate names exactly why.

## Beats

| Time | Visual | Voice-over (draft) | Evidence | Exists today? |
|---|---|---|---|---|
| 0:00–0:15 Hook | immich's March 2024 tree diff, ~17 layout PRs over ~52 h | "immich's maintainers restructured their server by hand: 17 PRs in two days. Nobody lets a tool, or an AI, do it, because nobody can prove it didn't change behavior." | gates.md (corrected hook) | yes |
| 0:15–0:40 The failure | opencode on **Nemotron 3 Super via Nebius Token Factory** (said aloud) runs on immich; vitest goes green, 2,337/2,337. Then `ac certify` on its branch turns red line by line | "The tests pass. The build has 1,680 errors, and 66 spec files never load. On the longer run, two moved files lost their migration and helmet paths, and no test noticed." | G3 + certificates (runs/g3) | yes |
| 0:40–1:30 Ours | Nemotron's plan view (a contested file's rationale; Ultra's review line) → the ladder runs: codemod, then the certificate ticks K0…K8, then tests and the OpenAPI byte-diff, then the commit with its `Ac-Certificate:` trailer. Then the seeded wrong move: step 2's commit drops one importer rewrite, K3a, K3b and K3c turn red on `workflow-execution.service.ts`, the attempt is rolled back, `album.dto.ts` is pinned, the step is replanned and passes | "Nemotron draws the map. A codemod moves the files. A separate checker proves nothing else changed, on the commit, with the test runner's own resolver. Break one import, and the checker says which, and the step is done again." | plan: docs/plans/immich/plan.md; ladder: runs/immich-ladder (63 commits, every rung and the whole PR PASS with oracles, 1 h 55 m); fault: runs/immich-fault (13 m 37 s) | yes |
| 1:30–2:05 Result | the folder graph before and after (the site's files-flow and matrices): type folders → 38 modules, 20 platform concerns and `shared/`; the largest import cycle grows from 12 of 14 folders to 41 of 70, the `BaseService` hub made obvious; a new forbidden import fails the boundary rules; findings "made obvious, never fixed" (`BaseService` injects 56 members into 51 services, which use 5.7 on average) | "The new layout doesn't hide the hub. It makes it obvious, and writes it down. Bugs the layout reveals are recorded, never fixed." | runs/immich-ladder (graph.json, boundaries/, findings/); decision 5 | yes |
| 2:05–2:35 Credibility | the certificate catching **our own** executor (the stale coverage path K4 named); the mutation kill matrix (static checks only); the bench table, honestly (wins and losses, and the two plans our own validator rejects); our misses, with how each was caught; `ac certify` on any diff | "We don't ask you to trust our tool either. The checker caught our own executor once; that's the point. Then we attacked the checker with every mutant we could write: every one rejected before a single test runs. And where the map loses to a classic method, we show it." | mutation: the S8 run below; bench/results/summary.md; README "Our own misses" | yes |
| 2:35–2:55 Close | the three-line pitch; repo and site URLs; optional 5 s: Clean Architecture as the next step | "Nemotron draws the map. Code moves it. A checker proves nothing else changed." | — | — |

## Decisions (corupta, 2026-10-07)
1. **Hook:** lead with immich's 2024 hand restructure, as drafted.
2. **Single-step fallback:** deferred until we know whether the full ladder run (S6) slips. **Taken at the end of S6 (2026-10-14): no fallback.** The full ladder ran unattended on immich (63 commits, each certified; every rung and the whole PR PASS with oracles; 1 h 55 m), so the video shows that run.
3. **Honesty, presented strongly:** show our own misses as strengths ("a failure is always an opportunity"). The R1 step's stale coverage path that K4 caught moves into the credibility beat as "the checker caught our own executor"; the red team's 26 closed false passes stay in it.
4. **opencode is named on screen**, with its model and provider said aloud; its numbers are reproducible from our recorded cassettes.
5. **The graph beat shows the hub, not a cleanup** (corupta, 2026-10-20): the largest import cycle grows from 12 of 14 folders to 41 of 70, the `BaseService` hub made obvious; the beat says so instead of implying a cleaner graph.
6. **The demo plans with Ultra; Super VL is shown as preliminary** (corupta, 2026-10-23): the recorded S6 run stays the demo. Nemotron 3.5 Super VL's bench results go into the credibility beat with their limits and the reasons for keeping Ultra (below).

## Measured beats (S7–S8), for the Oct 22–23 script

- **The seeded wrong move** (`runs/immich-fault`, the site's second run): `--inject-fault 2:M2` drops one importer rewrite in step 2; K3a, K3b and K3c fail on `workflow-execution.service.ts`; the attempt is rolled back, `album.dto.ts` is pinned, and the step is replanned and passes. The partial R1 rung certificate passes with the oracles. 13 m 37 s; step 1's certificate reproduces S6's digest `909262855d`.
- **The graph:** import pairs inside one folder fall from 23.4% to 20.5%, and the largest cycle grows from 12 of 14 folders to 41 of 70. Frame it as "the hub made obvious" (findings), not as a cleanup.
- **The bench** (`bench/results/summary.md`), MoJoFM, planner vs the best deterministic method, S7 → S8:
  - hoppscotch 87.59 vs 81.38 (both sessions); hoppscotch-H1 79.31 → **83.45** vs 81.38; ghostfolio 82.64 → **86.81** vs 84.72; kaneo 49.61 → 50.65 vs 66.90; immich TurboMQ 10.07 vs 10.50 (replayed under its pin).
  - The planner scores higher on 3 of 5 (1 of 5 in S7); counting only plans our validator accepts, 2 of 5. Say what changed: the S7 bench showed Ultra naming moves by the prompt's ids, which the validator dropped, and a 0-module plan winning; S8 fixed both in the tool, for $0.11 of re-recorded critic calls.
  - Say what didn't: on kaneo and ghostfolio the plan keeps one banned module name (`middleware`, `app`), so our own validator rejects it and `ac run` would refuse it; the bench scores it as it came back. Nemotron edits a deterministic draft, and the certificate, not the plan, carries the proof.
- **The mutation harness** (S8, every target, on a quiet machine, after the review's fixes): 831/831 mutants killed by the static checks, 207 of them layout mutants and 53 hunt cases (`runs/mutation/report.md`). The 561 in S4 and the 420 in S7 are older counts; quote 831.
- **Our misses, for the credibility beat** (README "Our own misses"): the checker caught our executor (S4); the H1 bench caught a planner regression (S7); our certifier refused our own kaneo scramble (S7); review caught a false pass we introduced (S7); certificates that depended on our own `node_modules`, now refused (S8); the planner that read files by path only (S8).
- **The newer model, honestly** (decision 6; `bench/experiments/s8b-super-vl`), about 10 s in the credibility beat:
  - Visual: the bench table with a Super VL column (thinking on, 256k): hoppscotch 91.26 against Ultra's 83.22,
    hoppscotch-H1 90.80 against 85.06, ghostfolio 86.11 against 82.18; immich TurboMQ 10.26 against 10.20. Then one
    line each for the limits: three runs per entry, the scrambles are public projects its reasoning tries to recall,
    2.5 times the cost and 6.4 times the time, and at our old 64k cap it finished 1 answer in 12.
  - Voice-over (draft): "NVIDIA's newer Nemotron 3.5 Super VL plans better on our benchmarks, once it may think past a
    hundred thousand tokens. On immich it doesn't, so the demo keeps Ultra. Whichever model draws the map, the
    certificate checks every commit."
- **Optional, 5 s, if the cut allows** (stretch S3): after the ladder, 20 immich files fail immich's own `prettier --check`; `ac rewrap` re-wraps 22 import lines in one commit, and K2 certifies it as layout only (equal tokens and syntax trees). "Even the formatting fix is proven."
