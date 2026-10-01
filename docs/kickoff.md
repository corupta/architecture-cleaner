# Kickoff notes (2026-10-01)

Distilled record of the feasibility session that ended in the go decision. The session transcript isn't preserved; this is what survives it.

**This is input for the planning session, not a set of decisions.** Anything here may be overturned. Only the "Decided at kickoff" list in CLAUDE.md was actually agreed.

## Hackathon facts

- Nebius x NVIDIA Global AI Hackathon on Devpost, online.
  - Submission window: 2026-08-26 → **2026-10-30 10:00 PT**.
  - Judging: Dec 1–15. Winners around 2027-01-11.
- 15.4k registrants as of Oct 1. The gallery isn't public yet. Guess: a few hundred to ~1.5k submissions.
- Tracks: Coding & Agentic Engineering ("agents that write, run, and test code in Token Factory"), Best Apps & Agents, Personal AI, Physical AI.
- Prizes:
  - Grand prizes of $20k / $10k / $6k, across all tracks.
  - Each track winner gets a Jetson Orin Nano.
  - A project can win one Overall award, or one Track award plus one Bonus award.
  - Bonus awards: Best Use of Tavily ($3k) and Most Valuable Feedback ($100 + swag, ×10). Feedback is a required submission field anyway.
- **Stage 1 (pass/fail):** the project fits a theme, makes a runtime call to Token Factory (or runs on Nebius AI Cloud: Serverless Jobs/Endpoints/DevPods), and uses at least one NVIDIA open model.
- **Stage 2:** four equally weighted criteria. Ties are broken in this order:
  1. Technological Implementation
  2. Design: "complete, coherent product experience not just a technical proof of concept"
  3. Potential Impact
  4. Quality of the Idea: "creative, non-obvious"
- **Judges aren't required to run the project.** They may score from the text, images and the ≤3-min video alone.
- An organizer update says code completion counts as "standard". They want agents that "autonomously plan, write, test, and refine code with minimal human intervention".
- The submission package:
  - public repo with an OSS license file
  - README with setup steps and the Nemotron usage
  - public YouTube video of ≤3 min
  - demo URL or test build
  - written feedback on the Nebius/NVIDIA tools
  - an explanation of what changed, if any work predates Aug 26
- Multiple submissions are allowed if they're substantially different. A possible Physical AI entry gets discussed in a separate workspace.

## Models and credits

Prices come from third-party listings; verify them on Token Factory.

| Model | Shape | Context | $/M tokens in · out |
|---|---|---|---|
| Nemotron 3 Ultra | 550B-A55B MoE, reasoning + tool calling; claimed 71.9% SWE-bench Verified | 1M | ~1.00 · 3.00 |
| Nemotron 3 Super | 120B-A12B MoE, reasoning + tool calling | 262K | ~0.30 · 0.90 |
| Nemotron 3 Nano | 30B-A3B MoE | verify | ~0.06 · 0.24 |

Credits: $25 via code `NEBIUS-DEVPOST-GLOBAL26`, plus $25 via the Nebius Builders Program.

## Prior art

- Deterministic move/rename for agents is a commodity. Kiro shipped semantic rename and smart relocate in Feb 2026, and ts-morph MCP servers already expose move-symbol and rename.
- Enterprise migration is covered by Moderne/OpenRewrite, Codemod.com and AWS Transform. Devin, Cursor and Claude Code do it ad hoc.
- "LLM decides, AST executes, tests verify" is the 2026 consensus pattern. Novelty has to come from **deciding where files go** and **proving the result is better/equivalent**.

## Positioning notes

- Top-level `entities/ usecases/ adapters/` folders still package by layer; they're the old disease with new labels. Screaming Architecture puts the domain at the top with layers inside, and so does Simon Brown's "package by component" chapter in the Clean Architecture book.
- Moves and renames alone ≠ Clean Architecture; the dependency rule needs actual inversion. The honest middle ground: measure the violations, then freeze them with generated boundary rules (dependency-cruiser / eslint-plugin-boundaries).

| | A. Literal CA folders | B. Feature modules + inner layers + boundary rules | C. B + dependency inversion |
|---|---|---|---|
| What changes | labels | cohesion, explicit boundaries, frozen violations | the dependency rule itself |
| Verification | mechanical | mechanical | needs tests |
| Risk | low | low | high |

- On generality, a few curated repos are fine for judging. Keep it honest:
  - no repo-specific code paths
  - a preflight check that declines poor fits and says why
  - breadth numbers from a benchmark
  - a stated support envelope

