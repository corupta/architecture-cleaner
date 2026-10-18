# Storyboard (draft for corupta's 15-minute review, Fri Oct 9)

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

[R1: docs/sessions/s3.md; G3: docs/gates.md; certificates: ~/ac-work/s4/]

The contrast is the video: **a green test count is not proof.** The single-shot branch passes 2,337/2,337 cases while its restructure is a dead copy tree with 1,680 type errors; the certificate names exactly why.

## Beats

| Time | Visual | Voice-over (draft) | Evidence | Exists today? |
|---|---|---|---|---|
| 0:00–0:15 Hook | immich's March 2024 tree diff, ~17 layout PRs over ~52 h | "immich's maintainers restructured their server by hand: 17 PRs in two days. Nobody lets a tool, or an AI, do it, because nobody can prove it didn't change behavior." | gates.md (corrected hook) | yes |
| 0:15–0:40 The failure | opencode on **Nemotron 3 Super via Nebius Token Factory** (said aloud) runs on immich; vitest goes green, 2,337/2,337. Then `ac certify` on its branch turns red line by line | "The tests pass. The build has 1,680 errors, and 66 spec files never load. On the longer run, two moved files lost their migration and helmet paths, and no test noticed." | G3 + certificates | yes (recordable now) |
| 0:40–1:30 Ours | Nemotron's plan view (a contested file's rationale; Ultra's review line) → the ladder runs: codemod, then the certificate ticks K0…K8, then tests and the OpenAPI byte-diff, then the commit with its `Ac-Certificate:` trailer. A seeded wrong move turns the certificate red → rollback → replan | "Nemotron draws the map. A codemod moves the files. A separate checker proves nothing else changed, on the commit, with the test runner's own resolver." | R1 certificate; mutation harness | certificate yes; plan view yes (S5: docs/plans/immich/plan.md, Ultra's critic review included); replan S6 |
| 1:30–2:05 Result | the module graph morphs (type folders → 38 modules); a new forbidden import fails the boundary rules; findings "made obvious, never fixed" (`BaseService` injects 56 repositories into 51 services, which use 5.7 on average) | "Bugs the new layout makes obvious are written down. Never fixed." | S6 run (`~/ac-work/s6/final`: R4 rules, findings log); graph view S7 | data yes (S6); visuals S7 |
| 2:05–2:35 Credibility | the certificate catching **our own** executor: the R1 step left a stale coverage path in `vitest.config.mjs`, and K4 named it (recorded, then fixed in the executor); mutation kill matrix: 561/561 mutants killed before a single test body runs (static checks only); 26 false passes our own red team found and closed; the 42 S3 bug-hunt reports as certifier cases; `ac certify` on any diff (G3, immich's 2024 PRs) | "We don't ask you to trust our tool either. The checker caught our own executor once; that's the point. Then we attacked the checker: 561 mutants, every one rejected before a single test runs." | ~/ac-work/s4/mutation/final/report.md; docs/sessions/s4.md | yes (immich 2024 PRs: S7) |
| 2:35–2:55 Close | the three-line pitch; repo and site URLs; optional 5 s: Clean Architecture as the next step | "Nemotron draws the map. Code moves it. A checker proves nothing else changed." | — | — |

## Decisions (corupta, 2026-10-07)
1. **Hook:** lead with immich's 2024 hand restructure, as drafted.
2. **Single-step fallback:** deferred until we know whether the full ladder run (S6) slips. **Taken at the end of S6 (2026-10-14): no fallback.** The full ladder ran unattended on immich (63 commits, each certified; every rung and the whole PR PASS with oracles; 1 h 55 m; `~/ac-work/s6/final`), so the video shows that run.
3. **Honesty, presented strongly:** show our own misses as strengths ("a failure is always an opportunity"). The R1 step's stale coverage path that K4 caught moves into the credibility beat as "the checker caught our own executor"; the red team's 26 closed false passes stay in it.
4. **opencode is named on screen**, with its model and provider said aloud; its numbers are reproducible from our recorded cassettes.

## S7 updates (2026-10-18), for the Oct 22–23 script

- **The seeded wrong move is recorded** (`runs/immich-fault`, the site's second run):
  - step 2's mutant (one importer rewrite dropped) fails K3a, K3b and K3c on `workflow-execution.service.ts`;
  - it is rolled back, `album.dto.ts` is pinned, and the step is replanned and passes;
  - 13 m 37 s.
- **The graph beat:** the folder graph doesn't get cleaner. Import pairs inside one folder fall from 23.4% to 20.5%, and the largest cycle grows from 12 of 14 folders to 41 of 70 (the `BaseService` hub). Show it as "the hub made obvious" (findings), not as a cleanup.
- **The credibility beat:** the bench table, honestly (`bench/results/summary.md`).
  - The planner beats the best deterministic method on hoppscotch, 87.59 vs 81.38, and loses on H1, kaneo, ghostfolio and immich's TurboMQ.
  - Say it: Nemotron edits a deterministic draft, and the certificate, not the plan, carries the proof.
  - Our own misses, from S7, now include:
    - the H1 bench catching a planner regression;
    - our certifier refusing our own kaneo scramble;
    - a false pass we introduced, which the review caught.
- **Mutation numbers for the video:** 420/420 killed by the static checks (fixtures, synthetic, hunt). The 561 in this storyboard is S4's count, which included the immich subjects; re-measure before quoting.
