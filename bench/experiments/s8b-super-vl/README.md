# Nemotron 3.5 Super VL as the planner (S8b, 2026-10-20)

corupta asked whether NVIDIA Nemotron 3.5 Super VL, released 2026-10-15, plans better than Nemotron 3 Ultra. Super VL
is a 120B mixture of experts with 12B active parameters; on Token Factory it is `nvidia/Nemotron-3.5-Super-VL`, at
$0.30 and $0.90 per million input and output tokens, against Ultra's $1.00 and $3.00. Public numbers favor it: 26.5 on
the Artificial Analysis Intelligence Index against Ultra's 23, and in NVIDIA's launch blog 63.44% against 56.33% on
Hermes Bench and 87.05% against 84.3% on LangChain's evals.

We measured it on our own task: the planner of `ac bench` (plan §7), on the four scrambles and immich.

## Setup

- The same pipeline for every configuration: the deterministic seeds draft, one edit call with n=3 candidates (64k
  max tokens each), the validator's ranking, then one critic call (32k max tokens) on the winner. Planner rules 2 and
  critic prompt 2; the same system prompts, facts and response formats for both models. Temperature 1.0 and top_p
  0.95, NVIDIA's recommended sampling for Super VL, as for every call.
- Configurations (src/planner/configurations.ts): `ultra` (Nemotron 3 Ultra, `medium_effort`), `super-vl` (Super VL,
  thinking on, NVIDIA's default), `super-vl-low` (`low_effort`) and `super-vl-direct` (thinking off).
- `ultra` and `super-vl-direct`: `ac bench --repeats 3`, three independent planner runs on each of the five entries,
  recorded into `cassettes/s8b-bench.jsonl` under budget run s8b. Ultra was recorded fresh under these settings (all
  30 of its calls were paid, none replayed). `super-vl` was stopped after hoppscotch's three runs and one call on
  hoppscotch-H1, and `super-vl-low` had a single probe run on hoppscotch: both had already shown the cap problem below.
- The full numbers are in [compare.md](compare.md), made by `ac bench compare` from the result directories here.

## What happened

**Thinking on did not finish inside our token cap.** On hoppscotch, all 9 edit choices of its 3 runs ran into the
64k cap (about 190,000 reasoning tokens per call): 8 of the 9 while still reasoning, before starting their answer, and
the 9th partway into its answer. The reasoning isn't a loop: 98% of its lines are distinct (96% to 99.5% per
choice). It deliberates, for instance, over what to call the root module's group when `app` is a banned name. Each
run therefore fell back to the seeds draft (MoJoFM 80.00) and cost $0.18. On hoppscotch-H1, the one edit call
recorded returned 1 usable choice of 3 (2 cut by the cap); its critic call was in flight when we stopped the
configuration, and was never recorded. We stopped rather than spend about $2 more on the same cap problem.

**Low effort finished more often, but not well.** One run on hoppscotch: 2 of 3 edit choices finished, still after
about 164,000 reasoning tokens in all, and the critic ran into its 32k cap with no answer. The plan scored MoJoFM
55.86 with 13 modules.

**Thinking off worked.** In its 15 runs every edit choice finished and the critic ran every time. MoJoFM (scrambles)
and TurboMQ (immich), mean over 3 runs (min to max):

| Entry | Best deterministic | Ultra (`medium_effort`) | Super VL (thinking off) |
|---|---|---|---|
| hoppscotch | 81.38 | 83.22 (81.38 to 84.83) | 81.84 (76.55 to 90.34) |
| hoppscotch-H1 | 81.38 | 85.06 (80.00 to 90.34) | 79.77 (77.24 to 82.76) |
| kaneo | **66.90** | 50.74 (50.39 to 50.91) | 56.13 (43.34 to 64.75) |
| ghostfolio | 84.72 | 82.18 (76.39 to 87.50) | 82.18 (80.56 to 83.33) |
| immich (TurboMQ) | **10.50** | 10.20 (10.03 to 10.42) | 9.84 (9.76 to 9.98) |

