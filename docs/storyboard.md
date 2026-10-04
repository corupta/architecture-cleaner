# Storyboard (draft for corupta's 15-minute review, Fri Oct 9)

≤3:00, a pitch, not a tutorial (plan §9). Every number below is measured, offline, on the pinned SHAs; the source is in brackets.

## Lead: the same task, two outcomes

| immich `server/` @ `02063972e8` | **ac**, one R1 step (`ac/s3-r1`) | opencode + Nemotron 3 Super, single-shot (G3) | the same, persistent (G3) |
|---|---|---|---|
| What the diff is | 292 files moved into 100 modules; 1,445 specifier edits in 386 files; every other byte identical | 211 files **copied** into `src/features/`, originals kept; every rewritten import corrupted | 297 moved, 562 copied (a `src.backup/` tree), 68 edited, 12 Python scripts left behind |
| tsc (base: 0) | **0** | 1,680 | 768 |
| Unit suite (base: 105 files, 2,337 cases) | **105/105 files, 2,337/2,337** | 2,337/2,337 cases pass, **but 66 of 171 spec files never load** | 5/105 files, 52 cases |
| OpenAPI spec (947,932 bytes) | **byte-identical** | byte-identical (the copies are dead code) | not produced |
| `ac certify` | **PASS**, every check (K0–K4, K6, K8) | **FAIL**: K1 (211 files added), K3a, K4, K6 (66 of 171 spec files don't load), K8 (tsc 1,680) | **FAIL** on every check K1–K8: 614 added, 2,168 TypeScript resolutions changed, 2,802 imports dangling under vitest, `import.meta.dirname` in the moved repositories, 100 of 105 spec files don't load |
| Cost and time | executor 14 s; certificate: static checks 139 s (vitest collection 91 s of it), oracles 146 s; $0 | $0.30, 169 s | $4.63, 33 min, stopped by the budget cap |

[R1: docs/sessions/s3.md; G3: docs/gates.md; certificates: ~/ac-work/s4/]

The contrast is the video: **a green test count is not proof.** The single-shot branch passes 2,337/2,337 cases while its restructure is a dead copy tree with 1,680 type errors; the certificate names exactly why.

## Beats

| Time | Visual | Voice-over (draft) | Evidence | Exists today? |
|---|---|---|---|---|
| 0:00–0:15 Hook | immich's March 2024 tree diff, ~17 layout PRs over ~52 h | "immich's maintainers restructured their server by hand: 17 PRs in two days. Nobody lets a tool, or an AI, do it, because nobody can prove it didn't change behavior." | gates.md (corrected hook) | yes |
| 0:15–0:40 The failure | opencode on **Nemotron 3 Super via Nebius Token Factory** (said aloud) runs on immich; vitest goes green, 2,337/2,337. Then `ac certify` on its branch turns red line by line | "The tests pass. The build has 1,680 errors, and 66 spec files never load. On the longer run, two moved files lost their migration and helmet paths, and no test noticed." | G3 + certificates | yes (recordable now) |
| 0:40–1:30 Ours | Nemotron's plan view (a contested file's rationale; Ultra's review line) → the ladder runs: codemod, then the certificate ticks K0…K8, then tests and the OpenAPI byte-diff, then the commit with its `Ac-Certificate:` trailer. A seeded wrong move turns the certificate red → rollback → replan | "Nemotron draws the map. A codemod moves the files. A separate checker proves nothing else changed, on the commit, with the test runner's own resolver." | R1 certificate; mutation harness | certificate yes; plan view S5–S6; replan S6 |
| 1:30–2:05 Result | the module graph morphs (type folders → ~35 modules); a new forbidden import fails the boundary rules; findings "made obvious, never fixed" (`BaseService` injects 55 repositories; the R1 step's stale coverage path) | "Bugs the new layout makes obvious are written down. Never fixed." | S6–S7 | no |
| 2:05–2:35 Credibility | mutation kill matrix: 561/561 mutants killed before a single test body runs (static checks only); 26 false passes our own red team found and closed; the 42 S3 bug-hunt reports as certifier cases; `ac certify` on any diff (G3, immich's 2024 PRs) | "We attacked our own checker first." | ~/ac-work/s4/mutation/final/report.md; docs/sessions/s4.md | yes (immich 2024 PRs: S7) |
| 2:35–2:55 Close | the three-line pitch; repo and site URLs; optional 5 s: Clean Architecture as the next step | "Nemotron draws the map. Code moves it. A checker proves nothing else changed." | — | — |

## Decisions for corupta
1. Hook order: lead with immich's 2024 hand restructure (as now), or open cold on the green 2,337/2,337 next to the red certificate?
2. The R1 step stays the hero shot until S6 produces the full ladder. OK to show a single-step certificate if the full run slips?
3. Show our own executor's miss in the findings beat? The R1 step left `server/test/vitest.config.mjs` coverage settings naming `src/services/api.service.ts`, which moved (coverage-only, no thresholds). It's an honest "the checker caught us" moment.
4. Name opencode on screen, or say "a generic coding agent"? Its numbers are reproducible from our recorded cassettes.
