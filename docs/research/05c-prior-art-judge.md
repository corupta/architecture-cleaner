# Track 5c: prior art (the judge who googles)

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

# Track 5c: the judge who googles. Novelty check for architecture-cleaner (AC)

## Bottom line
- **The base idea is commodity.** Several things a judge will find within minutes already exist: "an AI restructures a layered or MVC TS codebase into feature / Clean modules", "LLM decides, deterministic engine executes", and "move files with AST import rewriting".
- **The closest hit is 1 week old.** `@demlik/structure-sweep` + `@demlik/code-graph` (npm, created 2026-09-24) does about 60–70% of the restructure half of the claim on TS repos:
  - the LLM assigns each file a feature and a role, which gives inner-layer folders;
  - the graph must agree before a file moves;
  - ts-morph rewrites the imports;
  - entry points are pinned;
  - a boundary ledger freezes crossings.
- **What survives:**
  1. The independent, mechanical behavior-preservation certificate per step. No tool was found doing translation validation of agent refactors: resolved-identity AST equality, plus resolved-import-graph equality modulo `pathMap`, plus a hazard scan, plus glob match-set preservation.
  2. "Bugs made obvious, recorded, never fixed" as a product contract. The closest competitor does the opposite and proposes deduplication.
  3. A measured A/B against a generic agent, scored by that certificate.
- **The pitch has to lead with proof and restraint, not with "AI restructures code".**

## The 7 closest hits

| # | Hit | Date / traction | What it does | Undercut (0-10) |
|---|---|---|---|---|
| 1 | **@demlik/structure-sweep + @demlik/code-graph** (kamp-us/demlik) | npm created 2026-09-24, v0.3.2 on 2026-09-29; GitHub 4★ | LLM file→feature+role classification, graph-agreed moves, ts-morph rewrites, pinned entries, boundary/layer gates | **7** |
| 2 | **specialist-agent `/migrate-architecture`** skill (HerbertJulio) | ~22★, MIT; last commit Mar 6 2026 (third-party listing) | Agent migrates MVC/layered to Modular Monolith / Clean / Hexagonal / DDD / FSD; validates with tsc + tests | **5** |
| 3 | **Refactory** (codedrop-codes) | Commits Apr 6–23 2026; 0★; Product Hunt 0 upvotes; AGPL | "AI plans the splits. Engine copies the code." | **4** |
| 4 | **vFunction** (+ MCP, Claude/VS Code plugins, Kiro Power) | Commercial, enterprise | AI finds domain boundaries, then drives code assistants to modularize; Java/.NET only | **4** |
| 5 | **refactor-verify** skill (subinium/vibesubin) | 50★; first seen 2026-04-14 | "Four-check proof" for moves and renames | **4** (against the certificate claim) |
| 6 | **MM-assist** (ICSME 2025, arXiv 2503.20934) | Academic | LLM recommends where a method goes; IDE executes the move | **3** |
| 7 | **SonarQube Architecture Management** | GA in SonarQube Cloud 2026-03-04 | Intended-vs-current architecture, drift as issues, MCP context for agents; supports TS | **3** (against the boundary-freeze part) |

### 1. @demlik/structure-sweep + @demlik/code-graph (7/10)
Sources: https://www.npmjs.com/package/@demlik/structure-sweep (README via registry.npmjs.org), https://github.com/kamp-us/demlik

**What it does**
- `propose` drafts a feature vocabulary from repo signals. The signals are exported-name terms and label-propagation import clusters.
- `sweep` asks an LLM ("TypeSafe **Jev**", key `TYPESAFE_API_KEY`) which feature and which role every `.ts/.tsx` file has.
  - The default roles map to sub-dirs: `rules/ api/ flows/ store/ lib(shared)`. That is effectively feature modules with inner layers.
