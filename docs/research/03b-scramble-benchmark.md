# Track 3b: scramble benchmark candidates, procedure and metrics

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

# Track 3b: scramble benchmark candidates, flatten procedure, and metrics

## 0. Method and headline findings

**Method.** Plan mode was active, so I made no clones and `/tmp/ac-research` was not created. I read every repo by streaming the codeload tarball (`curl https://codeload.github.com/<repo>/tar.gz/HEAD | tar tz` / `tar xzO <file>`). Commit dates come from the `github.com/<repo>/commits/HEAD.atom` feed and SHAs from `git ls-remote`. File counts are `.ts` files excluding `.d.ts`. "Tests" means files matching `.spec.` / `.test.` / `__tests__` / `test/` / `e2e`. WebSearch hit the shared 200-call cap partway through, so later discovery used GitHub topic pages, the arXiv API, Crossref and OpenAlex.

**Headline findings**
1. Mid-size TS backends that are already feature-modular and have offline tests are almost all NestJS. Of about 35 repos screened, 4 pass every criterion: hoppscotch-backend, ghostfolio api, ultimate-nest and vndevteam. All four are NestJS. hedgedoc backend also has offline tests but is half type-sliced.
2. Other frameworks:
   - **Hono:** usekaneo/kaneo qualifies, but has no tests (tsc-only).
   - **Koa:** only Midway-on-Koa (cool-admin-midway) qualifies, also with no tests.
   - **Express:** only gothinkster realworld (26 files, MIT only in package.json, no LICENSE file) and mgce modular-monolith (ISC in package.json only, 2022).
   - **Fastify:** nothing qualified.
   - **Proposal:** two tiers. Tier T (tests run offline, so the behaviour check is real) and Tier M (MoJoFM plus `tsc` only). That keeps the framework spread without pretending we have tests.
3. File names leak module names heavily (55% in hoppscotch, 50% in ghostfolio app/). This is realistic: type-sliced repos keep the entity name, e.g. Immich `server/src/services/album.service.ts`. So it is not cheating, but the benchmark must report a name-token baseline. Otherwise "MoJoFM 90" is free.
4. NestJS `*.module.ts` files encode the answer through their `imports` / `controllers` / `providers` arrays. A real type-sliced Nest repo (Immich) has one `app.module.ts` fed by type-folder barrels. Collapsing the modules is realistic, but it changes code, not just paths.
5. There is no JS implementation of MoJoFM on npm (registry search for "mojofm" returns nothing). ARCADE (`usc-softarch/arcade_core`, Java, USC licence) has MoJo/MoJoFM, a2a, c2c_cvg and TurboMQ. A TS port is about 200 lines, and MoJo can be checked against the README oracle (`distra.rsf → distrb.rsf = 383`).
6. No TS/JS ground-truth architecture dataset was found. The standard sets are Java/C/C++ (ArchStudio4, Bash, Chromium, Hadoop, ITK, OODT, Libxml2, HDC, HDF). This is a negative search result, so treat it as UNVERIFIED beyond arXiv, SARIF and Semref.

## 1. Ranked shortlist

| # | Repo (subtree) · SHA | Framework | Licence | Last commit | Non-test TS / tests | Feature modules | Tests offline? | Flatten difficulty | Tier |
|---|---|---|---|---|---|---|---|---|---|
| 1 | hoppscotch/hoppscotch `packages/hoppscotch-backend` · 63273f8e599e | NestJS 11 + GraphQL code-first + REST, Prisma 7 | MIT (root LICENSE; package.json says "UNLICENSED", a private-package marker) | 2026-09-30 | 189 / 19 | ~25 | Yes | Medium | T |
| 2 | ghostfolio/ghostfolio `apps/api` · 347cd06a4012 | NestJS, Prisma, Bull, Nx | AGPL-3.0 | 2026-10-01 | 323 / 57 | 22 + 13 under `app/endpoints/` | Yes (mocked) | Medium-hard | T |
| 3 | rubiin/ultimate-nest · 43c67b79d931 | NestJS + MikroORM | MIT | 2026-09-30 | 274 / 26 | 11 + shared | Unit tests yes; e2e uses testcontainers | Easy-medium | T |
| 4 | vndevteam/nestjs-boilerplate · cb6bea3df300 | NestJS + TypeORM + BullMQ | MIT | 2025-10-09 | 115 / 20 | 5 (+ background, mail) | Yes | Easy | T |
| 5 | hedgedoc/hedgedoc `backend` · 5dd94d5449e5 (branch `develop`) | NestJS + Knex | AGPL-3.0 | 2026-09-22 | 203 / 46 | ~15 | Yes (knex-mock + SQLite in-memory) | Hard (hybrid) | T* |
| 6 | docmost/docmost `apps/server` · b6434371ed5f | NestJS + Kysely | AGPL-3.0 (+ `ee/`) | 2026-09-30 | 412 / 32 | 17 under `core/` | Weak: stub tests | Medium | M |
| 7 | brocoders/nestjs-boilerplate · 9620f159eefe | NestJS, hexagonal inside each module | MIT | 2026-08-08 | 178 / 6 (e2e) | ~12 | No (docker) | Medium-hard | M |
| 8 | usekaneo/kaneo `apps/api` · b80818fe2e93 | **Hono** + Drizzle | MIT | 2026-10-01 | 467 (128 in `plugins/`) / 0 | ~25 + integrations | No tests | Hard (naming) | M |
| 9 | cool-team-official/cool-admin-midway · e545ef6f3b0c (branch `8.x`) | **Midway (Koa)** + TypeORM | MIT | 2026-07-17 | 139 / 0 | 9 | No tests | Hard (no name tokens) | M |
| 10 | mikro-orm/nestjs-realworld-example-app · 323699b42d8b | NestJS + MikroORM (MySQL) | MIT | 2026-09-29 | 40 / 3 | 4 | Partial | Easy | T-partial (G1 fixture) |

### Per-repo evidence

**1. hoppscotch-backend.** Strongest overall.
- **Layout:** `src/<feature>/`:
  - access-token, admin, auth, health, infra-config, infra-token, mailer, mock-server, orchestration/sort, posthog, prisma, published-docs, pubsub, shortcode
  - team, team-collection, team-environments, team-invitation, team-request
  - user, user-collection, user-environment, user-history, user-request, user-settings
  - Top-level shared type folders already exist: `guards/`, `decorators/`, `interceptors/`, `types/`, `plugins/`.
  - 6 root files, including `src/gql-schema.ts`, a central registry of all resolvers.
- **Tests:**
  - The `jest` block in package.json uses `rootDir: src`, ts-jest, and `moduleNameMapper ^src/(.*)$`.
  - Specs build services directly: `src/team/team.service.spec.ts` has `const mockPrisma = mockDeep<PrismaService>()` (jest-mock-extended), so they run offline.
  - `test/app.e2e-spec.ts` has its own config; ignore it.
- **Install friction (UNVERIFIED offline):** pnpm monorepo. `postinstall` runs `prisma generate` and `generate-gql-sdl`, which is `nest start` with `GENERATE_GQL_SCHEMA=true`.
- **Flatten stats:**
  - 25 `*.module.ts`; 111 of 202 non-root files start with their module name.
  - Collisions: `input-type.args.ts` ×7, `user.resolver.ts` ×4, `team.resolver.ts` ×2, `user-collection.resolver.ts` ×2, `input-types.args.ts` ×2, `helper.ts` ×5 (access-token, auth, infra-config, mailer, team-collection).
- **Trap:** `user-settings/user.resolver.ts` exports `UserSettingsUserResolver`. The file name says "user" but it belongs to user-settings, and there are four similar cases. This is ideal for testing names against the import graph.

