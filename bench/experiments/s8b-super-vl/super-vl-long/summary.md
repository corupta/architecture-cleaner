# ac bench results

`ac bench` writes one JSON file per entry next to this summary (format `ac-bench/1`, src/bench/types.ts).

- **Scramble** entries flatten a feature-modular package into type folders with our own executor, in one commit. Our certifier checks that commit as a pure move: hoppscotch was not certified in this run. Verdict, scope and failing checks are per entry below; a scramble is scored whatever its verdict, since the ground truth is its original folders.
- **Real** entries are type-sliced targets with no ground truth: TurboMQ and back-edges only.
- MoJoFM runs 0 to 100 (ARCADE port). ARI runs from −0.5 to 1. c2c_cvg is the share of ground-truth modules recovered
  (c2c above 0.66). The cluster ratio is predicted clusters over ground-truth clusters.
- MoJoFM hard counts only the files whose own name doesn't give their feature away.
- TurboMQ is Bunch's sum of cluster factors; the JSON also has ARCADE's mean. Back-edges are the cluster-level import
  edges that point backwards in the partition's own DAG order.
- Louvain rows are the mean of seeds 1 to 5. **Bold**: the planner, and the best deterministic method (baselines and
  the seeds draft) on each measure: the best by MoJoFM in the ground-truth columns (MoJoFM to MoJoFM hard), the best
  by TurboMQ in the graph's columns (clusters, TurboMQ, back-edges), the whole row when one method is best on both.
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
- Best deterministic method on MoJoFM: seeds draft (export names), MoJoFM 81.38. On TurboMQ: Louvain r=4 (mean of seeds 1-5), TurboMQ 9.63.
- Planner configuration `super-vl-long`: Nemotron 3.5 Super VL (thinking on) edits and reviews.
- Planner: recorded into `cassettes/s8b-bench.jsonl` (2 calls) for $0.5957; 30 groups (21 modules), from the seeds draft (file names); planner rules 2; plan.yaml sha256 `9d1135074a27`.

| method | clusters | MoJoFM | ARI | c2c_cvg | cluster ratio | MoJoFM hard | TurboMQ | back-edges |
|---|---|---|---|---|---|---|---|---|
| B0 type folders | 17 | 9.66 | -0.022 | 0.000 | 0.60 | 30.00 | 1.11 | 15 |
| name-token (full stem) | 109 | 57.24 | 0.393 | 0.560 | 3.48 | 30.00 | 6.41 | 44 |
| name-token (anchored) | 56 | 75.17 | 0.541 | 0.760 | 1.88 | 50.00 | 7.43 | 53 |
| export-token (anchored) | 62 | 74.48 | 0.528 | 0.760 | 2.04 | 45.00 | 6.92 | 47 |
| seeds draft (file names) | 43 | 80.00 | 0.593 | 0.800 | 1.56 | 57.50 | 7.63 | 37 |
| **seeds draft (export names)** | 45 | **81.38** | **0.634** | **0.800** | **1.60** | **62.50** | 7.37 | 36 |
| Louvain r=1 (mean of seeds 1-5) | 8.4 | 32.55 | 0.278 | 0.032 | 0.30 | 57.00 | 4.02 | 17.2 |
| Louvain r=2 (mean of seeds 1-5) | 17 | 56.96 | 0.516 | 0.272 | 0.64 | 77.00 | 6.74 | 58 |
| **Louvain r=4 (mean of seeds 1-5)** | **33.6** | 74.62 | 0.601 | 0.616 | 1.26 | 79.00 | **9.63** | **76.4** |
| **planner (Super VL, thinking on, 512k)** | **30** | **88.28** | **0.798** | **0.840** | **1.12** | **72.50** | **8.16** | **25** |

Louvain MoJoFM per seed (1 to 5): r=1: 29.66, 35.17, 35.86, 32.41, 29.66; r=2: 56.55, 51.72, 59.31, 57.93, 59.31; r=4: 75.86, 73.79, 74.48, 75.86, 73.10.

Planner runs (`super-vl-long`):

| run | plan from | edit choices | critic | valid | groups | modules | recorded cost | spent | calls | prompt tokens | completion tokens | reasoning tokens | plan.yaml sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| planner (Super VL, thinking on, 512k) | an edit | 2 of 3 parsed (1 truncated) | yes | yes | 30 | 21 | $0.5957 | $0.5957 | 2 recorded | 21,064 | 654,852 | 648,596 | `9d1135074a27` |

1 of 1 run scores above the best deterministic method on MoJoFM and 0 of 1 on TurboMQ's sum, each run as delivered. 0 of 1 run had no usable edit; the critic reviewed 1 of 1 plan; 1 of 3 edit choices was cut by the length cap (finish_reason length). The validator accepts 1 of 1 plan, counting only plans that came from an edit.

- 1 feature file is pinned in the facts (no method can place it) and not scored.
- The planner starts from the seeds draft (file names): plannerDraft takes the export names only when they leave fewer files contested than the file names, and here they leave 12 against 10 (no ground truth is read).
- The planner's plan moves 13 of 186 files out of their draft group and merges 14 draft groups into others (43 draft groups, 30 plan groups). The winning edit, super-vl#2, had 43 group entries and 58 moves; the validator found 3 problems with it (foreign-name 3) and dropped or repaired each before applying it. The critic made 11 suggestions and its gate kept 9.
- Leakage, over the 186 movable files every method sees: 0 give their feature away in their path (0 still in a feature folder; 0 leaky renames; 0 in a sub-folder that only files of their feature share). Sub-folders kept under the type folders: constants (1 file, 1 feature); the planner's prompt shows them, and no deterministic method groups by them. 3 more leaky files are pinned or not read by the facts, so no method sees them: not counted.
