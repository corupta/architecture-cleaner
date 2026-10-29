# ac bench compare

The planner's runs from 6 results directories, one planner configuration each (src/planner/configurations.ts). `ac bench --repeats k` runs the planner k times per entry through one gateway, so each run is a sample of its own; the deterministic methods run once.

| results | directory | configuration | models | runs per entry |
|---|---|---|---|---|
| ultra | `bench/experiments/s8b-super-vl/ultra` | `ultra` | Nemotron 3 Ultra (medium_effort) edits and reviews | 3 |
| super-vl-direct | `bench/experiments/s8b-super-vl/super-vl-direct` | `super-vl-direct` | Nemotron 3.5 Super VL (thinking off) edits and reviews | 3 |
| super-vl-256k | `bench/experiments/s8b-super-vl/super-vl-256k` | `super-vl-256k` | Nemotron 3.5 Super VL (thinking on) edits and reviews | 3 |
| super-vl | `bench/experiments/s8b-super-vl/super-vl` | `super-vl` | Nemotron 3.5 Super VL (thinking on) edits and reviews | 3 |
| super-vl-low | `bench/experiments/s8b-super-vl/super-vl-low` | `super-vl-low` | Nemotron 3.5 Super VL (low_effort) edits and reviews | 1 |
| super-vl-long | `bench/experiments/s8b-super-vl/super-vl-long` | `super-vl-long` | Nemotron 3.5 Super VL (thinking on) edits and reviews | 1 |

- MoJoFM and TurboMQ's sum are each the mean over an entry's runs, the min to max in parentheses, every run as delivered: with the plan `ac plan` would give, which is the seeds draft when none of a run's edit choices came back usable. The directories have from 1 to 3 runs per entry. A difference that falls inside another directory's min-to-max range isn't conclusive, and a single run has no range at all.
- Beat: the runs that score above the entry's best deterministic method (the baselines and the seeds draft) on that measure, MoJoFM or TurboMQ's sum: each measure has its own best. The totals count MoJoFM over the runs that have one.
- Draft as the plan: the runs where none of the K edit choices came back usable (each one cut by the length cap or unparseable), so the seeds draft became the plan and the critic had nothing to review. Edit choices truncated: the choices the length cap cut (finish_reason length), of K per run. Critic ran: the runs whose winning edit the critic reviewed.
- Valid plans from an edit: the runs whose plan came from an edit and that our validator accepts. A run that delivered the draft is no plan of the model, so it never counts here, whatever the validator says of the draft; `ac run` refuses an invalid plan, and the bench scores it as it came back.
- Cost is what a run's edit and critic calls cost when they were recorded; tokens are the cassette's usage over those calls. – where a result doesn't record a count: tokens and edit choices in a result without a repeats block (before S8b, or one default run), and where the plan came from in a result written before the S7 fix round.
- MoJoFM over the key: a real target has a MoJoFM only over the files its partial answer key labels, every method still placing every movable file, and its best deterministic method on MoJoFM is the best over those files. Each such entry says what its key covers; a real target without a key has dashes.

## ghostfolio (scramble, default)

Best deterministic method on MoJoFM: seeds draft (file names), MoJoFM 84.72 in the 3 directories with this entry.
Best deterministic method on TurboMQ: seeds draft (file names), TurboMQ 19.88 in the 3 directories with this entry.

| results | configuration | runs | MoJoFM mean (min to max), as delivered | beat the best deterministic on MoJoFM | TurboMQ mean (min to max), as delivered | beat the best deterministic on TurboMQ | draft as the plan | edit choices truncated | critic ran | valid plans from an edit | modules mean (min to max) | recorded cost per run | completion tokens per run | reasoning tokens per run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ultra | `ultra` | 3 | 82.18 (76.39 to 87.50) | 1 of 3 | 18.25 (17.36 to 19.20) | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 0 of 3 | 37.0 (30 to 43) | $0.1099 | 32,133 | 14,904 |
| super-vl-direct | `super-vl-direct` | 3 | 82.18 (80.56 to 83.33) | 0 of 3 | 18.08 (17.09 to 18.64) | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 2 of 3 | 31.3 (27 to 34) | $0.0193 | 16,933 | 0 |
| super-vl-256k | `super-vl-256k` | 3 | 86.11 (83.33 to 87.50) | 2 of 3 | 18.31 (18.22 to 18.45) | 0 of 3 | 0 of 3 | 4 of 9 | 3 of 3 | 2 of 3 | 26.0 (23 to 28) | $0.5813 | 641,456 | 636,417 |
| super-vl | `super-vl` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |
| super-vl-low | `super-vl-low` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |
| super-vl-long | `super-vl-long` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |

Each MoJoFM mean against the other directories' runs:

- ultra: 82.18, inside the range (80.56 to 83.33) of super-vl-direct and below the range (83.33 to 87.50) of super-vl-256k.
- super-vl-direct: 82.18, inside the range (76.39 to 87.50) of ultra and below the range (83.33 to 87.50) of super-vl-256k.
- super-vl-256k: 86.11, inside the range (76.39 to 87.50) of ultra and above the range (80.56 to 83.33) of super-vl-direct.

Each TurboMQ mean against the other directories' runs:

- ultra: 18.25, inside the range (17.09 to 18.64) of super-vl-direct and inside the range (18.22 to 18.45) of super-vl-256k.
- super-vl-direct: 18.08, inside the range (17.36 to 19.20) of ultra and below the range (18.22 to 18.45) of super-vl-256k.
- super-vl-256k: 18.31, inside the range (17.36 to 19.20) of ultra and inside the range (17.09 to 18.64) of super-vl-direct.

## hoppscotch (scramble, default)

Best deterministic method on MoJoFM: seeds draft (export names), MoJoFM 81.38 in every directory.
Best deterministic method on TurboMQ: Louvain r=4 (mean of seeds 1-5), TurboMQ 9.63 in every directory.

| results | configuration | runs | MoJoFM mean (min to max), as delivered | beat the best deterministic on MoJoFM | TurboMQ mean (min to max), as delivered | beat the best deterministic on TurboMQ | draft as the plan | edit choices truncated | critic ran | valid plans from an edit | modules mean (min to max) | recorded cost per run | completion tokens per run | reasoning tokens per run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ultra | `ultra` | 3 | 83.22 (81.38 to 84.83) | 2 of 3 | 7.86 (7.67 to 8.13) | 0 of 3 | 0 of 3 | 1 of 9 | 3 of 3 | 3 of 3 | 25.0 (22 to 31) | $0.2169 | 65,280 | 60,755 |
| super-vl-direct | `super-vl-direct` | 3 | 81.84 (76.55 to 90.34) | 1 of 3 | 7.95 (7.55 to 8.74) | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 3 of 3 | 22.7 (22 to 24) | $0.0296 | 25,941 | 0 |
| super-vl-256k | `super-vl-256k` | 3 | 91.26 (88.97 to 94.48) | 3 of 3 | 8.32 (8.12 to 8.44) | 0 of 3 | 0 of 3 | 2 of 9 | 3 of 3 | 3 of 3 | 20.7 (20 to 21) | $0.4503 | 493,399 | 487,672 |
| super-vl | `super-vl` | 3 | 80.00 (80.00 to 80.00) | 0 of 3 | 7.63 (7.63 to 7.63) | 0 of 3 | 3 of 3 | 9 of 9 | 0 of 3 | 0 of 3 | 41.0 (41 to 41) | $0.1757 | 192,000 | 191,364 |
| super-vl-low | `super-vl-low` | 1 | 55.86 | 0 of 1 | 5.60 | 0 of 1 | 0 of 1 | 1 of 3 | 1 of 1 | 1 of 1 | 13 | $0.1861 | 199,893 | 195,855 |
| super-vl-long | `super-vl-long` | 1 | 88.28 | 1 of 1 | 8.16 | 0 of 1 | 0 of 1 | 1 of 3 | 1 of 1 | 1 of 1 | 21 | $0.5957 | 654,852 | 648,596 |

Each MoJoFM mean against the other directories' runs:

- ultra: 83.22, inside the range (76.55 to 90.34) of super-vl-direct, below the range (88.97 to 94.48) of super-vl-256k, above the range (80.00 to 80.00) of super-vl, above the one run (55.86) of super-vl-low and below the one run (88.28) of super-vl-long.
- super-vl-direct: 81.84, inside the range (81.38 to 84.83) of ultra, below the range (88.97 to 94.48) of super-vl-256k, above the range (80.00 to 80.00) of super-vl, above the one run (55.86) of super-vl-low and below the one run (88.28) of super-vl-long.
- super-vl-256k: 91.26, above the range (81.38 to 84.83) of ultra, above the range (76.55 to 90.34) of super-vl-direct, above the range (80.00 to 80.00) of super-vl, above the one run (55.86) of super-vl-low and above the one run (88.28) of super-vl-long.
- super-vl: 80.00, below the range (81.38 to 84.83) of ultra, inside the range (76.55 to 90.34) of super-vl-direct, below the range (88.97 to 94.48) of super-vl-256k, above the one run (55.86) of super-vl-low and below the one run (88.28) of super-vl-long.
- super-vl-low: 55.86, below the range (81.38 to 84.83) of ultra, below the range (76.55 to 90.34) of super-vl-direct, below the range (88.97 to 94.48) of super-vl-256k, below the range (80.00 to 80.00) of super-vl and below the one run (88.28) of super-vl-long.
- super-vl-long: 88.28, above the range (81.38 to 84.83) of ultra, inside the range (76.55 to 90.34) of super-vl-direct, below the range (88.97 to 94.48) of super-vl-256k, above the range (80.00 to 80.00) of super-vl and above the one run (55.86) of super-vl-low.

Each TurboMQ mean against the other directories' runs:

- ultra: 7.86, inside the range (7.55 to 8.74) of super-vl-direct, below the range (8.12 to 8.44) of super-vl-256k, above the range (7.63 to 7.63) of super-vl, above the one run (5.60) of super-vl-low and below the one run (8.16) of super-vl-long.
- super-vl-direct: 7.95, inside the range (7.67 to 8.13) of ultra, below the range (8.12 to 8.44) of super-vl-256k, above the range (7.63 to 7.63) of super-vl, above the one run (5.60) of super-vl-low and below the one run (8.16) of super-vl-long.
- super-vl-256k: 8.32, above the range (7.67 to 8.13) of ultra, inside the range (7.55 to 8.74) of super-vl-direct, above the range (7.63 to 7.63) of super-vl, above the one run (5.60) of super-vl-low and above the one run (8.16) of super-vl-long.
- super-vl: 7.63, below the range (7.67 to 8.13) of ultra, inside the range (7.55 to 8.74) of super-vl-direct, below the range (8.12 to 8.44) of super-vl-256k, above the one run (5.60) of super-vl-low and below the one run (8.16) of super-vl-long.
- super-vl-low: 5.60, below the range (7.67 to 8.13) of ultra, below the range (7.55 to 8.74) of super-vl-direct, below the range (8.12 to 8.44) of super-vl-256k, below the range (7.63 to 7.63) of super-vl and below the one run (8.16) of super-vl-long.
- super-vl-long: 8.16, above the range (7.67 to 8.13) of ultra, inside the range (7.55 to 8.74) of super-vl-direct, inside the range (8.12 to 8.44) of super-vl-256k, above the range (7.63 to 7.63) of super-vl and above the one run (5.60) of super-vl-low.

## hoppscotch-H1 (scramble, H1)

Best deterministic method on MoJoFM: seeds draft (export names), MoJoFM 81.38 in the 3 directories with this entry.
Best deterministic method on TurboMQ: Louvain r=4 (mean of seeds 1-5), TurboMQ 9.57 in the 3 directories with this entry.

| results | configuration | runs | MoJoFM mean (min to max), as delivered | beat the best deterministic on MoJoFM | TurboMQ mean (min to max), as delivered | beat the best deterministic on TurboMQ | draft as the plan | edit choices truncated | critic ran | valid plans from an edit | modules mean (min to max) | recorded cost per run | completion tokens per run | reasoning tokens per run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ultra | `ultra` | 3 | 85.06 (80.00 to 90.34) | 2 of 3 | 7.82 (7.14 to 8.46) | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 3 of 3 | 22.0 (21 to 23) | $0.1839 | 53,951 | 48,509 |
| super-vl-direct | `super-vl-direct` | 3 | 79.77 (77.24 to 82.76) | 1 of 3 | 7.57 (7.22 to 8.22) | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 3 of 3 | 20.3 (19 to 22) | $0.0216 | 16,639 | 0 |
| super-vl-256k | `super-vl-256k` | 3 | 90.80 (88.97 to 93.10) | 3 of 3 | 8.33 (8.22 to 8.41) | 0 of 3 | 0 of 3 | 1 of 9 | 3 of 3 | 3 of 3 | 21.7 (21 to 22) | $0.4583 | 501,907 | 495,963 |
| super-vl | `super-vl` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |
| super-vl-low | `super-vl-low` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |
| super-vl-long | `super-vl-long` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |

Each MoJoFM mean against the other directories' runs:

- ultra: 85.06, above the range (77.24 to 82.76) of super-vl-direct and below the range (88.97 to 93.10) of super-vl-256k.
- super-vl-direct: 79.77, below the range (80.00 to 90.34) of ultra and below the range (88.97 to 93.10) of super-vl-256k.
- super-vl-256k: 90.80, above the range (80.00 to 90.34) of ultra and above the range (77.24 to 82.76) of super-vl-direct.

Each TurboMQ mean against the other directories' runs:

- ultra: 7.82, inside the range (7.22 to 8.22) of super-vl-direct and below the range (8.22 to 8.41) of super-vl-256k.
- super-vl-direct: 7.57, inside the range (7.14 to 8.46) of ultra and below the range (8.22 to 8.41) of super-vl-256k.
- super-vl-256k: 8.33, inside the range (7.14 to 8.46) of ultra and above the range (7.22 to 8.22) of super-vl-direct.

## kaneo (scramble, default)

Best deterministic method on MoJoFM: Louvain r=4 (mean of seeds 1-5), MoJoFM 66.90 in the 3 directories with this entry.
Best deterministic method on TurboMQ: Louvain r=4 (mean of seeds 1-5), TurboMQ 16.05 in the 3 directories with this entry.

| results | configuration | runs | MoJoFM mean (min to max), as delivered | beat the best deterministic on MoJoFM | TurboMQ mean (min to max), as delivered | beat the best deterministic on TurboMQ | draft as the plan | edit choices truncated | critic ran | valid plans from an edit | modules mean (min to max) | recorded cost per run | completion tokens per run | reasoning tokens per run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ultra | `ultra` | 3 | 50.74 (50.39 to 50.91) | 0 of 3 | 9.83 (9.45 to 10.48) | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 2 of 3 | 46.0 (41 to 52) | $0.1808 | 43,705 | 30,899 |
| super-vl-direct | `super-vl-direct` | 3 | 56.13 (43.34 to 64.75) | 0 of 3 | 10.36 (8.55 to 11.87) | 0 of 3 | 0 of 3 | 0 of 9 | 3 of 3 | 2 of 3 | 41.3 (39 to 45) | $0.0698 | 60,969 | 0 |
| super-vl-256k | `super-vl-256k` | 3 | 55.27 (49.61 to 58.75) | 0 of 3 | 10.97 (8.99 to 12.12) | 0 of 3 | 0 of 3 | 1 of 9 | 3 of 3 | 3 of 3 | 26.0 (21 to 29) | $0.3588 | 382,274 | 352,088 |
| super-vl | `super-vl` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |
| super-vl-low | `super-vl-low` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |
| super-vl-long | `super-vl-long` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – |

Each MoJoFM mean against the other directories' runs:

- ultra: 50.74, inside the range (43.34 to 64.75) of super-vl-direct and inside the range (49.61 to 58.75) of super-vl-256k.
- super-vl-direct: 56.13, above the range (50.39 to 50.91) of ultra and inside the range (49.61 to 58.75) of super-vl-256k.
- super-vl-256k: 55.27, above the range (50.39 to 50.91) of ultra and inside the range (43.34 to 64.75) of super-vl-direct.

Each TurboMQ mean against the other directories' runs:

- ultra: 9.83, inside the range (8.55 to 11.87) of super-vl-direct and inside the range (8.99 to 12.12) of super-vl-256k.
- super-vl-direct: 10.36, inside the range (9.45 to 10.48) of ultra and inside the range (8.99 to 12.12) of super-vl-256k.
- super-vl-256k: 10.97, above the range (9.45 to 10.48) of ultra and inside the range (8.55 to 11.87) of super-vl-direct.

## immich (real)

MoJoFM over the key is computed over the files immich's 2024 domain layer labels (47 of 269 movable files, 23 features, 6 hard), unlike the scrambles' complete keys (key `bench/ground-truth/immich-2024.rsf`, sha256 `5459ab310fa5`) in the 3 directories with a key.
Best deterministic method on MoJoFM over the key: seeds draft (file names), MoJoFM 93.02 in the 3 directories with a key.
Best deterministic method on TurboMQ: Louvain r=4 (mean of seeds 1-5), TurboMQ 10.50 in the 3 directories with this entry.

