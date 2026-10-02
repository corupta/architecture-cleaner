# Track 3a: type-sliced target repos (G2 hunt)

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

## G2 repo hunt: type-sliced TS backends with offline tests (snapshot 2026-10-01)

**Method.** Plan mode was active for this run, so nothing was cloned into `/tmp`. I worked read-only over the network:
- File trees came from GitHub's `https://github.com/<repo>/tree-list/<HEAD sha>` JSON endpoint, with HEAD found via `git ls-remote`.
- Config and test files were read from `raw.githubusercontent.com`.
- Code-pattern scans and repo discovery used the Sourcegraph stream API (`sourcegraph.com/.api/search/stream`).
- Last-commit dates come from `github.com/<repo>/commits/<branch>.atom`. Star counts come from the repo HTML page.
- No `gh api` calls were made.
- The shared WebSearch budget (200 calls) ran out after 3 searches. Discovery after that was done through Sourcegraph structural queries.

**Count definition.** "TS src" means `.ts` files under the backend root, excluding `*.test|spec.ts`, `__tests__/`, `test/` folders, `.d.ts` and migrations.

**Host.** This machine is `aarch64` (`uname -m`) with Node v22.23.3, so arm64 builds of native deps matter (better-sqlite3, sqlite3, sharp, mongodb-memory-server binaries). Prebuilt arm64 availability for each repo's pinned versions is UNVERIFIED.

---

## Ranked top 6

### 1. samanhappy/mcphub — fit 9/10
- **URL:** https://github.com/samanhappy/mcphub
- **Basics:** Apache-2.0 · last commit 2026-10-01 · ~2,488 stars.
- **Size:** 226 TS src in `src/`. About 226 test files across `src/**` and `tests/**`, including 22 in `tests/frontend/` and 13 in `tests/integration/`.
- **Layout:**
  - `src/` holds `controllers/`(31), `services/`(44), `dao/`(29: `<X>Dao.ts` + `<X>DaoDbImpl.ts`), `db/`(33: `entities/`, `repositories/`, `subscribers/`), `middlewares/`(4), `routes/`(1), `utils/`(47), `cli/`(21), `config/`, `clients/`, `models/`.
  - `tests/` mirrors that by type: `controllers/`(26), `services/`(69), `dao/`(8), `utils/`(21), `integration/`(13).
  - `frontend/` is a separate Vite app. A Sourcegraph scan found no frontend imports of `../src/…`.
- **Domains (12+):** servers, groups, users, auth/OAuth (client, server, dynamic registration), bearer keys, prompts, builtin prompts/resources, credential bindings, market/registry/cloud, smart routing (vector embeddings), activity/logs, system config.
- **Tests: jest 30 with ts-jest in ESM mode. Offline: YES (likely).**
  - `jest.config.cjs` covers roots `src` and `tests`, maps `@/` to `src/`, strips `.js` extensions, and sets `setupFilesAfterEnv: tests/setup.ts`.
  - `tests/setup.ts` sets `DB_URL: 'sqlite::memory:'` and mocks `src/utils/moduleDir.js`.
  - `.github/workflows/ci.yml` runs `pnpm test:ci` with no `services:` block.
  - Caveat: some `tests/integration/*` files (e.g. `sse-service-real-client.test.ts`) might spawn real MCP clients. UNVERIFIED.
  - Also odd: `src/db/connection.ts` hardcodes `type: 'postgres'` while tests set a sqlite URL. Suites probably use the JSON-file DAO or mocks (`src/dao/base/JsonFileBaseDao.ts`). UNVERIFIED.
- **Hazards:**
  - ESM NodeNext, so every import carries a `.js` specifier (`tsconfig.json`: `"module": "NodeNext"`).
  - TypeORM decorators on `src/db/entities/*`. Entities are wired as an array through the `entities/index.ts` barrel, not a glob.
  - Barrels: `src/dao/index.ts`, `src/db/repositories/index.ts`.
  - **`src/services/registry.ts` dynamically `import()`s `join(process.cwd(), 'src/services' | 'dist/services', key + 'x' + '.ts'|'.js')`.** This path convention pins `services/` or must be recorded as a finding. It's a good showcase for the hazard scan.
  - `src/utils/i18n.ts` runs `readdirSync(process.cwd()/locales)`.
  - 142 test files import `../../src/…` relative paths, and **108 test files use `jest.mock('../…')` string paths**. That's a strong test of the checker's jest.mock handling.
  - Tests mirror the type layout, so they have to move with their modules.
- **Why 9:** pure type-slicing including dao/entity/repository layers, mid-size, a large offline suite, very active, and an MCP/AI domain that hackathon judges will recognise. The hazards are real but exactly the kind the checker is meant to show.

