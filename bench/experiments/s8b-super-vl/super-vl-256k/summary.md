# ac bench results

`ac bench` writes one JSON file per entry next to this summary (format `ac-bench/1`, src/bench/types.ts).

- **Scramble** entries flatten a feature-modular package into type folders with our own executor, in one commit. Our certifier checks that commit as a pure move: hoppscotch, hoppscotch-H1, kaneo and ghostfolio were not certified in this run. Verdict, scope and failing checks are per entry below; a scramble is scored whatever its verdict, since the ground truth is its original folders.
- **Real** entries are type-sliced targets with no ground truth: TurboMQ and back-edges only.
- MoJoFM runs 0 to 100 (ARCADE port). ARI runs from −0.5 to 1. c2c_cvg is the share of ground-truth modules recovered
  (c2c above 0.66). The cluster ratio is predicted clusters over ground-truth clusters.
- MoJoFM hard counts only the files whose own name doesn't give their feature away.
- TurboMQ is Bunch's sum of cluster factors; the JSON also has ARCADE's mean. Back-edges are the cluster-level import
  edges that point backwards in the partition's own DAG order.
- Louvain rows are the mean of seeds 1 to 5. **Bold**: the best deterministic method (baselines and the seeds draft)
  and the planner.
- Planner rules (src/planner/types.ts) say how the planner reads the target and Nemotron's answers and ranks its
  edits. Rules 2 (S8) read a move that names its file by the id the prompt showed, or its target by a draft group's id
  or key, never rank a plan without feature modules first while another candidate has one, and leave out of the facts'
  tables a Kysely common table expression's alias and any query call in a comment or a string. Rules 1 (S5 to S7)
  dropped such moves. A replay uses the rules its profile pins for its recording; each entry with a planner row says
  which it used.
- A planner configuration (src/planner/configurations.ts) names the models that edit the draft and review the
  winner. With `--repeats k` the planner runs k times per entry through one gateway, so the cassette keys each
  repeated request by its occurrence and every run is a sample of its own; the deterministic methods run once. Each
  run has its row (`#1` to `#k`), and the entry's runs table adds where its plan came from (an edit, or the seeds
  draft when none of the K edit choices came back usable), its edit choices, whether the critic ran, the validator's
  verdict, the cost and the tokens. The mean, min and max take every run as delivered; the validator's count takes
  only the plans that came from an edit.

## hoppscotch (scramble, default)

