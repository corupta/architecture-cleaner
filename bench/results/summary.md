# ac bench results

`ac bench` writes one JSON file per entry next to this summary (format `ac-bench/1`, src/bench/types.ts).

- **Scramble** entries flatten a feature-modular package into type folders with our own executor, in a certified
  commit. The original feature folders are the ground truth.
- **Real** entries are type-sliced targets with no ground truth: TurboMQ and back-edges only.
- MoJoFM runs 0 to 100 (ARCADE port). ARI runs from −0.5 to 1. c2c_cvg is the share of ground-truth modules recovered
  (c2c above 0.66). The cluster ratio is predicted clusters over ground-truth clusters.
- MoJoFM hard counts only the files whose own name doesn't give their feature away.
- TurboMQ is Bunch's sum of cluster factors; the JSON also has ARCADE's mean. Back-edges are the cluster-level import
  edges that point backwards in the partition's own DAG order.
- Louvain rows are the mean of seeds 1 to 5. **Bold**: the best deterministic method (baselines and the seeds draft)
  and the planner.

## hoppscotch (scramble, default)

- Target: `~/ac-targets/hoppscotch` `packages/hoppscotch-backend/src` @ `63273f8e599e`.
- Scramble: commit `cb622dd6f23a`, 156 files moved, 1 declined by the executor (they stay), 22 excluded; certificate PASS (static), digest `6dd17f2da96b`.
- Scored: 156 feature files in 25 modules (46 hard), of 186 movable files. 3 files give their feature away (leaky renames and files left in a feature folder).
- Best deterministic method: seeds draft (export names), MoJoFM 81.38.
- Planner: replayed from `cassettes/s7-bench.jsonl` (recorded cost $0.1375, this run spent $0); 29 groups; plan.yaml sha256 `5611214a28ec`.

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
| **planner (Ultra)** | **29** | **87.59** | **0.794** | **0.840** | **1.16** | **67.50** | **8.12** | **30** |

Louvain MoJoFM per seed (1 to 5): r=1: 29.66, 35.17, 35.86, 32.41, 29.66; r=2: 56.55, 51.72, 59.31, 57.93, 59.31; r=4: 75.86, 73.79, 74.48, 75.86, 73.10.

- 1 feature file is pinned in the facts (no method can place it) and not scored.

## hoppscotch-H1 (scramble, H1)

- Target: `~/ac-targets/hoppscotch` `packages/hoppscotch-backend/src` @ `63273f8e599e`.
- Scramble: commit `d61af1c77de0`, 156 files moved, 1 declined by the executor (they stay), 22 excluded; certificate PASS (static), digest `a93ef8132e86`.
- Scored: 156 feature files in 25 modules (46 hard), of 186 movable files. 3 files give their feature away (leaky renames and files left in a feature folder).
- Best deterministic method: seeds draft (export names), MoJoFM 81.38.
- Planner: replayed from `cassettes/s7-bench.jsonl` (recorded cost $0.1377, this run spent $0); 31 groups; plan.yaml sha256 `a38f96c02a77`.

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
| **planner (Ultra)** | **31** | **79.31** | **0.666** | **0.720** | **1.16** | **67.50** | **7.39** | **49** |

Louvain MoJoFM per seed (1 to 5): r=1: 26.21, 34.48, 42.76, 33.10, 30.34; r=2: 55.86, 51.03, 54.48, 51.03, 53.10; r=4: 74.48, 76.55, 76.55, 80.00, 73.79.

- 1 feature file is pinned in the facts (no method can place it) and not scored.

## kaneo (scramble, default)

- Target: `~/ac-targets/kaneo` `apps/api/src` @ `b80818fe2e93`.
- Scramble: commit `aad6fc97e3c7`, 400 files moved, 1 declined by the executor (they stay), 12 excluded; certificate FAIL (static), failing K3c, K4, digest `d68239231a54`.
- Scored: 401 feature files in 47 modules (234 hard), of 454 movable files. 58 files give their feature away (leaky renames and files left in a feature folder).
- Best deterministic method: Louvain r=4 (mean of seeds 1-5), MoJoFM 66.90.
- Planner: replayed from `cassettes/s7-bench.jsonl` (recorded cost $0.1683, this run spent $0); 68 groups; plan.yaml sha256 `670cef018843`.

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
| **planner (Ultra)** | **68** | **49.61** | **0.247** | **0.277** | **1.40** | **34.70** | **10.31** | **57** |

Louvain MoJoFM per seed (1 to 5): r=1: 27.15, 31.85, 27.68, 32.90, 27.68; r=2: 51.44, 50.13, 48.30, 52.22, 53.00; r=4: 63.97, 65.80, 68.15, 68.15, 68.41.

## ghostfolio (scramble, default)

- Target: `~/ac-targets/ghostfolio` `apps/api/src/app` @ `347cd06a4012`.
- Scramble: commit `4e7776bf720a`, 156 files moved, 3 declined by the executor (they stay), 219 excluded; certificate PASS (static), digest `6713d93e7285`.
- Scored: 153 feature files in 34 modules (54 hard), of 154 movable files. 28 files give their feature away (leaky renames and files left in a feature folder).
- Best deterministic method: seeds draft (file names), MoJoFM 84.72.
- Planner: replayed from `cassettes/s7-bench.jsonl` (recorded cost $0.0817, this run spent $0); 44 groups; plan.yaml sha256 `29e54d6d4627`.

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
| **planner (Ultra)** | **44** | **82.64** | **0.421** | **0.765** | **1.26** | **75.51** | **19.20** | **7** |

Louvain MoJoFM per seed (1 to 5): r=1: 54.86, 52.78, 52.78, 52.78, 52.78; r=2: 65.28, 64.58, 64.58, 63.89, 65.28; r=4: 73.61, 76.39, 76.39, 75.00, 76.39.

- 6 feature files are pinned in the facts (no method can place them) and not scored.

## immich (real)

- Target: `~/ac-targets/immich` `server/src` @ `02063972e82b`.
- 269 movable files; no ground truth.
- Best deterministic method: Louvain r=4 (mean of seeds 1-5), TurboMQ 10.50.
- Planner: replayed from `cassettes/s6-immich.jsonl` (recorded cost $0.1998, this run spent $0); 59 groups; plan.yaml sha256 `b4c7c548883c`.

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
| **planner (Ultra)** | **59** | – | – | – | – | – | **10.07** | **118** |
