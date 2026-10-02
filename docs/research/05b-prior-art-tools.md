# Track 5b: prior art (tools, products, OSS)

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

# Track 5b: prior art for automated TS/JS architecture restructuring (researched 2026-10-01)

## Bottom line

- **Nothing found does the whole job end to end: decide, execute, and prove behavior is preserved.** I found no tool or product that checks a structural refactor with a mechanical certificate (graph equality plus identity-normalized AST equality plus hazard scan). Every tool I found trusts one of these instead:
  - the language server or codemod being correct,
  - `tsc` and tests,
  - an ML or LLM judge,
  - nothing at all.
- **Closest competitor: `@demlik/structure-sweep` plus `@demlik/code-graph`** (kamp-us/demlik, first npm publish 2026-09-24, about a week ago). It covers a lot of what we planned:
  - an LLM decides each file's feature and role, and the import graph has to agree,
  - ts-morph executes the moves,
  - files land in feature folders with role subfolders, so inner layers exist too,
  - entry files are pinned,
  - renames and import rewrites go in separate commits,
  - a boundary-crossing ledger freezes violations,
  - a co-change F1 score and a "blind/redact" mode measure the plan, which is close in spirit to our scramble benchmark.

  It has **no behavior-preservation verification**: the README never mentions tsc, tests or equivalence. Its `consolidate`/`pairs` commands propose deduplication, which is the opposite of our "record bugs, never fix them" stance.
- **Deterministic move/rename for agents is a commodity**, which confirms the kickoff note. Kiro (Feb 2026), at least 4 ts-morph/tsserver MCP servers, WebStorm and Codemod JSSG `root.rename()` all do it. Enterprise platforms (Moderne, AWS Transform, Codemod, Sourcegraph) do API and framework migrations, **not architecture restructuring**.
- **Architecture-analysis vendors stop at "detect and guide".** SonarQube Architecture (GA 2026, supports TS), Sonargraph (supports TS), the Zügel MCP server (no TS), CAST Imaging (MCP server) and Lattix all fall here. None of them moves code.
- **The delta we can defend is narrower than the kickoff assumed:**
  1. a per-step mechanical certificate,
  2. a findings log that records and never fixes,
  3. a bisectable ladder of single-purpose steps with a certificate on each,
  4. rules emitted in standard tools (dependency-cruiser/ESLint) with a frozen baseline,
  5. Nemotron, an open model, as a planner that only plans.

  "The LLM decides where files go and AST executes" is **no longer novel**; structure-sweep and Katana already work that way.

## Closest competitors, ranked

### 1. @demlik/structure-sweep + @demlik/code-graph

**Sources:** README at https://raw.githubusercontent.com/kamp-us/demlik/main/packages/structure-sweep/README.md, npm https://registry.npmjs.org/@demlik%2Fstructure-sweep, repo https://github.com/kamp-us/demlik.

