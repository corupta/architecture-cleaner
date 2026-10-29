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
| immich (MoJoFM over its 2024 key, 47 of 269 files) | **93.02** | 89.15 (88.37 to 90.70) | 89.92 (88.37 to 90.70) |

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

- Three runs per configuration are few. Only immich separates completely, on TurboMQ (see "How immich is scored"
  below): all three Ultra runs are above all three Super VL runs, which at k=3 is
  still only a one-sided p of 0.05. On hoppscotch-H1 Ultra's mean is above Super VL's
  whole range, but Ultra's weakest run (80.00) is below Super VL's best (82.76). On hoppscotch, kaneo and ghostfolio
  the runs overlap: Super VL's kaneo runs (43.34 to 64.75) bracket Ultra's (50.39 to 50.91), and both stay below
  Louvain. Ultra's lead in beating the deterministic methods (5 against 2 of 15) is not conclusive either (p ≈ 0.2).
- So, on this task: Super VL with thinking off scores lower than Ultra on immich's TurboMQ, probably worse on
  hoppscotch-H1, with no
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
- **Decision (S8b, revisited in S8d below):** the demo's planner stays Nemotron 3 Ultra; the recorded immich plan and
  run are unchanged. Super VL with thinking off is a configuration of the tool (`--planner super-vl-direct`), at a
  fifth of the cost.

## S8c: thinking on with room to finish (2026-10-21)

corupta asked for thinking on with a much larger budget. A first probe at 256k/128k (edit/critic) got HTTP 504 from
Token Factory's nginx after exactly 600 s: a non-streamed request can't outlive 10 minutes there, and at about 245
tokens/s per choice that caps a choice near 145k tokens. The gateway now streams any request above 64k max_tokens
(every request up to 64k, and so every earlier recording, is unchanged), and the probe ran again at 512k/256k on
hoppscotch, one run ([super-vl-long](super-vl-long/summary.md)):

| Edit choice | Tokens | Ended | |
|---|---|---|---|
| 2 (the winner) | ~45k: 42k reasoning, 3k answer | finished | 95% of its reasoning lines distinct |
| 1 | ~69k: 67k reasoning, 2k answer | finished | 98% distinct |
| 3 | 512k, all reasoning | the 512k cap | a loop: 12% distinct, 1% in its last 400 lines ("Let me pick. Let me go. Let me write.") |

- The critic reasoned 28k tokens and finished: 11 suggestions, its gate kept 9. The plan is valid, 30 groups, and
  scores MoJoFM 88.28. The edit call streamed for 19 m 36 s and the critic for 1 m 18 s; the run cost $0.60, of which
  the looping choice cost $0.46.
- In this one run the two choices that finished took about 45k and 69k tokens. That was a short draw: S8d's three
  runs of the same request finished at about 62k to 164k, and 2 of their 9 choices were still reasoning at 256k.

## S8d: thinking on at 256k/128k, three runs per entry (2026-10-21)

After the 512k probe, corupta asked for the full comparison with thinking on at 256k-token edit choices and a 128k
critic (both streamed): three runs on each of the five entries, like Ultra's and thinking off's
([super-vl-256k](super-vl-256k/summary.md)). It took 3 h 31 min and cost $6.42. The requests match Ultra's in every
field (system prompts, per-entry prompt, response format, n=3, sampling, planner rules) except three: the caps
(256k/128k against 64k/32k), streaming, and the reasoning mode (Super VL's full default thinking against Ultra's
`medium_effort`).

| Entry | Best deterministic | Ultra (`medium_effort`) | Super VL, thinking off | **Super VL, thinking on, 256k** |
|---|---|---|---|---|
| hoppscotch | 81.38 | 83.22 (81.38 to 84.83) | 81.84 (76.55 to 90.34) | **91.26** (88.97 to 94.48) |
| hoppscotch-H1 | 81.38 | 85.06 (80.00 to 90.34) | 79.77 (77.24 to 82.76) | **90.80** (88.97 to 93.10) |
| kaneo | **66.90** | 50.74 (50.39 to 50.91) | 56.13 (43.34 to 64.75) | 55.27 (49.61 to 58.75) |
| ghostfolio | 84.72 | 82.18 (76.39 to 87.50) | 82.18 (80.56 to 83.33) | **86.11** (83.33 to 87.50) |
| immich (TurboMQ) | **10.50** | 10.20 (10.03 to 10.42) | 9.84 (9.76 to 9.98) | 10.26 (10.08 to 10.35) |
| immich (MoJoFM over its 2024 key, 47 of 269 files) | **93.02** | 89.15 (88.37 to 90.70) | 89.92 (88.37 to 90.70) | 88.37 (88.37 to 88.37) |

