# Next session: S7 (reporter and replay site v1, scramble tool, benchmark runner and runs, the judges' --replay build)

Opening prompt for S7, from [sessions/s6.md](sessions/s6.md). Paste it as the first message.

```
Session S7 for architecture-cleaner: the reporter and replay site v1, the scramble tool, the benchmark runner and its runs, and the judges' --replay build.

Read CLAUDE.md, docs/sessions/s6.md, docs/plan.md §4, §7, §8 and §9, docs/storyboard.md, and the S6 run's report (~/ac-work/s6/final/report.md, findings/pr-body.md, certificate.txt). Mode: execution, high autonomy, branch s7/reporter from main; merge when the exit criteria hold. LLM calls only through src/gateway, under a new budget run s7 (add it to budget/runs.json, cap $5: benchmark plans on several repos); every run replays from committed cassettes.

Build:
1. src/report/, `ac report <run-dir> --out <dir>`: a static HTML bundle per run (plan §4 "Outputs"):
   - the before/after module graph (type folders → modules), from the run's base and final trees;
   - the ladder: every step with its certificate (expandable), the rung and whole-PR certificates, timings;
   - the findings log (findings/findings.json), the table-access heatmap, the cost ledger;
   - the A/B (G3 single-shot and persistent vs ac, from docs/gates.md and the S4 certificates).
2. The replay site v1: a static site (GitHub Pages ready, no live calls) with the immich run, the A/B and the benchmark results, built by one command from committed run artifacts (decide what of ~/ac-work/s6/final gets committed, without the per-tree cache).
3. The judges' build (plan §4 "Test build"): `npm ci && npx ac demo --replay` replays the pipeline on the pinned immich SHA from cassettes (plan, narration) with no key and no cost; live mode with the judge's own key. The full ladder takes ~2 h: decide the honest fast path (a recorded run plus re-certifying a sample of commits, or one rung) and say so in the README draft.
4. The scramble tool and the benchmark runner (plan §7): `ac scramble` on our executor and certificate (dogfooding), the H1 opaque-name variant, and `ac bench <manifest>` with MoJoFM, ARI, c2c_cvg and the cluster-count ratio next to the B0, name-token, seeds and Louvain baselines; TurboMQ and back-edges for real targets. Runs on ≥3 repos (the G1 set: hoppscotch, kaneo, immich, plus a backup from the hunt), recorded.
5. S6 carry-overs (docs/sessions/s6.md item 10): a recorded --inject-fault run for the storyboard's "seeded wrong move" beat; K8 runs cached per tree (head runs too); the critic prompt matching its gate at the next live critic recording; testRegex modelled; whether rung certificates that only errored should be resumable.

Exit criteria: `ac report` on the S6 immich run and the replay site v1 building offline; the --replay build working from a clean clone with no key; benchmark results on ≥3 repos with baselines; docs/sessions/s7.md (10 lines) ending with the S8 opening prompt (stretch rungs S1–S3, polish, README draft before the Oct 20 freeze).
Log weird-but-not-blocking observations with /log-anomaly.
```
