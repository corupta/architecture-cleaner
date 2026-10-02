# Research reports (planning session, 2026-10-01/02)

These are raw agent reports, copied verbatim. They are the evidence behind [docs/plan.md](../plan.md). The plan is authoritative; where it disagrees with a report, the plan's correction wins.

| File | Track | Verified by a second agent? |
|---|---|---|
| [01-architecture-ruleset.md](01-architecture-ruleset.md) | Ladder, never-touch list, naming, shared code, hard cases, A/B/C table | no |
| [02-token-factory.md](02-token-factory.md) | Model IDs, prices, limits, reasoning/JSON/tools, credits, hackathon rules | yes |
| [03a-repo-targets.md](03a-repo-targets.md) | Type-sliced TS targets with offline tests (mcphub, traduora, openhab-cloud, …) | yes |
| [03b-scramble-benchmark.md](03b-scramble-benchmark.md) | Feature-modular repos to flatten, flatten procedure, MoJoFM and other metrics | yes |
| [03c-popular-targets.md](03c-popular-targets.md) | Popular demo targets: immich, n8n, Unleash, supabase/opencode/nest/vscode/Apache, tier 2, open sweep (Dokploy, paperclip, monkeytype) | sweep top 3 only |
| [03d-license-analysis.md](03d-license-analysis.md) | What each target license allows for the video, replay site and fork; a second, independent target ranking | no |
| [04a-executor-engine.md](04a-executor-engine.md) | ts-morph `move()` vs TS `getEditsForFileRename` vs our own engine; capability matrix | no |
| [04b-certificate-redteam.md](04b-certificate-redteam.md) | False-certificate holes, K0–K8 redesign, mutation catalog | no |
| [05a-prior-art-academic.md](05a-prior-art-academic.md) | Architecture recovery, remodularization, LLM refactoring, translation validation | no |
| [05b-prior-art-tools.md](05b-prior-art-tools.md) | Products and OSS (structure-sweep, Katana, Kiro, Sonar, dependency-cruiser, …) | no |
| [05c-prior-art-judge.md](05c-prior-art-judge.md) | "Judge who googles": closest hits, and pitches that survive | no |

## Method caveats

- Plan mode was active. Most agents read repos over the network (tree-list JSON, raw files, codeload tarballs streamed into memory, Sourcegraph). They didn't clone, and they didn't install or run anything. **Test offline-ability is inferred from configs and was never executed.** G2 executes it.
- The shared WebSearch budget (200 calls) ran out early. Later facts came from primary sources fetched directly: the TF catalog JSON and OpenAPI, Hugging Face cards, arXiv, Crossref, the npm registry, GitHub pages.
- Counts marked as regex or `it(` call-site counts are approximate.
- Anything marked UNVERIFIED stayed unverified. Plan §12 lists what the gate session must close.
- Star counts, SHAs and dates are snapshots from 2026-10-01/02. Targets move daily, so always use the pinned SHAs.
