# Mutation harness report

Started 2026-10-20T04:00:05.410Z; 6359 s. Checks: K0, K1, K2, K3a, K3b, K3c, K4, K6, K7 (no K8). Cap: 3 instances per operator variant and subject.
Staged: the tree-only checks (K0, K1, K2, K3a, K4) run first; the runner/runtime checks (K3b, K3c, K6) run only on mutants the first stage did not kill, so "Killers seen" undercounts the second stage. Controls run every check.

- Mutants: 813
- Killed: 813 (100.0%); target 100%
- Survived (verdict PASS): 0
- Survived once kills explained by the control are discounted (a check that rejects the good head counts only for violations the good head doesn't have): 0
- Rejected only by a crashing check (no failing check): 0

## Controls (each known-good result must certify PASS)

| Subject | Verdict | Failing checks | Time | Per check |
|---|---|---|---|---|
| fixture:ambient-references | PASS | - | 0.4 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| fixture:assets-json | PASS | - | 0.4 s | K0 0.0, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| fixture:cjs-relative | PASS | - | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| fixture:jest-mocks | PASS | - | 10.4 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.1, K3b 0.8, K3c 0.4, K4 0.0, K6 8.9, K7 0.0 |
| fixture:nodenext-esm | PASS | - | 0.5 s | K0 0.0, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| fixture:paths-alias | PASS | - | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| fixture:vitest-mocks | PASS | - | 3.4 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.1, K3b 0.7, K3c 0.4, K4 0.0, K6 1.9, K7 0.0 |
| synthetic:coverage | PASS | - | 8.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.7, K3c 0.3, K4 0.0, K6 7.3, K7 0.0 |
| synthetic:layout | PASS | - | 0.4 s | K0 0.0, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| openhab-cloud | PASS | - | 11.1 s | K0 1.3, K1 0.2, K2 0.2, K3a 0.2, K3b 1.6, K3c 1.8, K4 1.1, K6 4.4, K7 0.0 |
| immich-album | PASS | - | 134.7 s | K0 10.3, K1 2.3, K2 0.8, K3a 1.7, K3b 8.0, K3c 6.8, K4 6.3, K6 96.3, K7 0.7 |
| immich-r1 | PASS | - | 140.3 s | K0 10.4, K1 3.5, K2 3.0, K3a 1.8, K3b 6.3, K3c 7.1, K4 6.0, K6 97.6, K7 0.7 |
| hunt:B01 (before -> before) | PASS | - | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:B02 (before -> before) | FAIL | K0 | 0.8 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.5, K4 0.0, K6 0.0, K7 0.0 |
| hunt:B03 (before -> before) | FAIL | K0 | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:B03-alias (before -> before) | FAIL | K0 | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:B03-destructure (before -> before) | FAIL | K0 | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:B04 (before -> before) | FAIL | K0 | 0.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.4, K4 0.0, K6 0.0, K7 0.0 |
| hunt:B05 (before -> before) | PASS | - | 1.0 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.5, K4 0.0, K6 0.0, K7 0.0 |
| hunt:B06 (before -> before) | PASS | - | 7.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.8, K3c 0.8, K4 0.0, K6 5.4, K7 0.0 |
| hunt:JSM-1 (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:JSM-2 (before -> before) | FAIL | K0 | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:JSM-3 (before -> before) | FAIL | K0 | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:JSM-4 (before -> before) | FAIL | K0 | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:JSM-5 (before -> before) | FAIL | K0 | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:JSM-6 (before -> before) | FAIL | K0 | 6.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.8, K3c 0.4, K4 0.0, K6 5.0, K7 0.0 |
| hunt:MC-2 (before -> before) | PASS | - | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:MC-3 (before -> before) | PASS | - | 1.0 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.5, K4 0.0, K6 0.0, K7 0.0 |
| hunt:MC-4 (before -> before) | PASS | - | 11.3 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 1.6, K3c 0.4, K4 0.0, K6 8.9, K7 0.0 |
| hunt:MC-4-mapper (before -> before) | PASS | - | 11.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.1, K3b 1.6, K3c 0.4, K4 0.0, K6 9.0, K7 0.0 |
| hunt:MC-5 (before -> before) | PASS | - | 6.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.8, K3c 0.4, K4 0.0, K6 5.0, K7 0.0 |
| hunt:MC-5-negation (before -> before) | PASS | - | 6.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.8, K3c 0.4, K4 0.0, K6 5.0, K7 0.0 |
| hunt:MC-6 (before -> before) | PASS | - | 0.8 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:MSF-1 (before -> before) | FAIL | K0 | 0.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.5, K4 0.0, K6 0.0, K7 0.0 |
| hunt:MSF-2 (before -> before) | PASS | - | 0.8 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.5, K4 0.0, K6 0.0, K7 0.0 |
| hunt:MSF-4 (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.5, K4 0.0, K6 0.0, K7 0.0 |
| hunt:MSF-5 (before -> before) | PASS | - | 0.8 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:MSF-6 (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.4, K4 0.0, K6 0.0, K7 0.0 |
| hunt:RK-01 (before -> before) | PASS | - | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:RK-02 (before -> before) | PASS | - | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:RK-03 (before -> good) | PASS | - | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:RK-04 (before -> good) | PASS | - | 0.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.4, K4 0.0, K6 0.0, K7 0.0 |
| hunt:RK-05 (before -> good) | PASS | - | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:RK-06 (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.4, K4 0.0, K6 0.0, K7 0.0 |
| hunt:S7R-K3c-mocha-hooks (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.4, K4 0.0, K6 0.0, K7 0.0 |
| hunt:S7R-K4-comparison (before -> before) | PASS | - | 0.8 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SEM-1 (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SEM-1b (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SEM-1c (before -> before) | PASS | - | 3.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.8, K3c 0.4, K4 0.0, K6 2.0, K7 0.0 |
| hunt:SEM-2 (before -> before) | PASS | - | 0.9 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SEM-3 (before -> before) | PASS | - | 3.5 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.7, K3c 0.4, K4 0.0, K6 1.7, K7 0.0 |
| hunt:SEM-4 (before -> before) | PASS | - | 0.8 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SEM-5 (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SEM-5b (before -> before) | PASS | - | 0.7 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SEM-6 (before -> before) | PASS | - | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SF-1 (before -> good) | PASS | - | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SF-2 (before -> good) | PASS | - | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SF-2-sibling (before -> before) | PASS | - | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SF-3 (before -> good) | PASS | - | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SF-4 (before -> before) | PASS | - | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SF-5 (before -> before) | PASS | - | 0.8 s | K0 0.1, K1 0.2, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.3, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SF-6 (before -> good) | PASS | - | 0.6 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |
| hunt:SF-6-android (before -> before) | PASS | - | 0.5 s | K0 0.1, K1 0.0, K2 0.0, K3a 0.0, K3b 0.0, K3c 0.2, K4 0.0, K6 0.0, K7 0.0 |

A failing control invalidates its row: a check that rejects the good head only counts as a killer where it reports a violation the good head does not have.

- hunt:B02 K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:B03 K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:B03-alias K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:B03-destructure K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:B04 K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:JSM-2 K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:JSM-3 K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:JSM-4 K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:JSM-5 K0: non-TS majority: 1 JavaScript vs 0 TypeScript source files under the repo root
- hunt:JSM-6 K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root
- hunt:MSF-1 K0: non-TS majority: 2 JavaScript vs 0 TypeScript source files under the repo root

## Kill matrix (killed/total; `!` marks survivors)

| Operator | fixtures | synthetic | openhab-cloud | immich-album | immich-r1 | hunt | Total | Expected killers (04b) | Killers seen |
|---|---|---|---|---|---|---|---|---|---|
| M1 Retarget a specifier to a same-basename file | 6/6 |  | 3/3 |  |  |  | 9/9 | K3 | K3a×9 |
| M2 Drop one importer rewrite | 20/20 | 3/3 | 3/3 | 3/3 | 3/3 |  | 32/32 | K3 | K3a×32 |
| M3 Drop a jest.mock/vi.mock rewrite (non-virtual) | 5/5 |  |  |  |  |  | 5/5 | K3 | K3a×5 |
| M4 Drop a virtual mock rewrite |  | 1/1 |  |  |  |  | 1/1 | K3 | K3a×1 |
| M5 Drop a requireActual/importActual rewrite | 4/4 |  |  |  |  |  | 4/4 | K3 | K3a×4 |
| M6 Move a module, leave its __mocks__ file behind | 1/1 |  |  |  |  |  | 1/1 | K1, K6 | K1×1 K3a×1 |
| M7 Move a test, leave its __snapshots__ file behind | 1/1 |  |  |  |  |  | 1/1 | K1, K6 | K1×1 |
| M8 Swap two files' contents | 12/12 |  | 3/3 | 3/3 | 3/3 |  | 21/21 | K2, K3 | K1×1 K3a×21 |
| M9 Add a barrel and route an importer through it | 19/19 | 3/3 | 3/3 | 3/3 | 3/3 |  | 31/31 | K1, K2, K3 | K1×31 K3a×31 |
| M10 Reorder two imports | 20/20 | 3/3 | 3/3 | 3/3 | 3/3 |  | 32/32 | K2 | K1×17 K2×15 K3a×32 |
| M11 Relative specifier rewritten to a tsconfig alias (same file) | 9/9 | 1/1 |  |  | 1/1 |  | 11/11 | K3 (form class, runtime resolver) | K3a×11 |
| M12 Toggle import <-> import type | 35/35 | 5/5 | 6/6 | 6/6 | 6/6 |  | 58/58 | K2 | K1×30 K2×28 K3a×30 |
| M13 Change the extension style of a specifier | 29/29 | 4/4 | 3/3 | 3/3 | 3/3 |  | 42/42 | K3 (form class) | K3a×42 |
| M14 Move a __dirname / import.meta user (importers rewritten correctly) |  | 1/1 | 2/2 | 3/3 | 3/3 |  | 9/9 | K4 | K4×9 |
| M17 Move a file into a different tsconfig scope or module format | 3/3 |  | 3/3 | 3/3 | 3/3 |  | 12/12 | K0, K5 (fingerprint) | K1×6 K3a×12 K4×9 |
| M18 Move a .d.ts without its .js |  | 1/1 |  |  |  |  | 1/1 | K1 (bundle), K3 (runtime) | K1×1 |
| M19 Case-mismatched specifier | 29/29 | 4/4 | 3/3 | 3/3 | 3/3 |  | 42/42 | K3 | K3a×42 |
| M20 Move a test out of the runner's test set | 4/4 | 2/2 | 3/3 | 6/6 | 6/6 |  | 21/21 | K6 | K1×6 K3a×8 K4×17 K6×4 |
| M21 Leave an infrastructure/config path stale |  | 2/2 | 3/3 |  |  |  | 5/5 | K4 (old-path scan), K7 | K4×5 |
| M23 Stage into a gitignored path (the file is missing from the commit, or force-added under an ignore) | 20/20 | 2/2 | 6/6 | 6/6 | 6/6 |  | 40/40 | K1 | K0×6 K1×40 K3a×39 K4×9 |
| M24 Lose the exec bit (or gain one) | 20/20 | 2/2 | 1/1 | 3/3 | 3/3 |  | 29/29 | K1 (modes) | K1×29 |
| M25 Miss a non-import site kind | 30/30 |  | 3/3 |  |  |  | 33/33 | K3 (site inventory) | K3a×33 |
| M26 Edit a non-reference string containing the path | 17/17 | 3/3 | 3/3 | 3/3 | 3/3 |  | 29/29 | K2 | K1×11 K2×18 K3a×11 K4×3 |
| M27 Create a shadowing file | 18/18 | 2/2 | 3/3 | 3/3 | 3/3 |  | 29/29 | K1, K3 (all files) | K0×27 K1×28 K3a×29 |
| M28 Move a file under baseUrl to the name of an npm package |  | 3/3 |  |  |  |  | 3/3 | K3 (all files) | K3a×3 K4×3 |
| M29 Introduce a __mocks__ basename collision | 1/1 |  |  | 3/3 | 3/3 |  | 7/7 | K1, K6 (haste map) | K1×7 K3a×7 |
| M30 Edit alias config inconsistently (tsconfig paths, Jest moduleNameMapper, Vite alias) | 5/5 |  |  | 6/6 | 6/6 |  | 17/17 | K2, K3 (multi-resolver) | K2×17 K3a×11 |
| M33 Add a boundary-rule tool config that is not proven inert | 29/29 | 6/6 | 3/3 | 3/3 | 5/5 |  | 46/46 | K1 (only an inert config at the package root may be added) | K1×46 |
| M34 Break a line where it changes automatic semicolon insertion | 10/10 | 4/4 | 3/3 | 6/6 | 6/6 |  | 29/29 | K2 (same tokens, different syntax tree) | K2×29 |
| M35 Change whitespace inside a string, template literal or JSX text | 22/22 | 9/9 | 3/3 | 6/6 | 9/9 |  | 49/49 | K2 (a token differs) | K2×49 |
| M36 Add or remove a comma that is not the trailing comma of an import or export clause | 32/32 | 13/13 | 9/9 | 9/9 | 9/9 |  | 72/72 | K2 (a token differs) | K2×72 K3a×3 |
| M37 Move a line break past a directive comment (@ts-expect-error, eslint-disable-next-line, ...) |  | 4/4 |  | 6/6 | 6/6 |  | 16/16 | K2 (a directive next to a changed line break) | K2×16 |
| M38 Change a comment's text | 3/3 | 4/4 | 6/6 | 6/6 | 6/6 |  | 25/25 | K2 (a comment differs) | K2×25 |
| hunt S3 hunt corpus |  |  |  |  |  | 51/51 | 51/51 | per case.json | K0×2 K1×11 K2×1 K3a×25 K3b×1 K3c×2 K4×17 K6×2 |
| **Total** | 404/404 | 82/82 | 78/78 | 96/96 | 102/102 | 51/51 | 813/813 | | |

## Kills per check

| Check | Kills | Sole killer |
|---|---|---|
| K0 | 35 | 0 |
| K1 | 266 | 86 |
| K2 | 270 | 238 |
| K3a | 442 | 222 |
| K3b | 1 | 0 |
| K3c | 2 | 1 |
| K4 | 72 | 37 |
| K6 | 6 | 5 |

## Survivors (soundness holes)

None.

## Capped instances

Per operator variant and subject, candidates are ranked by a stable hash of their key and the first ones that apply are kept.

| Subject | Operator | Candidates | Kept | Skipped as not applicable | Kept keys |
|---|---|---|---|---|---|
| fixture:ambient-references | M13.relative-add-extension | 4 | 3 | 0 | `src/augment/user-extra.ts#0`, `src/platform/app.ts#2`, `src/platform/app.ts#3` |
| fixture:ambient-references | M19.relative | 7 | 3 | 0 | `src/augment/user-extra.ts#0`, `src/platform/app.ts#4`, `src/modules/legacy/legacy.ts#0` |
| fixture:ambient-references | M26.any-string | 4 | 3 | 0 | `src/legacy/legacy-runner.ts@148`, `src/legacy/legacy-runner.ts@156`, `src/legacy/legacy-runner.ts@192` |
| fixture:assets-json | M2 | 6 | 3 | 0 | `src/modules/ui/button.ts#1`, `src/app.ts#4`, `src/modules/ui/button.ts#0` |
| fixture:assets-json | M10 | 7 | 3 | 0 | `src/modules/ui/icons.ts#0`, `src/ui/card.ts#0`, `src/app.ts#2` |
| fixture:assets-json | M12.value-to-type | 4 | 3 | 0 | `src/ui/card.ts#1`, `src/app.ts#2`, `src/app.ts#4` |
| fixture:assets-json | M26.any-string | 12 | 3 | 0 | `src/ui/card.ts@177`, `src/app.ts@354`, `src/modules/ui/button.ts@344` |
| fixture:assets-json | M35.string | 7 | 3 | 0 | `src/app.ts@310`, `src/app.ts@246`, `src/app.ts@354` |
| fixture:cjs-relative | M2 | 12 | 3 | 0 | `src/modules/user/user-format.ts#0`, `src/modules/user/user.validator.ts#0`, `src/models/order.model.ts#0` |
| fixture:cjs-relative | M9 | 10 | 3 | 0 | `src/app.ts#0`, `src/modules/user/user.service.ts#3`, `src/services/order.service.ts#1` |
| fixture:cjs-relative | M10 | 10 | 3 | 0 | `src/modules/user/user-format.ts#0`, `src/services/order.service.ts#1`, `src/app.ts#2` |
| fixture:cjs-relative | M12.type-to-value | 6 | 3 | 0 | `src/models/order.model.ts#0`, `src/services/order.service.ts#1`, `src/modules/user/user.model.ts#0` |
| fixture:cjs-relative | M12.value-to-type | 11 | 3 | 0 | `src/app.ts#1`, `tests/user.service.test.ts#1`, `src/app.ts#0` |
| fixture:cjs-relative | M13.relative-add-extension | 26 | 3 | 0 | `src/index.ts#2`, `src/modules/user/user.service.ts#8`, `src/modules/user/user-format.ts#1` |
| fixture:cjs-relative | M17.tsconfig-scope | 13 | 3 | 0 | `tests/user.service.test.ts->src/modules/user`, `tests/user.service.test.ts->src/services`, `src/modules/user/user.validator.ts->tests` |
| fixture:cjs-relative | M19.relative | 26 | 3 | 0 | `src/app.ts#4`, `src/modules/user/user.validator.ts#0`, `src/services/order.service.ts#4` |
| fixture:cjs-relative | M23.missing | 4 | 3 | 0 | `src/modules/user/user.validator.ts`, `src/modules/user/user.model.ts`, `src/modules/user/user-format.ts` |
| fixture:cjs-relative | M24.gain-exec | 4 | 3 | 0 | `src/modules/user/user-format.ts`, `src/modules/user/user.validator.ts`, `src/modules/user/user.service.ts` |
| fixture:cjs-relative | M25.dynamic-import | 4 | 3 | 0 | `tests/user.service.test.ts#2`, `src/app.ts#5`, `src/services/order.service.ts#7` |
| fixture:cjs-relative | M25.export | 4 | 3 | 0 | `src/index.ts#2`, `src/index.ts#4`, `src/modules/user/user.validator.ts#2` |
| fixture:cjs-relative | M25.typeof-import | 4 | 3 | 0 | `src/services/order.service.ts#6`, `src/modules/user/user.service.ts#7`, `src/app.ts#4` |
| fixture:cjs-relative | M27.js-beside-ts | 4 | 3 | 0 | `src/modules/user/user.model.js`, `src/modules/user/user-format.js`, `src/modules/user/user.service.js` |
| fixture:cjs-relative | M34.return | 4 | 3 | 0 | `src/services/order.service.ts@585`, `src/models/order.model.ts@224`, `src/app.ts@284` |
| fixture:cjs-relative | M35.string | 11 | 3 | 0 | `src/services/order.service.ts@536`, `src/services/order.service.ts@458`, `src/app.ts@392` |
| fixture:cjs-relative | M36.call-trailing | 21 | 3 | 0 | `src/services/order.service.ts@349`, `src/services/order.service.ts@573`, `tests/user.service.test.ts@419` |
| fixture:cjs-relative | M36.removed | 7 | 3 | 0 | `src/services/order.service.ts@481`, `tests/user.service.test.ts@147`, `src/app.ts@389` |
| fixture:jest-mocks | M2 | 5 | 3 | 0 | `src/routes/user.routes.ts#0`, `src/modules/user/user.repository.ts#0`, `src/modules/user/user.service.ts#0` |
| fixture:jest-mocks | M3 | 4 | 3 | 0 | `src/modules/user/user.service.test.ts#3`, `src/routes/user.routes.test.ts#4`, `src/routes/user.routes.test.ts#2` |
| fixture:jest-mocks | M9 | 5 | 3 | 0 | `src/routes/user.routes.ts#0`, `src/modules/user/user.repository.ts#0`, `src/modules/user/user.service.ts#2` |
| fixture:jest-mocks | M10 | 5 | 3 | 0 | `src/modules/user/__mocks__/user.repository.ts#0`, `src/modules/user/user.service.ts#0`, `src/modules/user/user.service.ts#2` |
| fixture:jest-mocks | M11 | 5 | 3 | 0 | `src/routes/user.routes.ts#0`, `src/modules/user/user.service.ts#0`, `src/modules/user/user.repository.ts#0` |
| fixture:jest-mocks | M12.type-to-value | 5 | 3 | 0 | `src/modules/user/__mocks__/user.repository.ts#0`, `src/modules/user/user.service.ts#0`, `src/routes/user.routes.test.ts#0` |
| fixture:jest-mocks | M12.value-to-type | 6 | 3 | 0 | `src/modules/user/user.service.test.ts#0`, `src/routes/user.routes.test.ts#1`, `src/modules/user/user.service.ts#1` |
| fixture:jest-mocks | M13.relative-add-extension | 9 | 3 | 0 | `src/modules/user/user.service.ts#0`, `src/modules/user/__mocks__/user.repository.ts#0`, `src/routes/user.routes.test.ts#4` |
| fixture:jest-mocks | M19.relative | 9 | 3 | 0 | `src/modules/user/user.service.ts#0`, `src/routes/user.routes.ts#0`, `src/modules/user/user.service.ts#2` |
| fixture:jest-mocks | M23.missing | 5 | 3 | 0 | `src/modules/user/__mocks__/user.repository.ts`, `src/modules/user/__snapshots__/user.service.test.ts.snap`, `src/modules/user/user.service.ts` |
| fixture:jest-mocks | M24.gain-exec | 5 | 3 | 0 | `src/modules/user/user.repository.ts`, `src/modules/user/__mocks__/user.repository.ts`, `src/modules/user/__snapshots__/user.service.test.ts.snap` |
| fixture:jest-mocks | M26.any-string | 12 | 3 | 0 | `src/modules/user/user.service.test.ts@335`, `src/modules/user/__mocks__/user.repository.ts@225`, `src/modules/user/user.repository.ts@145` |
| fixture:jest-mocks | M35.string | 6 | 3 | 0 | `src/routes/user.routes.test.ts@454`, `src/routes/user.routes.test.ts@859`, `src/routes/user.routes.test.ts@321` |
| fixture:jest-mocks | M36.call-trailing | 18 | 3 | 0 | `src/routes/user.routes.test.ts@423`, `src/routes/user.routes.ts@131`, `src/routes/user.routes.test.ts@832` |
| fixture:jest-mocks | M36.removed | 4 | 3 | 0 | `src/routes/user.routes.test.ts@204`, `src/routes/user.routes.test.ts@487`, `src/routes/user.routes.test.ts@387` |
| fixture:nodenext-esm | M1 | 4 | 3 | 0 | `src/modules/users/user.model.ts#0->src/modules/users/index.ts`, `src/modules/users/user.service.ts#0->src/modules/users/index.ts`, `src/api.ts#1->src/shared/index.ts` |
| fixture:nodenext-esm | M2 | 8 | 3 | 0 | `src/modules/report/report.service.ts#0`, `src/modules/users/user.repository.ts#1`, `src/main.ts#2` |
| fixture:nodenext-esm | M9 | 5 | 3 | 0 | `src/modules/report/report.service.ts#0`, `src/main.ts#0`, `src/api.ts#0` |
| fixture:nodenext-esm | M10 | 8 | 3 | 0 | `src/main.ts#0`, `src/modules/order/order.service.ts#1`, `src/modules/users/user.service.ts#0` |
| fixture:nodenext-esm | M12.type-to-value | 7 | 3 | 0 | `src/modules/order/order.service.ts#2`, `src/modules/users/user.service.ts#2`, `src/modules/users/user.repository.ts#1` |
| fixture:nodenext-esm | M12.value-to-type | 7 | 3 | 0 | `src/main.ts#3`, `src/modules/users/user.service.ts#0`, `src/modules/users/user.service.ts#1` |
| fixture:nodenext-esm | M13.relative-drop-extension | 16 | 3 | 0 | `src/modules/order/order.service.ts#3`, `src/api.ts#2`, `src/modules/users/index.ts#1` |
| fixture:nodenext-esm | M19.relative | 16 | 3 | 0 | `src/api.ts#0`, `src/api.ts#2`, `src/main.ts#4` |
| fixture:nodenext-esm | M23.missing | 7 | 3 | 0 | `src/modules/order/order.service.ts`, `src/modules/users/user.repository.ts`, `src/modules/users/user.service.ts` |
| fixture:nodenext-esm | M24.gain-exec | 7 | 3 | 0 | `src/modules/users/user.repository.ts`, `src/modules/users/user.model.ts`, `src/modules/users/user.service.ts` |
| fixture:nodenext-esm | M25.export | 6 | 3 | 0 | `src/modules/order/order.service.ts#3`, `src/api.ts#0`, `src/api.ts#2` |
| fixture:nodenext-esm | M27.js-beside-ts | 6 | 3 | 0 | `src/modules/users/user.service.js`, `src/modules/report/report.service.js`, `src/modules/users/user.repository.js` |
| fixture:nodenext-esm | M35.string | 4 | 3 | 0 | `src/main.ts@698`, `src/main.ts@460`, `src/main.ts@345` |
| fixture:nodenext-esm | M36.call-trailing | 6 | 3 | 0 | `src/main.ts@643`, `src/main.ts@704`, `src/main.ts@521` |
| fixture:paths-alias | M1 | 5 | 3 | 1 | `src/server.ts#1->src/config/index.ts`, `src/server.ts#2->src/config/index.ts`, `src/server.ts#3->src/config/index.ts` |
| fixture:paths-alias | M2 | 12 | 3 | 0 | `src/modules/user/user.controller.ts#2`, `src/server.ts#3`, `src/app.ts#0` |
| fixture:paths-alias | M8 | 4 | 3 | 0 | `src/modules/user/user.model.ts<->src/modules/user/user.routes.ts`, `src/modules/user/user.routes.ts<->src/modules/user/user.service.ts`, `src/modules/user/user.controller.ts<->src/modules/user/user.model.ts` |
| fixture:paths-alias | M10 | 12 | 3 | 0 | `src/modules/user/user.controller.ts#2`, `src/server.ts#1`, `src/modules/user/user.model.ts#0` |
| fixture:paths-alias | M11 | 7 | 3 | 0 | `src/modules/user/index.ts#0`, `src/server.ts#1`, `src/app.ts#1` |
| fixture:paths-alias | M12.value-to-type | 13 | 3 | 0 | `src/server.ts#0`, `src/modules/user/user.controller.ts#3`, `src/modules/user/user.model.ts#1` |
| fixture:paths-alias | M13.alias-add-extension | 6 | 3 | 0 | `src/modules/user/user.controller.ts#3`, `src/modules/user/user.controller.ts#1`, `src/modules/user/user.controller.ts#2` |
| fixture:paths-alias | M13.relative-add-extension | 5 | 3 | 0 | `src/modules/user/user.service.ts#1`, `src/modules/user/user.routes.ts#0`, `src/app.ts#1` |
| fixture:paths-alias | M19.alias | 8 | 3 | 0 | `src/modules/user/user.model.ts#1`, `src/modules/user/user.controller.ts#3`, `src/server.ts#2` |
| fixture:paths-alias | M19.relative | 7 | 3 | 0 | `src/app.ts#0`, `src/modules/user/user.service.ts#1`, `src/modules/user/user.routes.ts#0` |
| fixture:paths-alias | M23.missing | 6 | 3 | 0 | `src/modules/user/index.ts`, `src/modules/user/user.service.ts`, `src/shared/identity/ids.ts` |
| fixture:paths-alias | M24.gain-exec | 6 | 3 | 0 | `src/modules/user/user.model.ts`, `src/modules/user/user.service.ts`, `src/shared/identity/ids.ts` |
| fixture:paths-alias | M26.any-string | 11 | 3 | 0 | `src/server.ts@449`, `src/modules/user/user.routes.ts@94`, `src/modules/user/user.controller.ts@502` |
| fixture:paths-alias | M27.js-beside-ts | 5 | 3 | 0 | `src/modules/user/user.model.js`, `src/shared/identity/ids.js`, `src/modules/user/user.routes.js` |
| fixture:vitest-mocks | M2 | 4 | 3 | 0 | `src/services/refund.service.ts#0`, `src/modules/billing/billing.service.ts#2`, `src/modules/billing/billing.service.test.ts#1` |
| fixture:vitest-mocks | M9 | 4 | 3 | 0 | `src/modules/billing/billing.service.test.ts#1`, `src/modules/billing/billing.service.ts#1`, `src/modules/billing/billing.service.ts#2` |
| fixture:vitest-mocks | M10 | 5 | 3 | 0 | `src/modules/billing/billing.service.test.ts#1`, `src/modules/billing/billing.service.ts#0`, `src/modules/billing/billing.service.test.ts#0` |
| fixture:vitest-mocks | M11 | 7 | 3 | 0 | `src/modules/billing/billing.service.ts#1`, `src/modules/billing/billing.service.test.ts#1`, `src/services/refund.service.ts#2` |
| fixture:vitest-mocks | M12.value-to-type | 8 | 3 | 0 | `src/services/refund.service.test.ts#0`, `src/modules/billing/billing.service.ts#0`, `src/modules/billing/billing.service.ts#2` |
| fixture:vitest-mocks | M13.relative-add-extension | 9 | 3 | 0 | `src/modules/billing/billing.service.test.ts#3`, `src/services/refund.service.ts#2`, `src/modules/billing/billing.service.test.ts#4` |
| fixture:vitest-mocks | M19.relative | 9 | 3 | 0 | `src/modules/billing/billing.service.test.ts#1`, `src/modules/billing/billing.service.test.ts#3`, `src/modules/billing/billing.service.ts#2` |
| fixture:vitest-mocks | M26.any-string | 8 | 3 | 0 | `src/services/refund.service.test.ts@134`, `src/services/refund.service.test.ts@164`, `src/services/refund.service.test.ts@450` |
| fixture:vitest-mocks | M35.string | 4 | 3 | 0 | `src/services/refund.service.test.ts@450`, `src/services/refund.service.test.ts@373`, `src/services/refund.service.test.ts@164` |
| fixture:vitest-mocks | M36.call-trailing | 11 | 3 | 0 | `src/services/refund.service.ts@248`, `src/services/refund.service.test.ts@339`, `src/services/refund.service.ts@292` |
| synthetic:coverage | M12.value-to-type | 5 | 3 | 0 | `src/server.ts#1`, `src/server.test.ts#0`, `src/server.ts#2` |
| synthetic:coverage | M26.any-string | 6 | 3 | 0 | `src/server.ts@284`, `src/server.test.ts@99`, `src/server.ts@332` |
| synthetic:coverage | M35.string | 7 | 3 | 0 | `src/server.test.ts@216`, `src/server.ts@284`, `src/server.test.ts@232` |
| synthetic:coverage | M36.call-trailing | 11 | 3 | 0 | `src/server.test.ts@128`, `src/server.test.ts@261`, `src/server.ts@320` |
| synthetic:layout | M36.call-trailing | 5 | 3 | 0 | `src/report.ts@467`, `src/report.ts@762`, `src/report.ts@275` |
| synthetic:layout | M36.removed | 4 | 3 | 0 | `src/report.ts@759`, `src/report.ts@459`, `src/report.ts@740` |
| openhab-cloud | M1 | 84 | 3 | 0 | `tests/integration/pages/authentication.test.ts#1->src/controllers/index.ts`, `src/factories/service.factory.ts#3->src/config/index.ts`, `tests/integration/seed-database.ts#1->src/controllers/index.ts` |
| openhab-cloud | M2 | 8 | 3 | 0 | `src/modules/notification/notifications-view.controller.ts#3`, `src/modules/notification/notifications-view.controller.ts#2`, `src/modules/notification/notification.service.ts#1` |
| openhab-cloud | M8 | 8 | 3 | 0 | `src/models/event.model.ts<->src/models/index.ts`, `src/modules/notification/notification.model.ts<->src/modules/notification/notification.service.ts`, `src/controllers/index.ts<->src/controllers/invitations.controller.ts` |
| openhab-cloud | M9 | 6 | 3 | 0 | `src/controllers/index.ts#11`, `tests/mocha/unit/services/notification.service.test.ts#2`, `tests/mocha/unit/controllers/notifications-view.controller.test.ts#3` |
| openhab-cloud | M10 | 16 | 3 | 0 | `src/modules/notification/notifications-view.controller.ts#2`, `tests/mocha/unit/controllers/notifications-view.controller.test.ts#2`, `tests/mocha/unit/services/notification.service.test.ts#2` |
| openhab-cloud | M12.type-to-value | 13 | 3 | 0 | `tests/mocha/unit/controllers/notifications-view.controller.test.ts#7`, `src/modules/notification/notifications-view.controller.ts#1`, `src/modules/notification/notifications-view.controller.ts#3` |
| openhab-cloud | M12.value-to-type | 7 | 3 | 0 | `tests/mocha/unit/services/notification.service.test.ts#2`, `tests/mocha/unit/controllers/notifications-view.controller.test.ts#3`, `src/modules/notification/notification.model.ts#0` |
| openhab-cloud | M13.relative-add-extension | 11 | 3 | 0 | `src/modules/notification/notifications-view.controller.ts#3`, `tests/mocha/unit/services/notification.service.test.ts#2`, `src/services/index.ts#0` |
| openhab-cloud | M17.tsconfig-scope | 122 | 3 | 1 | `src/modules/notification/notification.model.ts->tests/mocha/unit/services`, `src/modules/notification/notification.service.ts->tests/mocha/unit/routes`, `src/models/index.ts->scripts` |
| openhab-cloud | M19.relative | 11 | 3 | 0 | `tests/mocha/unit/controllers/notifications-view.controller.test.ts#4`, `src/modules/notification/notifications-view.controller.ts#3`, `src/services/index.ts#0` |
| openhab-cloud | M20.move-out-of-root | 31 | 3 | 0 | `tests/mocha/unit/controllers/notifications-view.controller.test.ts->tests/mocha/notifications-view.controller.test.ts`, `tests/mocha/unit/controllers/events.controller.test.ts->tests/mocha/events.controller.test.ts`, `tests/mocha/unit/controllers/timezone.controller.test.ts->tests/mocha/timezone.controller.test.ts` |
| openhab-cloud | M21 | 6 | 3 | 0 | `.github/workflows/docker-publish.yml:tests/integration/seed-database.ts`, `package.json:src/cli/makeinvites.ts`, `package.json:scripts/update-license-headers.ts` |
| openhab-cloud | M23.force-added | 9 | 3 | 0 | `src/modules/notification/notifications-view.controller.ts->coverage/notifications-view.controller.ts`, `src/modules/notification/notification.service.ts->coverage/notification.service.ts`, `src/modules/notification/notification.service.ts->logs/notification.service.ts` |
| openhab-cloud | M26.any-string | 143 | 3 | 0 | `src/modules/notification/notification.model.ts@2111`, `tests/mocha/unit/controllers/notifications-view.controller.test.ts@5446`, `tests/mocha/unit/services/notification.service.test.ts@11604` |
| openhab-cloud | M34.return | 9 | 3 | 0 | `tests/mocha/unit/services/notification.service.test.ts@3614`, `tests/mocha/unit/services/notification.service.test.ts@3441`, `tests/mocha/unit/services/notification.service.test.ts@2598` |
| openhab-cloud | M35.string | 128 | 3 | 0 | `tests/mocha/unit/services/notification.service.test.ts@9165`, `tests/mocha/unit/services/notification.service.test.ts@11180`, `tests/mocha/unit/services/notification.service.test.ts@5890` |
| openhab-cloud | M36.array-trailing | 6 | 3 | 0 | `tests/mocha/unit/controllers/notifications-view.controller.test.ts@7078`, `tests/mocha/unit/services/notification.service.test.ts@7147`, `tests/mocha/unit/controllers/notifications-view.controller.test.ts@7346` |
| openhab-cloud | M36.call-trailing | 190 | 3 | 0 | `tests/mocha/unit/services/notification.service.test.ts@8572`, `tests/mocha/unit/services/notification.service.test.ts@9860`, `tests/mocha/unit/services/notification.service.test.ts@10359` |
| openhab-cloud | M36.removed | 71 | 3 | 0 | `tests/mocha/unit/services/notification.service.test.ts@5996`, `tests/mocha/unit/services/notification.service.test.ts@10947`, `tests/mocha/unit/services/notification.service.test.ts@6797` |
| openhab-cloud | M38.block | 5 | 3 | 0 | `src/services/index.ts@377`, `tests/mocha/unit/controllers/notifications-view.controller.test.ts@377`, `src/models/index.ts@377` |
| openhab-cloud | M38.line | 18 | 3 | 0 | `tests/mocha/unit/services/notification.service.test.ts@8716`, `src/models/index.ts@398`, `src/models/index.ts@1044` |
| immich-album | M2 | 36 | 3 | 0 | `server/src/controllers/index.ts#1`, `server/test/medium.factory.ts#16`, `server/src/dtos/album-response.dto.spec.ts#0` |
| immich-album | M8 | 23 | 3 | 0 | `server/src/services/view.service.ts<->server/src/services/workflow-execution.service.ts`, `server/src/services/auth.service.ts<->server/src/services/base.service.ts`, `server/src/modules/album/album.repository.ts<->server/src/modules/album/album.service.ts` |
| immich-album | M9 | 28 | 3 | 0 | `server/test/medium/specs/services/activity.service.spec.ts#5`, `server/src/services/workflow-execution.service.ts#13`, `server/src/services/base.service.ts#11` |
| immich-album | M10 | 626 | 3 | 0 | `server/test/medium/specs/services/asset.service.spec.ts#15`, `server/src/modules/album/album.repository.ts#7`, `server/test/utils.ts#80` |
| immich-album | M12.type-to-value | 10 | 3 | 0 | `server/src/services/workflow-execution.service.ts#4`, `server/src/modules/album/album-user.repository.ts#2`, `server/src/services/notification.service.ts#2` |
| immich-album | M12.value-to-type | 637 | 3 | 0 | `server/test/medium/specs/services/duplicate.service.spec.ts#13`, `server/test/medium.factory.ts#24`, `server/src/modules/album/album.service.ts#10` |
| immich-album | M13.alias-drop-extension | 36 | 3 | 0 | `server/src/modules/album/album.service.ts#6`, `server/src/services/notification.service.ts#4`, `server/test/utils.ts#23` |
| immich-album | M14 | 7 | 3 | 0 | `server/src/constants.ts`, `server/src/maintenance/maintenance-health.repository.ts`, `server/src/repositories/database.repository.ts` |
| immich-album | M17.tsconfig-scope | 351 | 3 | 9 | `server/src/dtos/shared-link.dto.ts->server/test/medium/specs/exif`, `server/src/repositories/index.ts->server/test/repositories`, `server/src/modules/album/album-user.repository.ts->server/test/medium` |
| immich-album | M19.alias | 36 | 3 | 0 | `server/src/repositories/index.ts#3`, `server/test/medium.factory.ts#17`, `server/src/modules/album/album.controller.ts#9` |
| immich-album | M20.move-out-of-root | 105 | 3 | 0 | `server/src/services/transcoding.service.spec.ts->server/transcoding.service.spec.ts`, `server/src/controllers/partner.controller.spec.ts->server/partner.controller.spec.ts`, `server/src/services/integrity.service.spec.ts->server/integrity.service.spec.ts` |
| immich-album | M20.rename-out-of-pattern | 105 | 3 | 0 | `server/src/controllers/download.controller.spec.ts->server/src/controllers/download.controller-spec.ts`, `server/src/services/media.service.spec.ts->server/src/services/media.service-spec.ts`, `server/src/services/storage.service.spec.ts->server/src/services/storage.service-spec.ts` |
| immich-album | M23.force-added | 21 | 3 | 11 | `server/src/modules/album/album.controller.spec.ts->docs/build/album.controller.spec.ts`, `server/src/modules/album/album.service.spec.ts->docs/build/album.service.spec.ts`, `server/src/modules/album/album.controller.spec.ts->uploads/album.controller.spec.ts` |
| immich-album | M23.missing | 7 | 3 | 0 | `server/src/modules/album/album.controller.ts`, `server/src/modules/album/album.service.spec.ts`, `server/src/modules/album/album.controller.spec.ts` |
| immich-album | M24.lose-exec | 20 | 3 | 0 | `machine-learning/scripts/configure-apt.sh`, `mobile/ios/ci_scripts/ci_post_clone.sh`, `.devcontainer/server/container-common.sh` |
| immich-album | M26.any-string | 1238 | 3 | 0 | `server/src/dtos/search.dto.ts@7923`, `server/src/modules/album/album.service.ts@11650`, `server/src/modules/album/album.repository.ts@15539` |
| immich-album | M27.js-beside-ts | 5 | 3 | 0 | `server/src/modules/album/album.service.js`, `server/src/modules/album/album.repository.js`, `server/src/modules/album/album.controller.js` |
| immich-album | M29 | 5 | 3 | 0 | `web/src/lib/__mocks__/sdk.mock.ts->server/src/modules/album/__mocks__/sdk.mock.ts`, `web/src/lib/__mocks__/resize-observer.mock.ts->server/src/modules/album/__mocks__/resize-observer.mock.ts`, `web/src/lib/__mocks__/intersection-observer.mock.ts->server/src/modules/album/__mocks__/intersection-observer.mock.ts` |
| immich-album | M30.tsconfig-paths | 5 | 3 | 0 | `server/tsconfig.json@579`, `packages/cli/tsconfig.json@531`, `e2e/tsconfig.json@485` |
| immich-album | M34.return | 146 | 3 | 0 | `server/test/medium.factory.ts@20416`, `server/test/medium.factory.ts@18216`, `server/test/medium/specs/services/duplicate.service.spec.ts@2337` |
| immich-album | M35.string | 829 | 3 | 0 | `server/test/medium/specs/services/asset.service.spec.ts@7005`, `server/test/medium/specs/sync/sync-album-to-asset.spec.ts@2540`, `server/src/services/notification.service.ts@7579` |
| immich-album | M35.template | 58 | 3 | 0 | `server/src/services/workflow-execution.service.ts@7520`, `server/src/services/workflow-execution.service.ts@7988`, `server/test/medium.factory.ts@27153` |
| immich-album | M36.array-trailing | 287 | 3 | 0 | `server/test/medium/specs/services/duplicate.service.spec.ts@8512`, `server/test/medium/specs/services/duplicate.service.spec.ts@13475`, `server/test/medium/specs/sync/sync-album-user.spec.ts@2878` |
| immich-album | M36.call-trailing | 2689 | 3 | 0 | `server/test/medium/specs/sync/sync-album.spec.ts@4009`, `server/src/services/notification.service.ts@13291`, `server/src/services/base.service.ts@13817` |
| immich-album | M36.removed | 829 | 3 | 0 | `server/test/medium/specs/sync/sync-album-to-asset.spec.ts@1506`, `server/test/medium/specs/services/activity.service.spec.ts@3011`, `server/test/medium/specs/services/asset.service.spec.ts@36743` |
| immich-album | M38.block | 5 | 3 | 0 | `server/src/dtos/search.dto.ts@12785`, `server/src/dtos/search.dto.ts@13000`, `server/test/medium.factory.ts@11986` |
| immich-album | M38.line | 77 | 3 | 0 | `server/test/medium/specs/sync/sync-album-to-asset.spec.ts@8025`, `server/src/dtos/shared-link.dto.ts@5283`, `server/test/utils.ts@14750` |
| immich-r1 | M2 | 1445 | 3 | 0 | `server/src/modules/search/search.repository.ts#6`, `server/src/database.ts#3`, `server/src/modules/album/album.controller.ts#9` |
| immich-r1 | M8 | 195 | 3 | 0 | `server/src/schema/tables/plugin.table.ts<->server/src/schema/tables/session.table.ts`, `server/src/decorators.ts<->server/src/enum.ts`, `server/src/utils/database-backups.ts<->server/src/utils/database.ts` |
| immich-r1 | M9 | 1197 | 3 | 0 | `server/src/modules/auth/auth.service.ts#8`, `server/src/bin/sync-sql.ts#16`, `server/test/medium/specs/services/auth.service.spec.ts#11` |
| immich-r1 | M10 | 3734 | 3 | 0 | `server/test/utils.ts#67`, `server/src/modules/sync/sync.repository.ts#3`, `server/src/utils/search-filter.ts#1` |
| immich-r1 | M12.type-to-value | 172 | 3 | 0 | `server/src/modules/video-stream/video-stream.repository.ts#2`, `server/src/modules/view-repository/view-repository.ts#1`, `server/src/modules/timeline/timeline.controller.ts#2` |
| immich-r1 | M12.value-to-type | 3874 | 3 | 0 | `server/src/modules/duplicate/duplicate.repository.ts#9`, `server/src/modules/integrity/integrity.repository.ts#1`, `server/src/maintenance/maintenance-worker.service.ts#20` |
| immich-r1 | M13.alias-drop-extension | 1445 | 3 | 0 | `server/src/controllers/index.ts#9`, `server/src/modules/notification/notification.service.ts#7`, `server/src/commands/reset-admin-password.command.ts#1` |
| immich-r1 | M14 | 7 | 3 | 0 | `server/src/services/cli.service.ts`, `server/src/maintenance/maintenance-health.repository.ts`, `server/src/main.ts` |
| immich-r1 | M17.tsconfig-scope | 26904 | 3 | 3 | `server/test/medium/globalSetup.ts->server/src/modules/storage`, `server/src/modules/view-repository/view-repository.ts->server/test/medium/specs/exif`, `server/src/modules/user/user.controller.ts->server/test/medium/specs/workflow` |
| immich-r1 | M19.alias | 1445 | 3 | 0 | `server/src/decorators.ts#5`, `server/src/maintenance/maintenance-worker.service.ts#23`, `server/src/modules/base/base.service.ts#32` |
| immich-r1 | M20.move-out-of-root | 105 | 3 | 0 | `server/src/modules/hls/hls.service.spec.ts->server/hls.service.spec.ts`, `server/src/validation.spec.ts->server/validation.spec.ts`, `server/src/modules/api-key/api-key.service.spec.ts->server/api-key.service.spec.ts` |
| immich-r1 | M20.rename-out-of-pattern | 105 | 3 | 0 | `server/src/modules/api/api.service.spec.ts->server/src/modules/api/api.service-spec.ts`, `server/src/modules/notification/notification.controller.spec.ts->server/src/modules/notification/notification.controller-spec.ts`, `server/src/modules/job/job.service.spec.ts->server/src/modules/job/job.service-spec.ts` |
| immich-r1 | M23.force-added | 876 | 3 | 3 | `server/src/modules/database-backup/database-backup.controller.spec.ts->uploads/database-backup.controller.spec.ts`, `server/src/modules/user-admin/user-admin.service.spec.ts->docs/build/user-admin.service.spec.ts`, `server/src/modules/map/map.service.spec.ts->coverage/map.service.spec.ts` |
| immich-r1 | M23.missing | 292 | 3 | 0 | `server/src/modules/machine-learning/machine-learning.repository.ts`, `server/src/modules/server/server.service.ts`, `server/src/modules/map/map.controller.spec.ts` |
| immich-r1 | M24.lose-exec | 20 | 3 | 0 | `web/bin/immich-web`, `server/bin/get-cpus.sh`, `server/bin/immich-admin` |
| immich-r1 | M26.any-string | 19427 | 3 | 0 | `server/src/modules/database-backup/database-backup.service.ts@13317`, `server/test/medium/specs/services/tag.service.spec.ts@4427`, `server/test/medium/specs/sync/sync-reset.spec.ts@836` |
| immich-r1 | M27.js-beside-ts | 205 | 3 | 0 | `server/src/modules/asset-media-response/asset-media-response.dto.js`, `server/src/modules/trash/trash.dto.js`, `server/src/modules/memory/memory.service.js` |
| immich-r1 | M29 | 10 | 3 | 0 | `web/src/lib/__mocks__/animate.mock.ts->server/src/modules/access/__mocks__/animate.mock.ts`, `web/src/lib/__mocks__/animate.mock.ts->server/src/modules/activity/__mocks__/animate.mock.ts`, `web/src/lib/__mocks__/sdk.mock.ts->server/src/modules/activity/__mocks__/sdk.mock.ts` |
| immich-r1 | M30.tsconfig-paths | 5 | 3 | 0 | `packages/cli/tsconfig.json@531`, `e2e/tsconfig.json@485`, `packages/scripts/tsconfig.json@332` |
| immich-r1 | M33.off-root | 100 | 3 | 0 | `server/src/modules/tag/.dependency-cruiser.json`, `server/src/modules/user/.dependency-cruiser.json`, `server/src/modules/exif/.dependency-cruiser.json` |
| immich-r1 | M34.postfix | 15 | 3 | 0 | `server/test/utils.ts@22852`, `server/test/medium/specs/services/memory.service.spec.ts@25778`, `server/test/utils.ts@22888` |
| immich-r1 | M34.return | 713 | 3 | 0 | `server/test/medium/specs/sync/sync-reset.spec.ts@527`, `server/src/utils/database.ts@4328`, `server/test/repositories/storage.repository.mock.ts@1104` |
| immich-r1 | M35.jsx | 25 | 3 | 0 | `server/src/emails/album-invite.email.tsx@1852`, `server/src/emails/test.email.tsx@432`, `server/src/emails/album-update.email.tsx@946` |
| immich-r1 | M35.string | 5393 | 3 | 0 | `server/src/utils/database.ts@25150`, `server/src/decorators.ts@975`, `server/test/medium/specs/services/memory.service.spec.ts@19880` |
| immich-r1 | M35.template | 575 | 3 | 0 | `server/src/schema/migrations/1744910873969-InitialMigration.ts@36727`, `server/src/utils/config.ts@2450`, `server/src/middleware/logging.interceptor.ts@1300` |
| immich-r1 | M36.array-trailing | 1402 | 3 | 0 | `server/test/medium/specs/services/duplicate.service.spec.ts@8586`, `server/test/medium/specs/repositories/person-user.repository.spec.ts@8715`, `server/test/medium/specs/services/duplicate.service.spec.ts@19033` |
| immich-r1 | M36.call-trailing | 12469 | 3 | 0 | `server/test/medium/specs/sync/sync-partner.spec.ts@2905`, `server/test/medium/specs/sync/sync-partner-asset.spec.ts@9970`, `server/src/maintenance/maintenance-websocket.repository.ts@2841` |
| immich-r1 | M36.removed | 4511 | 3 | 0 | `server/test/medium/specs/services/timeline.service.spec.ts@9019`, `server/test/medium/specs/sync/sync-asset-edit.spec.ts@1271`, `server/test/medium/specs/sync/sync-album-user.spec.ts@7480` |
| immich-r1 | M37.blank-line | 21 | 3 | 0 | `server/src/repositories/database.repository.ts@1281`, `server/test/utils.ts@14263`, `server/src/decorators.ts@8877` |
| immich-r1 | M37.into-statement | 19 | 3 | 0 | `server/test/medium/specs/repositories/storage.repository.spec.ts@663`, `server/src/repositories/storage.repository.spec.ts@5056`, `server/src/decorators.ts@3964` |
| immich-r1 | M38.block | 57 | 3 | 0 | `server/src/utils/asset.util.ts@4779`, `server/src/decorators.ts@5382`, `server/src/maintenance/maintenance-worker.controller.ts@3231` |
| immich-r1 | M38.line | 356 | 3 | 0 | `server/src/types.ts@10239`, `server/src/utils/media.ts@10929`, `server/test/medium/specs/repositories/asset.repository.spec.ts@5495` |

## Not applicable (no instance on the subject)

- fixture:ambient-references: M1, M3, M4, M5, M6, M7, M8, M11, M14, M17, M18, M20, M21, M28, M29, M30, M37
- fixture:assets-json: M1, M3, M4, M5, M6, M7, M11, M14, M17, M18, M20, M21, M25, M28, M29, M30, M37, M38
- fixture:cjs-relative: M1, M3, M4, M5, M6, M7, M11, M14, M18, M20, M21, M28, M29, M30, M37, M38
- fixture:jest-mocks: M1, M4, M14, M17, M18, M21, M25, M28, M37, M38
- fixture:nodenext-esm: M3, M4, M5, M6, M7, M11, M14, M17, M18, M20, M21, M28, M29, M30, M37
- fixture:paths-alias: M3, M4, M5, M6, M7, M14, M17, M18, M20, M21, M28, M29, M37, M38
- fixture:vitest-mocks: M1, M4, M6, M7, M14, M17, M18, M21, M28, M29, M37, M38
- synthetic:coverage: M1, M3, M5, M6, M7, M8, M17, M25, M29, M30, M37, M38
- synthetic:layout: M1, M3, M4, M5, M6, M7, M8, M10, M11, M14, M17, M18, M20, M21, M25, M26, M28, M29, M30
- openhab-cloud: M3, M4, M5, M6, M7, M11, M18, M28, M29, M30, M37
- immich-album: M1, M3, M4, M5, M6, M7, M11, M18, M21, M25, M28
- immich-r1: M1, M3, M4, M5, M6, M7, M18, M21, M25, M28