- Runs that beat the best deterministic method: 8 of 15 (hoppscotch 3, hoppscotch-H1 3, ghostfolio 2), against Ultra's
  5 and thinking off's 2. Plans from an edit that our validator accepts: 14 of 15 (Ultra 11, thinking off 13).
- Cost per planner run: $0.428, 2.5 times Ultra's $0.170. Model time per run (the ledger's latencies, edit and critic):
  13.7 minutes, against Ultra's 2.1, 6.4 times as long.
- How much it thinks: 37 of 45 edit choices finished on their own, after a median of about 118k tokens (about 42k to
  247k, estimated per choice from each call's usage); only 5 of them would have fit S8b's 64k cap. 8 reached the 256k
  cap: 7 still reasoning (their text compresses like the finished ones), 1 in a loop. The critic finished 14 of 15
  times, after 13k to 75k tokens; the 15th was still reasoning at its 128k cap.
- Ultra at `medium_effort` never needed more room: its finished edit choices peak near 25k tokens and its critics near
  19k, and its only two cap hits in S8b were loops.
- Loops: 2 of the 64 choices in the 256k and 512k runs (3%), both in n=3 edit calls and outvoted by the other choices.
  Ultra: 4 of its 95 recorded planner choices (4%): whitespace, repeated chat-template tokens and a repeated module
  list in edit calls, each outvoted, and an off-task critic, which was its call's only choice, so that run's critic
  made no suggestion.

Reading it:

- Against Ultra at `medium_effort`, its mean is higher on all four scrambles. Pairwise over the runs that is 28 wins, 3
  ties and 5 losses in 36 pairs; a permutation test stratified by entry gives p ≈ 0.0007 (still at most 0.011 with any
  one entry left out). Entry by entry only hoppscotch is clear on its own (every run above every Ultra run, p = 0.05);
  hoppscotch-H1 (p 0.15), ghostfolio and kaneo (p 0.20) are not.
- It is the best planner we have measured on hoppscotch, hoppscotch-H1 and ghostfolio. On kaneo thinking off is a
  little better (MoJoFM 56.13 against 55.27, and on ARI and c2c too); thinking on merges kaneo heavily (about 26
  modules against 47 in the ground truth), and every configuration stays below Louvain (66.90).
- On immich, the demo's target and the one entry that isn't a scramble, we can't tell them apart: TurboMQ 10.26
  against 10.20, p 0.45, both below Louvain; MoJoFM over immich's 2024 key 88.37 against 89.15, a difference of under
  one file. Neither is evidence of no gain: TurboMQ can miss a gain of ghostfolio's size, and the 2024 key labels
  mostly easy files, 41 of its 47 named after their feature (below).
- Caveat: the scrambles are public projects, and in 11 of its 30 calls Super VL's long reasoning names them and tries
  to recall their real structure ("I recall ghostfolio has modules…", "the actual Immich module list (from memory of
  the codebase)"); some of what it recalls is wrong. Ultra's calls show no such recall. How much this inflates the
  scramble scores is unmeasured; the scramble whose upstream it recalls most, ghostfolio, gains 3.9 points over Ultra.
  On immich, which has no answer key to recall, TurboMQ shows no measurable difference, which can't settle it either.
- The lead is over Ultra at `medium_effort`, the configuration the tool uses, not over Ultra at full thinking, which we
  never measured with room to finish. It costs 2.5 times as much and takes 6.4 times as long per plan. At our earlier
  64k cap the same model looked like a failure.
- **Decided (corupta, 2026-10-23): the demo plans with Ultra.** The demo shows these Super VL numbers as preliminary
  results, with their limits, and says why it keeps Ultra:
  - On immich, the demo's target, Super VL shows no measurable gain: TurboMQ 10.26 against 10.20, p 0.45, and MoJoFM
    over immich's 2024 key 88.37 against 89.15. (Revised 2026-10-29: "no gain" said too much. The key sees only a few
    of the files where planners differ, worth one operation of score, and none of the 222 unlabeled ones; TurboMQ
    sees no file at all. So this reason is the weakest of the five.)
  - The recorded demo run (S6: 63 certified commits) reproduces byte for byte, digests included, from a fresh clone
    with the frozen tool. Switching means new code after the feature freeze (the demo and `ac run` can't take a
    planner configuration today) and recording the ladder, fault and re-wrap runs again.
  - The results are preliminary: three runs per entry, only hoppscotch clear on its own, the scrambles are public
    projects its reasoning tries to recall, and Ultra was compared at `medium_effort`, never at full thinking.
  - It needs 2.5 times the cost and 6.4 times the time per plan, and calls longer than Token Factory's 10-minute limit
    for non-streamed answers.
  - The proof doesn't depend on the planner: the certificate checks every commit whichever model drew the map, and
    `--planner super-vl-256k` is one flag away.