- Runs that beat the best deterministic method: Ultra 5 of 15 (4 with a plan our validator accepts), Super VL 2 of 15.
- Plans from an edit that our validator accepts: Ultra 11 of 15, Super VL 13 of 15 (ghostfolio: Ultra 0 of 3, Super
  VL 2 of 3; every rejected plan keeps a banned module name, `app` or `middleware`).
- Cost per planner run, as recorded: Ultra $0.1702, Super VL $0.0361, 4.7 times cheaper. Completion tokens over the
  15 runs: Ultra 709,836 (555,942 of them reasoning), Super VL 459,782 (none).
- Time per planner run (the ledger's latency, edit plus critic): Ultra about 128 s, Super VL about 40 s. The two were
  recorded half an hour apart, so this is indicative only.
- Ultra hit a cap too, once in each call kind, both on degenerate output: one hoppscotch edit choice (of 45) repeated
  a module list until the 64k cap, and one ghostfolio critic (of 15) went off task until the 32k cap (it counts as
  "critic ran" in compare.md, but made no suggestion).

## Reading it

- Three runs per configuration are few. Only immich separates completely: all three Ultra runs are above all three
  Super VL runs, which at k=3 is still only a one-sided p of 0.05. On hoppscotch-H1 Ultra's mean is above Super VL's
  whole range, but Ultra's weakest run (80.00) is below Super VL's best (82.76). On hoppscotch, kaneo and ghostfolio
  the runs overlap: Super VL's kaneo runs (43.34 to 64.75) bracket Ultra's (50.39 to 50.91), and both stay below
  Louvain. Ultra's lead in beating the deterministic methods (5 against 2 of 15) is not conclusive either (p ≈ 0.2).
- So, on this task: Super VL with thinking off is worse than Ultra on immich, probably worse on hoppscotch-H1, with no
  conclusive difference elsewhere, at a fifth of the cost and about a third of the time. Its public lead over Ultra
  does not show up here.
- With thinking on, 11 of 12 edit choices reasoned past 64k tokens; on low effort (one run), 1 of 3 edit choices did
  and the critic passed 32k. We didn't try larger caps (cost and latency), a reasoning budget, or prompts for Super VL.
- Our prompts and our answer reader were tuned on Ultra, from G1 to S8. The reader drops moves in forms it doesn't
  parse, and it dropped most of the moves of 4 of Super VL's 15 winning edits (files named as `src/2 decorators/…`,
  targets as `platform:bootstrap`) against 2 of Ultra's. The scores measure each model through that reader.
- Run-to-run spread matters for our headline numbers too. The committed bench (`bench/results`, S7 and S8) is one
  earlier draw of the same Ultra edit request on each scramble, and hoppscotch's 87.59 there is above all three fresh
  Ultra runs (81.38 to 84.83). Single-run planner numbers are one draw, and three-run ranges understate the spread.
- **Decision:** the demo's planner stays Nemotron 3 Ultra; the recorded immich plan and run are unchanged. Super VL
  with thinking off is a configuration of the tool (`--planner super-vl-direct`), at a fifth of the cost.

## Cost and reproduction

Budget run s8b recorded $4.00 of its $7 cap: Ultra $2.55, Super VL thinking off $0.54, thinking on $0.70 (3 runs on
hoppscotch, 1 edit call on hoppscotch-H1), low effort $0.19, the probes $0.02. The hoppscotch-H1 critic call that was
in flight when we stopped thinking on was never recorded; its $0.04 reservation stays open in the ledger, so the
gateway and `ac report`, which count open reservations, show s8b at $4.04 and the ledger at $14.58 ($14.54 recorded)
of the $50 cap.

Every recorded run here replays from the cassette for $0, for example:

```sh
npx ac bench bench/manifest.json --planner super-vl-direct --repeats 3 --cassette cassettes/s8b-bench.jsonl \
  --no-certify --out /tmp/super-vl-direct
npx ac bench compare bench/experiments/s8b-super-vl/ultra /tmp/super-vl-direct
```
