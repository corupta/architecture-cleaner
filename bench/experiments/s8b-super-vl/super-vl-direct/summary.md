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
- Planner configuration `super-vl-direct`: Nemotron 3.5 Super VL (thinking off) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): replayed from `cassettes/s8b-bench.jsonl` (2 calls, recorded cost $0.0287, this run spent $0); 36 groups (24 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `31064ef9d518`.

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
| **planner (Super VL, thinking off) #1** | **36** | **90.34** | **0.778** | **0.880** | **1.28** | **75.00** | **8.74** | **21** |
| **planner (Super VL, thinking off) #2** | **34** | **76.55** | **0.555** | **0.680** | **1.32** | **55.00** | **7.55** | **39** |
| **planner (Super VL, thinking off) #3** | **34** | **78.62** | **0.598** | **0.720** | **1.32** | **55.00** | **7.56** | **43** |

Louvain MoJoFM per seed (1 to 5): r=1: 29.66, 35.17, 35.86, 32.41, 29.66; r=2: 56.55, 51.72, 59.31, 57.93, 59.31; r=4: 75.86, 73.79, 74.48, 75.86, 73.10.

Planner runs (`super-vl-direct`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking off) #1 | an edit | 3 of 3 parsed | yes | yes | 36 | 24 | $0.0287 | $0.0000 | 2 replayed | 20,945 | 24,915 | 0 | `31064ef9d518` |
| planner (Super VL, thinking off) #2 | an edit | 3 of 3 parsed | yes | yes | 34 | 22 | $0.0322 | $0.0322 | 2 recorded | 21,008 | 28,809 | 0 | `08822a7cc689` |
| planner (Super VL, thinking off) #3 | an edit | 3 of 3 parsed | yes | yes | 34 | 22 | $0.0280 | $0.0280 | 2 recorded | 21,034 | 24,099 | 0 | `9c093c91bd95` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 81.84 | 0.644 | 0.760 | 1.31 | 61.67 | 7.95 | 34.3 | 34.7 | 22.7 | $0.0296 | 25,941 | 0 |
| min | 76.55 | 0.555 | 0.680 | 1.28 | 55.00 | 7.55 | 21 | 34 | 22 | $0.0280 | 24,099 | 0 |
| max | 90.34 | 0.778 | 0.880 | 1.32 | 75.00 | 8.74 | 43 | 36 | 24 | $0.0322 | 28,809 | 0 |

1 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- 1 feature file is pinned in the facts (no method can place it) and not scored.
- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 12 against 10 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 22 of 186 files out of their draft group and merges 9 draft groups into others (43 draft groups, 36 plan groups). The winning edit, super-vl#2, had 43 group entries and 186 moves; the validator found no problem with it. The critic made 22 suggestions and its gate kept 16.
- Run 2 of 3: The planner's plan moves 4 of 186 files out of their draft group and merges 9 draft groups into others (43 draft groups, 34 plan groups). The winning edit, super-vl#1, had 43 group entries and 144 moves; the validator found 144 problems with it (unknown-file 144) and dropped or repaired each before applying it. The critic made 34 suggestions and its gate kept 14.
- Run 3 of 3: The planner's plan moves 8 of 186 files out of their draft group and merges 9 draft groups into others (43 draft groups, 34 plan groups). The winning edit, super-vl#3, had 43 group entries and 185 moves; the validator found 181 problems with it (bad-name 180, unknown-file 1) and dropped or repaired each before applying it. The critic made 27 suggestions and its gate kept 14.
- Leakage, over the 186 movable files every method sees: 0 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 0 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: constants (1 file, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 3 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## hoppscotch-H1 (scramble, H1)

- Target: `~/ac-targets/hoppscotch` `packages/hoppscotch-backend/src` @ `63273f8e599e`.
- Scramble: commit `8f874d49a6fd`, 156 files moved, 1 declined by the executor (they stay), 22 excluded; not certified.
- Scored: 156 feature files in 25 modules (46 hard), of 186 movable files. 0 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: seeds draft (export names), MoJoFM 81.38.
- Planner configuration `super-vl-direct`: Nemotron 3.5 Super VL (thinking off) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): replayed from `cassettes/s8b-bench.jsonl` (2 calls, recorded cost $0.0195, this run spent $0); 40 groups (19 modules), from the seeds draft (export names); planner rules 2; plan.yaml sha256 `420d0c350deb`.

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
| **planner (Super VL, thinking off) #1** | **40** | **77.24** | **0.585** | **0.680** | **1.40** | **57.50** | **7.26** | **34** |
| **planner (Super VL, thinking off) #2** | **35** | **79.31** | **0.636** | **0.680** | **1.32** | **62.50** | **7.22** | **29** |
| **planner (Super VL, thinking off) #3** | **28** | **82.76** | **0.741** | **0.760** | **1.04** | **72.50** | **8.22** | **15** |

Louvain MoJoFM per seed (1 to 5): r=1: 26.21, 34.48, 42.76, 33.10, 30.34; r=2: 55.86, 51.03, 54.48, 51.03, 53.10; r=4: 74.48, 76.55, 76.55, 80.00, 73.79.

Planner runs (`super-vl-direct`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking off) #1 | an edit | 3 of 3 parsed | yes | yes | 40 | 19 | $0.0195 | $0.0000 | 2 replayed | 22,101 | 14,288 | 0 | `420d0c350deb` |
| planner (Super VL, thinking off) #2 | an edit | 3 of 3 parsed | yes | yes | 35 | 22 | $0.0223 | $0.0223 | 2 recorded | 22,366 | 17,372 | 0 | `15b905a379bf` |
| planner (Super VL, thinking off) #3 | an edit | 3 of 3 parsed | yes | yes | 28 | 20 | $0.0230 | $0.0230 | 2 recorded | 21,888 | 18,256 | 0 | `8cee0046745c` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 79.77 | 0.654 | 0.707 | 1.25 | 64.17 | 7.57 | 26 | 34.3 | 20.3 | $0.0216 | 16,639 | 0 |
| min | 77.24 | 0.585 | 0.680 | 1.04 | 57.50 | 7.22 | 15 | 28 | 19 | $0.0195 | 14,288 | 0 |
| max | 82.76 | 0.741 | 0.760 | 1.40 | 72.50 | 8.22 | 34 | 40 | 22 | $0.0230 | 18,256 | 0 |

1 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- 1 feature file is pinned in the facts (no method can place it) and not scored.
- The planner starts from the seeds draft (export names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 12 against 85 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 0 of 186 files out of their draft group and merges 5 draft groups into others (45 draft groups, 40 plan groups). The winning edit, super-vl#1, had 45 group entries and 0 moves; the validator found no problem with it. The critic made 24 suggestions and its gate kept 6.
- Run 2 of 3: The planner's plan moves 2 of 186 files out of their draft group and merges 10 draft groups into others (45 draft groups, 35 plan groups). The winning edit, super-vl#2, had 45 group entries and 11 moves; the validator found 11 problems with it (unknown-file 11) and dropped or repaired each before applying it. The critic made 22 suggestions and its gate kept 9.
- Run 3 of 3: The planner's plan moves 16 of 186 files out of their draft group and merges 18 draft groups into others (45 draft groups, 28 plan groups). The winning edit, super-vl#3, had 45 group entries and 141 moves; the validator found 24 problems with it (foreign-name 22, banned-name 2) and dropped or repaired each before applying it. The critic made 21 suggestions and its gate kept 8.
- Leakage, over the 186 movable files every method sees: 0 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 0 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: constants (1 file, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 3 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## kaneo (scramble, default)

- Target: `~/ac-targets/kaneo` `apps/api/src` @ `b80818fe2e93`.
- Scramble: commit `65e47f349959`, 400 files moved, 1 declined by the executor (they stay), 12 excluded; not certified.
- Scored: 401 feature files in 47 modules (234 hard), of 454 movable files. 54 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: Louvain r=4 (mean of seeds 1-5), MoJoFM 66.90.
- Planner configuration `super-vl-direct`: Nemotron 3.5 Super VL (thinking off) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.0584; 51 groups (40 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `6ae8b1e9dd74`.

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
| **planner (Super VL, thinking off) #1** | **51** | **64.75** | **0.510** | **0.319** | **0.94** | **59.82** | **11.87** | **47** |
| **planner (Super VL, thinking off) #2** | **48** | **43.34** | **0.174** | **0.234** | **0.89** | **41.55** | **8.55** | **45** |
| **planner (Super VL, thinking off) #3 (invalid plan: 1 validator error)** | **44** | **60.31** | **0.360** | **0.362** | **0.87** | **49.32** | **10.68** | **38** |

Louvain MoJoFM per seed (1 to 5): r=1: 27.15, 31.85, 27.68, 32.90, 27.68; r=2: 51.44, 50.13, 48.30, 52.22, 53.00; r=4: 63.97, 65.80, 68.15, 68.15, 68.41.

Planner runs (`super-vl-direct`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking off) #1 | an edit | 3 of 3 parsed | yes | yes | 51 | 40 | $0.0584 | $0.0584 | 2 recorded | 48,747 | 48,683 | 0 | `6ae8b1e9dd74` |
| planner (Super VL, thinking off) #2 | an edit | 3 of 3 parsed | yes | yes | 48 | 45 | $0.0749 | $0.0749 | 2 recorded | 50,983 | 66,190 | 0 | `f67a2db32e33` |
| planner (Super VL, thinking off) #3 | an edit | 3 of 3 parsed | yes | no (1 error) | 44 | 39 | $0.0760 | $0.0760 | 2 recorded | 49,119 | 68,034 | 0 | `22c4cbb01c5e` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 56.13 | 0.348 | 0.305 | 0.90 | 50.23 | 10.36 | 43.3 | 47.7 | 41.3 | $0.0698 | 60,969 | 0 |
| min | 43.34 | 0.174 | 0.234 | 0.87 | 41.55 | 8.55 | 38 | 44 | 39 | $0.0584 | 48,683 | 0 |
| max | 64.75 | 0.510 | 0.362 | 0.94 | 59.82 | 11.87 | 47 | 51 | 45 | $0.0760 | 68,034 | 0 |

0 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 2 of 3 plans, counting only plans that came from an edit.

- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 125 against 29 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 126 of 454 files out of their draft group and merges 68 draft groups into others (114 draft groups, 51 plan groups). The winning edit, super-vl#1, had 114 group entries and 447 moves; the validator found 9 problems with it (banned-name 9) and dropped or repaired each before applying it. The critic made 14 suggestions and its gate kept 5.
- Run 2 of 3: The planner's plan moves 92 of 454 files out of their draft group and merges 68 draft groups into others (114 draft groups, 48 plan groups). The winning edit, super-vl#2, had 114 group entries and 433 moves; the validator found 119 problems with it (banned-name 115, unknown-file 3, duplicate-move 1) and dropped or repaired each before applying it. The critic made 85 suggestions and its gate kept 39.
- Run 3 of 3: The validator rejects the planner's plan (banned-name: "middleware" is a junk drawer or a type word, not a feature); it is scored as it came back.
- Run 3 of 3: The planner's plan moves 87 of 454 files out of their draft group and merges 72 draft groups into others (114 draft groups, 44 plan groups). The winning edit, super-vl#1, had 114 group entries and 447 moves; the validator found 34 problems with it (banned-name 34) and dropped or repaired each before applying it. The critic made 38 suggestions and its gate kept 18.
- Leakage, over the 454 movable files every method sees: 54 give their feature away in their path (1 still in a feature folder; 53 leaky renames; 0 in a sub-folder that only files of their feature share). 4 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## ghostfolio (scramble, default)

- Target: `~/ac-targets/ghostfolio` `apps/api/src/app` @ `347cd06a4012`.
- Scramble: commit `88d9276404ea`, 156 files moved, 3 declined by the executor (they stay), 219 excluded; not certified.
- Scored: 153 feature files in 34 modules (54 hard), of 154 movable files. 16 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: seeds draft (file names), MoJoFM 84.72.
- Planner configuration `super-vl-direct`: Nemotron 3.5 Super VL (thinking off) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): replayed from `cassettes/s8b-bench.jsonl` (2 calls, recorded cost $0.0156, this run spent $0); 29 groups (27 modules), from the seeds draft (export names); planner rules 2; plan.yaml sha256 `d25c7addaa8b`.

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
| **planner (Super VL, thinking off) #1 (invalid plan: 1 validator error)** | **29** | **80.56** | **0.772** | **0.559** | **0.82** | **89.80** | **17.09** | **7** |
| **planner (Super VL, thinking off) #2** | **35** | **83.33** | **0.681** | **0.676** | **1.00** | **83.67** | **18.64** | **6** |
| **planner (Super VL, thinking off) #3** | **35** | **82.64** | **0.750** | **0.706** | **1.00** | **83.67** | **18.50** | **6** |

Louvain MoJoFM per seed (1 to 5): r=1: 54.86, 52.78, 52.78, 52.78, 52.78; r=2: 65.28, 64.58, 64.58, 63.89, 65.28; r=4: 73.61, 76.39, 76.39, 75.00, 76.39.

Planner runs (`super-vl-direct`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking off) #1 | an edit | 3 of 3 parsed | yes | no (1 error) | 29 | 27 | $0.0156 | $0.0000 | 2 replayed | 13,333 | 12,863 | 0 | `d25c7addaa8b` |
| planner (Super VL, thinking off) #2 | an edit | 3 of 3 parsed | yes | yes | 35 | 33 | $0.0144 | $0.0144 | 2 recorded | 13,441 | 11,536 | 0 | `23e2022b1e6f` |
| planner (Super VL, thinking off) #3 | an edit | 3 of 3 parsed | yes | yes | 35 | 34 | $0.0278 | $0.0278 | 2 recorded | 13,536 | 26,400 | 0 | `4b5bf5fabae8` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 82.18 | 0.734 | 0.647 | 0.94 | 85.71 | 18.08 | 6.3 | 33 | 31.3 | $0.0193 | 16,933 | 0 |
| min | 80.56 | 0.681 | 0.559 | 0.82 | 83.67 | 17.09 | 6 | 29 | 27 | $0.0144 | 11,536 | 0 |
| max | 83.33 | 0.772 | 0.706 | 1.00 | 89.80 | 18.64 | 7 | 35 | 34 | $0.0278 | 26,400 | 0 |

0 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 2 of 3 plans, counting only plans that came from an edit.

- 6 feature files are pinned in the facts (no method can place them) and not scored.
- Run 1 of 3: The validator rejects the planner's plan (banned-name: "app" is a junk drawer or a type word, not a feature); it is scored as it came back.
- The planner starts from the seeds draft (export names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 4 against 5 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 8 of 154 files out of their draft group and merges 17 draft groups into others (44 draft groups, 29 plan groups). The winning edit, super-vl#3, had 44 group entries and 136 moves; the validator found 9 problems with it (banned-name 7, duplicate-move 1, unknown-file 1) and dropped or repaired each before applying it. The critic made 11 suggestions and its gate kept 3.
- Run 2 of 3: The planner's plan moves 6 of 154 files out of their draft group and merges 9 draft groups into others (44 draft groups, 35 plan groups). The winning edit, super-vl#2, had 44 group entries and 155 moves; the validator found 7 problems with it (banned-name 6, duplicate-move 1) and dropped or repaired each before applying it. The critic made 11 suggestions and its gate kept 5.
- Run 3 of 3: The planner's plan moves 8 of 154 files out of their draft group and merges 9 draft groups into others (44 draft groups, 35 plan groups). The winning edit, super-vl#2, had 44 group entries and 122 moves; the validator found 4 problems with it (banned-name 4) and dropped or repaired each before applying it. The critic made 24 suggestions and its gate kept 8.
- Leakage, over the 154 movable files every method sees: 16 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 16 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: calculator (6 files, 1 feature), errors (2 files, 2 features), ghostfolio (7 files, 1 feature), queue (3 files, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 28 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## immich (real)

- Target: `~/ac-targets/immich` `server/src` @ `02063972e82b`.
- 269 movable files; no ground truth.
- Best deterministic method: Louvain r=4 (mean of seeds 1-5), TurboMQ 10.50.
- Planner configuration `super-vl-direct`: Nemotron 3.5 Super VL (thinking off) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.0362; 61 groups (52 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `e8af9da5de5a`.

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
| **planner (Super VL, thinking off) #1** | **61** | – | – | – | – | – | **9.78** | **163** |
| **planner (Super VL, thinking off) #2** | **63** | – | – | – | – | – | **9.76** | **117** |
| **planner (Super VL, thinking off) #3** | **58** | – | – | – | – | – | **9.98** | **131** |

Planner runs (`super-vl-direct`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking off) #1 | an edit | 3 of 3 parsed | yes | yes | 61 | 52 | $0.0362 | $0.0362 | 2 recorded | 35,255 | 28,502 | 0 | `e8af9da5de5a` |
| planner (Super VL, thinking off) #2 | an edit | 3 of 3 parsed | yes | yes | 63 | 41 | $0.0412 | $0.0412 | 2 recorded | 34,910 | 34,140 | 0 | `3c7e37f8f260` |
| planner (Super VL, thinking off) #3 | an edit | 3 of 3 parsed | yes | yes | 58 | 42 | $0.0426 | $0.0426 | 2 recorded | 34,900 | 35,695 | 0 | `ed4a166f30cf` |

| over the 3 runs, as delivered | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|
| mean | 9.84 | 137 | 60.7 | 45 | $0.0400 | 32,779 | 0 |
| min | 9.76 | 117 | 58 | 41 | $0.0362 | 28,502 | 0 |
| max | 9.98 | 163 | 63 | 52 | $0.0426 | 35,695 | 0 |

0 of 3 runs score above the best deterministic method on TurboMQ's sum, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 31 against 29 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 21 of 269 files out of their draft group and merges 20 draft groups into others (81 draft groups, 61 plan groups). The winning edit, super-vl#2, had 81 group entries and 112 moves; the validator found 5 problems with it (unknown-file 3, bad-name 2) and dropped or repaired each before applying it. The critic made 25 suggestions and its gate kept 8.
- Run 2 of 3: The planner's plan moves 20 of 269 files out of their draft group and merges 21 draft groups into others (81 draft groups, 63 plan groups). The winning edit, super-vl#1, had 81 group entries and 269 moves; the validator found 2 problems with it (bad-name 1, duplicate-move 1) and dropped or repaired each before applying it. The critic made 14 suggestions and its gate kept 3.
- Run 3 of 3: The planner's plan moves 6 of 269 files out of their draft group and merges 23 draft groups into others (81 draft groups, 58 plan groups). The winning edit, super-vl#1, had 81 group entries and 113 moves; the validator found 102 problems with it (bad-name 100, kind-conflict 2) and dropped or repaired each before applying it. The critic made 6 suggestions and its gate kept 5.