## How immich is scored: TurboMQ, and MoJoFM over its 2024 key (added 2026-10-29)

MoJoFM, ARI and c2c_cvg compare a plan with an answer key. The scrambles have one by construction: we flattened
feature-organized repos into type folders ourselves, and their original folders are the key. immich is sliced by type
for real, and nobody has written down what its feature modules should be. TurboMQ needs no key: it scores the import
graph alone (many imports inside a module, few between modules), so the bench computes it for every entry and every
method, scrambles included.

**immich's own history as a key.** immich's maintainers restructured `server/` by hand in March 2024 (the PRs our
video opens with): they dissolved its feature-sliced `domain/<feature>/` layer into the type folders we start from.
G2 (2026-10-02) mapped those former folders (`40262c30`, 2024-03-18) onto the files right after the restructure
(`~/ac-work/g2/immich-recovery/gt.rsf`, docs/gates.md) and found it a face-validity check, not a benchmark:

- Only the domain layer was feature-sliced in 2024, so only services and DTOs carry a label; controllers,
  repositories and shared code, where planners differ, have none.
- At our pinned commit (`02063972e8`) 44 of the 53 labeled files still exist, in 22 features: 22 services, 20 DTOs and
  2 others, 16% of the 269 movable files.
- 41 of the 44 name their feature in the file name (`album.service.ts` belongs to `album`). On the 2024 snapshot,
  G2's name-token baseline scored 91.7 and the LLM planner 93.8: every method lands near the top.
- It is the layout the maintainers had for 2024's code, and then left.

**The score.** `bench/ground-truth/immich-2024.rsf` re-derives that key at our pinned commit from immich's history
alone (47 files in 23 features: the 44 above, `server-info`'s two renamed files and `session.dto.ts`, split from auth;
how, and what it leaves out, in [bench/ground-truth/README.md](../../ground-truth/README.md)). `ac bench` now scores a
real entry over such a partial key the way it scores a scramble over its complete one: every method places all 269
movable files, and MoJoFM, ARI and c2c_cvg count the 47 labeled ones. The results here were spliced into the recorded
results from $0 replays (only `partialKey` added):

| Method | MoJoFM over the 2024 key |
|---|---|
| seeds draft (file names), the draft every planner starts from | **93.02** |
| name-token (anchored) | 90.70 |
| Super VL, thinking off (3 runs) | 89.92 (88.37 to 90.70) |
| Ultra, `medium_effort` (3 fresh runs) | 89.15 (88.37 to 90.70) |
| the demo's plan (Ultra, S6) | 88.37 |
| Super VL, thinking on, 256k (3 runs) | 88.37 (88.37 to 88.37) |
| Louvain r=4 (mean of seeds 1-5) | 71.63 |
| B0 type folders | 11.63 |