### 2. ever-co/ever-traduora (`api/`) — fit 8/10
- **URL:** https://github.com/ever-co/ever-traduora
- **Basics:** AGPL-3.0 · last commit 2026-08-05 (recent: NestJS 10→11 migration) · ~2,132 stars.
- **Size:** 76 TS src in `api/src/`. 27 tests: 15 in `api/test/*.e2e-spec.ts` and 12 in `api/src/formatters/*.spec.ts`.
- **Layout:** `api/src/` holds `controllers/`(16), `services/`(5), `entity/`(12), `domain/`(4), `formatters/`(16), `seeds/`, `guards/`, `middlewares/`, `decorators/`, `filters/`, `validators/`, `redis/`, `connection/`, `utils/`. Tests live in `api/test/`.
- **Domains (~12):** auth, user, project, project-user, project-invite, project-client, project-label, project-plan, project-stats, locale, term, translation, import/export (+ formatters).
- **NestJS, but type-sliced:** one `api/src/app.module.ts` lists all 16 controllers.
- **Tests: jest 29 + ts-jest. Offline: YES.**
  - `api/package.json` script `test:e2e` sets `NODE_ENV=e2e TR_DB_DATABASE=data/tr_e2e.sqlite3`.
  - `api/src/config.ts:58` has `type: env.TR_DB_TYPE || 'better-sqlite3'`.
  - `api/test/util.ts` boots `AppModule` through `@nestjs/testing` + supertest.
  - Caveat: no CI workflow runs the tests (`.github/workflows/` only has `k8s-build.yml` and `harvest-secrets-to-openbao.yml`), so whether the suite is currently green is unknown.
- **Hazards:**
  - NestJS/TypeORM decorators, plus a central `app.module.ts` wiring file.
  - `baseUrl: ./src` bare imports, e.g. `import … from 'domain/formatters'` in `api/src/formatters/strings.ts`. `domain` is also a Node core module name, which makes it a nasty resolution edge case.
  - Two entity globs: `api/src/config.ts:70` `entities: ['src/entity/*.entity*']` and `api/src/connection/datasource.ts:27` `` `${__dirname}/../entity/*.entity.{js,ts}` ``. There are also migration globs. Good for the glob match-set certificate.
  - `__dirname` paths for templates/public (`config.ts:21-22`) and `.env` (`env.logger.ts:4`).
  - Only 5 services, so business logic sits in controllers. That's good material for "made obvious, not fixed" findings.

### 3. openhab/openhab-cloud — fit 8/10
- **URL:** https://github.com/openhab/openhab-cloud
- **Basics:** EPL-2.0 (OSI-approved) · last commit 2026-08-09 · ~306 stars (openHAB Foundation org).
- **Size:** 76 TS src in `src/`. 31 unit tests in `tests/mocha/unit/` plus 20 integration files.
- **Layout:**
  - `src/` holds `controllers/`(18, `*.controller.ts` + `index.ts`), `models/`(12), `services/`(6), `routes/`(2), `middleware/`(5), `socket/`(8), `jobs/`(4), `lib/`(8), `factories/`(2), `cli/`, `config/`, `schemas/`, `types/`.
  - Outside `src/`: `views/`, `public/`, `templates/*.ejs`.
  - `tests/mocha/unit/` mirrors the types: `controllers/`, `services/`, `models/`, `routes/`, `socket/`, `middleware/`, `lib/`.
- **Domains (~12):** account, users, registration, invitations, devices (openHAB instances), items, events, notifications, applications/OAuth2, webhooks, IFTTT, staff, timezone.
- **Tests: mocha 11 + tsx + sinon/chai. Offline: YES for unit tests, NO for integration.**
  - `package.json` `test:unit` runs `mocha --require tsx tests/mocha/unit/**/*.ts --recursive`.
  - `.github/workflows/test.yml`: the `unit-tests` job has no services. `mongo:6` and `redis:7` appear only in `integration-tests`.
  - Units use in-memory fakes, e.g. `MockRedisClient` in `tests/mocha/unit/socket/connection-manager.test.ts`. `models.test.ts` imports types only.
- **Hazards (lowest in the set):** CommonJS, no `paths`, no decorators (`tsconfig.json`). `__dirname` is used for views/public/favicon/config in `src/app.ts:166-540` and `src/cli/db-connect.ts:34`. `src/services/email.service.ts:189` uses `process.cwd()/templates`. There's a `controllers/index.ts` barrel, and tests mirror the type layout.
- **Why 8:** smallest and cleanest. Best target for the first end-to-end run and checker bring-up, but less impressive on video.

### 4. seerr-team/seerr (`server/`) — fit 7/10
- **URL:** https://github.com/seerr-team/seerr. `Fallenbagel/jellyseerr` resolves to the same repo: same star count and server tree observed.
- **Basics:** MIT · last commit 2026-09-29 · ~12,768 stars.
- **Size:** 156 TS src in `server/`. 19 server test files (plus helpers in `server/test/`).
- **Layout:** `server/` holds `routes/`(26, incl. `settings/`, `user/`), `entity/`(14), `lib/`(31: `notifications/`, `scanners/`, `settings/`, `email/`), `api/`(21 external clients: themoviedb, servarr, tvdb, rating), `interfaces/api/`(14), `models/`(6), `subscriber/`(4), `middleware/`, `utils/`(18), `constants/`(7), `job/`, `repositories/`(1), `i18n/`. The repo-root `src/` is the Next.js frontend.
- **Domains (~12):** media, request, issue/comment, user/settings, discover, movie/tv/person/collection, blocklist, watchlist, settings, notifications, auth.
- **Tests: `node:test`. Offline: YES.**
  - `server/test/index.mts` runs with ts-node + tsconfig-paths and `--experimental-test-module-mocks`.
  - `server/datasource.ts` testConfig is `type: 'sqlite', database: ':memory:'` when `NODE_ENV==='test'`.
  - `server/test/setup.ts` blocks non-loopback HTTP.
  - `.github/workflows/ci.yml` job `unit-test` runs `pnpm test` with no services.