## Candidate design ideas

- **Plan as data.** The LLM outputs a `pathMap` and `renameMap` plus a rationale, never code. A deterministic executor applies them.
- **A ladder of single-purpose steps.** Each step is verified and committed on its own, so the history is bisectable.
- **Findings log.** Bugs the refactor makes obvious get recorded, never fixed, and surface in the PR description.
- **A mechanical certificate per step.** This is translation validation and needs neither tests nor types:
  1. **Diff confinement.** Only moved files, their importers, and configs carrying paths change.
  2. **Identity-normalized AST equality.** Replace every module reference with the file it actually resolves to, using the real resolution (tsconfig `paths`, extensions, index files). The before and after ASTs must then match. This is stronger than "tsc passes": it catches an import that now resolves to a different module with the same name.
  3. **Graph equality.** The resolved import graph after must equal `pathMap(graph before)`, edge kinds included. Adding no new barrels keeps the evaluation order intact.
  4. **Location-sensitivity scan.** Look for `__dirname`, `import.meta.url`, relative `fs`/`path` literals, `require(variable)`, readdirSync-style loaders and `new Worker('./…')`. A file that uses these is either pinned or moved together with its targets.
  5. **Glob and path strings in configs keep the same match set modulo `pathMap`.** Covers tsconfig `include`, Jest `testMatch`/`moduleNameMapper`, ORM globs, package.json `main`/`bin`/`scripts`, Dockerfiles and CI files.
  6. **Renames.** Binding-aware normalization plus a name-observability check: `X.name`, `constructor.name`, string literals equal to the name, decorators, framework base classes (e.g. Sequelize `Model`), `ns['Old']` access, public exports. When in doubt, don't rename.
  7. **Pinned surface.** Entrypoints and the public import surface stay put. References from outside the repo are listed as residual risk.

  tsc and the test suite run as a second, independent oracle.
- **Trusting the checker:**
  - Implement it independently of the executor: the raw compiler API on one side, ts-morph on the other.
  - Mutation-test it with deliberately broken moves.
  - Cross-check on tested OSS repos. "Certificate ✓, tests ✗" means a soundness hole.
- **Not certifiable:** dedup and abstraction refactors. They'd need a behavioral oracle (golden-master recording), so they're out of MVP scope.
- **Scramble benchmark.** Flatten well-structured, tested TS repos into `controllers/services/models`, then score how well the tool recovers the original modules (MoJoFM). That gives quantitative results and widens the pool of target repos.
- **Architecture search.** Sample K candidate decompositions, apply each one cheaply, score them on graph metrics plus the certificate, and keep the best. Could run in parallel on Nebius Serverless Jobs.
- **Model tiering (hypothesis).** Do deterministic grouping first: name stems plus import-graph clustering. Then:
  - Nano: per-file fan-out
  - Super: likely the workhorse
  - Ultra: a few global plan/critique calls

  Measure the tiers on the benchmark; a quality-vs-cost chart is itself a judging artifact.
- **Baseline A/B for the video.** Give a generic agent running on the *same* Nemotron model the prompt "restructure into Clean Architecture". Count its out-of-scope edits, behavior changes and "fixed" bugs.
- **Product surface: make the architecture visible.**
  - before/after dependency graph
  - violation counts
  - per-module rationale
  - live step ladder with certificates
  - PR output, one commit per step
  - a hosted static replay of recorded runs as the demo URL
- **Submission extras.** Keep a running Token Factory feedback log as we go (required field, plus a bonus award). Skip Tavily unless a natural use appears.

## Risks (ranked)

1. The video is 3 minutes of a refactor that, by design, changes nothing observable. Design and Impact hinge on the visuals.
2. Plan quality. Modules that look wrong to a senior viewer sink everything.
3. Checker soundness. One false certificate on camera ends credibility.
4. corupta's review bandwidth (solo, limited hours).
5. Credits, which are manageable:
   - Record/replay-cache every LLM call.
   - Give the LLM the compressed graph, not raw source.
   - Enforce hard per-run and global budgets computed from each response's `usage`.

   The real traps are the generic-agent baseline (cap it; use Super on both sides) and any live public endpoint running on our key.

## Gates before committing to the build

- **G1 boundary spike.** Does Super/Ultra propose sensible modules for a scrambled repo? About half a day and < $3.
- **G2 repo hunt.** Find 2–3 type-sliced TS repos whose tests run offline. If the good candidates turn out to be mostly JS, revisit the TS-only call.
- **G3 baseline.** Does a generic agent actually make a mess? If not, the pitch shifts to certificate, cost and determinism.