| results | configuration | runs | MoJoFM over the key mean (min to max), as delivered | beat the best deterministic on MoJoFM | TurboMQ mean (min to max), as delivered | beat the best deterministic on TurboMQ | back-edges mean (min to max) | draft as the plan | edit choices truncated | critic ran | valid plans from an edit | modules mean (min to max) | recorded cost per run | completion tokens per run | reasoning tokens per run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ultra | `ultra` | 3 | 89.15 (88.37 to 90.70) | 0 of 3 | 10.20 (10.03 to 10.42) | 0 of 3 | 121.7 (118 to 125) | 0 of 3 | 0 of 9 | 3 of 3 | 3 of 3 | 41.7 (40 to 44) | $0.1596 | 41,543 | 30,247 |
| super-vl-direct | `super-vl-direct` | 3 | 89.92 (88.37 to 90.70) | 0 of 3 | 9.84 (9.76 to 9.98) | 0 of 3 | 137.0 (117 to 163) | 0 of 3 | 0 of 9 | 3 of 3 | 3 of 3 | 45.0 (41 to 52) | $0.0400 | 32,779 | 0 |
| super-vl-256k | `super-vl-256k` | 3 | 88.37 (88.37 to 88.37) | 0 of 3 | 10.26 (10.08 to 10.35) | 0 of 3 | 119.0 (118 to 120) | 0 of 3 | 0 of 9 | 3 of 3 | 3 of 3 | 42.7 (42 to 43) | $0.2911 | 311,861 | 303,252 |
| super-vl | `super-vl` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – | – |
| super-vl-low | `super-vl-low` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – | – |
| super-vl-long | `super-vl-long` | 0 | no result for this entry | – | – | – | – | – | – | – | – | – | – | – | – |

Each MoJoFM mean over the key against the other directories' runs:

- ultra: 89.15, inside the range (88.37 to 90.70) of super-vl-direct and above the range (88.37 to 88.37) of super-vl-256k.
- super-vl-direct: 89.92, inside the range (88.37 to 90.70) of ultra and above the range (88.37 to 88.37) of super-vl-256k.
- super-vl-256k: 88.37, inside the range (88.37 to 90.70) of ultra and inside the range (88.37 to 90.70) of super-vl-direct.

Each TurboMQ mean against the other directories' runs:

- ultra: 10.20, above the range (9.76 to 9.98) of super-vl-direct and inside the range (10.08 to 10.35) of super-vl-256k.
- super-vl-direct: 9.84, below the range (10.03 to 10.42) of ultra and below the range (10.08 to 10.35) of super-vl-256k.
- super-vl-256k: 10.26, inside the range (10.03 to 10.42) of ultra and above the range (9.76 to 9.98) of super-vl-direct.

## Totals

| results | configuration | entries with runs | runs | beat the best deterministic on MoJoFM | beat the best deterministic on TurboMQ | draft as the plan | edit choices truncated | critic ran | valid plans from an edit | recorded cost | recorded cost per run | completion tokens | reasoning tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ultra | `ultra` | 5 | 15 | 5 of 15 | 0 of 15 | 0 of 15 | 1 of 45 | 15 of 15 | 11 of 15 | $2.5531 | $0.1702 | 709,836 | 555,942 |
| super-vl-direct | `super-vl-direct` | 5 | 15 | 2 of 15 | 0 of 15 | 0 of 15 | 0 of 45 | 15 of 15 | 13 of 15 | $0.5409 | $0.0361 | 459,782 | 0 |
| super-vl-256k | `super-vl-256k` | 5 | 15 | 8 of 15 | 0 of 15 | 0 of 15 | 8 of 45 | 15 of 15 | 14 of 15 | $6.4195 | $0.4280 | 6,992,691 | 6,826,180 |
| super-vl | `super-vl` | 1 | 3 | 0 of 3 | 0 of 3 | 3 of 3 | 9 of 9 | 0 of 3 | 0 of 3 | $0.5271 | $0.1757 | 576,000 | 574,091 |
| super-vl-low | `super-vl-low` | 1 | 1 | 0 of 1 | 0 of 1 | 0 of 1 | 1 of 3 | 1 of 1 | 1 of 1 | $0.1861 | $0.1861 | 199,893 | 195,855 |
| super-vl-long | `super-vl-long` | 1 | 1 | 1 of 1 | 0 of 1 | 0 of 1 | 1 of 3 | 1 of 1 | 1 of 1 | $0.5957 | $0.5957 | 654,852 | 648,596 |