- **Hazards:**
  - `@server/*` alias (`server/tsconfig.json`, and `tsc-alias` in `build:server`).
  - **140 frontend files in `src/` import `@server/{models,constants,interfaces,lib,entity,api,types}`** (Sourcegraph count). Server moves ripple into the Next app, or those files must stay pinned.
  - 20+ `__dirname`-relative paths, e.g. `server/lib/notifications/agents/email.ts` (templates), `server/i18n/index.ts` (locale JSON), `server/lib/settings/migrator.ts` (`readdir` of `migrations`), `server/index.ts` (`seerr-api.yml`), `server/utils/appVersion.ts` (`require('../../package.json')`).
  - TypeORM decorators, plus migration globs `'server/migration/sqlite/**/*.ts'` in `datasource.ts`.
  - The `copyfiles` build step references `server/templates/**` and `server/i18n/locale/*.json`.

### 5. immich-app/immich (`server/`) — fit 7/10
- **URL:** https://github.com/immich-app/immich
- **Basics:** AGPL-3.0 · last commit 2026-10-01 · ~115,432 stars.
- **Size:** 358 TS src in `server/src/`. 105 unit specs `src/**/*.spec.ts` plus 68 medium specs in `test/medium/`.
- **Layout:**
  - `server/src/` holds `controllers/`(47), `services/`(56), `repositories/`(57), `dtos/`(52), `schema/`(68), `utils/`(32), `commands/`, `middleware/`, `emails/`, `workers/`, `maintenance/`, `queries/` (37 generated `.sql`).
  - NestJS, but strictly type-sliced.
- **Domains (~45, from controller names):** album, asset, auth, library, memory, person/face, partner, search, shared-link, stack, tag, timeline, trash, user, workflow, and more.
- **Tests: vitest 4. Offline: YES for unit tests, NO for medium tests.**
  - `server/test/vitest.config.mjs` includes `src/**/*.spec.ts` with no globalSetup. Services are built with `newTestService` mocks from `test/utils.js`.
  - `.github/workflows/test.yml` job `server-unit-tests` has no services.
  - `server/test/medium/globalSetup.ts` uses testcontainers `GenericContainer('ghcr.io/immich-app/postgres…')`, which needs Docker, so medium tests are not offline.
- **Hazards:**
  - ESM `nodenext` with `.js` specifiers.
  - Every import goes through the `src/*` / `test/*` `paths` alias.
  - Barrels `src/services/index.ts` and `src/repositories/index.ts` export DI arrays.
  - `src/bin/sync-sql.ts` writes `./src/queries/<repository>.sql`, keyed by repository file name.
  - `import.meta.dirname` paths in `services/cli.service.ts`, `repositories/config.repository.ts`, `repositories/database.repository.ts`.
  - Workspace dependency `@immich/plugin-sdk: workspace:*`. Heavy install (native deps).
- **Why 7:** the biggest wow factor, but it sits at the size cap (token cost) and is the heaviest install.

### 6. cameri/nostream — fit 6/10
- **URL:** https://github.com/cameri/nostream
- **Basics:** MIT · last commit 2026-10-01 · ~829 stars.
- **Size:** 288 TS src in `src/`. 157 unit specs in `test/unit/**`.
- **Layout:**
  - `src/` holds `controllers/`(24, already sub-grouped: `admin/`, `invoices/`, `callbacks/`, `admission/`), `handlers/`(34), `factories/`(49), `repositories/`(9), `services/`(8), `adapters/`, `routes/`, `schemas/`, `utils/`(62), `cli/`(28), `payments-processors/`, `@types/`(25).
  - `test/unit/` mirrors the types.
- **Domains:** Nostr events and subscriptions, invoices/payments, admission, users, invite codes, reports, DVM jobs, admin settings.
- **Tests: mocha 11 + sinon (`.mocharc.js` uses ts-node). Offline: YES for unit tests.**
  - Repository specs stub `DatabaseClient`, e.g. `test/unit/repositories/dvm-job-repository.spec.ts`.
  - `.github/workflows/checks.yml` "Unit Tests And Coverage" job has no services.
  - Integration tests (cucumber, `test/integration/docker-compose.yml`) are not offline.
- **Hazards:**
  - The `factories/` composition root.
  - `pretest:unit` runs a full build first.
  - Location-sensitive paths: `resources/default-settings.yaml` via `process.cwd()` (`src/utils/settings-paths.ts`), and `readdirSync` in `src/utils/settings.ts`.
  - Dynamic `require()` of optional deps.
- **Why 6:** good structure and tests, but the domain is unfamiliar to judges.

---