- Target: `~/ac-targets/hoppscotch` `packages/hoppscotch-backend/src` @ `63273f8e599e`.
- Scramble: commit `f5fd0ff53cb7`, 156 files moved, 1 declined by the executor (they stay), 22 excluded; not certified.
- Scored: 156 feature files in 25 modules (46 hard), of 186 movable files. 0 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: seeds draft (export names), MoJoFM 81.38.
- Planner configuration `super-vl-256k`: Nemotron 3.5 Super VL (thinking on) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.4432; 27 groups (20 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `dce61dd2f15a`.

| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |
|---|---|---|---|---|---|---|---|---|
| B0 type folders | 17 | 9.66 | -0.022 | 0.000 | 0.60 | 30.00 | 1.11 | 15 |
| name-token (full stem) | 109 | 57.24 | 0.393 | 0.560 | 3.48 | 30.00 | 6.41 | 44 |
| name-token (anchored) | 56 | 75.17 | 0.541 | 0.760 | 1.88 | 50.00 | 7.43 | 53 |
| export-token (anchored) | 62 | 74.48 | 0.528 | 0.760 | 2.04 | 45.00 | 6.92 | 47 |
| seeds draft (file names) | 43 | 80.00 | 0.593 | 0.800 | 1.56 | 57.50 | 7.63 | 37 |
| **seeds draft (export names)** | **45** | **81.38** | **0.634** | **0.800** | **1.60** | **62.50** | **7.37** | **36** |
| Louvain r=1 (mean of seeds 1-5) | 8.4 | 32.55 | 0.278 | 0.032 | 0.30 | 57.00 | 4.02 | 17.2 |
| Louvain r=2 (mean of seeds 1-5) | 17 | 56.96 | 0.516 | 0.272 | 0.64 | 77.00 | 6.74 | 58 |
| Louvain r=4 (mean of seeds 1-5) | 33.6 | 74.62 | 0.601 | 0.616 | 1.26 | 79.00 | 9.63 | 76.4 |
| **planner (Super VL, thinking on, 256k) #1** | **27** | **94.48** | **0.896** | **0.920** | **1.04** | **85.00** | **8.40** | **15** |
| **planner (Super VL, thinking on, 256k) #2** | **29** | **88.97** | **0.796** | **0.840** | **1.12** | **72.50** | **8.12** | **31** |
| **planner (Super VL, thinking on, 256k) #3** | **28** | **90.34** | **0.824** | **0.880** | **1.08** | **70.00** | **8.44** | **49** |

Louvain MoJoFM per seed (1 to 5): r=1: 29.66, 35.17, 35.86, 32.41, 29.66; r=2: 56.55, 51.72, 59.31, 57.93, 59.31; r=4: 75.86, 73.79, 74.48, 75.86, 73.10.

Planner runs (`super-vl-256k`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking on, 256k) #1 | an edit | 3 of 3 parsed | yes | yes | 27 | 20 | $0.4432 | $0.4432 | 2 recorded | 20,855 | 485,528 | 478,513 | `dce61dd2f15a` |
| planner (Super VL, thinking on, 256k) #2 | an edit | 1 of 3 parsed (2 truncated) | yes | yes | 29 | 21 | $0.5506 | $0.5506 | 2 recorded | 20,901 | 604,806 | 601,481 | `cd1edee0dd1b` |
| planner (Super VL, thinking on, 256k) #3 | an edit | 3 of 3 parsed | yes | yes | 28 | 21 | $0.3572 | $0.3572 | 2 recorded | 20,949 | 389,864 | 383,022 | `aeb38400fd65` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 91.26 | 0.839 | 0.880 | 1.08 | 75.83 | 8.32 | 31.7 | 28 | 20.7 | $0.4503 | 493,399 | 487,672 |
| min | 88.97 | 0.796 | 0.840 | 1.04 | 70.00 | 8.12 | 15 | 27 | 20 | $0.3572 | 389,864 | 383,022 |
| max | 94.48 | 0.896 | 0.920 | 1.12 | 85.00 | 8.44 | 49 | 29 | 21 | $0.5506 | 604,806 | 601,481 |

3 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 2 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- 1 feature file is pinned in the facts (no method can place it) and not scored.
- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 12 against 10 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 22 of 186 files out of their draft group and merges 17 draft groups into others (43 draft groups, 27 plan groups). The winning edit, super-vl#1, had 43 group entries and 26 moves; the validator found no problem with it. The critic made 2 suggestions and its gate kept 1.
- Run 2 of 3: The planner's plan moves 15 of 186 files out of their draft group and merges 15 draft groups into others (43 draft groups, 29 plan groups). The winning edit, super-vl#3, had 43 group entries and 37 moves; the validator found no problem with it. The critic made 12 suggestions and its gate kept 10.
- Run 3 of 3: The planner's plan moves 17 of 186 files out of their draft group and merges 16 draft groups into others (43 draft groups, 28 plan groups). The winning edit, super-vl#1, had 43 group entries and 22 moves; the validator found no problem with it. The critic made 4 suggestions and its gate kept 4.
- Leakage, over the 186 movable files every method sees: 0 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 0 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: constants (1 file, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 3 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## hoppscotch-H1 (scramble, H1)

- Target: `~/ac-targets/hoppscotch` `packages/hoppscotch-backend/src` @ `63273f8e599e`.
- Scramble: commit `8f874d49a6fd`, 156 files moved, 1 declined by the executor (they stay), 22 excluded; not certified.
- Scored: 156 feature files in 25 modules (46 hard), of 186 movable files. 0 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: seeds draft (export names), MoJoFM 81.38.
- Planner configuration `super-vl-256k`: Nemotron 3.5 Super VL (thinking on) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.5383; 28 groups (22 modules), from the seeds draft (export names); planner rules 2; plan.yaml sha256 `cae2804c59d3`.

| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |
|---|---|---|---|---|---|---|---|---|
| B0 type folders | 17 | 9.66 | -0.022 | 0.000 | 0.60 | 30.00 | 1.11 | 15 |
| name-token (full stem) | 183 | 9.66 | 0.000 | 0.000 | 6.24 | 22.50 | 0.06 | 1 |
| name-token (anchored) | 175 | 9.66 | 0.000 | 0.000 | 6.24 | 22.50 | 0.06 | 2 |
| export-token (anchored) | 62 | 74.48 | 0.528 | 0.760 | 2.04 | 45.00 | 6.92 | 47 |
| seeds draft (file names) | 92 | 23.45 | 0.015 | 0.080 | 3.40 | 15.00 | 2.88 | 48 |
| **seeds draft (export names)** | **45** | **81.38** | **0.634** | **0.800** | **1.60** | **62.50** | **7.37** | **36** |
| Louvain r=1 (mean of seeds 1-5) | 9.4 | 33.38 | 0.299 | 0.048 | 0.34 | 56.50 | 4.44 | 22.4 |
| Louvain r=2 (mean of seeds 1-5) | 16.6 | 53.10 | 0.499 | 0.216 | 0.62 | 74.00 | 6.72 | 57.4 |
| Louvain r=4 (mean of seeds 1-5) | 33.2 | 76.27 | 0.601 | 0.616 | 1.22 | 80.50 | 9.57 | 70.4 |
| **planner (Super VL, thinking on, 256k) #1** | **28** | **88.97** | **0.827** | **0.920** | **1.12** | **72.50** | **8.22** | **25** |
| **planner (Super VL, thinking on, 256k) #2** | **28** | **93.10** | **0.897** | **0.960** | **1.08** | **85.00** | **8.35** | **25** |
| **planner (Super VL, thinking on, 256k) #3** | **29** | **90.34** | **0.827** | **0.920** | **1.08** | **77.50** | **8.41** | **23** |

Louvain MoJoFM per seed (1 to 5): r=1: 26.21, 34.48, 42.76, 33.10, 30.34; r=2: 55.86, 51.03, 54.48, 51.03, 53.10; r=4: 74.48, 76.55, 76.55, 80.00, 73.79.

Planner runs (`super-vl-256k`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking on, 256k) #1 | an edit | 2 of 3 parsed (1 truncated) | yes | yes | 28 | 22 | $0.5383 | $0.5383 | 2 recorded | 21,970 | 590,769 | 585,073 | `cae2804c59d3` |
| planner (Super VL, thinking on, 256k) #2 | an edit | 3 of 3 parsed | yes | yes | 28 | 21 | $0.4342 | $0.4342 | 2 recorded | 21,954 | 475,074 | 468,662 | `fe89b94643f5` |
| planner (Super VL, thinking on, 256k) #3 | an edit | 3 of 3 parsed | yes | yes | 29 | 22 | $0.4025 | $0.4025 | 2 recorded | 21,899 | 439,878 | 434,155 | `22b2010c55e7` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 90.80 | 0.850 | 0.933 | 1.09 | 78.33 | 8.33 | 24.3 | 28.3 | 21.7 | $0.4583 | 501,907 | 495,963 |
| min | 88.97 | 0.827 | 0.920 | 1.08 | 72.50 | 8.22 | 23 | 28 | 21 | $0.4025 | 439,878 | 434,155 |
| max | 93.10 | 0.897 | 0.960 | 1.12 | 85.00 | 8.41 | 25 | 29 | 22 | $0.5383 | 590,769 | 585,073 |

3 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 1 of 9 edit choices was cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- 1 feature file is pinned in the facts (no method can place it) and not scored.
- The planner starts from the seeds draft (export names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 12 against 85 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 4 of 186 files out of their draft group and merges 17 draft groups into others (45 draft groups, 28 plan groups). The winning edit, super-vl#1, had 45 group entries and 37 moves; the validator found 33 problems with it (bad-name 31, foreign-name 2) and dropped or repaired each before applying it. The critic made 7 suggestions and its gate kept 5.
- Run 2 of 3: The planner's plan moves 17 of 186 files out of their draft group and merges 17 draft groups into others (45 draft groups, 28 plan groups). The winning edit, super-vl#1, had 45 group entries and 21 moves; the validator found 1 problem with it (foreign-name 1) and dropped or repaired each before applying it. The critic made 6 suggestions and its gate kept 5.
- Run 3 of 3: The planner's plan moves 10 of 186 files out of their draft group and merges 17 draft groups into others (45 draft groups, 29 plan groups). The winning edit, super-vl#3, had 45 group entries and 9 moves; the validator found no problem with it. The critic made 12 suggestions and its gate kept 11.
- Leakage, over the 186 movable files every method sees: 0 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 0 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: constants (1 file, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 3 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## kaneo (scramble, default)

- Target: `~/ac-targets/kaneo` `apps/api/src` @ `b80818fe2e93`.
- Scramble: commit `65e47f349959`, 400 files moved, 1 declined by the executor (they stay), 12 excluded; not certified.
- Scored: 401 feature files in 47 modules (234 hard), of 454 movable files. 54 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: Louvain r=4 (mean of seeds 1-5), MoJoFM 66.90.
- Planner configuration `super-vl-256k`: Nemotron 3.5 Super VL (thinking on) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.4232; 35 groups (28 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `505467bdfd4e`.

| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |
|---|---|---|---|---|---|---|---|---|
| B0 type folders | 10 | 13.32 | 0.017 | 0.000 | 0.17 | 16.44 | 1.07 | 8 |
| name-token (full stem) | 426 | 13.05 | 0.012 | 0.149 | 7.96 | 14.61 | 2.38 | 4 |
| name-token (anchored) | 156 | 49.61 | 0.254 | 0.426 | 2.91 | 30.59 | 9.75 | 95 |
| export-token (anchored) | 252 | 26.37 | 0.080 | 0.085 | 4.96 | 29.22 | 3.32 | 61 |
| seeds draft (file names) | 114 | 50.13 | 0.236 | 0.404 | 2.23 | 31.96 | 10.40 | 72 |
| seeds draft (export names) | 104 | 31.07 | 0.078 | 0.064 | 1.96 | 30.59 | 6.30 | 104 |
| Louvain r=1 (mean of seeds 1-5) | 11.2 | 29.45 | 0.213 | 0.021 | 0.19 | 37.35 | 4.92 | 16.2 |
| Louvain r=2 (mean of seeds 1-5) | 23 | 51.02 | 0.389 | 0.094 | 0.45 | 49.50 | 10.01 | 43.4 |
| **Louvain r=4 (mean of seeds 1-5)** | **39.6** | **66.90** | **0.465** | **0.311** | **0.80** | **64.48** | **16.05** | **60.8** |
| **planner (Super VL, thinking on, 256k) #1** | **35** | **58.75** | **0.374** | **0.362** | **0.72** | **43.84** | **11.80** | **51** |
| **planner (Super VL, thinking on, 256k) #2** | **37** | **57.44** | **0.365** | **0.255** | **0.77** | **46.12** | **12.12** | **33** |
| **planner (Super VL, thinking on, 256k) #3** | **30** | **49.61** | **0.273** | **0.170** | **0.64** | **42.47** | **8.99** | **53** |

Louvain MoJoFM per seed (1 to 5): r=1: 27.15, 31.85, 27.68, 32.90, 27.68; r=2: 51.44, 50.13, 48.30, 52.22, 53.00; r=4: 63.97, 65.80, 68.15, 68.15, 68.41.

Planner runs (`super-vl-256k`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking on, 256k) #1 | an edit | 2 of 3 parsed (1 truncated) | yes | yes | 35 | 28 | $0.4232 | $0.4232 | 2 recorded | 49,585 | 453,652 | 413,014 | `505467bdfd4e` |
| planner (Super VL, thinking on, 256k) #2 | an edit | 3 of 3 parsed | yes | yes | 37 | 29 | $0.3236 | $0.3236 | 2 recorded | 49,112 | 343,177 | 321,942 | `de748b02addc` |
| planner (Super VL, thinking on, 256k) #3 | an edit | 3 of 3 parsed | yes | yes | 30 | 21 | $0.3298 | $0.3298 | 2 recorded | 49,260 | 349,993 | 321,309 | `6ea81eda1555` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 55.27 | 0.337 | 0.262 | 0.71 | 44.14 | 10.97 | 45.7 | 34 | 26 | $0.3588 | 382,274 | 352,088 |
| min | 49.61 | 0.273 | 0.170 | 0.64 | 42.47 | 8.99 | 33 | 30 | 21 | $0.3236 | 343,177 | 321,309 |
| max | 58.75 | 0.374 | 0.362 | 0.77 | 46.12 | 12.12 | 53 | 37 | 29 | $0.4232 | 453,652 | 413,014 |

0 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 1 of 9 edit choices was cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 125 against 29 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 80 of 454 files out of their draft group and merges 79 draft groups into others (114 draft groups, 35 plan groups). The winning edit, super-vl#3, had 114 group entries and 793 moves; the validator found 408 problems with it (duplicate-move 281, unknown-file 125, kind-conflict 2) and dropped or repaired each before applying it. The critic made 3 suggestions and its gate kept 3.
- Run 2 of 3: The planner's plan moves 75 of 454 files out of their draft group and merges 78 draft groups into others (114 draft groups, 37 plan groups). The winning edit, super-vl#3, had 114 group entries and 92 moves; the validator found no problem with it. The critic made 3 suggestions and its gate kept 3.
- Run 3 of 3: The planner's plan moves 58 of 454 files out of their draft group and merges 84 draft groups into others (114 draft groups, 30 plan groups). The winning edit, super-vl#3, had 114 group entries and 112 moves; the validator found 11 problems with it (duplicate-move 6, unknown-file 5) and dropped or repaired each before applying it. The critic made 4 suggestions and its gate kept 4.
- Leakage, over the 454 movable files every method sees: 54 give their feature away in their path (1 still in a feature folder; 53 leaky renames; 0 in a sub-folder that only files of their feature share). 4 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## ghostfolio (scramble, default)

- Target: `~/ac-targets/ghostfolio` `apps/api/src/app` @ `347cd06a4012`.
- Scramble: commit `88d9276404ea`, 156 files moved, 3 declined by the executor (they stay), 219 excluded; not certified.
- Scored: 153 feature files in 34 modules (54 hard), of 154 movable files. 16 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: seeds draft (file names), MoJoFM 84.72.
- Planner configuration `super-vl-256k`: Nemotron 3.5 Super VL (thinking on) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.5959; 29 groups (28 modules), from the seeds draft (export names); planner rules 2; plan.yaml sha256 `5de898cb3496`.

| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |
|---|---|---|---|---|---|---|---|---|
| B0 type folders | 10 | 18.06 | 0.014 | 0.000 | 0.26 | 55.10 | 1.64 | 2 |
| name-token (full stem) | 82 | 61.81 | 0.220 | 0.706 | 2.38 | 28.57 | 18.33 | 5 |
| name-token (anchored) | 56 | 77.78 | 0.360 | 0.794 | 1.62 | 57.14 | 19.42 | 9 |
| export-token (anchored) | 55 | 76.39 | 0.347 | 0.765 | 1.59 | 55.10 | 18.79 | 8 |
| **seeds draft (file names)** | **44** | **84.72** | **0.441** | **0.794** | **1.26** | **77.55** | **19.88** | **8** |
| seeds draft (export names) | 44 | 82.64 | 0.421 | 0.765 | 1.26 | 75.51 | 19.20 | 7 |
| Louvain r=1 (mean of seeds 1-5) | 17.6 | 53.20 | 0.334 | 0.229 | 0.49 | 84.89 | 13.84 | 6.6 |
| Louvain r=2 (mean of seeds 1-5) | 23 | 64.72 | 0.492 | 0.294 | 0.65 | 88.17 | 16.21 | 12 |
| Louvain r=4 (mean of seeds 1-5) | 30.8 | 75.56 | 0.501 | 0.435 | 0.87 | 85.30 | 19.71 | 7.2 |
| **planner (Super VL, thinking on, 256k) #1** | **29** | **87.50** | **0.928** | **0.676** | **0.85** | **97.96** | **18.45** | **3** |
| **planner (Super VL, thinking on, 256k) #2 (invalid plan: 1 validator error)** | **31** | **87.50** | **0.920** | **0.735** | **0.88** | **97.96** | **18.28** | **3** |
| **planner (Super VL, thinking on, 256k) #3** | **31** | **83.33** | **0.761** | **0.647** | **0.88** | **93.88** | **18.22** | **4** |

Louvain MoJoFM per seed (1 to 5): r=1: 54.86, 52.78, 52.78, 52.78, 52.78; r=2: 65.28, 64.58, 64.58, 63.89, 65.28; r=4: 73.61, 76.39, 76.39, 75.00, 76.39.

Planner runs (`super-vl-256k`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking on, 256k) #1 | an edit | 1 of 3 parsed (2 truncated) | yes | yes | 29 | 28 | $0.5959 | $0.5959 | 2 recorded | 13,108 | 657,713 | 653,690 | `5de898cb3496` |
| planner (Super VL, thinking on, 256k) #2 | an edit | 2 of 3 parsed (1 truncated) | yes | no (1 error) | 31 | 27 | $0.5912 | $0.5912 | 2 recorded | 13,153 | 652,511 | 647,176 | `f67d679a6145` |
| planner (Super VL, thinking on, 256k) #3 | an edit | 2 of 3 parsed (1 truncated) | yes | yes | 31 | 23 | $0.5567 | $0.5567 | 2 recorded | 13,174 | 614,143 | 608,386 | `4fc45ea31d30` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 86.11 | 0.870 | 0.686 | 0.87 | 96.60 | 18.31 | 3.3 | 30.3 | 26 | $0.5813 | 641,456 | 636,417 |
| min | 83.33 | 0.761 | 0.647 | 0.85 | 93.88 | 18.22 | 3 | 29 | 23 | $0.5567 | 614,143 | 608,386 |
| max | 87.50 | 0.928 | 0.735 | 0.88 | 97.96 | 18.45 | 4 | 31 | 28 | $0.5959 | 657,713 | 653,690 |

2 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 4 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 2 of 3 plans, counting only plans that came from an edit.

- 6 feature files are pinned in the facts (no method can place them) and not scored.
- The planner starts from the seeds draft (export names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 4 against 5 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 10 of 154 files out of their draft group and merges 16 draft groups into others (44 draft groups, 29 plan groups). The winning edit, super-vl#1, had 44 group entries and 53 moves; the validator found no problem with it. The critic made 3 suggestions and its gate kept 3.
- Run 2 of 3: The validator rejects the planner's plan (banned-name: "app" is a junk drawer or a type word, not a feature); it is scored as it came back.
- Run 2 of 3: The planner's plan moves 8 of 154 files out of their draft group and merges 14 draft groups into others (44 draft groups, 31 plan groups). The winning edit, super-vl#2, had 44 group entries and 58 moves; the validator found 3 problems with it (foreign-name 2, duplicate-move 1) and dropped or repaired each before applying it. The critic made no suggestion.
- Run 3 of 3: The planner's plan moves 9 of 154 files out of their draft group and merges 14 draft groups into others (44 draft groups, 31 plan groups). The winning edit, super-vl#3, had 44 group entries and 77 moves; the validator found no problem with it. The critic made 2 suggestions and its gate kept 2.
- Leakage, over the 154 movable files every method sees: 16 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 16 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: calculator (6 files, 1 feature), errors (2 files, 2 features), ghostfolio (7 files, 1 feature), queue (3 files, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 28 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## immich (real)

- Target: `~/ac-targets/immich` `server/src` @ `02063972e82b`.
- 269 movable files; no ground truth.
- Best deterministic method: Louvain r=4 (mean of seeds 1-5), TurboMQ 10.50.
- Planner configuration `super-vl-256k`: Nemotron 3.5 Super VL (thinking on) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.2697; 52 groups (43 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `0b9e24688266`.

| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |
|---|---|---|---|---|---|---|---|---|
| B0 type folders | 10 | – | – | – | – | – | 1.94 | 25 |
| name-token (full stem) | 138 | – | – | – | – | – | 9.03 | 212 |
| name-token (anchored) | 118 | – | – | – | – | – | 9.51 | 129 |
| export-token (anchored) | 122 | – | – | – | – | – | 8.39 | 127 |
| seeds draft (file names) | 81 | – | – | – | – | – | 10.19 | 141 |
| seeds draft (export names) | 83 | – | – | – | – | – | 9.11 | 142 |
| Louvain r=1 (mean of seeds 1-5) | 9.2 | – | – | – | – | – | 3.81 | 20.8 |
| Louvain r=2 (mean of seeds 1-5) | 25.6 | – | – | – | – | – | 7.09 | 136.8 |
| **Louvain r=4 (mean of seeds 1-5)** | **47.6** | – | – | – | – | – | **10.50** | **166** |
| **planner (Super VL, thinking on, 256k) #1** | **52** | – | – | – | – | – | **10.34** | **119** |
| **planner (Super VL, thinking on, 256k) #2** | **52** | – | – | – | – | – | **10.08** | **118** |
| **planner (Super VL, thinking on, 256k) #3** | **52** | – | – | – | – | – | **10.35** | **120** |

Planner runs (`super-vl-256k`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking on, 256k) #1 | an edit | 3 of 3 parsed | yes | yes | 52 | 43 | $0.2697 | $0.2697 | 2 recorded | 34,729 | 288,090 | 279,007 | `0b9e24688266` |
| planner (Super VL, thinking on, 256k) #2 | an edit | 3 of 3 parsed | yes | yes | 52 | 43 | $0.2912 | $0.2912 | 2 recorded | 34,771 | 311,963 | 303,925 | `862799b1547f` |
| planner (Super VL, thinking on, 256k) #3 | an edit | 3 of 3 parsed | yes | yes | 52 | 42 | $0.3124 | $0.3124 | 2 recorded | 34,833 | 335,530 | 326,825 | `675e2d385416` |

| over the 3 runs, as delivered | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|
| mean | 10.26 | 119 | 52 | 42.7 | $0.2911 | 311,861 | 303,252 |
| min | 10.08 | 118 | 52 | 42 | $0.2697 | 288,090 | 279,007 |
| max | 10.35 | 120 | 52 | 43 | $0.3124 | 335,530 | 326,825 |

0 of 3 runs score above the best deterministic method on TurboMQ's sum, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 31 against 29 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 12 of 269 files out of their draft group and merges 29 draft groups into others (81 draft groups, 52 plan groups). The winning edit, super-vl#2, had 81 group entries and 14 moves; the validator found no problem with it. The critic made 1 suggestion and its gate kept 1.
- Run 2 of 3: The planner's plan moves 12 of 269 files out of their draft group and merges 29 draft groups into others (81 draft groups, 52 plan groups). The winning edit, super-vl#1, had 81 group entries and 15 moves; the validator found no problem with it. The critic made 4 suggestions and its gate kept 4.
- Run 3 of 3: The planner's plan moves 12 of 269 files out of their draft group and merges 29 draft groups into others (81 draft groups, 52 plan groups). The winning edit, super-vl#3, had 81 group entries and 15 moves; the validator found no problem with it. The critic made 4 suggestions and its gate kept 4.
