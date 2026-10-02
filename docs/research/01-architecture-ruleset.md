# Track 1: architecture ruleset

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

# Track 1: Architecture ruleset for architecture-cleaner

Research was done 2026-10-01. In plan mode I made no writes anywhere, including no clones into /tmp/ac-research. I read repo trees through GitHub HTML pages and raw.githubusercontent.com, piped to stdout. Web search hit the shared 200-call budget partway through, so the later facts were checked with direct fetches. Source IDs `[Sn]` are listed at the end.

## 0. Bottom line

1. **Default target: B′.** Feature modules with flat, role-suffixed files, plus generated boundary rules and a frozen violation baseline. Inner layer folders are an opt-in profile. Dependency inversion produces report-only "draft ports".
   - Folders without enforcement are, in Brown's words, "simply an organization mechanism… rather than being used for encapsulation" [S1].
   - TS has no package-private, so lint rules have to play that role.
2. **Inner CA layer folders should not be the default.**
   - In the typical Express plus Sequelize/Mongoose active-record target, `domain/` would be empty, or it would hold ORM classes, which is a false label.
   - Every service would then show as a dependency-rule violation. That is noise, not "bugs made obvious".
3. **Module = ownership unit.** Each file has exactly one owner module. Data ownership, meaning who writes which table, decides contested files. Other modules depend on the owner through its declared public files.
   - DDD answers the shared `User` with per-context models plus references by identity [S7, S8, S10]. A behavior-preserving tool can't do that split, so it shows the coupling and freezes it.
4. **No new barrels, ever, in the hackathon scope.** Public API is an allow-list in the boundary config, not `index.ts`. Barrels change evaluation order and add cycle/TDZ risk [S18, S19, S21]. Barrel-less public APIs have precedent in Sheriff's `internal/` [S24] and Spring Modulith's `internal` packages [S12].
5. **No symbol renames.**
   - Class names drive persisted and observable names: Sequelize `modelName` defaults to the class name and the table name is its plural [S27]; TypeORM's table name is `snakeCase(className)` [S28].
   - File renames are fine as a separate rung with extra observability checks.
6. **The pinned set matters more than the move set.** Credibility depends on what the tool refuses to move: entrypoints, migrations, convention- or glob-loaded files, ambient `.d.ts`, generated code, and the test oracle.

---

## 1. Evidence base

### 1a. Literature, as it applies to the tool