## Alternates (inspected, ranked just below)
- **rmanguinho/clean-ts-api — fit 6.** GPL-3.0, last code commit 2024-11-27 (docs commit 2026-09-09), ~1,915 stars. 178 src split into layers: `data/ domain/ infra/ main/ presentation/ validation/`. Only 3 domains: account, survey, survey-result.
  - This is literally the kickoff's "package-by-layer CA is the old disease" example, which makes for a strong narrative.
  - Tests: jest 27, 41 specs in a mirrored `tests/` tree, `@/*` alias.
  - Integration tests use `@shelf/jest-mongodb`, and `jest-mongodb-config.js` pins binary `4.0.3`. An arm64 build of that version probably doesn't exist (UNVERIFIED).
- **SeuRonao/realworld-express-prisma — fit 6.** MIT, last commit 2025-10-31, 46 stars. 78 src, the purest type-slicing found: `controllers/<x>Controller/`, `middleware/<x>Validator/`, `routes/api/`, `utils/db/<x>/`, `view/<x>Viewer`, over 5 RealWorld domains.
  - 14 jest tests, fully mocked with `jest.mock('../../utils/db/…')`, so offline.
  - Needs `prisma generate`. Very low maintenance.
- **wiredoor/wiredoor — 5, offline status not verified.** Apache-2.0, last commit 2026-09-22, ~1.6k stars. About 95 backend src using routing-controllers + typedi + typeorm(sqlite3). Its 10 tests are already grouped by feature (`src/tests/nodes/…`).
- **hyperdxio/hyperdx `packages/api` — 5.** MIT. 180 src. 53 unit tests run offline, but 57 `*.int.test.ts` need Mongo + ClickHouse (`packages/api/.env.test`).
- **TriliumNext/Trilium `apps/server` — 5.** AGPL. Tests run offline (`TRILIUM_INTEGRATION_TEST: "memory"` in `apps/server/vite.config.mts`), but the core logic moved to `packages/trilium-core` (590 files).

## Rejected (one line each)
**Too small, stale, or not enough domains**
- w3tecch/express-typescript-boilerplate: only user/pet domains, last commit 2021-05-03. Its `.env.test` globs are useful as a hazard fixture.
- santiq/bulletproof-nodejs: 25 src, 1 test, last commit 2021-09.
- rmanguinho/advanced-node: only 2 domains, last commit 2021-10. pg-mem would have made it offline.
- rmanguinho/clean-node-api: JS, 30 files.
- ljlm0402/typescript-express-starter: about 20 files per template.
- GeekyAnts/express-typescript: 40 src, 0 tests.
- kutia-software-company/express-typescript-starter: 1 test, last commit 2021.
- antonio-lazaro/prisma-express-typescript-boilerplate: 36 src, 3 tests.
- gothinkster/node-express-prisma-v1-official-app: 22 src, last commit 2022-01.
- waldemarnt/node-typescript-api: 28 src, last commit 2024-01.
- cypress-io/cypress-realworld-app: backend is 19 flat files with no backend tests.
- CloudSaver: 47 src, 0 tests.
- undernightcore/dockerizalo: 0 tests.
- sct/overseerr: 0 server tests, superseded by Seerr.
- loopbackio/loopback4-example-shopping: LB4 convention booters, last commit 2022-06.

**Already feature- or domain-sliced**
- edwinhern/express-typescript: `src/api/user/`.
- gothinkster/node-express-realworld-example-app: `src/app/routes/{article,auth,profile,tag}`.
- gonzaloplaza/express-ts-ddd, przemek-nowicki/node-express-template.ts.
- mempool backend: `api/` already split into `bitcoin/`, `lightning/`, `mining/`.
- standardnotes/server: `Domain/`-sliced CA with Inversify.
- Unleash: migrating into `lib/features/`, and 922 src.

**Tests not offline**
- useplunk/plunk: real Postgres + Redis (`vitest.config.ts`, `test/helpers/database.ts`).
- aelassas/bookcars: real MongoDB (`backend/__tests__/globalSetup.ts` connects `env.DB_URI`) plus PayPal/Stripe tests.
- freeCodeCamp `api/`: MongoDB replica set (`api/vitest.utils.ts`, and CI uses `supercharge/mongodb-github-action`).
- supabase/postgres-meta: real Postgres.
- hagopj13/node-express-boilerplate: JS, real Mongo (`tests/utils/setupTestDB.js`).

**Too big**
- growthbook back-end: 1143 src.
- lightdash backend: 1310 src.
- logto core: 547 src.
- medusa v1.x: 1186 src.
- fdm-monster: 444 src.
- 2anki.net: 1694 src.
- FlowiseAI server: 321 src, with `enterprise/` under a commercial license per `LICENSE.md`, and the heavy `flowise-components` dependency. Its layout is ideal for this tool, though.

**Not OSS**
- Joplin Server: "Personal Use License" (`packages/server/LICENSE.md`).
- Directus: MSCL-1.0-GPL.
- Outline: BSL 1.1.
- n8n: Sustainable Use License with `.ee.` carve-outs.

**Not inspected**
- cnpm/cnpmcore: the jsDelivr listing failed (repo over 50 MB). Its test requirements weren't checked; it was dropped after that listing failure.
- Helicone `valhalla/jawn`: 259 src with tsoa decorators. Only 17 tests, and their offline status wasn't verified.

---

## Are the good targets mostly JS? No.
A Sourcegraph structural query looked for repos that have `(server/|backend/|api/)?src/controllers/*.{ts|js}` plus `src/services/*` plus `src/(models|entities|repositories)/*` in the same language:

| Stars | TS repos | JS repos |
|---|---|---|
| any | 95 | 79 |
| ≥100 | 51 | 40 |
| ≥500 | 12 | 6 |
| ≥1000 | 7 | 1 |

The JS hits above 500 stars are mostly boilerplates and tutorials (hagopj13, ServeRest, geshan/expressjs-structure, and similar). Sourcegraph only indexes part of GitHub, so read these as indicative. The TS-only call stands.

**Best JS targets, for the later Sequelize phase:**
1. **advplyr/audiobookshelf `server/`** (GPL-3.0, ~14.5k stars, last commit 2026-09-29).
   - About 160 app JS files: `controllers/`(23), `models/`(25, Sequelize), `managers/`(18), `routers/`, `objects/`, `providers/`, `scanner/`, `utils/`. There are also 244 vendored files in `server/libs/` that must stay pinned.
   - 35 mocha + sinon tests in `test/server/**`. They use `new Sequelize({ dialect: 'sqlite', storage: ':memory:' })`, e.g. in `test/server/managers/MigrationManager.test.js`, so they're offline.
   - The server is now built with `tsc -p tsconfig.server.json` before testing.
   - Closest match to corupta's private Sequelize repo.
2. **sahat/hackathon-starter** (MIT, ~35k stars). Flat `controllers/` + `models/`, but only about 20 source files. 36 mocha tests using `mongodb-memory-server` 11, which is offline after the first binary download.
3. **danny-avila/LibreChat `api/`** (MIT, ~45k stars). Type-sliced `server/{controllers,routes,services,middleware}` with jest + `mongodb-memory-server`. Too big, and models now live in TS workspace packages. Not a demo target.

## Suggested shortlist for planning
- **Main demo:** mcphub. Credible product, AI/MCP domain, large offline suite, and the hazards are the ones the checker is built to show.
- **Checker bring-up, then a second demo:** openhab-cloud (lowest hazard), then traduora (glob and baseUrl edge cases).
- **Stretch "wow" run:** Immich server, unit tests only.
- **For the video narrative:** clean-ts-api, the "Clean Architecture packaged by layer" case.


---

# Independent verification

## Track 3a verification: type-sliced TS backend shortlist (2026-10-01)

**Method and constraint.** Plan mode was active for this session, so nothing was cloned into `/tmp`. The treeless clone the task asked for counts as a system change, and plan mode forbids those. Everything was verified read-only over the network:
- HEAD SHAs via `git ls-remote`.
- File trees from `https://github.com/<repo>/tree-list/<sha>`.
- File contents from `raw.githubusercontent.com/<repo>/<sha>/<path>`, scanned in memory.
- Last-commit dates from `commits.atom`, stars from the repo HTML page, CI status from the Actions badge SVGs.
- CircleCI logs from the public v1.1 API.
- Native prebuild availability from GitHub `releases/expanded_assets` pages and unpkg.

No `gh api` calls were made. No files were written anywhere.

**Host.** aarch64, Ubuntu 22.04.3, Node v22.23.3. `python3`, `make`, `g++` and `gcc` are present, so native deps can fall back to a source build.

**Pinned SHAs.**

| Repo | SHA |
|---|---|
| mcphub | `70cf036c` |
| traduora | `f29a2167` (develop) |
| openhab-cloud | `76966b54` |
| seerr | `e9590629` (develop) |
| immich | `02063972` |
| nostream | `b68919dd` |
| clean-ts-api | `65d0b790` |
| realworld-express-prisma | `1f5a21ed` |

---

## Corrected table

"Src" means non-test `.ts` under the backend root, excluding migrations and generated `.sql`. "Cases" is a regex count of `it(`/`test(` calls, so it's approximate, except traduora, where the numbers come from the CI log.

| Repo | License (verified) | Last commit | Stars | Src files / LOC | Test files / cases | CI on default branch | Offline on this host |
|---|---|---|---|---|---|---|---|
| samanhappy/mcphub | Apache-2.0 (`LICENSE`, package.json) | 2026-10-01 (~10 commits/day) | 2,488 | 226 / 51.2k | 226 / ~1,822 | GH Actions passing, no `services:` | **Yes, except 1 suite** (needs npm network) |
| ever-co/ever-traduora `api/` | AGPL-3.0-only | 2026-08-05 | 2,132 | 74 / 6.1k (+19 migrations) | 12 unit + 15 e2e / **41 + 115, all passing in CircleCI at HEAD** | CircleCI green at `f29a2167` | **Yes** (better-sqlite3 file DB). Native-build risk on Node 22, see below |
| openhab/openhab-cloud | EPL-2.0 | 2026-08-09 (one maintainer) | 306 | 76 / 13.8k | 31 unit / ~452 (+20 integration files) | GH "Test" passing (runs on PRs only) | **Yes for unit**; integration needs Mongo + Redis + a running app |
| seerr-team/seerr `server/` | MIT | 2026-09-29 | 12,768 | 164 / 35.1k (+75 migrations) | 19 / ~221 | passing | Yes (sqlite `:memory:`, outbound HTTP blocked) |
| immich-app/immich `server/` | AGPL-3.0 | 2026-10-01 | 115,434 | 349 / 55.8k (+101 migrations, 37 generated `.sql`) | 105 unit specs / ~1,827 | passing | Unit tests yes, but the install/build chain is heavy (see below) |
| cameri/nostream | MIT | 2026-10-01 | 829 | 288 / 24.7k | 157 / ~1,977 | passing | Unit tests mostly yes; `pretest` does a full build and 4 CLI specs import `dist/` |
| rmanguinho/clean-ts-api | GPL-3.0-or-later | code 2024-11-27 (docs 2026-09-09) | 1,915 | 179 | 41 | none (stale `.travis.yml`) | **No.** The mongo preset applies to *every* jest config |
| SeuRonao/realworld-express-prisma | MIT | 2025-10-31 | 46 | 79 | 14 | none | Probably yes after `prisma generate` (UNVERIFIED) |