**2. ghostfolio api.**
- **Two-level ground truth:**
  - `app/<f>`: access, account, account-balance, activities, admin, asset, auth, auth-device, cache, exchange-rate, export, health, import, info, logo, platform, portfolio (63 files incl. `calculator/`), redis-cache, subscription, symbol, user.
  - `app/endpoints/<f>`: ai, api-keys, asset-profiles, assets, benchmarks, data-providers, market-data, mcp, platforms, public, sitemap, tags, watchlist.
- **`services/<x>/` is already a type folder with one subfolder per service** (data-provider has 24 files, queues 15). Planning must decide whether these count as clusters or as shared.
- **Tests:**
  - `test:api` = `npx dotenv-cli -e .env.example -- nx test api`.
  - `apps/api/jest.config.ts` forces `TZ=UTC`.
  - The calculator specs `jest.mock('@ghostfolio/api/app/portfolio/current-rate.service', …)` and likewise for RedisCacheService and PortfolioSnapshotService, so they run offline.
- **Hazards:**
  - Alias `@ghostfolio/api/*` → `./apps/api/src/*` in `tsconfig.base.json`.
  - `jest.mock` string literals use alias paths, which is exactly the kickoff checker edge case.
  - 59 `*.module.ts`.
  - Collisions: `get-dividends.dto.ts` ×2, `get-lookup.dto.ts` ×2, `interfaces/interfaces.ts` ×4, `yahoo-finance.service.ts` ×2.

**3. ultimate-nest.**
- **Modules:** `src/modules/{auth, category, chat, health, newsletter, post, profile, shared, tags, token, twofa, user}`. Only 74 of 274 files are in modules; `common/` and `lib/` are large shared folders.
- **Entities are already centralised** in `src/entities` (15 files). Their ground truth needs a manual mapping, or exclude them.
- **Tests:**
  - Unit specs use `Test.createTestingModule` with `useValue` mocks from `@mocks` (`src/_mocks_`), e.g. `src/modules/user/user.service.spec.ts`. Offline.
  - `test/jest-e2e.json` with `testcontainers` in devDeps: exclude.
- **Hazards:** tsconfig paths `@modules/*`, `@entities`, `@mocks`; `dto/index.ts` and `dtos/index.ts` barrels ×7.

**4. vndevteam/nestjs-boilerplate.** The cleanest small fixture.
- **Modules:** `src/api/{auth, user, post, health, home}`, plus `background/queues/email-queue` and `mail`. No collisions; 5 module files.
- **Tests:**
  - `jest.config.json` has `rootDir: src`, `testRegex .*\.spec\.ts$`.
  - `user.service.spec.ts` uses `getRepositoryToken(UserEntity)` with `useValue`.
  - `auth.service.spec.ts` mocks ConfigService, JwtService and CACHE_MANAGER. Offline.
- **Hazard:** `moduleNameMapper` hard-codes one alias per folder (`^@/api(.*)$`, `^@/guards(.*)$` …). New type folders need new entries.

**5. hedgedoc backend.** Offline tests, but already half type-sliced.
- **Already type-sliced parts:** `backend/src/dtos/` holds 50 central DTOs, and the 21 controllers sit under `api/private/<f>/` and `api/public/`.
- **Tests:**
  - Unit tests use knex-mock-client (`src/users/users.service.spec.ts`, `mockKnexDb()`).
  - E2E defaults to `HEDGEDOC_TEST_DB_TYPE || 'sqlite'` with better-sqlite3 `':memory:'` (`backend/test/test-setup.ts`).
- **Hazards:** workspace deps `@hedgedoc/commons` and `@hedgedoc/database` must be built first. Controller collisions (me, notes, media, alias ×2, private vs public).
- **Recommendation:** use it as a "real hybrid" demo target, or as a scramble repo with a hand-made ground truth for `dtos/` and `api/`.

**6. docmost.**
- **Modules:** `core/{attachment, auth, casl, comment, favorite, group, label, notification, page, public-space, search, session, share, space, user, watcher, workspace}`, plus 13 `integrations/*`. `database/repos` (26 files) is centralised.
- **Tests:** at least some are Nest CLI stubs. `core/space/space.controller.spec.ts` lists only `providers: [SpaceService]` and checks `it('should be defined')`.
- **Licence check needed:** jest maps `@docmost/ee` → `src/ee`, and the enterprise code's licence and presence need checking.

**7. brocoders.**
- **Modules:** auth, auth-apple, auth-facebook, auth-google, files, home, mail, mailer, roles, session, social, statuses, users.
- **Hexagonal layers inside modules** (`infrastructure/persistence/{document,relational}`, `domain/`) cause collisions inside a single module: `files.service.ts` ×4, `files.module.ts` ×4, `file.repository.ts` ×3, `session.repository.ts` ×3; 16 in total.
- **Tests:** only `test/**/*.e2e-spec.ts`, run through `docker-compose.*.test.yaml`.

**8. kaneo (Hono).**
- **Modules:** activity, admin, billing, calendar-feed, column, comment, custom-field, external-link, invitation, label, notification(-preferences), project, search, task (34 files), task-relation, time-entry, user, workflow-rule, workspace, plus 8 `*-integration` folders and `plugins/`.
- **Naming:** each module has `index.ts` (router), `schema.ts`, `response.ts` and `controllers/<verb>-<entity>.ts`. That gives `index.ts` ×37 collisions, and only 2 of 455 basenames start with the module name.
- **Tests:** none found under `apps/api`. The vitest scripts exist, and `.env.test.example` points to Postgres on localhost:5432.

**9. cool-admin-midway (Midway/Koa).**
- **Modules:** base, demo, dict, plugin, recycle, space, swagger, task, user.
- **Types live in subfolders** (`controller/{admin,app,open}`, `service/`, `entity/`, `middleware/`, `queue/`, `event/`). No file name contains its module name. Collisions: `config.ts` ×9, `controller/admin/info.ts` ×5, `sys/department.ts` ×3; 18 in total.
- **This is a natural "names stripped" benchmark.**
- Whether Midway's directory scanning survives file moves is UNVERIFIED.

**10. mikro-orm realworld.**
- **Modules:** article, profile, tag, user.
- **Tests (vitest):**
  - `user/test/user.service.spec.ts` mocks EntityManager and runs offline.
  - `tag/tag.controller.spec.ts` calls `MikroOrmModule.forRoot(config)` and needs MySQL (CI runs `docker compose up`).
- **Use:** a tiny fixture for the G1 spike.

**Honourable mentions (fail one criterion):**
- **NarHakobyan/awesome-nest-boilerplate** (MIT, 2026-06-09, 101 files): modules auth, user, post, health-checker. Only 2 specs.
- **buqiyuan/nest-admin** (MIT, 2025-06-10, 230 files): `system/{dept, dict-item, dict-type, log, menu, online, param-config, role, serve, task}`, auth, netdisk, sse, tasks, todo, tools, user. 0 tests.
- **gothinkster/node-express-realworld-example-app** (Express + Prisma, last commit 2024-01-04, 26 source files): `src/app/routes/{article, auth, profile, tag}`. Its tests are already type-sliced in `src/tests/services/*` and use a jest-mock-extended Prisma mock, so they run offline. MIT only in package.json.
- **mgce/modular-monolith-nodejs** (Express + Awilix + MikroORM, ISC in package.json only, 2022-08-02, 219 files): booking, couch, review, user, each a workspace package; 5 tests.

## 2. Screened out (reason)