- One MoJo operation (one file moved, or two groups joined) is worth about 2.3 points here (43 at most). Every planner
  run is 4 or 5 operations from the key, so the configurations' scores differ by at most one operation; their
  placements of the 47 labeled files differ by up to 3 files, which the score can't show. All of them score at or
  below the draft they start from, which is 3 operations away: it already puts `time-bucket.dto.ts` in a timeline
  group and `stack.dto.ts` in a stack group (the key: asset), and `session.dto.ts` in a session group (the key:
  auth). The planners lose the rest by merging features whose files name their feature: every run puts
  `storage-template.service.ts` with storage, and most put `smart-info.service.ts` with search, asset or media. Two
  thinking-off runs move `time-bucket.dto.ts` back to asset, toward the key.
- MoJoFM hard is meaningless on this key: 6 hard files in 3 features, so it takes steps of 33.33.
- So it does what we expected: it confirms that every planner keeps the easy files together, and it can't separate
  them. It is reported for consistency with the scrambles, not as a measure of planning quality on immich.

**What TurboMQ says where we can check it.** On the four scrambles, Ultra's and Super VL's (thinking on, 256k) mean
TurboMQ next to their MoJoFM difference:

| Entry | Ultra TurboMQ | Super VL TurboMQ | Super VL's MoJoFM gain | Rank correlation of TurboMQ with MoJoFM over the 9 planner runs |
|---|---|---|---|---|
| hoppscotch | 7.86 | 8.32 | +8.0 | 0.90 |
| hoppscotch-H1 | 7.82 | 8.33 | +5.7 | 0.83 |
| kaneo | 9.83 | 10.97 | +4.5 | 0.85 |
| ghostfolio | 18.25 | 18.31 | +3.9 | 0.22 |
| immich | 10.20 | 10.26 | −0.78 over its partial 2024 key (47 files) | |

- TurboMQ moves in MoJoFM's direction on all four, and tracks it across planner runs on three (the 9 runs: Ultra,
  Super VL thinking on and thinking off, 3 each). On ghostfolio it barely moves: a 3.9-point MoJoFM gain shows as
  +0.07, about immich's +0.05.
- It rewards what graph clustering optimizes, not whether a module is the right feature: on hoppscotch, Louvain
  (r=4) has the best TurboMQ of any method (9.63) and a MoJoFM of 74.62, below the seeds draft (TurboMQ 7.37, MoJoFM
  81.38). G1 also saw TurboMQ rank the unedited draft first on immich.
- Hence the reading above: on immich we see no measurable difference, which is not the same as no difference.

## Cost and reproduction

Budget run s8b recorded $4.00 of its $7 cap: Ultra $2.55, Super VL thinking off $0.54, thinking on at 64k $0.70 (3
runs on hoppscotch, 1 edit call on hoppscotch-H1), low effort $0.19, the probes $0.02. S8c (budget run s8c): the 504
probe was charged its $0.70 estimate (the bill for a call cut off upstream is unknown; S10: the bill shows it wasn't billed), and the 512k probe cost $0.60,
$1.30 in all. S8d (budget run s8d): $6.42 for the 15 runs at 256k/128k. The ledger stands at $22.26 recorded. (S10: the Nebius bill of 2026-10-24 priced Super VL's and Ultra's cached input
lower from 2026-10-20 at the latest and didn't bill the 504: these experiments came to $10.71 billed against $11.72 recorded; see the
reconciliation lines in `budget/ledger.jsonl`.) The
hoppscotch-H1 critic call that was in flight when we stopped thinking on at 64k was never recorded; its $0.04
reservation stayed open in the ledger (the gateway and `ac report`, which count open reservations, showed s8b at $4.04
and the ledger at $22.30) until S10's reconciliation settled it at $0.

Every recorded run here replays from the cassette for $0, for example:

```sh
npx ac bench bench/manifest.json --planner super-vl-direct --repeats 3 --cassette cassettes/s8b-bench.jsonl \
  --no-certify --out /tmp/super-vl-direct
npx ac bench compare bench/experiments/s8b-super-vl/ultra /tmp/super-vl-direct
# the streamed 256k runs replay the same way (about 5 minutes, $0):
npx ac bench bench/manifest.json --planner super-vl-256k --repeats 3 --cassette cassettes/s8b-bench.jsonl \
  --no-certify --out /tmp/super-vl-256k
```