---

## Per-candidate verification

### 1. mcphub: KEEP, recommended main demo (with conditions)

**Confirmed:**
- Layout: `controllers/` 31, `services/` 44, `dao/` 29, `db/` 33, `utils/` 47, `cli/` 21.
- jest 30 + ts-jest 29, `default-esm` preset.
- `tests/setup.ts` sets `DB_URL: 'sqlite::memory:'` and mocks `../src/utils/moduleDir.js`.
- CI `ci.yml` runs `pnpm test:ci` on a 20.x/22.x matrix with no services. The integration job with pgvector is commented out.
- DB tests mock TypeORM or the connection:
  - `src/db/connection.test.ts` → `jest.mock('typeorm')`
  - `tests/db/repositories/serverRepository.test.ts` → mocks `src/db/connection.js`
- The mcpService tests mock `@modelcontextprotocol/client`.
- The SSRF tests inject the DNS `lookup`.
- `src/services/registry.ts` builds `join(process.cwd(), 'src/services'|'dist/services', key+'x'+ext)` and loads it with dynamic `import()`.

**Corrections to the prior shortlist:**
- **One suite is not offline.** `tests/utils/mockSettings.ts:11-13` configures `test-server-1` as `command: 'npx', args: ['-y','time-mcp']`. `tests/integration/sse-service-real-client.test.ts` then waits up to 30s for it to reach `connected`, which needs the npm registry. Exclude it with `--testPathIgnorePatterns`, or pre-warm the npx cache.
- **"No frontend imports of `../src`" is wrong.** `frontend/viteBasePath.ts` and `frontend/viteProxy.ts` both import `../src/utils/basePath.js`. Either pin that file or treat this as a cross-package edge.
- Counts:
  - 152 test files import `../src` (prior: 142).
  - **120 test files call `jest.mock('./…'|'../…')` with relative string paths** (prior: 108).
  - The `@/` alias exists only in jest's `moduleNameMapper`. No test uses it, and tsconfig has no `paths`.