- `move plan` moves a file only when both opinions agree:
  - Jev's confidence is ≥0.8;
  - the import-graph "pull" agrees (a strict majority of the file's edges go to that feature).
  - Disagreements become `review` rows.
- Pinned, never moved:
  - `package.json` `main/module/types/bin/exports` targets, traced back to source;
  - wrangler `main`;
  - Next.js app-router files.
- `move apply` makes two commits:
  - first, `git mv` renames with content unchanged (100% renames, so blame survives);
  - second, ts-morph rewrites imports and `vi.mock` specifiers, heals dangling specifiers, and reports `staleStringRefs`.
  - It refuses to run on a dirty tree, and the commits are deterministic.
- `score` grades the file→feature assignment by F1 against git co-change, with a leaf-folder baseline.
- `--blind` / `--redact` hide folder names "to measure propose against a repository whose folders are the answer". This is essentially AC's scramble benchmark.
- code-graph adds:
  - `--boundaries --ci`, gated against `boundary-ledger.json`, plus `--accept-crossings --reason`. This is the "freeze violations" idea.
  - a `--layers` gate;
  - `--clusters`, which reports where the directory layout disagrees with how the code clusters.

**What it lacks**
- No behavior-equivalence certificate. I grepped the README for prove / equal / behavior / certif / test suite and found nothing beyond "code-graph proves structure".
- No findings log.
- Not a ladder of steps (renames commit plus rewrite commit only).
- Not Nemotron.
- Its `pairs` / `consolidate` commands propose collapsing duplicate business rules. That is the opposite of AC's "never fix".

**Discoverability:** low (4★, a week old). It does surface in an npm search for "feature folders".

**UNVERIFIED:** what model or provider "Jev / TypeSafe" is. The npm metadata says Apache-2.0; the GitHub fetch summary said MIT.

### 2. specialist-agent `/migrate-architecture` (5/10)
Sources: https://raw.githubusercontent.com/HerbertJulio/specialist-agent/main/skills/migrate-architecture/SKILL.md, https://www.claudepluginhub.com/skills/herbertjulio-specialist-agent/migrate-architecture

- Supported migrations: "MVC / Layered: controllers, services, repositories" to Modular Monolith / Clean / Hexagonal / DDD; FSD on the frontend.
- Workflow, in the skill's own words: "Map existing files to their new locations", then "Move files one module at a time… LEAST coupled module" first.
- Imports are updated by the LLM using Grep and Edit. It creates barrel `index.ts` files and adapter files.
- Validation: `npx tsc --noEmit`, import-rule check, `npm test`.
- It is literally the G3 generic-agent baseline as a published skill.
- Undercut 6 at the idea level, 0 on mechanism.
- It adds barrels, which changes evaluation order. That is a concrete thing AC's certificate is designed to catch.

### 3. Refactory (4/10)
Sources: https://github.com/codedrop-codes/refactory, https://hunted.space/product/refactory, https://www.producthunt.com/products/refactory

- "AI plans the boundaries. A deterministic engine handles the routine extractions."
- It splits single monolith files into modules, for JS/TS/Python, and ships as an MCP server plus CLI.
- Verification is syntax-only, according to the README summary.
- It undercuts the "LLM decides, deterministic execution" framing, at file-split granularity rather than folder architecture.

### 4. vFunction (4/10)
Sources: https://vfunction.com/platform/, https://vfunction.com/resources/kiro-application-modernization-vfunction-power/

- It collects static and dynamic analysis, then "identifies domain boundaries".
- It "produces detailed specs that serve as prompts" and works through an MCP server and plugins (Claude, VS Code, Kiro Powers) to refactor code, or to "generate specs… for code assistants to rewrite those modules from scratch".
- Java/.NET only. The LLM writes the code, and there is no certificate.
- To a judge it is the enterprise version of "AI decides the modules".

### 5. refactor-verify (vibesubin) (4/10 against the certificate claim)
Sources: https://github.com/subinium/vibesubin, https://skills.sh/subinium/vibesubin/refactor-verify

- Its "four-check proof" for moves and renames:
  1. symbol-set preservation;
  2. byte-equivalence of moved code;
  3. re-run typecheck / lint / tests / smoke;
  4. caller audit across the import graph.
- It is prompt-level instructions to the same agent, not an independent checker.
- It has no resolved-identity normalization, no graph equality under `pathMap`, and no hazard or glob checks.
- The risk is the vocabulary: "proof" for moves is already used by a 50★ skill.
- Related:
  - typegraph-mcp `refactor-safety` (12★, Aug 2026): GO/CAUTION/STOP, https://skillsmp.com/creators/guyowen/typegraph-mcp/skills-refactor-safety
  - GitNexus `detect_changes`, which "verifies only expected files were modified" (47.7k★): https://github.com/abhigyanpatwari/GitNexus. This is close to AC's diff confinement.

### 6. MM-assist (3/10)
Sources: https://arxiv.org/abs/2503.20934, https://conf.researchr.org/details/icsme-2025/icsme-2025-papers/29/Together-We-Are-Better-LLM-IDE-and-Semantic-Embedding-to-Assist-Move-Method-Refacto

- The LLM recommends where a method should go; IDE static analysis filters the suggestions ("up to 80% of the suggestions are hallucinations"); the IDE executes the move.
- Recall@1/3 improved 1.7x; 82.8% of recommendations were rated positively in a 30-person study.
- It is academic precedent for "LLM picks the destination, deterministic engine moves", in Java at method level.
- Full author list UNVERIFIED (Danny Dig's group, per https://danny.cs.colorado.edu/courses/csci7000-011_F25/pdfs/W3_L2_MMAssist_ICSME2025.pdf).

### 7. SonarQube Architecture Management (3/10 against the boundary-freeze part)
Sources: https://docs.sonarsource.com/sonarqube-server/2026.4/architecture, https://www.sonarsource.com/blog/sonarqube-architecture-management-keeps-agent-generated-code-sound/ (2026-05-07), https://siliconangle.com/2025/12/16/sonar-adds-architecture-controls-keep-fast-growing-codebases-structurally-sound/

- Supports "C#, Java, JavaScript, Python, and TypeScript".
- It derives the current architecture automatically; the intended architecture is defined by hand.
- Deviations show up as issues and Quality Gate failures; MCP gives agents the current and intended architecture.
- It does not move code.
- Together with the commodity boundary tools (below), this makes "generated boundary rules that freeze the architecture" table stakes.

## Also found (lower undercut)

| Hit | Undercuts | Notes / URL |
|---|---|---|
| Kiro "Smart Relocate" (2026-02-05) | Executor | Moves files and updates imports through VS Code; "doesn't decide where files go". https://kiro.dev/blog/refactoring-made-right/ |
| mcp-ts-morph (16★) | Executor | `rename_filesystem_entry_by_tsmorph`, `move_symbol_to_file_by_tsmorph`. https://github.com/SiroSuzume/mcp-ts-morph |
| Other TS move servers | Executor | mcp-refactor-typescript `batch_move_files` (https://github.com/Stefan-Nitu/mcp-refactor-typescript); ts-refactor-mcp (https://glama.ai/mcp/servers/schicks/ts-refactor-mcp) |
| monday.com Morphex (2025-09-16) | Pattern | Hybrid of AI and "deterministic code… codemod tools" to split a JS monolith; checked with tests, side-by-side comparison and 2 reviewers per PR; not open source. https://engineering.monday.com/?p=11288 |
| Codegen "SWE agents are better with codemods" (2025) | Pattern | "The codemod is a program you can review, run, and verify." https://codegen.com/swe-agents-are-better-with-codemods/ |
| Matt Pocock `improve-codebase-architecture` (updated 2026-08-24) | Mindshare | Proposes deep-module refactors and "never changes the code". https://aihero.dev/skills-improve-codebase-architecture. His YouTube "How To De-Slop A Codebase Ruined By AI" (2026-04-29, ~243k views, https://www.youtube.com/watch?v=3MP8D-mdheA) is the most visible thing a judge will hit. |
| Codex CLI monolith decomposition guide (2026-05-13) | Pattern | Ranks modules by coupling score; parity tests. https://codex.danielvaughan.com/2026/05/13/codex-cli-monolith-decomposition-strangler-fig-service-extraction-dependency-analysis/ |
| Autohand "Break a monolith into modules" | Idea | The agent moves files and updates imports through LLM edits, then runs tests. https://docs.autohand.ai/tutorials/break-monolith-into-modules |
| Commit-per-step | Commodity | GitHub stacked PRs for agents (https://github.blog/tag/stacked-pull-requests/); Mergify Stacks; "Codemod Runner" subagent, one PR per package with ts-morph/jscodeshift/Nx (https://techsy.io/en/community/ai-automations/codemod-runner) |
| Boundary rule generation | Commodity | @j2blasco/ts-boundaries, ArchSentry (https://www.everydev.ai/tools/archsentry/llms.txt), eslint-plugin-boundaries, dependency-cruiser; ArchKeel (HN 2026-09-24, https://github.com/rapiddweller/archkeel) |
| ICSA 2026, Sambu et al., "LLMs for Architectural Refactoring" | "LLM decides" (academic) | LLM decompositions beat traditional ones on CI (+15%) and BCP (+7.3%), **but traditional methods win MoJoFM by +62%**. https://conf.researchr.org/details/icsa-2026/icsa-2026-papers/27/LLMs-for-Architectural-Refactoring-An-Exploratory-study-on-Monoliths-to-Microservice |
| SemRef (ICSE 2026, arXiv 2607.23774); ArchAgent (arXiv 2601.13007) | Architecture recovery | LLM plus dependency analysis; no code moves |
| Schmidt, MacDonell & Connor 2012 | Prior art (pre-LLM) | Reconstruct the conceptual architecture and refactor Java toward it. https://openrepository.aut.ac.nz/handle/10292/3484 |
| CodeScene ACE | "Verified AI refactoring" marketing | Function-level only, for JS/TS/Java. https://codescene.io/docs/auto-refactor/index.html |
| Kiroween Devpost entries (e.g. CodeCrypt, 2025-12-03) | None | Dependency modernization, not restructuring. https://devpost.com/software/codecrypt |
| Benchmarks | Context | SWE Atlas Refactoring: open models "often introducing regressions" (https://labs.scale.com/leaderboard/sweatlas-refactoring); SWE-Bench ProMax, 170 instances incl. TS (arXiv 2608.09802); agents mostly make local refactorings rather than architectural ones (arXiv 2511.04824) |

## Searches with no hits, and coverage limits
- **GitHub repo search** returned 0 repos for: "restructure codebase feature folders llm", "clean architecture refactor agent typescript move files", "\"feature folders\" refactor ai", "migrate architecture feature-based refactor".
- **npm registry search** found only scaffolders (domain-driver, @giansandoval/screaming-arch, both generators) plus structure-sweep.
- **HN (Algolia, 2025 onward):** no Show HN for a TS type-to-feature restructurer with proofs.
- **Devpost:** the search endpoint returned HTTP 202 to curl, the Nebius gallery isn't public, and web search surfaced no Devpost entry doing this. Devpost coverage is partial.
- **Product Hunt:** checked only through hunted.space mirrors.
- **WebSearch budget:** the shared 200-call budget ran out mid-research. Coverage after that point came from npm, HN Algolia, arXiv API, YouTube and GitHub pages.

## Commodity vs. what survives

**Commodity (do not claim):**
- An AI restructuring a layered codebase into feature / Clean / DDD modules (#1, #2, #4, plus skills and ad-hoc agents).
- AST moves with import rewriting (Kiro, ts-morph MCPs, VS Code).
- "LLM decides, deterministic engine executes" (#1, #3, #6, Morphex, Codegen). The kickoff already calls it the 2026 consensus.
- Commit-per-step and stacked PRs.
- Boundary / drift gates, including generated rules (#7, dependency-cruiser, eslint-plugin-boundaries, ts-boundaries, demlik's ledger).
- tsc + tests as the verifier.
- Pinning entry points (#1 already does it).
- Scramble / blind recovery benchmarks (#1 `--blind`, MoJoFM in ICSA 2026).
- Inner-layer role folders (#1).

**Survives (nothing found that does it):**
1. **An independent per-step certificate built as translation validation:** identity-normalized AST equality, plus resolved-import-graph equality modulo `pathMap` with edge kinds, plus a location-hazard scan, plus config glob match-set preservation. On top of that, mutation-testing the checker itself. The nearest things are a prompt-level "four-check proof" (#5), changed-file detection (GitNexus) and stale-string reporting (#1).
2. **The restraint contract:** a findings log of bugs made obvious, recorded and never fixed, kept out of the diff. #1 moves toward dedup; elsewhere this exists only as folk advice.
3. **Certificate-scored A/B against a generic agent on the same model,** quantifying what tests miss.
4. **The full combination on TS backends** (LLM never writes code, ladder plus certificate plus findings plus freeze, Nemotron). This is semi-novel; #1 is the nearest.

## Three one-sentence pitches that survive a judge who googles
1. "architecture-cleaner restructures a type-sliced TypeScript backend into feature modules and ships every commit with a machine-checked certificate that it is the same program — same resolved import graph, same code modulo file paths — so you can merge an architecture change on proof, not on trust in the AI or your test suite."
2. "Nemotron only draws the map — which files belong to which feature, and why — while a deterministic codemod moves them, an independent checker proves each step changed nothing but paths, and every bug the new layout exposes is logged, never fixed."
3. Only if G3 confirms it: "Same model, same repo: a generic agent told to 'clean up the architecture' passes tsc and tests yet changes behavior; architecture-cleaner makes the same structural change and proves, commit by commit, that it didn't." Fallback wording: "…and shows the N breakages the tests didn't catch."

Avoid these phrasings:
- "first AI tool that restructures codebases"
- "AI refactoring agent"
- "one-click Clean Architecture"
- "verified" without saying what is verified
- "zero risk"

## What makes a judge think "obvious" or "just a codemod", and how the demo should get ahead of it

**Triggers:**
- An opening that shows "AI moves files into folders". That reads as drag-and-drop in VS Code, Kiro Smart Relocate, or a ts-morph script.
- An obvious plan, e.g. `user.controller` + `user.service` → `user/`. The judge thinks "a regex or name stem does that, so why an LLM?"
- A certificate shown only as green checks. That reads as "tsc passed".
- Clean Architecture folder labels with no dependency change. That reads as relabeling.
- An LLM that makes one call, with nothing that plans, tests and refines. That reads as "not agentic" in a track that asks for agents that "plan, write, test, and refine".
- Implying nobody has done this when #1 and #2 exist.

**Pre-emption:**
1. **Open on the failure.** The generic agent (same Nemotron model, same prompt, or #2 verbatim) produces a restructure that passes tsc and tests but changes behavior. Candidate breakages to show:
   - a new barrel changes evaluation order or circular-import initialization;
   - a `jest.mock` path still points at the old module;
   - a same-name module now resolves to a different file;
   - an `fs` read built from `__dirname` now points elsewhere;
   - a `readdirSync` loader over `models/` stops finding files.

   Then show the certificate flagging exactly that. Tests are not the oracle; that is the moment the idea lands.
2. **Show a certificate going red on a seeded broken move,** live. Report the checker's mutation-test score next to what the tests caught. Use real numbers from the runs; don't promise them in advance.
3. **Show judgment the LLM adds over clustering.** Pick ambiguous files: a shared `notification.service`, a god service, cross-cutting utils. Show the rationale and the alternatives considered. Report MoJoFM / co-change F1 against a deterministic clustering baseline. ICSA 2026 found classic methods beat LLM decompositions by 62% on MoJoFM, so without a baseline the "LLM decides" claim is open to attack. Consider the hybrid #1 uses, where graph and LLM must agree, and credit it.
4. **Make the restraint the visual.** Show a finding such as "orders reaches into users' persistence" with a pointer, and the diff that leaves it untouched.
5. **Show the agent loop:** plan → execute → certify → fail → roll back → replan (bounded). This answers "not agentic".
6. **Put prior art on one slide.** Moves: Kiro and ts-morph MCPs. AI restructuring: skills that edit with grep and check with tsc, plus demlik. "Ours: a proof per step, and bugs left as found." Naming the competition defuses the judge who googles.
7. **Show the preflight declining a poor-fit repo, and a CI boundary violation failing.** Keep the boundary part brief, since it is commodity.

## Planning implications
- Ideas worth taking from #1, with credit:
  - two-opinion agreement (LLM verdict plus graph pull) with a review queue;
  - co-change F1 as a metric that needs no ground truth, with a leaf-folder baseline;
  - blind/redacted planner input for the scramble benchmark;
  - a renames-commit then rewrites-commit pattern so blame survives;
  - a pinned-entry inventory.
- The novelty budget belongs in the certificate checker and the A/B. If the checker isn't credible on camera, little of the novelty claim survives.