| Repo | Why it fails |
|---|---|
| Sairyss/domain-driven-hexagon | 2 modules (user, wallet); 2024-05-14; no tests in src |
| marcoturi/fastify-boilerplate | 1 module (user); e2e needs Postgres |
| stemmlerjs/ddd-forum | 2 modules; 2023-06 |
| talyssonoc/node-api-boilerplate | 2 modules; 2022 |
| edwinhern/express-typescript | 1 feature module; 19 files |
| notiz-dev/nestjs-prisma-starter | 3 modules; 2023-11 |
| lujakob/nestjs-realworld-example-app | ISC in package.json only; 2021-01; 1 test |
| fastify/demo | 34 files; tests need MySQL |
| illright/realworld-hono-drizzle | about 20 TS files; no tests |
| openstatushq/openstatus `apps/server` (Hono) | `deno test`, `.env.test` `DATABASE_URL=http://127.0.0.1:8080` (needs a sqld server); files named by HTTP verb |
| rybbit-io/rybbit `server` (Fastify) | Type-first hybrid (`api/`, `services/`, `db/`, `lib/` with features nested inside) |
| AmruthPillai/Reactive-Resume | Server rewritten; 41 files |
| CodelyTV/typescript-ddd-example | No LICENSE file, package.json licence is `""`; tests need Mongo, RabbitMQ and Elastic; 2024-08 |
| krater-app/api | 2022; no spec files found |
| jcserv/fastify-api-template, codersaadi/fastify, rifandani/be-monorepo | Too small, untested, or layered rather than feature-sliced |
| NeaDigitra/Fastify-TS-API | Tarball came back empty; UNVERIFIED |

## 3. Side findings for G2 (type-sliced targets for the main track)

- **immich-app/immich `server/src`:** canonical type-sliced NestJS.
  - 82 controllers, 101 services, 63 repositories and 55 dtos (counts include specs), with co-located `*.service.spec.ts`.
  - A single `app.module.ts` imports `controllers` from `src/controllers/index.js` and `repositories` from `src/repositories/index.js`.
  - Larger than 500 files. Whether its tests run offline is UNVERIFIED.
- **acm309/PutongOJ `apps/server`:** Koa, type-sliced (`handlers/`, `services/`, `policies/`, `middlewares/`), MIT, ava tests with seeds. It depends on ioredis; whether its tests need MongoDB and Redis is UNVERIFIED (likely yes).

## 4. Flatten procedure spec

**Manifest.** Kept on the benchmark side and never inside the scrambled tree. It records:
- `moduleRoots`
- `featureDepth` (default 1, overrides such as `app/endpoints: 2` and `orchestration: 2`)
- `shared` (folders left in place)
- `typeTaxonomy`
- `nestModuleMode` (A or B)
- `nameMode` (default or H1)

**S0. Baseline.** Pin the SHA. Run `tsc --noEmit` and the test suite, and record pass/fail per full test name. Build the import graph G₀ with ts-morph. Include `jest.mock` / `vi.mock`, `require` and dynamic-import string literals as edges.

**S1. Ground truth.** See section 5.

**S2. Technical type T per file**, in priority order:
1. Compound suffix `<name>.<T>.ts`, where T is one of: controller, service, module, resolver, model, entity, dto, args, input, guard, strategy, decorator, interceptor, filter, pipe, middleware, repository, gateway, processor, mapper, schema, interface, enum, constants, config, handler, command, query, event, subscriber, validator, mock.
2. Nearest type-named folder inside the module: `dto/`, `dtos/`, `entities/`, `guards/`, `strategies/`, `controllers/`, `services/`, `repositories/`, `mappers/`, `events/`, `handlers/`.
3. AST fallback. Decorator `@Controller`, `@Resolver`, `@Injectable`, `@Entity` or `@Module`. A Hono/Express router instance becomes `routes/`. A file exporting only types becomes `types/`. Anything else goes to `utils/`.

**S3. Target path** is `<root>/<plural(T)>/<basename>`.
- Drop the module segment and the type segment. Keep any other qualifier segments as subfolders, e.g. brocoders `persistence/relational/...` → `repositories/relational/...`.
- Module-internal guards, decorators and so on merge into existing top-level `guards/` and `decorators/` (realistic for hoppscotch).
- Shared folders stay untouched.

**S4. Name style.** By default keep the basename. This is realistic: Immich `services/album.service.ts`, PutongOJ `services/user.ts`. Optionally convert to the repo's dominant style.

**S5. Collisions**, applied in order:
1. Rename from the primary exported symbol. `user-settings/user.resolver.ts` (exports `UserSettingsUserResolver`) → `resolvers/user-settings-user.resolver.ts`. Dot-style developers would plausibly do this.
2. If there is no exported symbol (`helper.ts`, `config.ts`, `index.ts`), prefix the module token (`team-collection.helper.ts`). Flag these files as "leaky" in the manifest.
3. Barrels that only re-export get dissolved: rewrite importers to direct paths. Optionally generate one barrel per type folder, Immich-style. Barrels are excluded from ground truth.

**S6. Tests and fixtures.**
- `x.spec.ts` moves and renames in lockstep with its subject, co-located in the type folder (Immich style).
- `__snapshots__/x.spec.ts.snap` moves and renames with its test.
- A module-local `__mocks__/` moves next to the module it mocks. A root `__mocks__/` (node_modules mocks) stays put.
- `*.mock.ts` (ghostfolio) and fixtures go to `mocks/` or `test/fixtures/`.
- Tests are not ground-truth entities.

**S7. NestJS `*.module.ts`.**
- **Variant A, "easy":** move to `modules/<x>.module.ts`. Contents stay byte-identical, but the DI arrays are an answer key in the graph.
- **Variant B, "realistic", the default:** collapse into one `app.module.ts`, Immich-style. Take the union of `imports`, `controllers`, `providers` and `exports`. Merge `TypeOrmModule.forFeature`, `MikroOrmModule.forFeature`, `JwtModule.register`, `BullModule.registerQueue` and similar, and drop `forwardRef`.
  - Risks: provider scope changes, duplicate tokens, e2e tests that boot AppModule.
  - It must pass the S9 checks.
  - Planning decision: under B, un-scrambling requires the tool to generate module files, which goes beyond pure moves.