- Native deps: `pnpm.ignoredBuiltDependencies` skips the install scripts for `bcrypt` and `better-sqlite3`.
  - bcrypt 6.0.0 ships `prebuilds/linux-arm64` inside the package (https://unpkg.com/bcrypt@6.0.0/prebuilds/), so it loads anyway.
  - better-sqlite3 isn't imported anywhere in `src/`.
  - Net: no native blocker found.

**New hazards (good checker showcase material):**
- `src/utils/path.ts` assumes its own depth ("This file is in src/utils/path.ts … 2 levels up") and **skips itself when `NODE_ENV==='test'` or `JEST_WORKER_ID` is set**. A move that breaks it can pass every test. This is the "certificate ✓, tests ✓, prod ✗" case the location scan exists for.
- 12 dynamic `import()` calls with literal relative specifiers that the rewriter has to cover. Examples: `vectorSearchService → './mcpService.js'`, `utils/systemConfigCache → '../dao/DaoFactory.js'`, `server.ts → './db/connection.js'`.

**Bad on camera:**
- God files: `services/mcpService.ts` is 5,380 LOC and `controllers/serverController.ts` is 2,927 LOC. Move-only can't split them, so the `servers` module will dominate.
- **One 85-file import cycle (SCC)** spanning dao 27, services 21, db 18, utils 13 (my resolver over relative and dynamic imports). The before and after graphs both risk looking like hairballs, and boundary rules will freeze many violations.
- Hubs: `types/index.ts` (918 LOC) has 102 importers; `utils/logger.ts` has 81. Both have to be a shared kernel.
- 10 `hosted*` services form a cross-cutting concern.
- Tests mirror the type layout, so a "move tests too" step touches ~150 test files.
- Very high churn, so the SHA has to be pinned.

### 2. ever-traduora (`api/`): KEEP, recommended backup (safest oracle)

**Corrections to the prior shortlist:**
- **"No CI runs the tests" is wrong.** `.circleci/config.yml` runs `test_unit` and `test_e2e`. The public CircleCI API shows both green at HEAD `f29a2167` on 2026-08-05:
  - build 2306: e2e, **15 suites / 115 tests passed**, ~60s.
  - build 2305: unit, **12 suites / 41 tests**, ~14s.
- The e2e log shows "Successfully connected to better-sqlite3 database". The `mysql:5.7` service container in CircleCI is vestigial. PR #544's statement that the tests "need a MySQL service" is outdated (https://github.com/ever-co/ever-traduora/pull/544).
- Src is 74, not 76. Two formatter tests are named `android-xml-spec.ts` and `resx-spec.ts`, and they only match because the testRegex `.spec.ts$` has an unescaped `.`. That's a regex/glob match-set edge case.
- Redis is optional: `redis.module.ts` returns `null` without `REDIS_HOST`, and `UserLoginAttemptsStorage` falls back to in-memory.
- Mail is skipped when `config.env==='e2e'`.

**Oracle strength:**
- The e2e tests are black-box HTTP via supertest. Across all e2e files they import only `app.module`, a few entities, `services/mail.service`, `connection/datasource` and two formatters: 9 import lines in total.
- So the tests are an independent behaviour oracle, not something the refactor co-edits.

**Hazards (confirmed and new):**
- `baseUrl: ./src` bare imports:
  - `formatters/strings.ts` → `'domain/formatters'`. This shadows Node core `domain`. The imports are type-only, so it's tsc-only resolution.
  - `shutdown.handler.ts` → `'types'`.
- `connection/datasource.ts` uses `${__dirname}/../entity/*.entity.{js,ts}` and `${__dirname}/../migrations/*`. Moving entities, or changing datasource's depth, empties the glob, so it must be caught before tests run.
- `config.ts` has a second, cwd-relative `entities: ['src/entity/*.entity*']`.
- `formatters/fixtures/index.ts` calls `readFileSync('src/formatters/fixtures/${name}')`, which is cwd-relative.
- Migrations import `../config` and `../utils/database-type-helper`. Migrations should be pinned.
- Two migration filenames contain spaces (`1537531930470-add locales.ts`).
- `createAndMigrateApp()` in `api/test/util.ts` **catches and only logs** dropDatabase/migration errors. That's a finding to record, not fix.
- Small cycle: one 4-file SCC.

**Install risk:**
- **`api/yarn.lock` is stale** (Nest 8.0.6, typeorm 0.2.37). The real lock is the root `yarn.lock` (workspaces), which pins `better-sqlite3@9.6.0`.
- v9.6.0 has linux-arm64 prebuilds only for node-v108/115/120; there's no v127 (Node 22) (https://github.com/WiseLibs/better-sqlite3/releases/tag/v9.6.0). Node 22 support arrived in v10.0.0 ("Add Node.js v22", https://github.com/WiseLibs/better-sqlite3/releases/tag/v10.0.0).
- **So on this host, use a project-local Node 20, which matches CircleCI's 20.19.0.** Whether a source build under Node 22 works is UNVERIFIED.
- The root workspace install also pulls in the Angular 19 webapp.

**Bad on camera:**
- Small (6.1k LOC). It may read as a toy.
- 12 of 16 controllers inject TypeORM repositories directly, so the modules come out as thin "controller + entity" pairs. Good findings material, thin visuals.

### 3. openhab-cloud: KEEP as checker bring-up target, not the demo

**Confirmed:**
- `test:unit` runs `mocha --require tsx tests/mocha/unit/**/*.ts`.
- The CI `unit-tests` job has no services; Mongo and Redis appear only in `integration-tests`.
- Unit tests stub mongoose `readyState` and redis. No proxyquire or `require.cache` tricks.
- CommonJS, no `paths`, no decorators.
- **The import graph is acyclic.**

**Corrections and new findings:**
- There are **7 per-layer barrels**, not 1: `controllers/`, `models/`, `services/`, `socket/`, `jobs/`, `middleware/`, `types/` `index.ts`. `routes/index.ts` is a 952-LOC route-wiring file, not a barrel.
- `models/index.ts` already groups its exports under domain comments ("User & Account", "OpenHAB", "Devices", …). That's a useful planner hint.
- **The test glob is unquoted, so `/bin/sh` (dash) expands `**` like `*`.** That matches depth-1 test files only. Today all 31 test files sit at exactly `tests/mocha/unit/<dir>/<file>.ts`, so nothing is dropped yet. But any restructure that nests tests deeper would *silently drop them* from the run. This is a glob certificate case.
- `__dirname` usage: `src/app.ts:166,170,269,540` and `src/cli/db-connect.ts`. `process.cwd()` is used in `email.service.ts`.

**Bad on camera:** small, an IoT domain that's niche for judges, and the oracle is unit tests only.

### 4. seerr (`server/`): DEMOTE

- **Confirmed: 140 of 336 frontend files in `src/` import `@server/*`** (models 72, constants 65, interfaces 55, lib 38, entity 26, api 16, types 6). Server moves ripple into the Next.js app.
- The test runner globs `server/**/*.test.ts` plus `src/**/*.test.ts`. `setup.ts` blocks non-loopback HTTP. The datasource uses sqlite `:memory:` when `NODE_ENV==='test'`.
- sqlite3 5.1.7 has a napi-v6 linux-arm64 prebuild, so no native blocker.
- Thin oracle: ~221 cases for 35k LOC.
- 14 files use `__dirname`. `settings/migrator.ts` does readdir plus dynamic import.
- Shares the root `package.json` and tsconfig with the Next app.

### 5. immich (`server/`): DEMOTE (stretch only)

- Confirmed:
  - vitest unit config includes `src/**/*.spec.ts`.
  - The medium tests need testcontainers.
  - 37 `queries/*.repository.sql` files, generated per repository class name (`sync-sql.ts`).
  - **All 2,601 internal imports use the `src/` alias; there are 0 relative ones.**
  - 5 barrels exporting DI arrays.
- New: the CI `ci-unit` task runs `//:plugins` first. That builds `@immich/plugin-core` with `extism-js … -o dist/plugin.wasm`, and the plugin packages use `typescript ^7.0.0`. The server itself uses `npm:@typescript/typescript6`. Whether server unit tests can run without the plugin build is UNVERIFIED, and ts-morph compatibility with a TS 6 project is UNVERIFIED.
- Size: 55.8k LOC, about the same as mcphub (the prior shortlist framed only Immich as "at the size cap"). Install is the heaviest of the set.

### 6. nostream: DEMOTE

- Confirmed: mocha with ts-node, 157 unit specs, CI unit job with no services.
- New:
  - 3 route specs use **proxyquire**, which takes string module paths (a second mock-path dialect).
  - 4 CLI specs import `dist/`, so tests depend on build output.
  - `controllers/` and `handlers/` are already sub-grouped by feature: `admin/`, `invoices/`, `callbacks/`, `event-strategies/`, `request-handlers/`.
  - The Nostr domain is unfamiliar to judges.

### Alternates
- **clean-ts-api: REJECT as a run target; keep only as a narrative slide.**
  - `jest.config.js` sets `preset: '@shelf/jest-mongodb'`, and `jest-unit-config.js` and `jest-integration-config.js` both `require('./jest.config')`. So the mongo globalSetup runs for unit tests too.
  - The binary is pinned to `4.0.3`. `fastdl.mongodb.org` returns 403 for aarch64 ubuntu1804/2004/2204 builds and 200 only for `mongodb-linux-arm64-ubuntu1604-4.0.3.tgz`, which also likely needs libssl1.0 (missing on 22.04; UNVERIFIED).
  - Needs the network on first run. jest 27 / TS 4.4. Only 3 domains. `main/` holds 91 of 179 files.
- **realworld-express-prisma: DEMOTE to a benchmark/scramble fixture.**
  - 46 stars, no CI.
  - Of 14 tests, 13 are validators/viewers and 1 is a controller test.
  - The `test` script uses `dotenv -e .env.development`, and that file isn't in the repo.
  - Needs `prisma generate` plus an engine download.

---

## Recommendation

**Best demo target: samanhappy/mcphub @ `70cf036c`**
- Why:
  - AI/MCP domain that judges will recognise; Apache-2.0.
  - Mid-size, pure type-slicing (dao, db entity/repository, services, controllers).
  - ~1,800 offline test cases.
  - Hazards a generic agent will predictably break: 120 relative `jest.mock` strings, 12 literal dynamic imports, the frontend → `src/utils/basePath` edge, `registry.ts`'s cwd-based override paths, and `utils/path.ts`'s test-invisible depth assumption.
  - That makes the G3 baseline A/B and the "tests can't see this, the certificate did" beat concrete.
- Preconditions:
  - Pin the SHA.
  - Exclude or pre-warm `sse-service-real-client.test.ts`.
  - Treat `types/index.ts` and `utils/logger.ts` as a shared kernel.
  - Pin or co-move `utils/path.ts`, `utils/moduleDir.ts`, `services/registry.ts`, `utils/i18n.ts`.
  - Budget a "move tests to mirror" rung.
  - Present the 85-file cycle and the god files as headline findings, not as a failure.

**Best backup: ever-traduora `api/` @ `f29a2167`**
- Why:
  - The only candidate whose behaviour oracle is **black-box and independent of the refactor**: 115 HTTP e2e tests touching 9 src import lines.
  - CircleCI-proven green on sqlite at HEAD.
  - Smallest token cost (6.1k LOC).
  - Legible domains: project, term, translation, locale, label, invite, client, plan, user, auth, import/export.
  - Exercises the baseUrl, `__dirname`-glob and regex match-set certificates.
- Preconditions: a project-local Node 20 for better-sqlite3 9.6.0, the root `yarn.lock` (not `api/yarn.lock`), and AGPL hygiene for any published target code (the forked target keeps its license).

**Fallback rule.** If the G1 plan on mcphub looks wrong to corupta (the 85-file SCC is the likely cause), promote traduora to main demo. Use openhab-cloud as the first end-to-end checker bring-up either way: acyclic, CommonJS, no aliases, 452 unit cases.

**Across-the-board risks for the video:**
- Move-only can't shrink god files. Say so up front as "made obvious, not fixed".
- Type-mirrored test trees make diffs look huge. Show the certificate summary, not raw diffs.
- AGPL targets (traduora, immich) constrain how target source appears in a hosted replay.

## Still UNVERIFIED
- Wall-clock runtime of the mcphub suite.
- Whether the server unit tests in immich need the plugin build.
- Whether better-sqlite3 9.6.0 compiles under Node 22.
- realworld-express-prisma's behaviour with a missing `.env.development`.
- clean-ts-api's exact mongodb-memory-server failure mode on arm64.
