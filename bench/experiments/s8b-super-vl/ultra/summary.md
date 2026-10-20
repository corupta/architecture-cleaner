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
- Planner configuration `ultra`: Nemotron 3 Ultra (medium_effort) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.1963; 31 groups (22 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `f2c0d42c99f4`.

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
| **planner (Ultra) #1** | **31** | **84.83** | **0.722** | **0.840** | **1.16** | **57.50** | **7.78** | **35** |
| **planner (Ultra) #2** | **35** | **81.38** | **0.591** | **0.800** | **1.32** | **57.50** | **7.67** | **39** |
| **planner (Ultra) #3** | **38** | **83.45** | **0.621** | **0.840** | **1.36** | **57.50** | **8.13** | **37** |

Louvain MoJoFM per seed (1 to 5): r=1: 29.66, 35.17, 35.86, 32.41, 29.66; r=2: 56.55, 51.72, 59.31, 57.93, 59.31; r=4: 75.86, 73.79, 74.48, 75.86, 73.10.

Planner runs (`ultra`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Ultra) #1 | an edit | 3 of 3 parsed | yes | yes | 31 | 22 | $0.1963 | $0.1963 | 2 recorded | 20,988 | 58,434 | 53,657 | `f2c0d42c99f4` |
| planner (Ultra) #2 | an edit | 3 of 3 parsed | yes | yes | 35 | 22 | $0.1416 | $0.1416 | 2 recorded | 21,179 | 40,138 | 35,496 | `57f426d29cfc` |
| planner (Ultra) #3 | an edit | 2 of 3 parsed (1 truncated) | yes | yes | 38 | 31 | $0.3127 | $0.3127 | 2 recorded | 20,948 | 97,267 | 93,112 | `b2492c91c709` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 83.22 | 0.645 | 0.827 | 1.28 | 57.50 | 7.86 | 37 | 34.7 | 25 | $0.2169 | 65,280 | 60,755 |
| min | 81.38 | 0.591 | 0.800 | 1.16 | 57.50 | 7.67 | 35 | 31 | 22 | $0.1416 | 40,138 | 35,496 |
| max | 84.83 | 0.722 | 0.840 | 1.36 | 57.50 | 8.13 | 39 | 38 | 31 | $0.3127 | 97,267 | 93,112 |

2 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 1 of 9 edit choices was cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- 1 feature file is pinned in the facts (no method can place it) and not scored.
- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 12 against 10 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 8 of 186 files out of their draft group and merges 14 draft groups into others (43 draft groups, 31 plan groups). The winning edit, ultra#2, had 43 group entries and 2 moves; the validator found no problem with it. The critic made 15 suggestions and its gate kept 8.
- Run 2 of 3: The planner's plan moves 0 of 186 files out of their draft group and merges 8 draft groups into others (43 draft groups, 35 plan groups). The winning edit, ultra#1, had 43 group entries and 0 moves; the validator found 1 problem with it (foreign-name 1) and dropped or repaired each before applying it. The critic made 17 suggestions and its gate kept none.
- Run 3 of 3: The planner's plan moves 8 of 186 files out of their draft group and merges 5 draft groups into others (43 draft groups, 38 plan groups). The winning edit, ultra#2, had 43 group entries and 3 moves; the validator found 2 problems with it (bad-name 2) and dropped or repaired each before applying it. The critic made 20 suggestions and its gate kept 12.
- Leakage, over the 186 movable files every method sees: 0 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 0 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: constants (1 file, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 3 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## hoppscotch-H1 (scramble, H1)

- Target: `~/ac-targets/hoppscotch` `packages/hoppscotch-backend/src` @ `63273f8e599e`.
- Scramble: commit `8f874d49a6fd`, 156 files moved, 1 declined by the executor (they stay), 22 excluded; not certified.
- Scored: 156 feature files in 25 modules (46 hard), of 186 movable files. 0 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: seeds draft (export names), MoJoFM 81.38.
- Planner configuration `ultra`: Nemotron 3 Ultra (medium_effort) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.2051; 29 groups (21 modules), from the seeds draft (export names); planner rules 2; plan.yaml sha256 `79b7bb75dd9a`.

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
| **planner (Ultra) #1** | **29** | **90.34** | **0.804** | **0.920** | **1.12** | **75.00** | **8.46** | **22** |
| **planner (Ultra) #2** | **33** | **80.00** | **0.635** | **0.760** | **1.24** | **65.00** | **7.14** | **32** |
| **planner (Ultra) #3** | **32** | **84.83** | **0.708** | **0.800** | **1.24** | **67.50** | **7.85** | **31** |

Louvain MoJoFM per seed (1 to 5): r=1: 26.21, 34.48, 42.76, 33.10, 30.34; r=2: 55.86, 51.03, 54.48, 51.03, 53.10; r=4: 74.48, 76.55, 76.55, 80.00, 73.79.

Planner runs (`ultra`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Ultra) #1 | an edit | 3 of 3 parsed | yes | yes | 29 | 21 | $0.2051 | $0.2051 | 2 recorded | 21,985 | 61,050 | 54,790 | `79b7bb75dd9a` |
| planner (Ultra) #2 | an edit | 3 of 3 parsed | yes | yes | 33 | 23 | $0.1739 | $0.1739 | 2 recorded | 22,079 | 50,600 | 45,902 | `5258fb70de83` |
| planner (Ultra) #3 | an edit | 3 of 3 parsed | yes | yes | 32 | 22 | $0.1726 | $0.1726 | 2 recorded | 22,034 | 50,203 | 44,835 | `673b02dd9e5e` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 85.06 | 0.716 | 0.827 | 1.20 | 69.17 | 7.82 | 28.3 | 31.3 | 22 | $0.1839 | 53,951 | 48,509 |
| min | 80.00 | 0.635 | 0.760 | 1.12 | 65.00 | 7.14 | 22 | 29 | 21 | $0.1726 | 50,203 | 44,835 |
| max | 90.34 | 0.804 | 0.920 | 1.24 | 75.00 | 8.46 | 32 | 33 | 23 | $0.2051 | 61,050 | 54,790 |

2 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- 1 feature file is pinned in the facts (no method can place it) and not scored.
- The planner starts from the seeds draft (export names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 12 against 85 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 11 of 186 files out of their draft group and merges 16 draft groups into others (45 draft groups, 29 plan groups). The winning edit, ultra#1, had 45 group entries and 31 moves; the validator found 1 problem with it (foreign-name 1) and dropped or repaired each before applying it. The critic made 16 suggestions and its gate kept 14.
- Run 2 of 3: The planner's plan moves 3 of 186 files out of their draft group and merges 13 draft groups into others (45 draft groups, 33 plan groups). The winning edit, ultra#1, had 45 group entries and 7 moves; the validator found 4 problems with it (foreign-name 2, banned-name 1, unknown-file 1) and dropped or repaired each before applying it. The critic made 3 suggestions and its gate kept 2.
- Run 3 of 3: The planner's plan moves 3 of 186 files out of their draft group and merges 13 draft groups into others (45 draft groups, 32 plan groups). The winning edit, ultra#2, had 45 group entries and 12 moves; the validator found 13 problems with it (unknown-file 12, foreign-name 1) and dropped or repaired each before applying it. The critic made 12 suggestions and its gate kept 6.
- Leakage, over the 186 movable files every method sees: 0 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 0 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: constants (1 file, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 3 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## kaneo (scramble, default)

- Target: `~/ac-targets/kaneo` `apps/api/src` @ `b80818fe2e93`.
- Scramble: commit `65e47f349959`, 400 files moved, 1 declined by the executor (they stay), 12 excluded; not certified.
- Scored: 401 feature files in 47 modules (234 hard), of 454 movable files. 54 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: Louvain r=4 (mean of seeds 1-5), MoJoFM 66.90.
- Planner configuration `ultra`: Nemotron 3 Ultra (medium_effort) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.2250; 56 groups (41 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `6ed88b7cd306`.

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
| **planner (Ultra) #1** | **56** | **50.91** | **0.254** | **0.234** | **1.15** | **36.53** | **10.48** | **55** |
| **planner (Ultra) #2** | **51** | **50.91** | **0.233** | **0.277** | **1.06** | **34.70** | **9.45** | **55** |
| **planner (Ultra) #3 (invalid plan: 1 validator error)** | **63** | **50.39** | **0.259** | **0.277** | **1.28** | **33.33** | **9.58** | **61** |

Louvain MoJoFM per seed (1 to 5): r=1: 27.15, 31.85, 27.68, 32.90, 27.68; r=2: 51.44, 50.13, 48.30, 52.22, 53.00; r=4: 63.97, 65.80, 68.15, 68.15, 68.41.

Planner runs (`ultra`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Ultra) #1 | an edit | 3 of 3 parsed | yes | yes | 56 | 41 | $0.2250 | $0.2250 | 2 recorded | 49,727 | 58,411 | 44,708 | `6ed88b7cd306` |
| planner (Ultra) #2 | an edit | 3 of 3 parsed | yes | yes | 51 | 45 | $0.1788 | $0.1788 | 2 recorded | 49,940 | 42,960 | 31,039 | `fd1af1fda35c` |
| planner (Ultra) #3 | an edit | 3 of 3 parsed | yes | no (1 error) | 63 | 52 | $0.1385 | $0.1385 | 2 recorded | 49,280 | 29,743 | 16,950 | `23293fa61f17` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 50.74 | 0.249 | 0.263 | 1.16 | 34.85 | 9.83 | 57 | 56.7 | 46 | $0.1808 | 43,705 | 30,899 |
| min | 50.39 | 0.233 | 0.234 | 1.06 | 33.33 | 9.45 | 55 | 51 | 41 | $0.1385 | 29,743 | 16,950 |
| max | 50.91 | 0.259 | 0.277 | 1.28 | 36.53 | 10.48 | 61 | 63 | 52 | $0.2250 | 58,411 | 44,708 |

0 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 2 of 3 plans, counting only plans that came from an edit.

- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 125 against 29 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 14 of 454 files out of their draft group and merges 58 draft groups into others (114 draft groups, 56 plan groups). The winning edit, ultra#2, had 114 group entries and 25 moves; the validator found no problem with it. The critic made 39 suggestions and its gate kept 15.
- Run 2 of 3: The planner's plan moves 4 of 454 files out of their draft group and merges 63 draft groups into others (114 draft groups, 51 plan groups). The winning edit, ultra#3, had 114 group entries and 0 moves; the validator found no problem with it. The critic made 24 suggestions and its gate kept 7.
- Run 3 of 3: The validator rejects the planner's plan (banned-name: "middleware" is a junk drawer or a type word, not a feature); it is scored as it came back.
- Run 3 of 3: The planner's plan moves 9 of 454 files out of their draft group and merges 51 draft groups into others (114 draft groups, 63 plan groups). The winning edit, ultra#1, had 114 group entries and 29 moves; the validator found 32 problems with it (unknown-file 29, banned-name 2, foreign-name 1) and dropped or repaired each before applying it. The critic made 13 suggestions and its gate kept 9.
- Leakage, over the 454 movable files every method sees: 54 give their feature away in their path (1 still in a feature folder; 53 leaky renames; 0 in a sub-folder that only files of their feature share). 4 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## ghostfolio (scramble, default)

- Target: `~/ac-targets/ghostfolio` `apps/api/src/app` @ `347cd06a4012`.
- Scramble: commit `88d9276404ea`, 156 files moved, 3 declined by the executor (they stay), 219 excluded; not certified.
- Scored: 153 feature files in 34 modules (54 hard), of 154 movable files. 16 of the movable files give their feature away in their path (the leakage note below).
- Best deterministic method: seeds draft (file names), MoJoFM 84.72.
- Planner configuration `ultra`: Nemotron 3 Ultra (medium_effort) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.0803; 31 groups (30 modules), from the seeds draft (export names); planner rules 2; plan.yaml sha256 `1aea0650b88f`.

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
| **planner (Ultra) #1 (invalid plan: 1 validator error)** | **31** | **87.50** | **0.910** | **0.706** | **0.88** | **93.88** | **18.18** | **4** |
| **planner (Ultra) #2 (invalid plan: 1 validator error; its draft's partition)** | **44** | **82.64** | **0.421** | **0.765** | **1.26** | **75.51** | **19.20** | **7** |
| **planner (Ultra) #3 (invalid plan: 1 validator error)** | **39** | **76.39** | **0.465** | **0.588** | **1.12** | **75.51** | **17.36** | **6** |

Louvain MoJoFM per seed (1 to 5): r=1: 54.86, 52.78, 52.78, 52.78, 52.78; r=2: 65.28, 64.58, 64.58, 63.89, 65.28; r=4: 73.61, 76.39, 76.39, 75.00, 76.39.

Planner runs (`ultra`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Ultra) #1 | an edit | 3 of 3 parsed | yes | no (1 error) | 31 | 30 | $0.0803 | $0.0803 | 2 recorded | 13,371 | 22,308 | 14,725 | `1aea0650b88f` |
| planner (Ultra) #2 | an edit | 3 of 3 parsed | yes | no (1 error) | 44 | 43 | $0.1669 | $0.1669 | 2 recorded | 13,554 | 51,131 | 11,745 | `c11d144fe5a1` |
| planner (Ultra) #3 | an edit | 3 of 3 parsed | yes | no (1 error) | 39 | 38 | $0.0825 | $0.0825 | 2 recorded | 13,663 | 22,961 | 18,241 | `d5a5b2851165` |

| over the 3 runs, as delivered | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | 82.18 | 0.599 | 0.686 | 1.09 | 81.63 | 18.25 | 5.7 | 38 | 37 | $0.1099 | 32,133 | 14,904 |
| min | 76.39 | 0.421 | 0.588 | 0.88 | 75.51 | 17.36 | 4 | 31 | 30 | $0.0803 | 22,308 | 11,745 |
| max | 87.50 | 0.910 | 0.765 | 1.26 | 93.88 | 19.20 | 7 | 44 | 43 | $0.1669 | 51,131 | 18,241 |

1 of 3 runs score above the best deterministic method on MoJoFM, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 0 of 3 plans, counting only plans that came from an edit.

- 6 feature files are pinned in the facts (no method can place them) and not scored.
- Run 1 of 3: The validator rejects the planner's plan (banned-name: "app" is a junk drawer or a type word, not a feature); it is scored as it came back.
- The planner starts from the seeds draft (export names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 4 against 5 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 0 of 154 files out of their draft group and merges 13 draft groups into others (44 draft groups, 31 plan groups). The winning edit, ultra#1, had 44 group entries and 39 moves; the validator found 8 problems with it (banned-name 7, foreign-name 1) and dropped or repaired each before applying it. The critic made 7 suggestions and its gate kept 6.
- Run 2 of 3: The validator rejects the planner's plan (banned-name: "app" is a junk drawer or a type word, not a feature); it is scored as it came back.
- Run 2 of 3: The planner's plan keeps the partition of its draft, the seeds draft (export names): every file stays in its draft group, so the planner row scores the draft. The winning edit, ultra#3, had 44 group entries and 0 moves; the validator found 2 problems with it (banned-name 2) and dropped or repaired each before applying it. The critic made no suggestion.
- Run 3 of 3: The validator rejects the planner's plan (banned-name: "app" is a junk drawer or a type word, not a feature); it is scored as it came back.
- Run 3 of 3: The planner's plan moves 0 of 154 files out of their draft group and merges 5 draft groups into others (44 draft groups, 39 plan groups). The winning edit, ultra#2, had 44 group entries and 0 moves; the validator found 33 problems with it (bad-name 27, foreign-name 6) and dropped or repaired each before applying it. The critic made no suggestion.
- Leakage, over the 154 movable files every method sees: 16 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 16 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: calculator (6 files, 1 feature), errors (2 files, 2 features), ghostfolio (7 files, 1 feature), queue (3 files, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 28 more leaky files are pinned or not read by the facts, so no method sees them: not counted.

## immich (real)

- Target: `~/ac-targets/immich` `server/src` @ `02063972e82b`.
- 269 movable files; no ground truth.
- Best deterministic method: Louvain r=4 (mean of seeds 1-5), TurboMQ 10.50.
- Planner configuration `ultra`: Nemotron 3 Ultra (medium_effort) edits and reviews; 3 runs through one gateway.
- Planner, run 1 of 3 (the runs table has every run): recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.1738; 55 groups (44 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `a55e73dd6f1e`.

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
| **planner (Ultra) #1** | **55** | – | – | – | – | – | **10.16** | **118** |
| **planner (Ultra) #2** | **62** | – | – | – | – | – | **10.03** | **125** |
| **planner (Ultra) #3** | **59** | – | – | – | – | – | **10.42** | **122** |

Planner runs (`ultra`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Ultra) #1 | an edit | 3 of 3 parsed | yes | yes | 55 | 44 | $0.1738 | $0.1738 | 2 recorded | 34,866 | 46,309 | 30,690 | `a55e73dd6f1e` |
| planner (Ultra) #2 | an edit | 3 of 3 parsed | yes | yes | 62 | 41 | $0.1649 | $0.1649 | 2 recorded | 35,029 | 43,290 | 34,112 | `0428279198e3` |
| planner (Ultra) #3 | an edit | 3 of 3 parsed | yes | yes | 59 | 40 | $0.1400 | $0.1400 | 2 recorded | 34,913 | 35,031 | 25,940 | `a4f34092c842` |

| over the 3 runs, as delivered | TurboMQ | back-edges | groups | modules | recorded cost | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|
| mean | 10.20 | 121.7 | 58.7 | 41.7 | $0.1596 | 41,543 | 30,247 |
| min | 10.03 | 118 | 55 | 40 | $0.1400 | 35,031 | 25,940 |
| max | 10.42 | 125 | 62 | 44 | $0.1738 | 46,309 | 34,112 |

0 of 3 runs score above the best deterministic method on TurboMQ's sum, each run as delivered. 0 of 3 runs had no usable edit; the critic reviewed 3 of 3 plans; 0 of 9 edit choices were cut by the length cap (finish_reason length). The validator accepts 3 of 3 plans, counting only plans that came from an edit.

- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 31 against 29 (no ground truth is read).
- Run 1 of 3: The planner's plan moves 9 of 269 files out of their draft group and merges 28 draft groups into others (81 draft groups, 55 plan groups). The winning edit, ultra#1, had 81 group entries and 18 moves; the validator found 5 problems with it (banned-name 4, foreign-name 1) and dropped or repaired each before applying it. The critic made 5 suggestions and its gate kept 3.
- Run 2 of 3: The planner's plan moves 12 of 269 files out of their draft group and merges 20 draft groups into others (81 draft groups, 62 plan groups). The winning edit, ultra#1, had 81 group entries and 42 moves; the validator found 2 problems with it (banned-name 1, kind-conflict 1) and dropped or repaired each before applying it. The critic made 4 suggestions and its gate kept 3.
- Run 3 of 3: The planner's plan moves 7 of 269 files out of their draft group and merges 24 draft groups into others (81 draft groups, 59 plan groups). The winning edit, ultra#1, had 81 group entries and 10 moves; the validator found no problem with it. The critic made 7 suggestions and its gate kept 3.