| Source | Claim used |
|---|---|
| Brown, *Clean Architecture* ch.34 "The Missing Chapter" (2017) [S1] | Four options: package by layer, by feature, ports & adapters, by component.<br>Package by component bundles business logic and persistence behind one interface and "keeps the user interface separate".<br>"Web controllers should never access repositories directly."<br>The "Périphérique anti-pattern": infrastructure calling infrastructure and bypassing the domain.<br>"Organization versus encapsulation": with everything public, the architectural styles collapse into the same thing.<br>"Lean on the compiler." In TS that becomes lint/boundary rules. |
| Martin, Screaming Architecture (2011-09-30) [S2] | The top-level folders should scream the domain, not the framework. |
| Martin, The Clean Architecture (2012-08-13) [S3] | Dependency Rule: "Source code dependencies can only point inwards."<br>Boundaries are crossed via DIP.<br>"There's no rule that says you must always have just these four." |
| Cockburn, Hexagonal (2005-09-04) [S4] | Ports and adapters, primary (driving) vs secondary (driven). This is where `http/` vs `infrastructure/` comes from. |
| Bogard, Vertical Slice (2018-04-19) [S5] | "Minimize coupling between slices, and maximize coupling in a slice."<br>Shared abstractions only when tools need them.<br>Per-request slices are finer than what pure moves can produce (§2, R12). |
| Grzybek, Modular Monolith Primer (2019-12-02) [S6] + reference repo (14k★, last commit 2024-04-20) [S7] | A module has complete functionality, is organized by business domain, and has a defined contract with everything else encapsulated.<br>The repo has `Modules/{Meetings,Payments,UserAccess,…}/{Application,Domain,Infrastructure,IntegrationEvents}`.<br>**Meetings has `Members/Member.cs`, Payments has `Payers/` and `Users/`, UserAccess has `Users/`.** That is the textbook answer to "who owns User". |
| Fowler, BoundedContext (2014-01-15) [S8] | Different contexts hold "completely different models of common concepts" (Customer, Product). |
| Evans, DDD Reference (2015) [S9]; ddd-crew context mapping [S9] | Shared Kernel: an explicitly agreed shared subset.<br>Customer/Supplier, Conformist, ACL, Big Ball of Mud: "prevented from spreading". |
| Vernon, Effective Aggregate Design II (2011) [S10] | Reference other aggregates by identity. (The PDF couldn't be machine-read here; the rule is from the paper title and well-known content.) |
| Hauer, Package by Feature (2020, updated 2022) [S11] | Minimal `common` package; reuse only after the Rule of Three; `api`/`internal` subpackages once a feature package grows. |
| Spring Modulith docs [S12] | A module is a direct sub-package. Its base package is the API, sub-packages are `internal`. `@NamedInterface` and `allowedDependencies` are verified. This is the model for "declared module DAG + verification". |
| NestJS modules docs [S13] | `src/cats/{cats.controller.ts, cats.service.ts, cats.module.ts, dto/, interfaces/}`. Note that Nest module encapsulation is **DI-level**, not import-level. |
| Angular style guide [S14] | Organize by feature areas; avoid `components/`, `services/` dirs; avoid `helpers.ts`, `utils.ts`, `common.ts`; `.spec.ts` sits next to the source.<br>Angular v20 (2025) dropped type suffixes, per a secondary source. That is a frontend decision, and backend ecosystems still use suffixes (§1b). |
| Feature-Sliced Design [S15] | Frontend-only by its own statement. Useful ideas: a strict downward layer rule (pages > widgets > features > entities > shared), `entities` vs `shared`, a public API that warns against `export *`, and the `@x` cross-import notation for entity-to-entity references. |
| goldbergyoni Node best practices §1.1 [S16] | `apps/{orders,users,payments}/{api,domain,data-access}` plus `libraries/{logger,authenticator}`; "consume… only through its public interface". |

### 1b. Real TS backends surveyed (trees read 2026-10-01)

| Repo (★, last commit) | Module root | Module dir naming | File naming | Inside a module | Tests |
|---|---|---|---|---|---|
| immich-app/immich server (115k, 2026-10-01) | **type-sliced** `src/{controllers,services,repositories,dtos,schema}` with barrels `index.ts` | singular kebab stems | `asset-media.controller.ts` | – | co-located `.spec.ts` |
| n8n-io/n8n `packages/cli` (206k, 2026-10-01) | `src/modules/<kebab>`, **coexisting with legacy** `src/controllers/`, `src/services/` | kebab, singular or plural mixed (`insights`, `data-table`) | `my-feature.<role>.ts`, "infixes… strongly recommended" [S17] | flat, plus `database/{entities,repositories}` | `__tests__/` in the module |
| Unleash/unleash (13.8k, 2026-10-01) | `src/lib/features/<kebab>`, **coexisting with** `src/lib/{services,db,routes}` | kebab | `segment-service.ts`, `segment-store.ts`, `segment-controller.ts`, factory `createSegmentService.ts` | flat; `fakes/`, `tests/` | co-located `.test.ts`, `.e2e.test.ts` |
| Infisical backend (29.5k, 2026-10-01) | `src/services/<kebab>` (feature folders under a type-named root) | singular kebab | `project-service.ts`, `project-dal.ts`, `project-types.ts`, `project-fns.ts`, `project-queue.ts` | flat | co-located `.test.ts` |
| hoppscotch backend (80k, 2026-09-30) | `src/<kebab>` | singular (`team`, `user`, `user-collection`) | `team.service.ts`, `team.resolver.ts` | flat | co-located `.spec.ts` |
| twenty server (57.8k, 2026-10-01) | `src/engine/core-modules/<kebab>` plus `src/modules/` | singular (`user`, `workspace`) | `user.entity.ts`, `user.resolver.ts` | `dtos/ services/ utils/` (type-sliced inside the module) | – |
| novu api (40k, 2026-10-01) | `apps/api/src/app/<kebab>` | mixed | `subscribersV1.controller.ts` | `usecases/<use-case>/` (vertical slices), `dtos/`, `e2e/`, `unit/` | inside the feature |
| cal.com api v2 (48.8k, 2026-09-20) | `src/modules/<kebab>` | plural (`users`) | `users.module.ts`, `users.repository.ts` | `inputs/ outputs/ services/` | – |
| ghostfolio api (9.4k, 2026-10-01) | `apps/api/src/app/<kebab>` | mixed (`account`, `activities`) | `account.controller.ts` | flat | co-located `.spec.ts` |
| brocoders/nestjs-boilerplate (4.4k, 2026-08-08) | `src/<plural>` | plural (`users`, `statuses`) | `users.service.ts` | `domain/`, `dto/`, `infrastructure/persistence/{relational,document}` | – |
| Sairyss/domain-driven-hexagon (15k, 2024-05-14) | `src/modules/<singular>` plus `src/libs` | singular | `user.module.ts`, `user.mapper.ts` | `commands/ queries/ domain/ database/ dtos/` | – |
| stemmlerjs/ddd-forum (2.1k, 2023-06-10) | `src/modules/<plural>` plus `src/shared/{core,domain,infra,utils}` | plural | – | `domain/ useCases/ repos/ mappers/ infra/http/` | – |
| practicajs/practica (1.7k, 2025-03-09) | `services/order-service` plus `libraries/{logger,error-handling,configuration-provider,…}` | kebab | – | `entry-points/ domain/ data-access/` | `test/` per component |
| edwinhern/express-typescript (1.25k, 2026-03-25) | `src/api/<singular>` plus `src/common/{middleware,models,utils}` | singular | camelCase `userController.ts` | flat | `__tests__/` |
| documenso `packages/lib/server-only` (2026-10-01) | `<singular>/` | singular | per use case: `create-user.ts`, `get-user-by-id.ts` | flat functions (VSA-ish) | – |
| outline server (40.8k, 2026-10-01) | **type-sliced** `models/ commands/ presenters/ policies/` plus `routes/api/<camelPlural>/` | – | – | – | co-located `.test.ts` |
| directus api (38k, 2026-10-01) | **type-sliced** `services/` (with `index.ts` barrel), `controllers/`, `database/{migrations,seeds}` | – | `users.ts` | – | co-located `.test.ts` |

What the survey shows:
- **Kebab-case directories are universal.** Singular vs plural is split. Singular-leaning: hoppscotch, twenty, infisical, immich stems, Sairyss, edwinhern, documenso. Plural: Nest docs, cal.com, brocoders, ddd-forum. n8n, novu and ghostfolio are mixed.
- **`<stem>.<role>.ts` dominates backend TS** (Nest docs, immich, hoppscotch, twenty, n8n's 2025-26 guide). The hyphen form `<stem>-<role>.ts` (Unleash, Infisical) is the minority.
- **Co-located tests dominate.**
- **Two large, active, high-profile repos are mid-migration from type folders to feature folders (n8n, Unleash), and the old and new coexist.**
  - Unleash `features/segment/createSegmentService.ts` still imports `SegmentService` from `../../services/index.js`.
  - The same production file imports `../../../test/fixtures/fake-segment-store.js` [S35].
  - This is the "stalled manual migration" story to pitch against. When to start the migration is out of scope; whether it stalls is the point. The test-fixture import is a ready-made example of a finding the tool should surface and not fix.
- n8n keeps **migrations centralized** even for modules ("As an exception, migrations remain centralized") [S17], which backs the never-touch list.
- n8n registers controllers by **side-effect import** (`await import('./my-feature.controller')`) [S17]. Side-effect edges must be preserved as their own edge kind.

### 1c. State of boundary tooling (2026-10)

| Tool | Version / activity | Fit |
|---|---|---|
| dependency-cruiser [S22] | 18.5.0, commit 2026-10-01 | **Primary.** Standalone, JS and TS. Regex rules with **group matching** (`pathNot: "^src/modules/$1/"`). `scope: "folder"` handles **folder-level `circular`**, i.e. module-level cycles. `dependencyTypes` includes type-only. `--baseline` writes `.dependency-cruiser-known-violations.json` (recommended since 18.3.0). Graph reporters can feed the before/after visuals. |
| eslint-plugin-boundaries [S23] | 7.2.0 (2026-08-09). v6 2026-03, v7 2026-07 | Editor feedback. Single `boundaries/dependencies` rule with `policies`; `element-types`, `entry-point`, `external` and `no-private` are deprecated. **The API churns heavily, so pin the major version.** Baseline via ESLint bulk suppressions (`eslint-suppressions.json`, ESLint ≥ 9.24, count per file and rule) [S25]. |
| Sheriff [S24] | core 0.20.0, commit 2026-09-29 | Tag-based `depRules`, path placeholders (`src/app/<domain>/<type>`), barrel or **barrel-less (`internal/`)** modules. Still 0.x, with an Angular-flavored community. |
| Nx enforce-module-boundaries [S26] | – | **Project-level only.** Not applicable inside a single-package app. |

---

## 2. Step ladder

Every rung is its own commit series; R1 is one commit per module. Certificate items C1–C7 are the kickoff list. New certificate items I'm proposing:
- **C8** emitted-file-list equality modulo pathMap (`tsc --listEmittedFiles`). Without an explicit `rootDir`, tsc infers the common root, and moves can shift `dist/` layout under `package.json` `main`.
- **C9** test-set equality modulo pathMap (`jest --listTests` / `vitest list`), plus `--ci` so missing snapshots fail instead of being silently written.
- **C10** a string-literal glob/path scan **in source code**, not just configs. Examples: swagger-jsdoc `apis: ['src/routes/v1/*.js']` in hagopj13's `docs.route.js` [S32], awilix `loadModules([...])` [S30], `@fastify/autoload` dirs [S31].
- **C11** CODEOWNERS and path-keyed configs (Jest `coverageThreshold` path keys, `nest-cli.json` assets, `.sequelizerc`, `package.json` `imports` `#subpaths`) keep the same match sets.

| # | Rung | What changes | Preconditions | Certification | Value to a senior reviewer | Risk | Verdict |
|---|---|---|---|---|---|---|---|
| R0 | Preflight + pin set | Nothing. Inventory, tsc/test baseline, resolved graph, hazard scan, pinned set, table-access matrix (§5) | TS; type-sliced; tests runnable | n/a (it is the baseline) | Pinned set and decline reasons show judgment | – | **MVP** |
| R1 | Group into feature modules | `src/controllers/user.controller.ts` → `src/modules/user/user.controller.ts`, **basename kept**. Only single-owner files move; ambiguous or contested files stay | Not pinned; no location-sensitive code (or moved together with its targets); glob match sets preserved | **Mechanical:** C1–C11. Moved files' own relative specifiers change, so present the diff as `git diff -M` moves plus a specifier-only edit list | **Highest.** The tree screams the domain; cohesion becomes visible; reviewable as renames | Mechanical risk low. **Plan risk is the real risk** | **MVP** |
| R2 | Residual consolidation | `utils/`, `middlewares/`, `config/`, `validations/` leftovers → `src/shared/` (pure, ≥2 consumers) or `src/platform/` (plumbing); single-consumer residue → into its module | Same as R1; composition roots stay | Mechanical, same as R1 | High. Kills the `utils/` dumping ground and makes plumbing explicit | Low | **MVP** |
| R3 | File renames | `userController.ts`/`UserController.ts`/`user_controller.ts` → `user.controller.ts`. Stem and role word kept; **only casing and separator normalized** (`dal` stays `dal`) | Parseable `<stem><role>`; role in a closed vocabulary; no filename observability | Mechanical plus a **filename-observability scan**: `__filename`/`path.basename`, awilix name-from-file [S30], logger names, `__snapshots__/<test>.snap` pairing, case-only renames on case-insensitive FS (two-step `git mv`) | Medium. Consistency, greppability, and it enables suffix-based layer rules | Low | **MVP, first to cut** |
| R4 | Boundary rules + baseline | New `.dependency-cruiser.cjs` and known-violations baseline (optionally an eslint-plugin-boundaries config). **No source edits; no package.json or lockfile edits** (run via pinned `npx`) | Final paths (run after R1–R3) | Config-only diff; `--validate` passes with the baseline; **anti-vacuity mutation check**: inject a synthetic forbidden import in a scratch copy and assert each rule fires (a regex typo would silently disable a rule) | **Very high.** Turns organization into encapsulation [S1]; freezes violations; "stays clean" proof | Very low | **MVP** |
| R5 | Inner-layer placement (layered profile) | `modules/order/{http,application,domain,infrastructure}/…` | A file goes into `domain/` **only if it has zero framework, ORM or I/O imports**; empty layers are not created | Mechanical (moves) | Mixed. Seniors read inner folders on an active-record codebase as ceremony | Low mechanically, **high on credibility** | **Stretch, opt-in** |
| R6 | Co-locate mirrored unit tests | `tests/unit/services/order.service.test.ts` → `src/modules/order/order.service.test.ts` | Unit tests only; integration/e2e never move; fixtures pinned | R1 plus C9, plus **C8 critically**: tests must not enter the `tsconfig.build` emit; `jest.mock`/`vi.mock` specifiers treated as edges; snapshots co-moved | Medium | Medium: silent test drop, build-output drift | **Stretch** |
| R7 | Type-only shared-kernel split | Split `types/index.ts` interfaces/type aliases per consumer module or into `shared/` | Declarations are `interface`/`type` only; **no `enum`, `const enum` or `namespace`** (runtime values) | Types are erased, so **emitted JS is identical modulo specifiers** (strong oracle). Watch `verbatimModuleSyntax` import forms [S34] | Medium | Low | **Stretch** |
| R8 | Split mixed/god *files* (pure functions) | Move top-level function declarations to the owning module's file; re-export or rewrite importers | Source file has no top-level side effects; no shared module-scope mutable state; no decorators or static blocks on moved classes | Symbol-move certificate: per-declaration AST identity; importers resolve each symbol to the same declaration; new-file evaluation timing irrelevant because of the purity precondition | High (makes god files visibly decomposable) | Medium; the checker work is non-trivial | **Stretch, late**. MVP **reports** a per-export affinity table instead |
| R9 | Public-API barrels (add or dissolve) | Add `modules/x/index.ts`; route importers through it; or dissolve legacy `services/index.ts` | – | **Not certifiable.** Changes graph and evaluation order: engines can't skip modules because of "globals or module execution order" [S18]; cycles cause TDZ `ReferenceError` [S21]; barrel cycles crash bundlers [S19] | Low. Performance is negative (Atlassian: 75% faster builds after removal, 2025-06-26 [S20]) | High | **Never (hackathon).** Use config allow-lists |
| R10 | Symbol renames | `UsersService` → `UserService`, etc. | – | Binding-aware plus name-observability. Class names are persisted: Sequelize `modelName` = `this.name`, `tableName` = pluralize(name) [S27]; TypeORM `tableName = userSpecifiedName ?? snakeCase(targetName)` [S28]; Swagger/GraphQL schema names; `err.constructor.name` in responses; Nest `@Inject('…')` strings | Low (cosmetic) | High (silent DB/API change) | **Never.** Log inconsistencies as findings |
| R11 | Dependency inversion via ports | Interface in the module, adapter in infrastructure, wiring in the composition root | – | Needs a behavioral oracle. Call sites, construction, transaction propagation (CLS), error wrapping and `this` all change. In Nest, the constructor param type *is* the DI token, so an interface breaks DI | Highest conceptually | High | **Never as code.** Stretch: the report emits **draft port signatures** per violation, as LLM text, uncertified |
| R12 | God-class split / dedup / per-use-case VSA | Split `UserService` methods into handlers; merge duplicate utils | – | Oracle only (kickoff: "Not certifiable") | High | High | **Never** |

Ordering: R0 → R1 (per module) → R2 → R3 → R4. Rules are generated last because they key on the final paths and suffixes. R5–R8 are optional after R4, each followed by rule regeneration.

---

## 3. Never-touch list

"Pinned" means no move, no rename, no content edit, except where noted. Importers of pinned files still get specifier rewrites. If a never-touch file imports a file that is about to move, the default is to **pin the target too**, with a per-repo flag allowing specifier-only edits.

| Item | Detection | Why |
|---|---|---|
| Entrypoints | `package.json` `main`/`module`/`bin`/`exports`/`types`/`files`, `scripts` (`node dist/x.js`, `ts-node src/x.ts`), Dockerfile `CMD`/`ENTRYPOINT`/`COPY`, Procfile, PM2 `ecosystem.config`, `serverless.yml` handlers, `nodemon.json`, `nest-cli.json` `entryFile`/`sourceRoot`, CI workflows | The path is a contract with an external runner that tests can't see. |
| Published import surface | Everything reachable from `exports`/`main`/`types` of a package that is published or consumed in a workspace | External importers are unknown. List them as residual risk (kickoff C7). |
| Migrations, seeders and their config | `migrations/`, `seeders/`, `.sequelizerc`, TypeORM `migrations` globs, `knexfile`, `prisma/migrations/*` | The tool records **filenames** or **class names** in the DB (SequelizeMeta, knex_migrations, typeorm `migrations`, `_prisma_migrations`). Renames cause re-runs or "missing migration" errors on live DBs, and order is filename-sorted. n8n keeps them centralized even for modules [S17]. Migrations importing app models is itself a finding. |
| Convention- or glob-loaded files | sequelize-cli `models/index.js` (`fs.readdirSync(__dirname)` plus `associate()` [S29]); TypeORM/sequelize-typescript `entities`/`models` globs; routing-controllers `controllers` globs; awilix `loadModules` (registers under the file name [S30]); `@fastify/autoload` (`dirNameRoutePrefix` defaults to `true`, so **folder names become URL prefixes** [S31]); swagger-jsdoc `apis` globs [S32]; job/queue folder loaders; i18n locale dirs; email/view templates (`app.set('views')`, `path.join(__dirname,'../templates')`) | Membership, order, URL prefixes and DI names come from paths the import graph doesn't see. Move only as an intact unit with the loader, or when C5/C10 prove set equality. |
| Ambient declarations | `*.d.ts`, `declare global`, `declare module 'express'` (the `req.user` augmentation), `typeRoots` | Included by tsconfig `include`/`typeRoots`, not by imports. |
| Generated code | Prisma client output, `*.generated.ts`, `__generated__/`, OpenAPI/proto stubs, codegen configs | Overwritten on regeneration; the output path lives in the generator config. |
| Oracle configs | tsconfig*, jest/vitest/mocha, eslint, babel/swc, tsup/webpack/esbuild, `.env*` | Editing the oracle invalidates the proof. Only path-carrying entries may change, and only with match-set equality (C5/C11). |
| Test oracle: integration/e2e tests, fixtures, snapshots, test utils | `tests/integration`, `test/e2e`, `__snapshots__`, `fixtures/`, `setupTestDB` | Don't move the oracle in the same run that it certifies.<br>Fixtures are referenced by `__dirname` strings.<br>**A Jest test moved without its `.snap`, run without `--ci`, writes a fresh snapshot and passes vacuously.** |
| Location-sensitive files | `__dirname`, `__filename`, `import.meta.url`, `process.cwd()`-relative paths, `require.resolve`, `require(variable)`, non-literal `import()`, `new Worker('./…')`, `child_process.fork`, `express.static(path.join(__dirname,…))`, `readFileSync('./schema.graphql')` | Behavior depends on the file's own location (kickoff C4). Pin, or move together with the targets. |
| Composition roots (pinned in MVP, movable later) | `app.ts`, route mount tables (`routes/index.ts`), ORM association hubs (`models/index.ts`), DI containers, job schedulers | They legitimately import many modules, so their content stays fixed (registration order = behavior). Relocating them is low value. |
| Pre-existing barrels | `services/index.ts` (immich, directus, Unleash) | Keep them as legacy facades with rewritten specifiers. Dissolving them changes evaluation order (R9). |
| Non-TS path-coupled assets | `.graphql`, `.sql`, `.hbs/.ejs/.pug`, `.json` data, `.proto`, static assets | Loaded by path string. |
| Dependency manifests | `package.json` deps, lockfiles, `tsconfig` `paths` (**no new aliases**: an alias needs consistent edits in tsconfig, the runtime resolver, Jest `moduleNameMapper`, the bundler and `_moduleAliases`) | Out of scope; multi-config consistency is unprovable. |
| Formatting and content | No prettier, no `eslint --fix`; moved file bytes are identical except specifiers. Specifier style is preserved (relative stays relative, ESM `.js` extensions kept as Unleash uses them, alias stays alias if it still covers the target) | Diff confinement (C1) and reviewability. |
| Workspace boundaries | Other workspace packages, `node_modules`, `vendor/`, submodules | Outside the support envelope. |

---

## 4. Naming and target layout

### 4a. One default profile, `feature-flat`

```
src/
  modules/<module>/          # kebab-case, SINGULAR concept/capability name: user, order, payment, notification, auth
    <stem>.<role>.ts         # role from the repo's own vocabulary, closed set: controller|route(s)|service|model|entity|
                             # repository|dal|store|validation|validator|schema|dto|middleware|mapper|types|constants|
                             # errors|job|worker|listener|subscriber|policy|guard|resolver|gateway
    <stem>.<role>.test.ts    # only if it was already co-located (it moves with its subject in R1)
  shared/                    # shared kernel: pure (no I/O, no framework), ≥2 module consumers; files named by concept
  platform/                  # process-wide plumbing: config, database, logger, http (generic middleware), queue, mail transport
  <composition roots>        # index.ts/server.ts (pinned), app.ts, route mount table, ORM association hub: stay in place
```

Why each choice:
- **`src/modules/` root rather than `src/<module>`.**
  - It gives one regex for all generated rules (`^src/modules/([^/]+)/`).
  - It separates domain from `shared/`, `platform/` and the composition roots.
  - n8n, cal.com, Sairyss, ddd-forum and twenty use it.
  - Screaming still holds: `modules/` lists only domain nouns.
- **Singular.**
  - Type-sliced repos already have singular stems (`userController`, `User`, `user.service`), so module name = stem and R3 needs no stem changes.
  - Capability modules (`auth`, `billing`, `search`) don't pluralize, so singular is the only rule that stays consistent.
  - It avoids irregular plurals (brocoders literally has `statuses/`).
  - DDD module names come from the ubiquitous language of aggregates and capabilities [S9].
  - The ecosystem is split, so this is a choice, not a consensus.
- **`<stem>.<role>.ts`.** It's the dominant backend convention [S13, S17; immich, hoppscotch, twenty]. It also lets boundary rules classify the layer **by filename**, which removes the need for inner folders.
  - Angular v20 removed suffixes, but that is a frontend/IDE argument [S14].
  - R3 normalizes only shape. It keeps the repo's role word (`dal`, `store`, `repository`) and never rewrites semantics.
- **Banned module names** (reject at plan validation): `common, core, misc, general, helpers, utils, lib, base, manager, shared, platform`, plus technical words (`controllers`, `services`). `core` also collides with the DDD "core domain". Module names must come from the repo's own vocabulary: route prefixes, table/model names, file stems. **The LLM doesn't invent business terms.**

**Configurability.** Ship the one default plus four knobs:
- `moduleRoot` (`src/modules` | `src`)
- `moduleNumber` (`singular` | `plural` | `preserve`)
- `fileNaming` (`dot-role` | `preserve`; `preserve` skips R3)
- `layout` (`flat` | `layered`)

Demo only the default. The knobs exist to make the support envelope honest and to prove there are no repo-specific code paths. Opt-in `layered` naming is `http/ application/ domain/ infrastructure/`:
- `http` beats `api`, `presentation` or `interface`: it's concrete, and `interface` collides with TS.
- `infrastructure` follows DDD/CA/Grzybek/brocoders. It's free to use as an inner name because the top-level plumbing folder is `platform/`, not `infrastructure/`.

### 4b. Before: Express + Sequelize (TS, hagopj13-style, Model.init per file, `models/index.ts` hub)

```
src/
├─ index.ts                      # entrypoint (package.json "main": "dist/index.js"), starts cron
├─ app.ts                        # express(); app.use('/v1', routes); error handlers
├─ config/  config.ts  logger.ts  database.ts  passport.ts (JWT strategy, loads User)  roles.ts
├─ controllers/  auth.controller.ts  user.controller.ts  order.controller.ts
│                payment.controller.ts       # incl. Stripe webhook → orderService.markPaid
├─ services/   index.ts (barrel)  auth.service.ts  token.service.ts  email.service.ts
│              user.service.ts  order.service.ts  payment.service.ts  notification.service.ts
├─ models/     index.ts (imports all models, wires associations, re-exports)
│              user.model.ts  token.model.ts  order.model.ts  orderItem.model.ts
│              product.model.ts  payment.model.ts  notification.model.ts
├─ routes/v1/  index.ts (mount table)  auth.route.ts  user.route.ts  order.route.ts  payment.route.ts
│              docs.route.ts             # swagger-jsdoc apis: ['src/routes/v1/*.ts']
├─ middlewares/ auth.ts (requireAuth)  validate.ts  error.ts  rateLimiter.ts
├─ validations/ auth.validation.ts  user.validation.ts  order.validation.ts  custom.validation.ts
├─ utils/      ApiError.ts  catchAsync.ts  pick.ts  money.ts (order + payment)
├─ jobs/       orderReminder.job.ts      # imported by index.ts
└─ types/      express.d.ts              # declare global Request.user
migrations/  seeders/  .sequelizerc
tests/ integration/{auth,user,order}.test.ts  unit/services/order.service.test.ts  fixtures/  utils/
```

### 4c. After: default `feature-flat`, rungs R1–R4

```
src/
├─ index.ts                      # PINNED entrypoint; specifiers only
├─ app.ts                        # composition root; specifiers only
├─ routes/v1/                    # PINNED as a unit: swagger-jsdoc glob in docs.route.ts (C10) → finding F-3
│  index.ts docs.route.ts auth.route.ts user.route.ts order.route.ts payment.route.ts
├─ models/index.ts               # composition root + legacy barrel: re-exports from modules, wires associations
├─ services/index.ts             # legacy barrel kept; specifiers rewritten; finding: hides module coupling
├─ modules/
│  ├─ auth/      auth.controller.ts  auth.service.ts  auth.validation.ts
│  │             token.service.ts  token.model.ts
│  │             auth.middleware.ts        # ← middlewares/auth.ts (R3). PUBLIC: every module's routes use it
│  │             passport.ts  roles.ts     # ← config/ (domain semantics, not plumbing)
│  ├─ user/      user.controller.ts  user.service.ts  user.model.ts  user.validation.ts
│  ├─ order/     order.controller.ts  order.service.ts  order.validation.ts
│  │             order.model.ts  order-item.model.ts   # join/child: written only by order.service
│  │             product.model.ts          # single consumer → here; finding: candidate module "catalog"
│  │             order-reminder.job.ts
│  ├─ payment/   payment.controller.ts     # webhook → order.service: back-edge payment→order (frozen, finding)
│  │             payment.service.ts  payment.model.ts
│  └─ notification/ notification.service.ts  notification.model.ts
│                email.service.ts          # 2 domains (auth reset mails + order mails): owner = notification; split candidate
├─ shared/       api-error.ts  catch-async.ts  pick.ts  money.ts  custom.validation.ts
├─ platform/     config.ts  logger.ts  database.ts
│  └─ http/      validate.middleware.ts  error.middleware.ts  rate-limiter.middleware.ts
└─ types/express.d.ts            # PINNED (ambient)
migrations/ seeders/ .sequelizerc  # PINNED
tests/                           # untouched except specifiers (the oracle stays put)
.dependency-cruiser.cjs  .dependency-cruiser-known-violations.json   # R4
```

**Variant: sequelize-cli `models/index.js` readdirSync loader** [S29]. `models/` is pinned as a unit; it is in effect a shared persistence kernel. Modules contain controllers, services and validations only. The report puts this at the top: "data model is a shared kernel; ownership matrix below". **This is the case for corupta's private repo** (~100 Sequelize models).

**TypeORM delta:**
- `*.entity.ts` and repositories go into modules.
- If the DataSource `entities` glob is `src/**/*.entity.ts`, moves are free under C5.
- If it's a fixed folder (`src/entity/*.ts`), either pin, or rewrite the glob with proven set equality.
- Migrations are pinned.

**Prisma delta:**
- `prisma/schema.prisma` and `prisma/migrations/` are pinned.
- There are no model files.
- The client singleton goes to `platform/database/prisma.ts`.
- Ownership comes from the `prisma.<model>.<op>` call-site matrix.

### 4d. Opt-in `layered`, same `order` module

```
src/modules/order/
├─ http/            order.controller.ts  order.validation.ts
├─ application/     order.service.ts  order-reminder.job.ts
└─ infrastructure/  order.model.ts  order-item.model.ts  product.model.ts
   (no domain/: zero files are free of sequelize/express imports. That is reported as a finding, not shown as an empty folder.)
```

---

## 5. Shared and cross-cutting code: decision procedure

These rules are deterministic, applied in order per file, after seeding modules from route prefixes, model names and file stems:

1. **Pinned** (§3): stays.
2. **Composition root** (imports ≥2 modules and registers or wires them: mount tables, association hubs, DI containers, schedulers): stays.
3. **Stem match** to a module (`userController`, `User` model, `user.route`): goes to that module, unless more than half of its resolved edges go to one other module (flag).
4. **Consumer analysis.** Attribute through barrels by resolving symbols to their declaring files, then count importing modules:
   - **0 consumers**: don't move; finding "unreachable from entrypoints". Never delete.
   - **Exactly 1 module**: goes into that module, even if it came from `utils/` or `middlewares/` ("maximize coupling in a slice" [S5]).
   - **≥2 modules**:
     - *Domain-semantic* (imports a module's model, carries domain vocabulary, writes data): goes to the **data-owner module**, and others depend on it via public files. Example: `requireAuth` goes to `auth`.
     - *Pure* (no I/O, framework or module imports): goes to `shared/`, under a concept filename (`money.ts`, not `utils.ts` [S14]).
     - *Plumbing* (wraps db client, logger, config, http server, cache, queue, mail transport; generic middleware like error, validate, rate limit, cors, request logging): goes to `platform/`.
5. **Mixed files** (exports with different owners: `constants.ts`, `types/index.ts`, `helpers.ts`): owner by majority of export usage, plus a "split candidate" finding with a per-export affinity table. Type-only splits are R7; pure-function splits are R8.
6. **Specific placements:**
   - Errors: base `ApiError`/`AppError` → `shared/`; `OrderNotFoundError` → `order/`.
   - Config: the env loader → `platform/config.ts`; module-specific config sections stay in it, because splitting is a file split (finding).
   - Validators: endpoint schemas → module; generic `validate()` → `platform/http/`; custom Joi/zod rules used by ≥2 modules → `shared/`.
   - Logger and DB connection → `platform/`.
7. **Guardrails (generated rules):**
   - `shared/` is a leaf: it imports nothing from `modules/` or `platform/`.
   - `platform/` never imports `modules/`.
   - Only composition roots may import multiple modules freely.
   - The report tracks `shared/` size, and any `shared/` file whose consumer count drops to 1.
   - The "rule of three" [S11] is for *creating* abstractions. Placement uses ≥2 because a file can't live in two folders.

### Entity ownership: a model used by many modules

- **What DDD prescribes:**
  - Each context models its own view: Member, Payer, User in separate modules [S7, S8].
  - Aggregates reference each other by ID [S10].
  - An explicit Shared Kernel only by agreement [S9].
  - A module owns its data [S6].
- **What the tool can do without behavior change:** it can't split a model into projections or remove ORM associations, because the queries would change. So:
  1. **Build a table-access matrix** (module × model, with reads and writes) from static call sites:
     - Sequelize `create/update/destroy/bulkCreate/save` **plus association mixins** (`user.addRole`, `setX`, `removeX`), which write join tables implicitly;
     - TypeORM `Repository<E>` and `EntityManager` calls;
     - Prisma `prisma.<model>.<op>`.

     This is planner input and the most convincing reviewer artifact ("this is what your shared database looks like").
  2. **Owner = the single writer.** With no writer, owner = the stem-named module. With several writers, the planner decides with a rationale, and the report flags a "multi-writer table".
  3. **Readers in other modules** import the model through the owner's public files. The cross-module edge is recorded and frozen as "shared-database coupling".
  4. **ORM relation edges** (`@BelongsTo(() => User)`, `User.hasMany(Order)` inside model files) produce model↔model cycles across modules. Report them separately as **schema edges**, apart from code edges, and freeze them.
  5. **Convention-loaded models** (sequelize-cli) cannot be distributed. They remain a declared shared persistence kernel.

---

## 6. Hard cases a senior reviewer will judge

1. **Cycles between would-be modules.**
   - Compute SCCs on the module quotient graph for every candidate plan. This is the plan objective: penalize inter-module back-edges, singleton modules and `shared/` bloat.
   - **Dense SCC** (several edges in both directions, or shared writes): merge. They are one module today; splitting them only on paper is a lie.
   - **Sparse SCC**: keep the split, list the back-edges as findings, and freeze them in the baseline.
   - Report `import type` edges separately; they are erased at runtime (depcruise `dependencyTypes`).
   - Moves never add or remove file-level cycles (graph isomorphism). They only change which cycles cross module lines.
   - **A pure move can break a module cycle.** Example: the payment webhook handler that calls `order.service` is orchestration. Moving it into a process module (`checkout/`) leaves `payment ↛ order`, provided `payment.service` itself doesn't import order.
   - Suggested two-tier rule: process modules (orchestrate, own no tables) may depend on entity modules (own tables), never the reverse. This is the FSD features→entities idea [S15] applied server-side.
2. **God services.**
   - The file goes to the max-affinity module (fan-in from assigned files plus write ownership).
   - The report shows a per-function affinity table ("7 of 31 functions are only called from `order/`") and a suggested split.
   - Splitting pure functions is R8 (stretch); splitting classes is R12 (never). This is "make the bug obvious, then resist" in its purest form.
3. **Many-to-many join models.**
   - Owner = the writing module. Mixins count, so `user.addRole()` makes `UserRole` an auth/access concern.
   - If both sides write, the relationship is a concept of its own: a candidate module (`membership`, `enrollment`) or a human decision.
   - String `through: 'UserRoles'` tables have no file to move; report them in the matrix.
4. **Auth/user entanglement.**
   - Default split:
     - `auth` owns credentials, tokens, sessions, strategies, `requireAuth`, roles/permissions.
     - `user` owns profile CRUD and the `User` model.
   - Expect `auth → user` (find by email, create on register) and `user → auth` (routes use `requireAuth`). That is a mutual dependency: freeze it and report it; don't merge by default.
   - The planner may merge into `identity` if density is high, which is closer to Grzybek's `UserAccess` [S7].
   - Also report:
     - **runtime-only coupling the static graph misses**: passport strategies registered in `app.ts` and resolved by name in middleware (hagopj13 pattern);
     - the global `Request.user` augmentation coupling every module to the User shape.
5. **"common" dumping grounds** (`utils/ helpers/ common/ lib/`): handled by §5 rule 4, file by file, with export-level reporting. Success metric: share of files left in `shared/`, and zero `utils.ts`/`helpers.ts` names after R3.
6. **Where tests go.**
   - The ecosystem co-locates: immich, Unleash, Infisical, Outline, Directus, hoppscotch, Nest; n8n uses `__tests__/` in the module; Angular says co-locate [S14].
   - Policy:
     - (a) already co-located: moves with its subject in R1;
     - (b) mirrored unit trees: stay in MVP, R6 later;
     - (c) integration/e2e: **never move**, because they test the external contract and are the oracle;
     - (d) fixtures and test utils: pinned.
   - Hazards: tsconfig.build include/exclude and inferred `rootDir` (C8); Jest `roots`/`testMatch` (C9); path-keyed `coverageThreshold`; `jest.mock`/`vi.mock`/proxyquire string specifiers (rewrite as edges); snapshot pairing plus `--ci`.
7. **One file, two domains.**
   - A file has exactly one owner. In order: stem → incoming-edge majority → write ownership → planner with rationale.
   - Non-owners depend on it via public files, and the report adds a split-candidate finding.
   - Orchestrators spanning ≥3 modules (checkout) are the strongest case for a process module.
8. **Hidden coupling behind legacy barrels.** `import { orderService } from '../services'` keeps working after the moves, so the coupling is invisible in specifiers.
   - The analyzer must attribute edges through re-exports to the declaring module.
   - Whether dependency-cruiser does this natively is UNVERIFIED. If it doesn't, the tool's own analysis feeds the report and the rule allow-lists.
9. **NestJS targets** (e.g. immich: type-sliced, barrels, `app.module.ts` arrays).
   - Move files only. **Never generate `*.module.ts`.** A Nest module scopes DI, so providers would become unresolvable unless exported [S13].
   - "Feature folder" ≠ "Nest feature module". Say so in the report.

---

## 7. The kickoff A/B/C table, challenged

The table is right on verification but misses two axes: **plan-quality risk** and **label truthfulness**. Revised:

| | A. Literal CA top-level folders | **B′. Feature modules (flat, role-suffixed) + declared module DAG + frozen baseline** | B-layered. B′ + inner CA folders | C. + dependency inversion |
|---|---|---|---|---|
| What changes | Labels only; still package-by-layer (kickoff positioning, [S1]) | Cohesion; ownership; encapsulation via rules; violations measured and frozen | Plus a layer claim per file | The dependency rule itself |
| Certificate | Mechanical | Mechanical (moves) + config-only (rules) + anti-vacuity mutation | Mechanical | Behavioral oracle only |
| Plan risk | Low | **Medium: module assignment is the product** | High: classification on active-record code is mostly "violation" | High |
| Label truthfulness | False (screams layers) | True by construction (folder = owner) | Often false (`domain/` with ORM classes) unless the zero-framework-import rule holds | True |
| Senior value | Negative: cargo cult | High | Mixed, polarizing | Highest, unprovable by Oct 30 |
| Verdict | Use only as the **generic-agent foil** in the video (likely what a naive agent produces) | **MVP default** | Opt-in profile | **Report-only draft ports** (stretch). No code changes |

Pitch framing, consistent with "make the bugs obvious, then resist":
> We don't claim Clean Architecture. We deliver Screaming Architecture, module boundaries the compiler toolchain enforces, and a measured, frozen inventory of every dependency-rule violation, with a drafted port for each. That inventory is the precondition for Clean Architecture.

### Generated rules for B′ (dependency-cruiser sketch, syntax per [S22]; not run)

```js
forbidden: [
  { name: 'no-module-cycles', scope: 'folder', from: { path: '^src/modules/[^/]+/' }, to: { circular: true } },
  // declared module DAG: one rule per module, allow-list = today's module deps minus back-edges (back-edges → baseline)
  { name: 'order-allowed-deps', from: { path: '^src/modules/order/' },
    to: { path: '^src/modules/', pathNot: '^src/modules/(order|user|notification|auth)/' } },
  // public API allow-list = files imported cross-module today (barrel-less, like Sheriff internal/ or Spring Modulith)
  { name: 'public-api-only', from: { path: '^src/modules/([^/]+)/' },
    to: { path: '^src/modules/', pathNot: ['^src/modules/$1/', '<generated public-file regex>'] } },
  { name: 'shared-is-leaf', from: { path: '^src/shared/' }, to: { path: '^src/(modules|platform)/' } },
  { name: 'platform-not-domain', from: { path: '^src/platform/' }, to: { path: '^src/modules/' } },
  { name: 'controller-not-to-persistence', from: { path: '\\.controller\\.ts$' },
    to: { path: '\\.(model|entity|repository|dal|store)\\.ts$' } },              // Brown's rule [S1]
  { name: 'persistence-is-inner', from: { path: '\\.(model|entity)\\.ts$' },
    to: { path: '\\.(service|controller|routes?)\\.ts$' } },
  { name: 'service-not-http', from: { path: '\\.service\\.ts$' },
    to: { path: '\\.(controller|routes?)\\.ts$|node_modules/express/' } },
  { name: 'no-prod-to-test', from: { pathNot: '\\.(spec|test)\\.ts$|^tests?/' },
    to: { path: '\\.(spec|test)\\.ts$|^tests?/|fixtures/' } },                   // the Unleash pattern
]
```

Follow with `depcruise src --baseline` to write `.dependency-cruiser-known-violations.json`. CI fails only on new violations. Emitting an eslint-plugin-boundaries v7 config with `eslint --suppress-all` is a stretch for in-editor feedback.

---

## 8. Cross-track notes (checker and planner)

- **Additions to the certificate:**
  - C8 emitted-file list (inferred `rootDir` drift);
  - C9 test list plus `jest --ci`;
  - C10 string-literal globs and paths in *source*;
  - C11 CODEOWNERS and path-keyed configs;
  - filename-observability for R3;
  - side-effect `import './x'` as its own edge kind (n8n registration pattern [S17]);
  - preserve import forms exactly (`verbatimModuleSyntax` keeps `import {type X}` as a side-effect import [S34]);
  - ESM `.js` specifier style;
  - case-only renames.
- **ts-morph `move()`** updates relative import/export specifiers in the moved file and its importers [S33]. It does not claim to handle `jest.mock` strings, glob literals, configs or aliases, so those stay in the checker's scope.
- **Plan validator, deterministic, before execution:** banned names; no module under N files unless justified (N is a tunable heuristic); unassigned-file count; inter-module back-edges; `shared/` share; every multi-writer table flagged. Score K candidate plans with this.
- **Review UX:** present moved files as renames (`git diff -M`) plus a separate "specifier-only edits" list. Senior reviewers will check exactly that split.

## 9. UNVERIFIED / gaps

- Simon Brown's "Modular Monoliths" talk: not fetched (search budget exhausted). Brown is cited only via ch.34.
- Whether dependency-cruiser attributes dependencies **through** barrel re-exports to the declaring module.
- Vitest's snapshot-writing behavior in CI (Jest `--ci` is the known-safe flag).
- The NestJS GraphQL code-first type name defaulting to the class name: the docs examples imply it, but no explicit sentence was found.
- The base path for `jest.mock` specifier resolution. The fetched summary said "cwd", which contradicts the usual understanding of "like `require` from the test file". Treat these specifiers as import edges resolved by Jest's resolver and verify in the spike.
- The tsc CommonJS emit for `export *` (`__exportStar(require(…))`) and any change to `rootDir` defaults in TS 6/7: from memory, not checked this session.
- The Angular v20 release date (2025): from secondary sources [S14b].
- When Unleash's and n8n's migrations started: not checked. Only their current coexistence is observed.
- The `typeorm init` default folder names.
- The Vernon and Evans PDFs couldn't be machine-read. Their claims are the well-known rule names, attributed to those documents.

## 10. Sources

- S1 Brown, "The Missing Chapter", *Clean Architecture* ch.34 (Pearson 2017). Text via the bilingual transcription https://github.com/liaokongVFX/Clean-Architecture-zh/blob/master/docs/ch34.md
- S2 https://blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html
- S3 https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- S4 https://alistair.cockburn.us/hexagonal-architecture/
- S5 https://www.jimmybogard.com/vertical-slice-architecture/
- S6 https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer
- S7 https://github.com/kgrzybek/modular-monolith-with-ddd (tree: src/Modules/*/Domain)
- S8 https://martinfowler.com/bliki/BoundedContext.html
- S9 https://domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf · https://github.com/ddd-crew/context-mapping
- S10 https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf
- S11 https://phauer.com/2020/package-by-feature/
- S12 https://docs.spring.io/spring-modulith/reference/fundamentals.html
- S13 https://docs.nestjs.com/modules
- S14 https://angular.dev/style-guide · S14b https://www.angulartraining.com/daily-newsletter/2025/12/
- S15 https://feature-sliced.design/docs/reference/layers · https://feature-sliced.design/docs/reference/public-api
- S16 https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/projectstructre/breakintcomponents.md
- S17 https://github.com/n8n-io/n8n/blob/master/scripts/backend-module/backend-module-guide.md
- S18 https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/ (2023-10-08)
- S19 https://tkdodo.eu/blog/please-stop-using-barrel-files (2024-07-26)
- S20 https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files (2025-06-26)
- S21 https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
- S22 https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md · https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- S23 https://github.com/javierbrea/eslint-plugin-boundaries/blob/master/packages/eslint-plugin/CHANGELOG.md · https://www.jsboundaries.dev/docs/overview/
- S24 https://sheriff.softarc.io/docs/module_boundaries · https://sheriff.softarc.io/docs/dependency-rules
- S25 https://eslint.org/blog/2025/04/introducing-bulk-suppressions/
- S26 https://nx.dev/docs/features/enforce-module-boundaries
- S27 https://github.com/sequelize/sequelize/blob/v6/src/model.js (≈L923–1018: `modelName` defaults to the class name; `tableName` = pluralize)
- S28 https://github.com/typeorm/typeorm/blob/master/packages/typeorm/src/naming-strategy/DefaultNamingStrategy.ts (`userSpecifiedName ?? snakeCase(targetName)`)
- S29 https://github.com/sequelize/cli/blob/main/src/assets/models/index.js
- S30 https://github.com/jeffijoe/awilix (README, `loadModules`: "register… as the name of the file")
- S31 https://github.com/fastify/fastify-autoload (README, `dirNameRoutePrefix` default `true`)
- S32 https://github.com/Surnet/swagger-jsdoc · https://github.com/hagopj13/node-express-boilerplate/blob/master/src/routes/v1/docs.route.js
- S33 https://ts-morph.com/details/source-files
- S34 https://www.typescriptlang.org/tsconfig/#verbatimModuleSyntax
- S35 https://github.com/Unleash/unleash/blob/main/src/lib/features/segment/createSegmentService.ts
- Survey trees (each read from `https://github.com/<repo>/tree/<branch>/<path>` on 2026-10-01): immich-app/immich, n8n-io/n8n, Unleash/unleash, Infisical/infisical, hoppscotch/hoppscotch, twentyhq/twenty, novuhq/novu, calcom/cal.com, ghostfolio/ghostfolio, brocoders/nestjs-boilerplate, Sairyss/domain-driven-hexagon, stemmlerjs/ddd-forum, practicajs/practica, edwinhern/express-typescript, gothinkster/node-express-realworld-example-app, documenso/documenso, outline/outline, directus/directus, medusajs/medusa, ToolJet/ToolJet, logto-io/logto, w3tecch/express-typescript-boilerplate (last commit 2021-05-03), hagopj13/node-express-boilerplate (2023-08-12), lujakob/nestjs-realworld-example-app (2021-01-18)