## Flow (rough; planning owns the timeline)

### The next four weeks

```
 WHEN       MAIN PATH                                IF IT GOES WRONG
 ─────────  ───────────────────────────────────────  ──────────────────────────────
 Oct 1      kickoff: feasibility, go, CLAUDE.md
              │
 Oct 2–3    PLANNING SESSION
            scope · architecture · requirements
            · repo shortlist · timeline
              │
 Oct 3–6    G1 boundary spike                        bad → ≤1 day of variants;
            scrambled repo → Nemotron plan                 still bad → pivot / stop
            → MoJoFM score + corupta's eyeball
              │ good
            G2 repo hunt                             none → demo on scrambled
            2–3 type-sliced TS repos,                       repos (weaker story)
            tests run offline
              │ found
            G3 baseline                              clean → re-pitch around
            generic agent, same Nemotron                     certificate / cost
              │ messy (expected)
 ~Oct 6     ◆ corupta decides: build / pivot / stop
              │ build
 Oct 6–20   BUILD, checker first                     step red → fix or roll back,
            checker → mutation-test it → analyzer           never pile on
            → planner → executor + ladder
            → report / visuals → PR output
              │
 Oct 20     ◆ FEATURE FREEZE                         unfinished → cut, not rushed
              │
 Oct 20–28  recorded runs → video (corupta's voice)
            → README → submit (target Oct 28)
              │
 Oct 30     deadline 10:00 PT
              │
 later      JS moves → corupta's private repo
```

### One tool run (candidate design)

```
 target repo
   │
 PREFLIGHT ─────────── unfit ──► decline, with reasons
   │ fits: TS, type-sliced; baseline recorded (tsc · tests · file inventory)
   │
 ANALYZE    (no LLM)   ts-morph → symbol/import graph, hazards
   │
 PLAN       (Nemotron) modules · file→module map · rationale · step ladder
   │                   Nano: per-file fan-out · Super/Ultra: global calls
   ▼
 ┌─► STEP     one transformation, e.g. "move billing files into billing/"
 │     │
 │   EXECUTE  (no LLM) deterministic codemod
 │     │
 │   CERTIFY  diff confinement · same graph · same code modulo import paths
 │     │      hazard scan · glob match-sets · then tsc + tests
 │     ├── fail ──► roll back → replan step (bounded) or skip, flagged
 │     │ pass
 │   COMMIT   step + certificate + findings ("made obvious, not fixed")
 │     │
 └─────┤ more steps
       │ done
 GUARDRAILS  boundary lint rules, so it stays clean
   │
 REPORT + PR before/after graph · certificates · findings
```

## Open questions for the planning session

- **Target layout profile.** Module naming and inner-layer names; one opinionated profile or configurable?
- **MVP rungs.** Which of these: module moves, inner-layer moves, file renames, symbol renames, boundary rules, one dependency-inversion pattern?
- **Form factor and demo URL.** CLI plus a hosted static replay? GitHub Action/App? Web UI?
- **Planner input.** Compressed-graph format, how much source per file the LLM sees, the deterministic pre-clustering method, single plan vs K-candidate search.
- **Checker edge cases.** tsconfig `paths`, ESM extensions, package `exports` maps, `jest.mock`/`vi.mock`, monorepo package boundaries.
- **Repos.** Shortlist and scramble procedure (how to flatten faithfully).
- **Nebius AI Cloud.** Worth using beyond Token Factory (Serverless Jobs for parallel candidates), or not worth the effort?
- **Video.** Storyline, and what corupta has to record personally.
- **Timeline.** Feature-freeze date and buffer.

## Sources

- Hackathon: https://nebiusglobalaihackathon.devpost.com/ (plus `/rules`, `/updates`, `/resources`)
- Kiro, agent refactoring tools: https://kiro.dev/blog/refactoring-made-right/
- ts-morph MCP server: https://playbooks.com/mcp/sirosuzume-ts-morph
- Nemotron 3 Ultra: https://www.buildfastwithai.com/blogs/nvidia-nemotron-3-ultra-review-2026
- Token Factory listings: https://www.getmaxim.ai/bifrost/model-library/compare/nebius/nemotron-3-ultra-550b-a55b.md · https://modelcompare.dev/models/nvidia/nemotron-3-super-120b
- Modernization platforms overview: https://dev.to/axel_6225c422a7f5ddb4eb30/best-ai-code-modernization-platforms-in-2026-the-9-worth-evaluating-1nj2