**S8. Rewrites.** Relative imports; tsconfig `paths`; jest `moduleNameMapper` (vndevteam's per-folder aliases) and vitest `alias`; `jest.mock` / `vi.mock` literals; `nest-cli.json` assets; package.json scripts that reference moved paths. Leave non-TS assets in place (hoppscotch `postbuild` copies `src/mailer/templates`). Remove aliases whose names are module names.

**S9. Scrubbing leaks.**
- Fresh history: `git init` and a single "initial import" commit, because the old history contains the answer.
- Drop CODEOWNERS, labeler configs, eslint-boundaries / dependency-cruiser configs and per-path coverage thresholds.
- Grep the tree for every original module directory path; it must have 0 hits.
- Identifiers and string tags (`@ApiTags('users')`) stay; they are realistic.

**S10. Validating the scramble.**
- `tsc` is clean.
- The pass/fail set matches S0 exactly.
- The graph is isomorphic to G₀ under the path map.
- File contents are identical apart from import specifiers (variant B's `app.module.ts` excepted).
- This doubles as a test of our own executor and certificate.

**S11. Outputs.**
- The scrambled repo.
- `gt.rsf` with lines `contain <module> <scrambledPath>` (ARCADE/MoJo RSF format).
- The path map and the leak report.
- **Realism check:** compare type-folder ratio and file naming conventions against Immich and PutongOJ.

## 5. Ground-truth definition

- **Entities** are non-test, non-barrel, non-generated, non-migration `.ts` files.
- **Label** is the feature directory under the module root, at the manifest depth.
- **Shared folders** get the label `shared:<name>`; root files get `root`.
- **Score two ways:**
  - Headline: feature files only.
  - Secondary: all entities.
- **Cross-check for NestJS:** a file listed in module X's `@Module({controllers, providers})` but living in folder Y is a developer anomaly. Record it and don't silently "fix" it, in line with the "make bugs obvious" principle.
- **Per-module recoverability:** compute each module's intra- vs inter-edge ratio on G₀. Modules with no internal edges (e.g. `health`) can't be recovered from the graph and should be reported separately.
- **Disagreements are reviewed, not just counted as errors.** If the tool moves a shared file into its only consuming module, that may be an improvement.

## 6. Hard variants and baselines

- **H1, file names stripped (repo is mutated):**
  - Basename becomes an opaque deterministic ID, e.g. `services/s-3f9a.service.ts`.
  - Identifiers keep their names and tests still pass.
  - It is unrealistic, but it isolates the file-name signal.
- **H2, graph-only planner input (repo not mutated):** anonymise paths, identifiers and string literals in the compressed graph given to the planner.
  - Mutating the repo instead is unsafe. Renaming identifiers changes GraphQL code-first type names and TypeORM default table names.
- **H3, names-only planner input:** the file list without edges.
- **Baselines:**
  - **Random:** size-matched random partition.
  - **Name-token clustering:** group files by their leading basename token after stripping the type suffix, with prefix merging so team vs team-collection is handled. Anquetil & Lethbridge (1999) showed that file names alone recover subsystems.
  - **Graph-only:** Louvain/Leiden on the import graph, or a Bunch-style MQ hill-climb.
- **Report** MoJoFM and ARI for default, H1, H2 and H3, each against these baselines. The pitch is the delta, especially on leaky files (`helper.ts`), cross-named files (hoppscotch's `*/user.resolver.ts`) and kaneo / cool-admin-style naming.

## 7. Metrics

**MoJoFM** (Wen & Tzerpos, IWPC 2004, doi:10.1109/WPC.2004.1311061; MoJo: Tzerpos & Holt, WCRE 1999; optimal algorithm: Wen & Tzerpos, IWPC 2003)
- `MoJoFM(A,B) = (1 − mno(A,B) / max(mno(∀A,B))) × 100`, where A is the tool output and B the authoritative ground truth. It is asymmetric.
- Per ARCADE `mojo/MoJoCalculator.java`:
  - `mno = Σᵢ(|Aᵢ| − maxⱼ|Aᵢ∩Bⱼ|) + (l − g)`, where l is the number of clusters in A.
  - g is the number of non-empty groups after maximum bipartite matching between each Aᵢ and the Bⱼ that ties for its max overlap.
  - `max = n − g_B`: sort B's cluster sizes ascending and increment a counter c whenever c < size.
- Only objects present in both partitions count (MoJo README).
- Bias: it favours many small clusters (SARIF, arXiv 2311.04643).

**a2a** (Behnamghader et al., EMSE 2017, doi:10.1007/s10664-016-9466-0)
- `(1 − mto / (aco(A) + aco(B))) × 100`.
- In ARCADE `A2a.java`: `mto = |kA−kB| + 2·added + 2·removed + moved`, with moved from min-cost flow divided by 2. The denominator is `kA + 2nA + kB + 2nB`.
- Low dynamic range, so SARIF proposed `a2a_adj = 1 − α·mto_m/mto_m^max − β·mto_ar/(aco(A)+aco(B))`.

**c2c / c2c_cvg** (Garcia, Ivkovic, Medvidovic, ASE 2013, doi:10.1109/ASE.2013.6693106)
- `sim(a,b) = |a∩b| / max(|a|,|b|)`.
- `cvg = |{clusters with some sim > 0.66}| / |clusters|`. The 0.66 threshold is ARCADE's `Cvg.java` default, and SARIF also uses 0.66.
- It is the most demo-friendly number: "recovered 9 of 11 modules".

**ARI**
- Pair-counting and chance-adjusted, so random labels score about 0. Range is [−0.5, 1] (scikit-learn docs).
- NMI is not chance-adjusted and grows with the number of clusters, so use AMI if a mutual-information metric is wanted (scikit-learn docs).

**TurboMQ** (Mitchell & Mancoridis, TSE 2006, doi:10.1109/TSE.2006.31)
- `CFᵢ = 2μᵢ / (2μᵢ + εᵢ)`, where μ is intra-cluster edges and ε inter-cluster edges.
- ARCADE `TurboMQ.java` averages CF over clusters, i.e. Σ CF divided by the number of clusters.
- It needs no ground truth, so use it for before/after on real type-sliced targets.

**Tooling**
- No npm package exists for MoJo or ARI. `normalized-mutual-information@1.0.3` (2019) is the only near hit.
- ARCADE `usc-softarch/arcade_core` (53e6f4f6e350, last commit 2024-03-07) has MoJo, MoJoFM, EdgeMoJo, A2a, Cvg, TurboMQ and BasicMQ in Java.
- **Recommendation:**
  - Write our own TS: `mojo.ts` (Kuhn/Hopcroft-Karp matching), `ari.ts`, `c2c.ts`, `turboMQ.ts`.
  - Check MoJo against the ARCADE README oracle (`java mojo.MoJo distra.rsf distrb.rsf` → 383), with the RSF files taken from that repo.
  - Optionally cross-check ARI with sklearn's `adjusted_rand_score`.
  - Skip porting a2a (it needs min-cost flow) unless Java ARCADE is used offline.

**Headline set:** MoJoFM (feature files) + ARI + c2c_cvg@0.66 + the ratio of predicted to ground-truth cluster count, always shown next to the name-token and graph-only baselines. For targets without ground truth: TurboMQ, cross-module edge count and boundary-rule violations.

**Calibration.**
- The best prior technique averages about 47 MoJoFM on the 9 large ground-truth systems (SARIF).
- Semref (arXiv 2607.23774, 2026-07, GPT-4o-mini plus dependencies) reports +118.57% relative on MoJoFM and +100.41% on a2a_adj.
- Our setting is much easier (moderate size, explicit modules, leaky names), so absolute numbers aren't comparable. Report deltas against baselines.

## 8. Datasets and prior art

- **Garcia, Krka, Mattmann, Medvidovic**, "Obtaining Ground-Truth Software Architectures", ICSE 2013 (doi:10.1109/ICSE.2013.6606639): ground truths for four OSS systems.
- **Lutellier et al.**, ICSE 2015 (doi:10.1109/ICSE.2015.136) and TSE 2018 (doi:10.1109/TSE.2017.2671865): Chromium ground truth from two years of work with its developers; nine recovery techniques compared.
- **SARIF** (arXiv 2311.04643) and **Semref** (arXiv 2607.23774) both use ArchStudio4, Bash 4.2, Chromium svn-171054, Hadoop 0.19.0, ITK 4.5.2, OODT 0.2, Libxml2, HDC and HDF. All are Java, C or C++; none are JS/TS. Semref worries about the LLM already knowing the projects and tells it to "avoid considering the project background".
- **Analogues for our design:**
  - **ClassLAR** (He, Huai, Chen, Garcia; arXiv 2512.15980, 2025-12) treats JPMS module declarations as ground truth across 20 Java projects. It recovers modules from fully-qualified class names with language models. This is the closest precedent for "declared modules = ground truth" and also shows how much names carry.
  - **ConcernBERT** (arXiv 2606.21647, 2026-06) merges methods from 2+ classes and scores recovery of the original membership, which is a scramble-and-recover protocol at method level.
- **No TS/JS ground-truth set was found** (UNVERIFIED beyond these sources). A scrambled TS feature-module set is plausibly novel; say "we found none" rather than claiming it is the first.
- **UNVERIFIED:** Bavota et al. (WCRE 2010, doi:10.1109/WCRE.2010.29; EMSE 2012/13, doi:10.1007/s10664-012-9226-8) evaluating by artificially degrading packages. The WCRE abstract doesn't mention it, so don't cite it for that.

## 9. Open questions for planning

1. **Nest module variant:** A or B as the default? B is realistic but means the tool must generate `*.module.ts` files.
2. **Ghostfolio `services/`:** clusters or shared? HedgeDoc `dtos/` and `api/`: hand-labelled or demo-only?
3. **Tier M acceptance:** is `tsc` plus the graph certificate enough proof for Hono and Koa without tests?
4. **G1 spike set (cheap):**
   - vndevteam: easy, has tests.
   - hoppscotch: traps, has tests.
   - kaneo: Hono, low name leakage.
   - Optionally cool-admin for the no-name-token case.
5. **Unchecked install friction:** whether hoppscotch's postinstall and Prisma generate, ghostfolio's full Nx install and hedgedoc's workspace build all work without network beyond the npm registry.

## Sources

- **Repos (via codeload tarball, atom feed, ls-remote):**
  - https://github.com/hoppscotch/hoppscotch · https://github.com/ghostfolio/ghostfolio · https://github.com/rubiin/ultimate-nest · https://github.com/vndevteam/nestjs-boilerplate
  - https://github.com/hedgedoc/hedgedoc · https://github.com/docmost/docmost · https://github.com/brocoders/nestjs-boilerplate · https://github.com/usekaneo/kaneo
  - https://github.com/cool-team-official/cool-admin-midway · https://github.com/mikro-orm/nestjs-realworld-example-app · https://github.com/NarHakobyan/awesome-nest-boilerplate · https://github.com/buqiyuan/nest-admin
  - https://github.com/gothinkster/node-express-realworld-example-app · https://github.com/mgce/modular-monolith-nodejs · https://github.com/immich-app/immich · https://github.com/acm309/PutongOJ
  - https://github.com/usc-softarch/arcade_core
  - Screened-out repos listed in §2 at `github.com/<owner>/<name>`.
- **Discovery pages:**
  - https://github.com/topics/modular-monolith · https://github.com/topics/hono · https://github.com/topics/koa · https://github.com/topics/fastify-boilerplate
  - https://app.unpkg.com/realworld-hono-drizzle@1.0.6/files/README.md · https://registry.npmjs.org/-/v1/search
- **Papers:**
  - https://arxiv.org/abs/2311.04643 (SARIF) · https://arxiv.org/html/2607.23774v1 (Semref) · https://arxiv.org/abs/2512.15980 (ClassLAR) · https://arxiv.org/abs/2606.21647 (ConcernBERT) · https://arxiv.org/abs/2605.04188
  - DOIs verified via Crossref/OpenAlex: 10.1109/WPC.2004.1311061, 10.1109/WCRE.1999.806959, 10.1109/WPC.2003.1199206, 10.1007/s10664-016-9466-0, 10.1109/ICSE.2013.6606639, 10.1109/ASE.2013.6693106, 10.1109/ICSE.2015.136, 10.1109/TSE.2017.2671865, 10.1109/TSE.2006.31, 10.1002/(SICI)1096-908X(199905/06)11:3<201::AID-SMR192>3.0.CO;2-1
- **MoJo tool page:** https://bil.eecs.yorku.ca/?p=23
- **scikit-learn clustering metrics:** https://scikit-learn.org/stable/modules/clustering.html


---

# Independent verification

## 0. Method and summary

**Method**
- Plan mode was active, so I made no clones and `/tmp/ac-research` holds no repo checkouts.
- Each repo was read by streaming `codeload.github.com/<repo>/tar.gz/<sha>` into Python `tarfile` (`r|gz`, nothing written to disk), plus single files from `raw.githubusercontent.com/<repo>/<sha>/<path>`.
- SHAs come from `git ls-remote` and dates from `github.com/<repo>/commits/<branch>.atom`. The `gh` API was not used.
- Test-case counts are regex counts of `it(`/`test(`, so they are approximate.
- The WebSearch budget was already used up by other agents. Papers were checked through the arXiv API and Crossref, and npm facts through `registry.npmjs.org`.

**What changed against the report**
1. **kaneo has tests.** About 112 files and ~670 cases live in the repo-root `tests/api/**`, wired up by `apps/api/vitest.config.ts` (`include: ["../../tests/api/**/*.test.ts"]`). They mock the DB with `vi.mock("../../../apps/api/src/database")`. A further 116 integration files in `tests/api-integration/` need Postgres. kaneo moves up to Tier T, so Tier T is no longer NestJS-only.
2. **cool-admin-midway cannot be flattened faithfully.** This is verified: `@cool-midway/core@8.0.8` `dist/decorator/controller.js` builds the route prefix and the module from the file path (`modules/<m>/controller/...`) and reads `modules/<m>/config.ts`. `src/config/config.local.ts` has `entities: ['**/modules/*/entity']`. Moving files changes the HTTP routes.
3. **docmost has a private enterprise submodule.**
   - `apps/server/src/ee` points to `github.com/docmost/ee`, and `ls-remote` asks for credentials.
   - `app.module.ts` loads it with `require('./ee/ee.module')`.
   - The server's package.json has `license: ""`.
   - 15 of its 32 specs are bare stubs (`providers: [XService]` with no mocks) that will probably fail at baseline.
4. **Variant B (merge all Nest modules into one app.module) is unsafe as the default.** Measured blockers:
   - ghostfolio: 29 provider classes are declared in more than one module (ConfigurationService in 8, AccountService in 6), and `JwtModule.register` appears 4 times.
   - ultimate-nest: `RabbitMQModule.forRootAsync` appears twice.
   - amplication: 26 module-level and 18 provider-level `forwardRef`.
   - Of the repos checked, only hoppscotch looks B-safe: 0 duplicated providers and 3 `@Global` modules.
5. **Missing location hazards.**
   - hoppscotch `src/mailer/mailer.module.ts`: `dir: __dirname + '/templates'`.
   - vndevteam `src/mail/mail.module.ts`: `join(__dirname, 'templates')`.
   - ghostfolio calculator specs and `portfolio-calculator-test-utils.ts`: `join(__dirname, '../../../../../../(../)test/import/ok/…')`.
   - The report's rule "leave non-TS assets in place" breaks the hoppscotch and vndevteam mail templates at runtime.
6. **The MoJo oracle files are not in ARCADE.** `distra.rsf`/`distrb.rsf` are mentioned in `src/main/java/mojo/README` but missing from `arcade_core`. The cited tool page `bil.eecs.yorku.ca/?p=23` now redirects with a 301 to `/publications/`. Use ARCADE's own test oracles instead (§6).
7. **A strong candidate was missed:** amplication `packages/amplication-server`. It is Apache-2.0, has 878 non-test files, about 50 `core/<feature>` modules, and 65 specs with ~568 offline-mocked cases.

## 1. Corrected table

My counts throughout: non-test `.ts` excluding `.d.ts`; "tests" means spec/test files.

| Repo (subtree) · SHA | Framework | Licence (verified) | Last commit | Non-test / tests | Feature modules · share of files in GT folders | Tests offline? | Faithful flatten? | Verdict |
|---|---|---|---|---|---|---|---|---|
| hoppscotch `packages/hoppscotch-backend` · 63273f8e599e | NestJS 11, GraphQL, Prisma 7 | MIT (root LICENSE); package.json `UNLICENSED`, `private` | 2026-09-30 | 189 / 19 unit + 1 e2e | ~25 (26 `*.module.ts` incl. app) · ~83% | **Yes**: 18 service specs, ~700 cases, all `mockDeep<PrismaService>` | Yes, with hazards: mailer `__dirname` templates; gitignored `src/generated/prisma` (Prisma output `../src/generated/prisma`); `baseUrl: ./` so bare `src/...` imports | **KEEP (flagship)** |
| ghostfolio `apps/api` · 347cd06a4012 | NestJS, Prisma, Bull, Nx | AGPL-3.0 | 2026-10-01 | 323 / 57 | 21 `app/*` + 13 `app/endpoints/*` · ~50% (`services/`, `helper/`, `models/` are already type folders) | **Yes** (jest.mock-heavy), but 28 of 57 specs are in `portfolio` | Yes, Variant A only; depth-relative `__dirname` fixtures; ~100 `jest.mock('@ghostfolio/api/…')` alias literals | **KEEP** |
| usekaneo/kaneo `apps/api` · b80818fe2e93 | **Hono**, Drizzle, ESM, TS ^7.0.2 | MIT (root LICENSE; no `license` in package.json) | 2026-10-01 | 467 / 0 in-tree; **112 test files out-of-tree** | ~25 + 8 `*-integration` + `plugins/` (128) · ~85% | **Likely yes** for `tests/api` (vi.mock DB; two tests start loopback HTTP servers); integration suite needs Postgres | Yes; tests in `tests/api/<feature>/` mirror the layout and must be flattened too | **PROMOTE to Tier T** |
| rubiin/ultimate-nest · 43c67b79d931 | NestJS, MikroORM | MIT | 2026-09-30 | 269 / 26 | 11 + `shared` · **~25%** (common/ and lib/ dominate; 15 central entities) | Yes for unit (`@mocks`, swc); e2e uses testcontainers | Yes; 40 `index.ts` barrels; `@modules/*` alias collides with a Variant-A `modules/` folder | **KEEP (secondary)** |
| amplication `packages/amplication-server` · 7656495d27f0 | NestJS, GraphQL, Prisma, Nx | Apache-2.0 outside `ee/` (root LICENSE) | 2026-04-02 | 878 / 65 | ~50 `core/*` · ~89% | Likely yes (PrismaService `useClass: jest.fn`); 1 of 65 specs looks DB-bound; Nx uses the `nx-cloud` runner, so run jest directly | Yes, Variant A (provider-level `forwardRef` blocks B) | **NEW: KEEP (large tier)** |
| vndevteam/nestjs-boilerplate · cb6bea3df300 | NestJS, TypeORM, BullMQ | MIT | 2025-10-09 | 115 / 20 | 5 in `api/` (health and home have 2 files each, so 3 real) · ~39% | Yes, but 7 of 9 module specs are 1-case smoke tests | Yes; mail `__dirname` templates; `api.module` aggregator; `modules-set.ts`; one alias per folder | **DEMOTE → G1 smoke fixture** |
| mikro-orm/nestjs-realworld-example-app · 323699b42d8b | NestJS, MikroORM (MySQL), vitest | MIT | 2026-09-29 | 40 / 3 | 4 · ~75% | Partial: 2 user specs offline; `tag.controller.spec` uses `MikroOrmModule.forRoot` and needs MySQL | Yes | **KEEP as G1 fixture only** |
| hedgedoc `backend` · 5dd94d5449e5 (develop) | NestJS, Knex | AGPL-3.0 | 2026-09-22 | ~190–203 / ~46 | ~15 thin folders (often just module + service); 50 central `dtos/`; controllers in `api/{private,public}` | Yes: knex-mock for unit; e2e defaults to better-sqlite3 `:memory:` (native module) | Only with a hand-made GT | **DEMOTE → "real hybrid" demo, not scramble** |
| docmost `apps/server` · b6434371ed5f | NestJS, Kysely | AGPL-3.0; server package.json `""` | 2026-09-30 | ~393 / 32 | 17 `core/*` + 16 `integrations/*` | Weak; probably failing stubs | Hard: private `ee` submodule plus dynamic `require` | **REJECT** |
| brocoders/nestjs-boilerplate · 9620f159eefe | NestJS, hexagonal | MIT | 2026-08-08 | 171 / 13 (e2e + helpers) | 13 | **No**: e2e only, via docker-compose | Hard: 51 files collide (4× `files.service.ts`); hygen templates encode paths | **REJECT** |
| cool-team-official/cool-admin-midway · e545ef6f3b0c (8.x) | Midway/Koa | MIT | 2026-07-17 | 139 / 0 | 9 | No tests | **No**: routes come from file paths (verified) | **REJECT** (good preflight-decline demo) |
| NarHakobyan/awesome-nest-boilerplate · 8f1c0a8cded5 | NestJS, TypeORM | MIT | 2026-06-09 | 100 / 2 | 4 | 1 unit spec | Yes | Tier M only |
| buqiyuan/nest-admin · 2eeccc4cb699 | NestJS | MIT | 2025-06-10 | 230 / 0 | ~8 + `system/*` (10) | No tests | Yes | Tier M only |
| gothinkster/node-express-realworld-example-app · 30b68e1e8814 | Express, Prisma, Nx | MIT in package.json only; **no LICENSE file** | 2024-01-04 | ~26 / 6 | 4 (`src/app/routes/*`) | Yes (jest-mock-extended), but tests are already type-sliced (`src/tests/services/*`) | Yes | **DEMOTE** (optional Express micro-fixture) |
| mgce/modular-monolith-nodejs · 83adcbcf87f6 | Express, Awilix, MikroORM, Rush | **No LICENSE file**; no root package.json | 2022-08-02 | 224 TS | 4, each its own workspace package | 4 domain tests | No: flattening crosses package boundaries | **REJECT** |

**Further details**
- **hoppscotch:** collisions are `input-type.args.ts` ×7, `helper.ts` ×5, `user.resolver.ts` ×4, `input-types.args.ts` ×2, `team.resolver.ts` ×2, `user-collection.resolver.ts` ×2. The `UserSettingsUserResolver` trap is confirmed in `src/gql-schema.ts`. ts-jest runs with `diagnostics:false`, so tsc must be a separate oracle.
- **ghostfolio:** the report's collision list is incomplete. Actual: `interfaces.ts` ×6, `portfolio-calculator.ts` ×5, and ×2 each for `get-dividends.dto`, `get-lookup.dto`, `ghostfolio.service`, `market-data.module`, `yahoo-finance.service`, `current-investment`, `emerging-markets`. There are 65 `*.module.ts`, not 59. `nx.json` has `neverConnectToCloud: true`.
- **kaneo:** `vite-plus@1.0.0` (MIT) is the `vp` runner. `moduleResolution: Bundler`, extensionless imports.

## 2. Verdicts with reasons

**KEEP**
- **hoppscotch:** MIT, every service spec runs on mocks, more than 25 modules, real traps (cross-named resolvers, `helper.ts` ×5). It is the only checked repo where Variant B looks safe.
  - Install friction: `preinstall: npx only-allow pnpm`, and `@prisma/engines` is in `onlyBuiltDependencies`, which likely downloads from binaries.prisma.sh (UNVERIFIED).
  - `postinstall` runs `prisma generate` and then `generate-gql-sdl`, which starts Nest with `GENERATE_GQL_SCHEMA` and needs no DB, per `main.ts:104–107`.
- **ghostfolio:** offline mocked specs, two-level ground truth, and the `jest.mock` alias-literal edge case.
  - Caveats: Variant A only; ground truth covers about half the code; behavioural coverage is mostly in `portfolio`.
- **kaneo:** a non-Nest Tier-T candidate. ~670 unit cases import `../../../apps/api/src/...` and use `vi.mock` literals plus top-level `await import()`, which is exactly the kickoff checker edge case.
  - The "Hard (naming), low leakage" claim is wrong. Only 2 of 455 basenames *start* with the module name, but 22% *contain* the entity token (`label/controllers/create-label.ts`).
  - The S5.2 prefix rule would inject module tokens into the 107 `index.ts`/`response.ts`/`schema.ts` files.
  - Cross-named trap: `label/controllers/get-labels-by-task-id.ts`.
- **ultimate-nest:** offline unit tests (7 module specs, ~37 cases). Only 25% of files sit in module folders, so it is a secondary repo.
- **amplication-server (new):** large and feature-modular, with ~568 cases using mocked Prisma. Apache-2.0, which is fine to show in a public replay.
  - Risks (UNVERIFIED): monorepo install, Prisma generate, and the nx-cloud runner with a read token in `nx.json` (bypass with `jest -c packages/amplication-server/jest.config.ts`). TypeScript 5.1.6.

**DEMOTE**
- **vndevteam:** only 3 substantive modules, stub-level tests, a year stale. Fine as a cheap G1 smoke test.
- **mikro-orm realworld:** 40 files. G1 only; exclude `tag.controller.spec.ts`.
- **hedgedoc:** already half type-sliced. Use it as a hybrid demo target.
- **gothinkster:** tiny, 2024, no LICENSE file.
- **awesome-nest, nest-admin:** Tier M only.

**REJECT**
- **docmost:** private submodule, dynamic `require`, empty licence field, stub specs.
- **brocoders:** e2e via docker only; hexagonal duplicates.
- **cool-admin:** path-derived routes.
- **mgce:** one package per module, no licence, 2022.

**Optional large candidate (UNVERIFIED offline): teableio/teable `apps/nestjs-backend`** · 5ef2238883ca · 2026-09-01.
- 900 files and 63 `features/*`.
- 260 unit specs: 196 "plain" (~1,795 cases) plus 39 that import `GlobalModule` (Prisma/DB).
- AGPL-3.0 with Section-7 additional terms; root LICENSE is a mixed scheme.
- Only worth it if amplication fails to install.

## 3. Corrections to the headline findings

- **Finding 1/2** ("all four passing repos are NestJS"; "Hono has no tests"): kaneo has offline unit tests. Express still has no verified Tier-T candidate:
  - gothinkster is a micro-repo.
  - Unleash (AGPL-3.0-or-later, Express, 2026-10-01) is a hybrid mid-migration: ~55 `features/*` alongside legacy `services/` 36, `routes/` 37, `db/` 29 and `openapi/` 271. By a regex heuristic, 89 of 326 test files (788 of 1,945 cases) use DB setup, concentrated in `features/`.
- **Finding 3:** name leakage, measured by me:

  | Scope | Basename starts with module | Contains module token |
  |---|---|---|
  | hoppscotch src | 54% | 61% |
  | ghostfolio `app/` | 67% | 72% |
  | kaneo | 0% | 22% |
  | amplication `core/` | 48% | 75% |
  | ultimate-nest `modules/` | 50% | 70% |

  These are pre-scramble figures; S5 collision renames raise them.
- **Finding 4** is confirmed for Immich: `server/src/app.module.ts` imports `controllers` from `src/controllers/index.js` and `repositories` from `src/repositories/index.js`. Note that Immich now also has a feature folder, `src/maintenance/`.
- **Finding 5:**
  - No npm package for MoJo or ARI, confirmed by registry searches for "mojofm", "mojo distance" and "adjusted rand index".
  - `normalized-mutual-information@1.0.3` exists (modified 2022).
  - `graphology-communities-louvain@2.0.2` (MIT) exists for the graph baseline; there is no `graphology-communities-leiden` package.
  - ARCADE's licence is **BSD-3-Clause**, not a bespoke "USC licence".

## 4. Corrections to the flatten procedure

- **S0:**
  - Run generators before tsc and pin their output: hoppscotch `src/generated/prisma` is gitignored; ultimate-nest's `src/generated` and vndevteam's `src/generated` are committed.
  - Run S0 in a separate worktree and scramble from a clean checkout. Caches carry old paths: hoppscotch has `incremental: true` (tsbuildinfo), vndevteam has `.jest-cache`, and there are `.nx` caches.
  - Use each repo's own compiler for the tsc oracle. Versions range from TS 5.1.6 (amplication), 5.9.3 (hoppscotch) and 6.0.x (ghostfolio, ultimate-nest) to ^7.0.2 (kaneo; 7.0.2 is npm `latest`). ts-morph 28.0.0 bundles TS 6.0.
- **S2:** add bare-basename type tokens: `schema.ts`, `response.ts`, `types.ts`, `config.ts`, `constants.ts`, and `index.ts` as router via AST. The `<name>.<T>.ts` rule misses kaneo's 107 such files.
- **S3/S7-A:** the target folder `modules/` collides with existing feature roots (ultimate-nest `src/modules/`, `@modules/*` alias). The manifest must choose a free name.
- **S5.2:**
  - Prefixing with the module token is realistic, but it dominates leakage on kaneo-style repos. Count it in the leak report and in the H1 delta.
  - S5.1 (name from exported symbol) does not apply to default-exported functions (kaneo controllers); fall back to the existing basename.
- **S6:**
  - Handle out-of-tree test mirrors (kaneo `tests/api/<feature>/` → `tests/api/<type>/`) and module-local test folders (mikro-orm `src/user/test/`). Otherwise the test tree leaks the answer.
  - Rewrite relative `vi.mock("…")` and dynamic `import("…")` literals in those tests.
- **S7, make Variant A the default.** Allow B only if a merge-safety precheck passes:
  - no provider class in more than one module's `providers` (ghostfolio fails with 29);
  - no dynamic module registered twice (ghostfolio `JwtModule.register` ×4; ultimate-nest `RabbitMQModule.forRootAsync` ×2);
  - no `RouterModule` or GraphQL `include` keyed by module;
  - no spec that imports a feature module class.
  
  Drop only module-level `forwardRef(() => XModule)`. Provider-level `@Inject(forwardRef(...))` must stay (amplication has 18). B also changes `onModuleInit` order. Under A, add a **DI-oracle baseline** (§5), because module files encode the answer.
- **S8:**
  - Add a rule for `__dirname` / `import.meta.url`-relative literals: pin the file, co-move the asset, or rewrite the literal. Cases: hoppscotch and vndevteam mail templates, ghostfolio fixtures.
  - Bare `src/...` imports via `baseUrl` (hoppscotch) are a separate case from `paths`.
  - `nest-cli.json` assets (`mailer/templates/**/*`) and the `postbuild` copy must stay consistent.
- **S9:**
  - Also scrub agent and tool configs: `CLAUDE.md` (ultimate-nest, brocoders, mikro-orm realworld, kaneo), `AGENTS.md` (kaneo), `.cursorrules` (cool-admin), `.coderabbit.yaml` (kaneo), `.mergify.yml`, `release-please-config.json`, renovate path groups, `codecov.yml`, Nx `project.json`, hygen templates, CHANGELOG and docs.
  - The "0 hits" grep must match path forms (`src/<m>/`, `./<m>/`, `../<m>/`), not bare tokens, or it will hit route strings.
- **S10:** content identity must whitelist the rewritten path literals from S8. Match the pass/fail set by test ID (name), since file paths change.
- **S11 / MoJo oracle:** see §5.

## 5. Corrections to metrics, baselines and citations

**MoJo / MoJoFM: the report's formulas are correct**, checked against ARCADE `src/main/java/mojo/MoJoCalculator.java`:
- `totalCost = moves + numOfClustersInA − no_of_nonempty_group`.
- `maxDistanceTo` sorts B's sizes ascending and does `if (group_number < B[i]) group_number++`, returning `n − g`.
- The result is rounded to 2 decimals.
- The README confirms that only the intersection of objects counts.

Add three things:
- Build both RSFs over the same object set explicitly and report coverage. With intersection semantics, files the tool drops vanish silently.
- Degenerate partitions score low but not zero. For example, with B = 3×3 both all-singletons and one-cluster give 14.29. Keep the predicted-to-GT cluster-count ratio.
- "Favours many small clusters (SARIF)" is UNVERIFIED; I could not extract text from the SARIF PDF.

**Oracle for a TS port:** use ARCADE `src/test/resources/MoJoCalculator/{MoJoFMoracles,MoJoBaseOracles}/*.txt` with the httpd/struts RSFs in the same tree. For example, MoJoFM from httpd-2.4.7 to 2.3.8 (ACDC) is 93.59 and MoJo is 20. Caveat: these are ARCADE self-generated regression oracles (`generateOracles` in `MoJoCalculatorTest.java`), not independent truth.

**c2c_cvg**
- `Cvg.java` defaults to a strict `sim > 0.66` (`upper = 1.0`) and runs `RenameFixer.fix` first.
- It is directional. For "recovered 9 of 11 modules", report matched GT clusters over GT clusters (`getCvgTargetToSource` with source = tool).
- Semref states it uses 0.66 following Zhang et al. 2023 (SARIF), so the threshold is confirmed.

**a2a:** the formula is confirmed in `A2a.java` (`|kA−kB| + 2·added + 2·removed + mcfCost/2`; denominator `kA + 2nA + kB + 2nB`). In the scramble setting there are no added or removed entities, so the moved term should reduce to a Hungarian assignment. That equivalence is UNVERIFIED; cross-check against `A2aTest.java`. Porting is cheap and helps comparability, since Semref reports a2a and a2a_adj.

**TurboMQ**
- ARCADE `TurboMQ.java` does return Σ CF / |clusters|, and CF = 0 for clusters with no internal edges (verified).
- Bunch's original TurboMQ is the unnormalised Σ CF (from memory, not re-checked here). Label it "TurboMQ (ARCADE mean-CF)".

**ARI / NMI / AMI:** confirmed against the scikit-learn docs. ARI range is [−0.5, 1]; "NMI and MI are not adjusted against chance"; AMI is ≈0 for random labels.

**Baselines to add**
- **B0, as-scrambled:** the type folders themselves as clusters. Every improvement must be a delta from this.
- **B-DI (Variant A):** assign each file to the module whose `*.module.ts` reaches it through the DI arrays plus imports. This is a near-oracle for NestJS.

**Calibration**
- "Best prior ≈47 MoJoFM average" is UNVERIFIED. A WebFetch summary of Semref's HTML (not checked directly) reports SARIF input MoJoFM of 24–77 per project and output 61–84.
- Semref claims are verified via arXiv 2607.23774v1 (2026-07-26):
  - model `gpt-4o-mini-2024-07-18`, with GPT-4o, Gemini-2.0-flash, Llama 3.3 70B and DeepSeek-V3 in RQ4;
  - 9 projects and 10 tools; metrics MoJoFM, a2a, ARI, a2a_adj and c2c_cvg;
  - +118.57% and +100.41%;
  - "we instructed it to avoid considering the project background".
- **SARIF's 9 systems are not all published ground truths.** Its abstract says "six projects with published ground-truth architectures and three open-source projects labeled by our industrial collaborators".

**Citations**
- All 7 DOIs I re-checked resolve on Crossref: TSE.2006.31, the Anquetil–Lethbridge SMR 1999 paper, WPC.2004.1311061, ASE.2013.6693106, s10664-016-9466-0, WCRE.1999.806959, WPC.2003.1199206.
- arXiv titles confirmed:
  - ClassLAR is "Embedding Software Intent: Lightweight Java Module Recovery" (He, Huai, Chen, Garcia; 2025-12-17; 20 projects).
  - ConcernBERT (2026-06-19) uses a merge-and-recover protocol, confirmed.
  - The unexplained 2605.04188 is "A Multi-Agent Consensus Protocol for Stable Software Remodularization" (Ibrahim, 2026-05-05).

## 6. Recommended benchmark set

| Role | Repo | Why |
|---|---|---|
| T1 flagship | hoppscotch-backend | MIT; ~700 offline cases; traps; only B-safe repo, so it can carry the Variant-B "hard" run |
| T2 non-Nest | kaneo `apps/api` | Hono, MIT; ~670 offline cases; verb-entity naming; out-of-tree `vi.mock` literals |
| T3 alias/fixture hazards | ghostfolio `apps/api` | Two-level ground truth; alias `jest.mock`; `__dirname` fixtures; Variant A only; AGPL |
| T4 large | amplication-server | About 50 modules and 878 files; Apache-2.0; install UNVERIFIED |
| T5 secondary | ultimate-nest | MIT; barrel-heavy; small ground-truth share |
| G1 fixtures (not headline) | mikro-orm realworld, vndevteam | Cheap, fast spike runs |
| Hybrid demo (not scramble) | hedgedoc backend | Real half-type-sliced layout |
| Preflight-decline demo | cool-admin-midway | Path-derived routes; shows the tool saying "no" |

- **G1 spike order:** mikro-orm realworld → vndevteam → hoppscotch → kaneo. Drop cool-admin from G1.
- **Public replay:** prefer MIT/Apache targets (hoppscotch, kaneo, amplication, ultimate-nest). Generate scrambles at runtime and never commit them, per CLAUDE.md.

## 7. Side findings for G2 (brief)

- **medusajs/medusa branch `v1.x`** · 55491df168e9 · 2026-06-01 · MIT, `packages/medusa/src`.
  - Type-sliced: `api` 424, `services` 71, `repositories` 70, `models` 84; 276 test files.
  - But `loaders/services.ts` registers DI names via `glob.sync(path.join(__dirname, corePath))` plus `formatRegistrationName(file)`. Moving a service renames its DI key, so this is a preflight-decline or pin case, not an easy target.
- **Unleash:** a "finish their migration" story (see §3). Offline split of its tests is UNVERIFIED.

## 8. Still UNVERIFIED

- Whether any of these suites run offline in practice. I inspected configs and specs only; no installs, no execution.
- Prisma engine downloads during install (hoppscotch, amplication).
- Whether kaneo's TS 7 is compatible with ts-morph-based analysis.
- Whether docmost's stub specs actually fail.
- The SARIF "bias" claim and the "≈47" figure.
- Bunch's unnormalised TurboMQ definition.
- The a2a-to-Hungarian equivalence.
- The screened-out list in report §2 (Sairyss, CodelyTV and others) was not re-checked.

## Sources

**Repos** (`github.com/<repo>`, SHAs as above):
- hoppscotch/hoppscotch, ghostfolio/ghostfolio, usekaneo/kaneo, rubiin/ultimate-nest
- amplication/amplication, vndevteam/nestjs-boilerplate, mikro-orm/nestjs-realworld-example-app
- hedgedoc/hedgedoc, docmost/docmost, brocoders/nestjs-boilerplate, cool-team-official/cool-admin-midway
- NarHakobyan/awesome-nest-boilerplate, buqiyuan/nest-admin, gothinkster/node-express-realworld-example-app, mgce/modular-monolith-nodejs
- teableio/teable, Unleash/unleash, medusajs/medusa (v1.x), immich-app/immich, usc-softarch/arcade_core

**Key files**
- hoppscotch: `packages/hoppscotch-backend/{package.json,nest-cli.json,tsconfig.json,src/mailer/mailer.module.ts,src/gql-schema.ts,prisma/schema.prisma}`
- ghostfolio: `apps/api/src/app/portfolio/calculator/portfolio-calculator-test-utils.ts`, `nx.json`, `tsconfig.base.json`
- kaneo: `apps/api/vitest.config.ts`, `tests/api/billing/session-required.test.ts`, `tests/api/external-link/create-external-link.test.ts`
- docmost: `.gitmodules`, `apps/server/src/app.module.ts`
- vndevteam: `src/mail/mail.module.ts`, `src/utils/modules-set.ts`
- amplication: `LICENSE`, `nx.json`
- medusa v1.x: `packages/medusa/src/loaders/services.ts`
- ARCADE: `src/main/java/mojo/{README,MoJoCalculator.java}`, `metrics/evolution/{Cvg,A2a}.java`, `metrics/decay/TurboMQ.java`, `src/test/resources/MoJoCalculator/*`

**Other**
- cool-midway core: https://unpkg.com/@cool-midway/core@8.0.8/dist/decorator/controller.js
- npm registry: https://registry.npmjs.org/ (vite-plus, typescript dist-tags, ts-morph, @ts-morph/common, graphology-communities-louvain, normalized-mutual-information, search API)
- arXiv API: https://export.arxiv.org/api/query?id_list=2311.04643,2607.23774,2512.15980,2606.21647,2605.04188
- Semref HTML: https://arxiv.org/html/2607.23774v1
- scikit-learn clustering metrics: https://scikit-learn.org/stable/modules/clustering.html
- Crossref: https://api.crossref.org/works/<doi>
- MoJo page redirect: https://bil.eecs.yorku.ca/?p=23 → https://bil.eecs.yorku.ca/publications/