**Maturity**
- 6 npm versions, created 2026-09-24, last modified 2026-09-29.
- Repo has 4 stars and 0 forks.
- Commits are by `cansirin`, co-authored with `claude`, dated 2026-09-25 to 09-29 (https://github.com/kamp-us/demlik/commits/main/packages/structure-sweep).
- npm metadata says Apache-2.0; the repo page says MIT.

**LLM**
- Uses "TypeSafe Jev" (model id `jev-1`), a paid typed-classifier endpoint keyed by `TYPESAFE_API_KEY` (https://github.com/kamp-us/demlik/blob/main/packages/tea/docs/how-to/ask-jev-a-typed-question.md).
- Codemod's docs also mention "Smart (Jev-powered) queries" (https://docs.codemod.com/enterprise/insights/smart-queries.md). Whether the two Jevs are related is UNVERIFIED.

**Decides structure: yes**
- `propose` writes `signals.json` (folders, exported-name terms, label-propagation import clusters, code-graph clusters) and a prompt. A coding agent drafts the feature vocabulary from it.
- `sweep` asks Jev, for each file: which feature, which role (`business_rule`→`rules/`, `api_surface`→`api/`, `flows/`, `persistence`→`store/`, `plumbing`→`lib/` shared), and whether a business rule is sitting inside an API file.
- `propose refine` loops on merge/split candidates until the score plateaus.

**Executes: yes**
- `move plan` moves a file only when two opinions agree: Jev at confidence ≥0.8, and the graph "pull" (the feature holding a strict majority of the file's import edges). Disagreements become `review` rows.
- Pinned files are never moved: `package.json` `main/module/types/bin/exports` targets (traced back from `dist` to `src`), and Next.js app-router files.
- `move apply` makes 2 commits:
  1. `git mv` renames with content unchanged, so git scores each as a 100% rename,
  2. ts-morph rewrites imports and `vi.mock` specifiers, and Biome formats the result.
- It refuses to run on a dirty tree, is idempotent, and reports `staleStringRefs` (old paths still written as plain strings).

**Verifies behavior: no.** The full README has 0 hits for tsc/typecheck/test/verify/equivalence/hazard. It scores plan quality only:
- co-change precision/recall/F1 against a "leaf folders" baseline,
- `--blind`/`--redact` modes, which hide paths so placement is judged on code alone, "to measure propose against a repository whose folders are the answer".

**Freeze**
- code-graph has `--boundaries`, `--layers`, `boundary-ledger.json` and `--accept-crossings --reason` (https://registry.npmjs.org/@demlik%2Fcode-graph).
- This is its own format, not dependency-cruiser or ESLint.

**Opposite stance on fixing:** `consolidate` proposes merging small files, collapsing duplicate business rules and extracting shared helpers.

**Ideas worth borrowing (with credit):**
- the dual-opinion gate (LLM and graph must agree),
- tracing pinned entrypoints back from build output,
- the rename-commit / rewrite-commit split,
- `staleStringRefs`,
- co-change F1 as a free second plan metric next to MoJoFM.

### 2. Katana (vgmakeev/katana)

https://github.com/vgmakeev/katana

- About 12 stars.
- Its stated split is "The agent owns architecture. Katana owns mechanics."
- The agent writes a JSON plan; Katana moves source ranges byte-for-byte using the TS Compiler API.
- Afterwards it runs tsc/ESLint/Prettier and checks content hashes, collisions and cycles.
- Scope is **one-file splits only**, and it deliberately does not rewrite imports across the project.
- Same philosophy as ours, different rung.

### 3. destiny (benawad/destiny)

https://github.com/benawad/destiny

- "Prettier for file structures", 3.5k stars.
- Decision is deterministic and graph-only: it builds a "fractal" tree from the import graph. Executes moves and fixes imports.
- No verification beyond a dry-run preview.
- Dormant: last npm release 0.7.1 on 2020-08-19, about 1.2k downloads a month (https://api.npmjs.org/downloads/point/last-month/destiny).
- No domain semantics and no layers.

### 4. Devin at Nubank

https://devin.ai/customers/nubank

- Case study: an 8-year-old multi-million-LOC ETL monolith migrated "to sub-modules" by "moving each data class implementation from one architecture to another while tracing imports correctly".
- Humans fixed the target architecture and taught Devin per-task playbooks. Engineers reviewed and merged every PR.
- Claimed 8–12x faster and 20x cost savings. The project started in 2023; the source doesn't name the language.
- This is the strongest marketing precedent for "an agent restructures into modules". Verification was human review only.

## Capability matrix

D = decides structure, E = executes moves, V = verifies behavior.

### Commercial platforms and agents

| Tool | D | E | V | TS | Maturity / date | Notes | URL |
|---|---|---|---|---|---|---|---|
| Moderne / OpenRewrite | N | Partial | Recipe determinism; no equivalence check | Yes, JS/TS LST announced 2025-10-14, via Moderne CLI/Platform only (CLI free for OSS repos) | Enterprise | Recipes focus on API migrations (e.g. Node 20→24 `util.is*`). `javascript.change-import` exists. Core `MoveFile` docs don't say it updates references. No restructuring recipes mentioned. | https://sdtimes.com/softwaredev/moderne-adds-support-for-javascript-and-typescript-to-its-code-refactoring-tool/ · https://docs.openrewrite.org/recipes/javascript/change-import · https://docs.openrewrite.org/recipes/core/movefile · https://docs.moderne.io/user-documentation/moderne-cli/how-to-guides/javascript |
| Moderne Moddy | N | Via recipes | — | via LST | Agent over LSTs, multi-repo | Migration-focused | https://devops.com/moderne-adds-ai-agent-to-simplify-application-modernization-initiatives/ |
| Codemod.com | N | Yes, primitives | Workflow gates; no equivalence check | Yes | 1.1k stars | JSSG (ast-grep) with `root.rename(newPath)` and semantic definitions/references. Workflow `ai` step (Rig harness: bash, str_replace, …). "Codemod 2.0" = deterministic detection plus LLM transformation. No architecture feature. | https://docs.codemod.com/community/jssg/reference.md · https://docs.codemod.com/community/workflows/ai-harness-rig.md · https://codemod.com/blog/codemod2 · https://github.com/codemod-com/codemod |
| AWS Transform custom | N | Yes, agentic | User-supplied build/validation command | Node.js / JS→TS | GA; managed transforms added 2026-03-31 | "Architecture Migrations" here means x86→Graviton or on-prem→Lambda, **not code architecture**. Definitions are SKILL.md files. | https://docs.aws.amazon.com/transform/latest/userguide/custom.html · https://aws.amazon.com/about-aws/whats-new/2026/03/transform-custom-new-transformations |
| Sourcegraph Agentic Batch Changes | N | Yes | Tests/linters in plan; CI-driven | Yes | Beta from 2026-06-29 | Picks deterministic scripts or agents per change; works across repos | https://sourcegraph.com/changelog/2026-06-29 |
| Grit.io | — | — | — | — | Acquired by Honeycomb April 2025; standalone product sunset | GritQL is still open source (Biome uses it) | https://finder.techleap.nl/news/feed/honeycomb-acquires-grit-expands-ai-capabilities · https://biomejs.dev/reference/gritql |
| Kiro | N (agent picks the tool, not the structure) | Yes: semantic rename, smart relocate | Language server only | Yes | 2026-02-05 | Uses VS Code `executeDocumentRenameProvider` and `WorkspaceEdit.renameFile` | https://kiro.dev/blog/refactoring-made-right/ |
| Claude Code | Ad hoc | Text edits / bash | Whatever the agent runs | — | — | Built-in LSP tool has 9 navigation ops; `rename`/`codeAction` are missing (issue #40282, opened 2026-03-28, still open) | https://claudeissues.com/issue/40282-expose-additional-lsp-operations-diagnostics-codeaction-rename |
| Cursor | Ad hoc | Text edits | — | — | — | Forum request (2025-12-01) asking the agent to use IDE refactor tools for moves. Forum reports say a Cursor file move deletes and recreates the file, losing git history. | https://forum.cursor.com/t/use-ide-tools-for-refactoring-intsead-of-manual/144844 · https://forum.cursor.com/t/drag-to-move-file-folder-doesnt-trigger-git-mv/43678 |
| Google Jules, Factory, Augment, Tabnine, Sweep, Amp | Ad hoc | Agentic | Tests/CI | — | — | No restructuring-specific capability found. Factory markets a "Large Feature Workflow" with per-phase validation. Sweep is now a JetBrains plugin that uses IDE refactorings. Amp not investigated (UNVERIFIED). | https://www.datacamp.com/tutorial/google-jules · https://www.zenml.io/llmops-database/enterprise-autonomous-software-engineering-with-ai-droids · https://rywalker.com/research/sweep |
| JetBrains WebStorm | N | Yes: Move file, Move symbol (ES6) with import updates | Static analysis | Yes | Mature | Built-in MCP server (2026.2) exposes `rename_refactoring` but no move tool | https://www.jetbrains.com/help/webstorm/specific-typescript-refactorings.html · https://www.jetbrains.com/help/webstorm/mcp-server.html |
| CodeScene ACE | N (function-level smells) | Yes, LLM-generated | ESLint + Code Health + **ML semantic classifier**: 98% precision, 52% recall, functions up to 130 LOC | JS/TS/Java/C# | Product; paper July 2025 | Closest analogue for "validated LLM refactoring", but at function scope and with a learned judge rather than a proof | https://codescene.io/docs/auto-refactor/index.html · https://arxiv.org/html/2507.03536v1 |
| SonarQube Architecture | N (you define the intended architecture in a GUI) | **No** | — | Yes (Java/JS/TS/Py/C#) | Cloud GA blog 2026-03-02; all plans incl. Free/OSS from 2026-03-19; Server 2026.4 (July) | Discover → formalize → prioritize → fix, where the developer does the fixing. "Context Augmentation" beta (2026-03-31) gives agents the architecture over MCP: full for Java, *partial* for JS/TS. | https://www.sonarsource.com/blog/code-architecture-management-general-availability-in-sonarqube/ · https://community.sonarsource.com/t/architecture-is-now-available-for-everyone-on-sonarqube-cloud/179844 · https://community.sonarsource.com/t/guide-verify-solve-context-augmentation-and-agentic-analysis-for-sonarqube-cloud/180604 |
| Structure101 | — | — | — | — | Acquired by Sonar 2024-10-15 | Became part of the above | https://sonarsource.com/company/press-releases/sonar-acquires-structure101-to-strengthen-code-quality-offering |
| Sonargraph + Zügel MCP | Proposes cycle breakup sets | **No** (Zügel "proposes refactorings", the agent executes) | Rule check on proposed dependencies | Sonargraph: TS yes. Zügel: Java, plus Python/C# from 2026-08-20; **no TS** | Zügel launched 2026-08-13 | Architecture DSL, virtual refactorings | https://www.hello2morrow.com/products/sonargraph · https://www.hello2morrow.com/products/zugel · https://www.hello2morrow.com/news/87 |
| Lattix Architect | What-if DSM (drag and drop) | No | — | JS yes; TS UNVERIFIED | Mature | | https://www.lattix.com/products · https://docs.lattix.com/lattix/whyUseLattixArchitect/whyUseLattixArchitect.html |
| vFunction | Yes, for microservice extraction | Yes ("Code Copy") | — | **No**: monolith analysis is Java/.NET only; OTel-based distributed view covers Node | Mature | | https://vfunction.com/resource-center/faq/ · https://kb.vfunction.com/installations/install/dist-agent/ |
| CAST Imaging | N | No | — | TS 1.x–5.x | MCP server: early access Aug 2025, all users Nov 2025 | Context provider for agents only | https://doc.castsoftware.com/technologies/web/typescript/com.castsoftware.typescript/1.19/ · https://www.castsoftware.com/news/ai-can-now-understand-and-transform-big-enterprise-codebases |

### OSS move/refactor executors for agents (the commodity layer)

| Tool | E | V | Notes | URL |
|---|---|---|---|---|
| SiroSuzume/mcp-ts-morph (`@sirosuzume/mcp-tsmorph-refactor` 1.5.3, 2026-06-11, 16 stars) | rename symbol, rename file/folder, move symbol, change signature, remove path aliases, dry run | — | Known limits: default exports may not update; path aliases get rewritten to relative paths | https://github.com/SiroSuzume/mcp-ts-morph |
| schicks/ts-refactor-mcp (0.1.2, 2026-01-16) | moveFile, atomic, dryRun | — | Uses tsserver `getEditsForFileRename`, the same API VS Code uses | https://cdn.jsdelivr.net/npm/ts-refactor-mcp@0.1.2/README.md |
| Stefan-Nitu/mcp-refactor-typescript | move/batch move, rename, extract, organize imports | — | Uses tsserver | https://glama.ai/mcp/servers/Stefan-Nitu/mcp-refactor-typescript |
| egn88/refactor-mcp (first seen 2026-06-28) | 16 tools, Java (OpenRewrite) and TS (ts-morph) | — | | https://glama.ai/mcp/servers/egn88/refactor-mcp |
| jav-ed/ai_refac (`refac`) | Multi-language file moves; TS via Oxc + TS resolver | Checks import resolution after the move | | https://github.com/jav-ed/ai_refac |
| codegen-sh/graph-sitter | `move_to_file()` with import handling (Py/TS) | — | **Archived 2026-07-17** | https://github.com/codegen-sh/graph-sitter |
| Depwire | What-if simulation of move/rename/split/merge (reports broken imports) | Pre-check only | BSL 1.1 licence, 64 stars | https://github.com/depwire/depwire |

### OSS graph and boundary tools (reuse candidates)

All versions and dates are from the npm registry on 2026-10-01; monthly downloads from https://api.npmjs.org/downloads/point/last-month/.

| Tool | Version, date | Downloads/mo | What it gives us | URL |
|---|---|---|---|---|
| dependency-cruiser | 18.5.0, 2026-09-30; 7.2k stars; MIT | 16.3M | Resolved graph with **edge kinds** (`type-only`, `dynamic-import`, `aliased-tsconfig-paths`, `pre-compilation-only`, `triple-slash-*`, `jsdoc-*`, …). Forbidden/allowed/required rules. `--baseline` / `--ignore-known` (known-violations file) for freezing. `--collapse`/`archi`/`ddot`/`mermaid`/`d2`/`html` reporters. `--affected` for PR diffs. | https://github.com/sverweij/dependency-cruiser · https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/doc/cli.md · https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/doc/rules-reference.md |
| eslint-plugin-boundaries | 7.2.0, 2026-08-09; 993 stars | 6.8M | Element types by path pattern; `dependencies`, `entry-point`, `no-private` rules. Enforcement only; no config generation or moves. | https://github.com/javierbrea/eslint-plugin-boundaries |
| Sheriff (`@softarc/sheriff-core`) | 0.20.0, 2026-09-29; 322 stars | 515k | Modules via barrel or barrel-less; tags plus `depRules`; `verify`/`list`/`export`; ESLint plugin. No restructuring. | https://github.com/softarc-consulting/sheriff |
| Nx | 23.2.1 | — | `enforce-module-boundaries` (tags). `@nx/workspace:move` moves whole **projects**, not files, and updates import paths. | https://nx.dev/docs/features/enforce-module-boundaries · https://20.nx.dev/nx-api/workspace/generators/move |
| ArchUnitTS (`archunit`) | 2.5.4, 2026-09-13; 497 stars | 216k | Architecture tests plus metrics (LCOM96a/b, abstractness, instability, distance from main sequence), PlantUML conformance. LLM features only planned. | https://github.com/LukasNiessen/ArchUnitTS |
| tsarch | 5.4.1, 2024-12-23 | 141k | Older and stale | https://github.com/ts-arch/ts-arch |
| arch-unit-ts | 1.0.12, 2026-07-03 | 6.2k | | https://github.com/arch-unit-ts/arch-unit-ts |
| skott | 0.35.12, 2026-09-11; 877 stars | 381k | Graph API, web UI, cycles, unused files | https://github.com/antoine-coulon/skott |
| madge | 8.0.0, **2024-08-05** | 11.7M | Stale; avoid | https://github.com/pahen/madge |
| arkit | 2.1.0, 2026-03-26; 969 stars | 9.4k | SVG/PNG/PlantUML component diagrams | https://github.com/dyatko/arkit |
| good-fences | 1.2.0, 2023 | — | JS version unmaintained; replaced by a Rust rewrite | https://github.com/smikula/good-fences |
| knip | 6.39.0, 2026-09-30 | 61M | Unused files/exports/deps, which can feed findings ("made obvious") | https://github.com/webpro-nl/knip |
| Archprint | 7 stars, MIT, TS-only | — | **Infers** boundary rules from the import graph with statistical gating; emits ESLint flat config, dependency-cruiser JSON and ts-arch, plus MCP. Overlaps our "generated rules" rung. Show HN 2026-09-08. | https://github.com/Tommkruix/archprint |
| Feature-Sliced Design (frontend) | steiger 0.7.0 (2026-09-25, 436 stars, 368k/mo); `@feature-sliced/cli` generator | — | Steiger is an FSD linter with no move autofix. The official "migration from custom architecture" guide is **entirely manual**. A Claude skill (ccheney/robust-skills feature-slicing) is prompt-only. | https://github.com/feature-sliced/steiger · https://feature-sliced.design/docs/guides/migration/from-custom · https://claudepluginhub.com/skills/ccheney-ccheney-robust-skills/feature-slicing |
| eslint-plugin-project-structure | 3.14.5, 2026-09-30 | 295k | Folder-structure lint, independent modules | https://github.com/Igorkowalski94/eslint-plugin-project-structure |
| ArchGuard | 677 stars | — | Architecture governance; TS only for API-consumer analysis; Co-mate LLM; no execution | https://github.com/archguard/archguard |

### Verification-adjacent tools (none certify moves)

- **RefDiff:** detects refactorings including Move and Rename for Java/JS/C. **No TypeScript.** https://github.com/aserg-ufmg/RefDiff
- **SemanticDiff:** a TS-aware diff that hides invariant changes and detects moved code; GitHub App. Useful as a presentation reference only. https://semanticdiff.com/

### Cross-language analogues (decision stays human; tools enforce or execute)

- **Ruby `packs`:** `bin/packs move` into a developer-chosen pack, with packwerk enforcing. https://github.com/rubyatscale/use_packs
- **Python Tach:** boundary enforcement, 2.8k stars. https://github.com/gauge-sh/tach
- **Spring Modulith 2.0:** GA late 2025 per a secondary source (https://medium.com/viascom/the-modular-monolith-a-field-guide-36dcf21a477b); UNVERIFIED against a primary source.

### Evidence that generic agents struggle (useful for G3 and the pitch)

- **RefactorBench** (ICLR 2025): LM agents solve 22% of multi-file refactoring tasks vs 87% for humans. https://arxiv.org/abs/2503.07832
- **Agentic Refactoring**, Horikawa et al., Nov 2025, Java (AIDev dataset): agents mostly make low-level edits (Change Variable Type 11.8%, Rename Parameter 10.4%) rather than architectural changes. https://arxiv.org/abs/2511.04824v1
- **Industry LLM migrations** (all API/framework migrations, not restructuring):
  - Google, Apr 2025: 39 migrations, 74.45% of changes LLM-generated. https://arxiv.org/abs/2504.09691
  - Spotify, 2025: 1,000+ merged PRs; verified by build/test/lint plus LLM-as-judge plus human review. https://www.zenml.io/llmops-database/autonomous-codebase-migration-at-scale-using-llm-powered-agents
  - OpenHands Refactor SDK, Oct 2025: verifiers are scripts or LLM prompts. https://www.openhands.dev/blog/automating-massive-refactors-with-parallel-agents
- **Prompt-only "clean architecture" skills and PRs** are common, e.g. https://skills.wondel.ai/skills/clean-architecture/ and https://github.com/LucasSci/Corretor-AI/pull/153. They come with no mechanical verification.

## Delta we can defend

1. **A behavior-preservation certificate for each step, independent of tests:**
   - resolved-graph equality with edge kinds,
   - identity-normalized AST equality,
   - a location-hazard scan (`__dirname`, `readdirSync`, `require(var)`, …),
   - config glob match sets.

   Nobody found does this. Kiro and the MCP servers trust the language server. Katana and AWS run tsc/build. CodeScene uses an ML classifier. structure-sweep and destiny verify nothing.
2. **Findings log, recorded and never fixed.** structure-sweep `consolidate` does the opposite (proposes merges and collapses), and agents tend to "fix while there" (RefactorBench, Agentic Refactoring study).
3. **A ladder of single-purpose steps with a certificate per commit, bisectable.** structure-sweep has 2 commits (renames, then rewrites) but no per-module ladder and no per-step checks.
4. **Rules in standard tools:** dependency-cruiser/ESLint rules plus a frozen known-violations baseline, rather than a proprietary ledger (structure-sweep) or a vendor GUI (Sonar).
5. **Backend-specific profile** (controllers/services/models/routes → feature/inner layers) with **an open NVIDIA model** as a planner that only plans. structure-sweep is generic, Next.js-aware and uses a paid proprietary classifier.
6. **Benchmark:** MoJoFM on flattened ("scrambled") tested repos. structure-sweep already has co-change F1 and blind/redact modes, so frame ours as complementary: we have ground truth, they have history. We could report both.

**No longer differentiators:** "the LLM decides placement and an AST tool executes", feature folders with role subfolders, graph clustering signals, pinned entrypoints, and freezing current crossings. Say so openly in the README and cite structure-sweep and Katana as related work.

## What to reuse rather than rebuild

- **dependency-cruiser**, for several jobs at once:
  - a third, independent resolver for graph equality, alongside the raw compiler API and ts-morph. That it uses enhanced-resolve internally is UNVERIFIED; check the repo.
  - edge kinds to compare,
  - `--baseline` as the freeze mechanism,
  - `archi`/`ddot`/`mermaid`/`d2`/`html` reporters for the before/after visuals,
  - generated forbidden/allowed rules as the guardrail output.
- **eslint-plugin-boundaries**, optionally, as a second rule target for in-editor feedback. Look at Archprint for how to emit ESLint, dependency-cruiser and ts-arch rules from one model.
- **TypeScript language service `getEditsForFileRename`** (what VS Code and ts-refactor-mcp use) as an independent cross-check of the ts-morph executor's import rewrites.
- **knip** for unused exports/files to feed findings. **ArchUnitTS metrics** (instability, abstractness, distance from main sequence, LCOM) for a before/after scorecard.
- **From structure-sweep, borrow:**
  - the LLM-and-graph agreement gate with `review` rows,
  - pinned-entry tracing through `dist→src`,
  - `git mv` commits separated from rewrite commits,
  - `staleStringRefs`,
  - the co-change F1 metric.
- **Avoid:** madge (last release 2024-08), good-fences (JS version unmaintained), graph-sitter (archived).
- **Optional:** SonarQube Cloud Architecture is free for OSS and supports TS. It could give a third-party before/after architecture view, but setup cost is likely not worth it.

## Gaps and UNVERIFIED items

- **Search coverage was partial:**
  - The WebSearch budget ran out (200/200, shared), so the 2025–2026 blog/YouTube sweep for "AI agent restructures repo into modules" is incomplete.
  - Show HN (via HN Algolia) and npm search surfaced no other restructure-and-verify tool.
  - Devpost project search returned HTTP 202 with an empty body, and `built-with` pages came back empty, so **no Devpost projects were checked**. The current hackathon gallery isn't public anyway.
  - GitHub's anonymous repo search is shallow and hit HTTP 429 once.
- **Absence claims mean "not found", not "doesn't exist".**
- Lattix TS support, dependency-cruiser's internal resolver, Amp's capabilities, and any link between Jev and Codemod are UNVERIFIED.
- Name check: `architecture-cleaner` returns 404 on npm, and GitHub shows no TS repo with that name.

No files were written. No repos were cloned, because plan mode was active; everything was checked over the network with read-only requests (WebFetch, npm registry and HN Algolia APIs, raw.githubusercontent).
