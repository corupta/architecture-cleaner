# Next session: S8 (freeze prep: hermetic certificates, planner robustness, carry-overs, stretch if time, polish)

Opening prompt for S8, from [sessions/s7.md](sessions/s7.md). Paste it as the first message.

```
Session S8 for architecture-cleaner: freeze prep. Feature freeze is Tue Oct 20; this is the last build session.

Read CLAUDE.md, docs/sessions/s7.md (all of it, especially item 10), docs/plan.md §2.3 (stretch rungs), §8 (cut order) and §9, docs/storyboard.md, README.md, and the replay site (`npm run build && node dist/cli/main.js site --out /tmp/site`). Mode: execution, high autonomy, branch s8/freeze from main; merge when the exit criteria hold. LLM calls only through src/gateway under a new budget run s8 (cap $3), and only if a planner fix needs the bench plans re-recorded; every run replays from committed cassettes.

In priority order (plan §8's cut order applies: stretch rungs go first if time runs short):
1. Hermetic certificates: certify in a work dir that no parent node_modules can reach (TypeScript's @types walk, Node's resolution), so the default `npx ac demo --replay --env <checkout>` compares digests from inside the clone; then default the demo's work dir accordingly. Prove it: the recorded digests reproduce from a fresh clone's default layout.
2. Planner robustness from the S7 bench, if it fits: a move naming a file by its id resolves (versioned so the immich cassette still replays byte-identically), and a 0-module plan can't win the ranking. Re-record the bench plans (s8), re-run `ac bench`, and report before and after honestly.
3. Small carry-overs: K3b/K6 report fail (not error) when a runner found violations; the findings renderer separates "dropped by the guard" from "not returned" (regenerate the committed findings from the cassette, $0, and keep the demo byte-identical); scripts/target-env.sh picks the arch.
4. Stretch, only with time left: S3 (whitespace-only re-wrap of touched import lines, certified by token-stream equality), then S1 (tests follow their subject). S2 is cut.
5. Polish for the freeze: README final draft (clone URL and site URL placeholders stay until the repo is public), the storyboard updated with S7's measured beats (the fault run, the bench table, the graph framing), the site's copy reviewed end to end, CLAUDE.md status.

Exit criteria: main frozen with a green suite and the mutation harness at 100%; `npx ac demo --replay` from a fresh clone exits 0 (with --env: digests reproduced); the site builds offline; docs/sessions/s8.md (10 lines) ending with the opening prompt for the recording session (final recorded runs, numbers frozen Oct 22, site deployed, repo public).
Log weird-but-not-blocking observations with /log-anomaly.
```
