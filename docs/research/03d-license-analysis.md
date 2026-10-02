# Track 3d: target license analysis (with an independent demo-target ranking)

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

# architecture-cleaner: demo-target research (2026-10-02)

Process note: early on I wrote 3 temp files to `/dev/shm`, which is RAM-backed tmpfs (`immich.json`, `scan.py`, `immich.pkl`). I deleted them right away. After that, every tarball was streamed into Python memory only. No clones and no other writes.

## TL;DR ranking against the mcphub bar

| Rank | Repo | Stars | License | Fit | Offline tests | Score |
|---|---|---|---|---|---|---|
| 1 | immich-app/immich `server/src` | 115,437 | AGPL-3.0 (OSI) | **full** | ~1,830 vitest cases, no CI services | **9** |
| 2 | directus/directus `api/src` | 38,007 | MSCL-1.0-GPL (not OSI; permissive for our use) | scoped/full | ~4,300 cases (knex-mock) | 7 |
| 3 | FlowiseAI/Flowise `packages/server/src` | 55,493 | Apache-2.0 + Commercial `enterprise/` | scoped | 32 files, ~939 cases | 6 |
| 4 | logto-io/logto `packages/core/src` | 14,649 | MPL-2.0 | scoped (routes pinned) | ~2,950 cases | 6 |
| 5 | n8n-io/n8n `packages/cli/src` | 206,476 | SUL + n8n EE (not OSI) | scoped | ~8.6k cases touching scope (sqlite) | 5 (license) |
| 6 | strapi/strapi admin server | 73,271 | MIT + `ee/` EE | scoped | ~664 cases | 5 |
| 7 | Unleash/unleash `src/lib` | 13,850 | AGPL-3.0-or-later | scoped | globalSetup needs Postgres | 5 (cap) |
| – | outline 4 · budibase 4 · nocodb 3 · lobehub 3 · tooljet 2 · joplin-server 2 | | | | | |
| ref | samanhappy/mcphub | 2,488 | Apache-2.0 | full | ~1,800 jest | bar |
| ref | ever-co/ever-traduora | 2,132 | AGPL-3.0 | full | – | – |

Reference pins:
- mcphub: SHA `70cf036c90f8239c2a11a57f137b588fce7d1b0c`, last commit 2026-10-01.
- traduora: SHA `f29a2167284c6df2c30c5066bf166f7268cb0af5`, last commit 2026-08-05.

**Recommendation:** make immich the primary demo target. Keep mcphub as the fallback and benchmark target. Directus is the second showcase if breadth is wanted. Use n8n only as a read-only "plan + findings" showcase, with no published fork or diffs, unless n8n grants written permission (license@n8n.io).

---

## Card 1: immich (score 9)

**1. Identity**
- https://github.com/immich-app/immich
- License: `AGPL-3.0`, OSI-approved (`LICENSE`; `server/package.json` says "GNU Affero General Public License version 3").
- 115,437 stars. Last commit 2026-10-01T17:34Z.
- HEAD `02063972e82b1bfd17b6fc2e3b3ff39936229ea5`. Server version 3.3.0-rc.0, NestJS 12.

**2. Subtree**
- `server/src` is purely type-sliced, 458 non-test `.ts` files:
  - `controllers/` 47 (incl. `index.ts`)
  - `services/` 56 (incl. `base.service.ts`, `index.ts`, `shared/user-methods.ts`)
  - `repositories/` 57
  - `dtos/` 52
  - `utils/` 32, `middleware/` 7, `cores/` 1
  - `schema/` 168 (tables plus 101 migrations), `commands/` 10, `emails/` 9 (`.tsx`), `maintenance/` 5, `workers/` 3, `bin/` 2
- Moved set: about 212 files (controllers, services, repositories, dtos), up to about 252 with middleware, utils and cores. 105 co-located specs travel with them.
- Domains: 46 stems appear in two or more role folders: activity, album, api-key, asset, asset-media, asset-file, auth, cluster-group, database-backup, download, duplicate, integrity, job, library, map, memory, metadata, notification, oauth, ocr, partner, person, plugin, queue, search, server, session, shared-link, stack, storage, sync, system-config, system-metadata, tag, telemetry, timeline, trash, user, video-stream, view, workflow, and others.
- Files already follow `<stem>.<role>.ts`, e.g. `album.controller.ts`, `album.service.ts`, `album.repository.ts`, `album.dto.ts`.

**3. Applicability**
- DI is NestJS by class reference.
- `app.module.ts` builds providers from explicit registry arrays: `controllers/index.ts`, `services/index.ts`, `repositories/index.ts`. These are arrays, not re-export barrels.
- Imports: `tsconfig` has `paths {"src/*": ["./src/*"]}` and `module: nodenext`, so specifiers look like `src/services/album.service.js`. 2,343 alias imports and only 1 relative import.
- Location-sensitive files to pin:
  - `repositories/config.repository.ts:161` uses `join(import.meta.dirname,'..','..','helmet.json')`.
  - `repositories/database.repository.ts:511` uses `migrationFolder: join(import.meta.dirname,'..','schema/migrations')`.
  - `services/cli.service.ts:25` uses `readdir(join(import.meta.dirname,'../schema/migrations'))`.
  - `constants.ts`, `main.ts` (workers by path) and `maintenance-health.repository.ts` are outside the moved set.
- Generated code: `bin/sync-sql.ts` writes `src/queries/*.sql`. File names come from the class name (`Repository.name`), not the file path, so moves don't affect it. CI's "SQL files have not changed" check still holds.
- The `@nestjs/swagger` CLI plugin keys on `.dto.ts` / `.controller.ts` suffixes (`nest-cli.json`). The `<stem>.<role>.ts` convention preserves them.
- Path-carrying configs: the coverage `include: ['src/services/**', …]` in `test/vitest.config.mjs` needs a path rewrite. The test `include: ['src/**/*.spec.ts']` is unaffected.
- No package outside `server/` imports `server/src`. e2e and `packages/cli` use `@immich/sdk`.
- **Verdict: full.** Pin 3 files plus `schema/`, `emails/`, `workers/`, `main.ts`. Open question: the registries left behind in `controllers/index.ts` etc. need a home in `platform/` (that would be a rename).

**4. Tests**
- vitest 4 with `unplugin-swc`. Unit config: `server/test/vitest.config.mjs`, `include src/**/*.spec.ts`, no global setup.
- CI `server-unit-tests` runs `mise run //server:ci-unit` with no `services:` block (`.github/workflows/test.yml`).
- Services are tested with mocked repositories from `server/test/utils.ts`. Controller specs use supertest; 19 of them import only `test/medium/responses.js` matchers.
- About 1,830 static cases, plus 28 `it.each`:

  | Area | Spec files | Cases |
  |---|---|---|
  | services | 46 | 1,357 |
  | controllers | 35 | 227 |
  | utils | 11 | 135 |
  | repositories | 6 | 63 |
  | dtos | 3 | 13 |

- About 1,660 of those cases touch the moved set.
- Not offline: `test/medium` (68 files, ~707 cases). `test/medium/globalSetup.ts` uses testcontainers Postgres (`ghcr.io/immich-app/postgres:14-vectorchord`). Exclude it.

**5. Install weight (aarch64, Node 22)**
- `pnpm install --filter immich` (pnpm 11, root `mise.toml`), then build `@immich/plugin-sdk` and `@immich/sdk`, which `dtos/workflow.dto.ts` and `services/workflow*.ts` need, using esbuild + tsc + tsc-alias.
- `ci-unit` also runs `//:plugins`, which builds plugin-core wasm via `extism-js`. An aarch64-linux asset exists for js-pdk v1.7.0. Probably not needed for unit tests (UNVERIFIED).
- Native: sharp ^0.35 (prebuilt arm64), bcrypt 6 (`node-gyp-build` with prebuilds, compiles as fallback). `@typescript/native` = typescript@7, which ships `@typescript/typescript-linux-arm64` (npm registry).
- mise pins Node 24.21.0 and `server/package.json` has no `engines`. Node 22 compatibility is UNVERIFIED; fall back to a project-local Node 24 tarball.
- Checker risk: immich type-checks with TS 7 (Go). ts-morph runs on the TS 5/6 API, so the parse oracle and the tsc oracle differ.

**6. Demo appeal**
- After-tree: `modules/{album(+album-user), asset(+asset-media,-file,-edit,-job), auth(+auth-admin,oauth,session), person(+person-user,face), user(+user-admin), library, memory, partner, shared-link, stack, tag, timeline, trash, search, sync, duplicate, map, notification, ocr, workflow/plugin, job/queue, system-config, database-backup, download, media/transcoding/hls/video-stream, view, …}`, `shared/` (bytes, date, set, object, pagination), `platform/` (config, crypto, logging, event, telemetry, websocket, storage repositories; middleware; `base.service.ts`; registries).
- Headline findings:
  - `services/base.service.ts` injects **55 repositories** into every service, so every module can reach every table.
  - God files: `repositories/asset.repository.ts` 1,260 lines, `services/metadata.service.ts` 1,176, `repositories/person.repository.ts` 1,098, `services/sync.service.ts` 1,015.
  - `metadata.service` and `person.service` each touch 14 repositories, a sign of cross-module DB access. Which of those touches are writes is UNVERIFIED.
  - Naming drift that file normalization can fix: `repositories/view-repository.ts`, and `asset-ids.response.dto.ts` next to `asset-media-response.dto.ts`.
- Hook: "the most-starred self-hosted TypeScript backend on GitHub. immich already has one feature folder (`maintenance/`); we give the other 46 domains the same, with a certificate."

**7. Planner input:** about 252 × 80 ≈ **20k tokens**; the whole `server/src` (458 files) ≈ 37k.

**8. Red flags**
- Very high commit velocity; pin the SHA.
- The `BaseService` god-base will make generated boundary rules flag nearly everything. Classify it as platform and show the violation count as a finding.
- Fork must stay AGPL with modification notices.
- No logos in the video (Devpost rules).
- **Score 9.**

## Card 2: Directus (score 7)

**1. Identity**
- https://github.com/directus/directus
- License: **MSCL-1.0-GPL** ("Monospace Sustainable Core License"; root `license`). Not OSI. It is no longer BSL.
- 38,007 stars. Last commit 2026-10-01. HEAD `7e9b03504c6094bac8dace713c11a6f909016057`.

**2. Subtree**
- `api/src` has 839 non-test `.ts` files. Type-sliced parts:
  - `controllers/` 42 (flat `users.ts`, `roles.ts`, …)
  - `services/` 114 (flat files plus `graphql/`, `tus/`, `mail/`, `mcp-oauth/` subfolders)
  - `middleware/` 21
  - `utils/` 111
  - `database/` 213
- Already feature-ish: `permissions/` (55), `websocket/` (31), `ai/` (62).
- Moved set: controllers + services + middleware = 177 files.
- About 30 domains: item, collection, field, relation, file, folder, asset, tus, user, role, policy, permission, access, activity, revision, comment, notification, share, preset, dashboard, panel, flow, operation, setting, server, extension, translation, version, schema, deployment, mcp.

**3. Applicability**
- Express. Controllers are imported explicitly in `app.ts` (40 imports). ESM with relative `.js` specifiers (949).
- Existing barrel `services/index.ts`: 42 re-exports, 19 importers. It stays; only its specifiers change.
- Lazy-import cycles: `services/items.ts:332` `await import('./activity.js')`, `payload.ts:596`, `versions.ts:88`.
- Location-sensitive:
  - `services/mail/index.ts:21,114` (`__dirname/templates`)
  - `controllers/mcp/oauth-consent-page.ts:14` (templates)
  - Move these with their assets or pin them.
- The build copies `src/**/*.{yaml,liquid,md}` by glob (`api/package.json`); the match set is preserved.
- Rename question: does `controllers/users.ts` become `user.controller.ts` (adds a role suffix and singularizes)?
- **Verdict: scoped (controllers/services/middleware) or full.**

**4. Tests**
- vitest. `api/vitest.config.ts` uses globalSetup `src/__setup__/global.js`, which only imports `sharp` and `isolated-vm`.
- 393 test files, about 4,318 cases. 30 files use `knex-mock-client`; testcontainers appear 0 times.
- In scope: controllers 9 files / 76 cases, services 65 / 1,223, middleware 9 / 80.
- CI `check.yml` unit job has no services but builds every package first.
- **Offline.**

**5. Install weight**
- pnpm monorepo (`@directus/*` packages, plus `@directus/app`, a Vue app). The full build is needed before tests (CI comment, `check.yml` L103-105).
- Native: argon2 0.44, sharp 0.35, **isolated-vm 5.0.3** (`prebuild-install || node-gyp rebuild`; whether an arm64 prebuild exists is UNVERIFIED, so a compile may be needed).
- Node ≥22, which matches the host.

**6. Demo appeal**
- 23 services `extends ItemsService` (inheritance coupling).
- God files: `mcp-oauth/index.ts` 2,019 lines, `items.ts` 1,291, `payload.ts` 1,108, `fields.ts` 1,054.
- The lazy imports show cycles: items↔activity/revisions, payload↔`utils/get-service`, versions↔collections.

**7. Planner input:** 177 × 80 ≈ 14k; full ≈ 67k.

**8. Red flags:** non-OSI license (see the license section), heavy full-monorepo build, isolated-vm on arm64. **Score 7.**

## Card 3: n8n (score 5, license-capped judgment)

**1. Identity**
- https://github.com/n8n-io/n8n
- License: **Sustainable Use License 1.0** plus the **n8n Enterprise License** for `.ee.` files and dirs (`LICENSE.md`, `LICENSE_EE.md`). Not OSI.
- 206,476 stars. Last commit 2026-10-01. HEAD `56aa3d8857ebb3304f28bc590e7eba36eab1219a`.

**2. Subtree**
- `packages/cli/src` is mixed. 33 module dirs under `modules/` (1,323 files) and feature dirs (`workflows/`, `executions/`, `credentials/`, …) sit next to legacy `controllers/` (39) and `services/` (70).
- Scoped moved set: 109 files.
- Domains: user/auth (auth, me, mfa, password-reset, invitation, owner, users), project, folder, tag/annotation-tag, api-key, ai (ai, ai-preference, ai-gateway, ai-usage), workflow-statistics, role, security-settings, oauth, engine-v2, pruning, import/export. That is at least 10.

**3. Applicability**
- `@n8n/di` by class reference. Controllers are registered by side-effect imports in `server.ts` (27).
- `@/*` alias. Extensions are mixed: `.js` on dynamic imports, none on static ones.
- Literal dynamic imports, e.g. `services/user.service.ts:703-721`, `project.service.ee.ts:107-155`.
- `translation.controller.ts:41` does `require(translationPath)` (package-relative): pin it.
- **Conflict:** n8n's own `ModuleRegistry` loads `modules/<name>/<name>.module.js` by name (`packages/@n8n/backend-common/src/modules/module-registry.ts:18-19`). Our `src/modules/<x>/` target would collide with n8n's module concept, and we can't generate `.module.ts` files.
- 18 EE-licensed non-test files import the scope.
- **Verdict: scoped, but needs a different target root.**

**4. Tests**
- vitest. Unit and integration run with `DB_TYPE=sqlite` (`packages/cli/package.json` scripts).
- 319 test files touch the scope, about 8,595 cases, including 81 sqlite integration files (~2,150 cases). The whole CLI has 1,785 files and ~29.5k cases.
- **Offline.**

**5. Install weight:** `engines.node >=24.0.0`, which is not the host's Node 22. pnpm/turbo monorepo with about 60 packages (`nodes-base` alone is 7.8k files). Tests use `workspaceDistExternals`, so the dists must be built. Very heavy; exact build time UNVERIFIED.

**6. Demo appeal**
- Biggest name.
- Stalled migration: 33 modules versus 109 legacy files.
- `project.service.ee.ts` has 9 lazy imports reaching into `modules/agents`, `data-table` and `external-secrets` (a god coordinator). `user.service.ts` uses lazy imports to break cycles.

**7. Planner input:** about 9k tokens for the scope.

**8. Red flags**
- SUL limits modification to "internal business purposes or non-commercial or personal use".
- EE license: "forbidden to copy, merge, publish, distribute" except development and testing.
- n8n's LICENSE says content of non-master branches is "not licensed", which makes a fork branch ambiguous.
- Node 24, and the `src/modules` collision.
- **Score 5.**

## Card 4: Flowise (score 6)

**1. Identity**
- https://github.com/FlowiseAI/Flowise
- License: Apache-2.0, except `packages/server/src/enterprise/` and files with an explicit notice such as `IdentityManager.ts`, which fall under a Commercial License (`LICENSE.md`).
- 55,493 stars. **Last commit 2026-08-13** (slowing). HEAD `9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb`.

**2. Subtree**
- `packages/server/src` is sliced type-then-feature: `controllers/<feature>/index.ts` (48), `services/<feature>/` (50), `routes/<feature>/` (62).
- Moved set: 163 files across about 45 domains (chatflow, assistant, credential, documentstore, evaluation, execution, marketplace, prediction, tool, variable, …).

**3. Applicability**
- Express with explicit imports. TypeORM entities are an explicit list (`DataSource.ts`).
- `__dirname`-relative reads in `services/marketplaces/index.ts:32-98`, `agentflowv2-generator:104`, `log:75`, `versions:11-15`. Moves that keep the same depth keep these paths valid, but pin conservatively.
- Every file is `index.ts`, so each move is also a rename to `<stem>.<role>.ts`.
- 26 Commercial-License `enterprise/` files import the scope.
- **Verdict: scoped.**

**4. Tests:** jest + ts-jest (`packages/server/jest.config.js`, typeorm mocked through `moduleNameMapper`). 32 files, about 939 cases, heavy `jest.mock` (specifiers need rewriting). Offline, but thin.

**5. Install weight:** Node `^24`. Depends on the `flowise-components` workspace (huge LangChain tree). Heavy.

**6. Demo appeal:** controller/service/route triplets per feature collapse cleanly into modules.

**7. Planner input:** about 13k tokens.

**8. Red flags:** thin tests, Commercial-License coupling, slowing activity. **Score 6.**

## Card 5: Logto (score 6)

**1. Identity**
- https://github.com/logto-io/logto
- License: `MPL-2.0`, OSI-approved.
- 14,649 stars. Last commit 2026-09-30. HEAD `c814034401b0e13a6f461e0b0835ad3bbb84c9c2`.

**2. Subtree**
- `packages/core/src`: `routes/` 208, `libraries/` 67, `queries/` 59 (56 entities), `middleware/` 42, `utils/` 53.

**3. Applicability**
- `routes/` is glob-scanned: `routes/swagger/utils/documents.ts:242-251` runs `findUp('routes')` plus `findSupplementFiles` over 85 co-located `*.openapi.json` files. So `routes/` is pinned.
- Movable: libraries + queries + middleware ≈ 168 files.
- Uses the package.json `imports` map `#src/*` → `./build/*` (1,237 specifiers), and `mockEsm('#src/...')` specifier strings. The checker must support both.
- **Verdict: scoped.**

**4. Tests:** jest ESM (`--experimental-vm-modules`), run on tsc output in `build/`. `jest.setup.js` sets `DB_URL='postgres://mock.db.url'`. 323 files, about 2,951 cases; only 3 look DB-ish. **Offline.**

**5. Install weight:** Node `^22.14` (matches the host). pnpm workspace with about 15 `@logto/*` workspace dependencies to build.

**6–7. Demo appeal and planner input:** queries + libraries pair cleanly per entity. About 13k tokens.

**8. Red flags:** mid-tier popularity, and controllers (routes) stay put. **Score 6.**

## Card 6: Strapi admin server (score 5, partly UNVERIFIED)

- https://github.com/strapi/strapi, MIT except `ee/` (EE license per root `LICENSE`). 73,271 stars. HEAD `aa939d34f59aebe59aaa484f15b81721271864dc`.
- `packages/core/admin/server/src`: services 33, controllers 20, validation 19, routes 13, content-types 9, strategies 6, policies 4, middlewares 3. Scope is 113 files.
- Registries are keyed by name through `index.ts` objects, so moves are safe.
- Pin `routes/serve-admin-panel.ts:21` (`resolve(__dirname,'../../build')`).
- 8 `ee/server` files import the scope.
- jest: 47 test files, about 664 cases. Offline, assumed from the mock-strapi pattern (UNVERIFIED).
- Red flags:
  - It goes against Strapi's documented plugin folder convention.
  - EE coupling.
  - yarn4/nx build is heavy.
  - The EE license text was not read.

## Card 7: Unleash (score 5, capped)

- https://github.com/Unleash/unleash, now **AGPL-3.0-or-later** (`LICENSE`, `package.json`). 13,850 stars. HEAD `89672116b1a395f940eaebbb9ee1a4572e259e8e`.
- Textbook stalled migration: `src/lib/features/` has 48 dirs and 281 files. Legacy `routes/` 37, `services/` 36, `db/` 29 and `middleware/` 26 remain; 128 feature files still import the legacy dirs.
- `email-service.ts:808` uses `__dirname/../../mailtemplates`: pin it.
- Tests: vitest `src/test-setup.ts` globalSetup **always connects to Postgres**. There are 237 non-DB unit files (~1.16k cases), but they only run with a harness-supplied config override.
- Node ≥22. **Score 5.**

## Short cards (score 4 or less)

**Outline** (score 4)
- https://github.com/outline/outline, BSL 1.1 (Change Date 2030-09-09 → Apache-2.0). 40,777 stars. HEAD `d410db1b…`.
- `server/` has models 75, presenters 41, policies 32, commands 23; `routes/api` is already per-feature.
- Tests need Postgres and Redis (`.env.test` DATABASE_URL; `ci.yml` starts postgresql).

**Budibase** (score 4)
- 28,328 stars. HEAD `ee2f184b…`. License GPL-3.0 (UNVERIFIED).
- `api/controllers` 132 and `api/routes` 71 next to `sdk/workspace` 158 (a stalled migration).
- Root `globalSetup.ts` uses testcontainers/docker.

**NocoDB** (score 3)
- 65,149 stars. HEAD `799d458a…` (develop).
- **SUL since 2026-01-29** (`LICENSE.md`). Node ≥24.
- controllers 78, services 163, models 96, but `modules/` and `helpers/` are already mixed in.
- No meaningful offline suite: `tests/` holds 35 files, mostly MySQL dumps; co-located specs are Nest scaffolds (UNVERIFIED).

**LobeHub** (score 3)
- `lobehub/lobe-chat` redirects to `lobehub/lobehub`. 82,951 stars. HEAD `4bcb808c…`.
- LobeHub Community License: "a commercial license must be obtained … to develop and distribute a derivative work".
- `apps/server/src/services` already has 88 per-feature dirs, and models live in a different package (`packages/database`).

**ToolJet** (score 2): 41,025 stars. 1,076 of 1,235 `server/src` files are already in `modules/`. Not applicable.

**Joplin Server** (score 2): 56,554 stars. `packages/server/LICENSE.md` is the "Joplin Server Personal Use License", which bars "modifying, creating derivative works … publishing … displaying" for commercial purposes. Decline.

**Not applicable (already feature-sliced or layered):**
- anomalyco/opencode (`sst/opencode` redirects there): `packages/opencode/src/{session,provider,tool,server,…}`.
- supabase/storage: `src/{http,storage,internal}`.
- vscode and nestjs/nest were not examined. Calling them non-fits (no type-sliced app backend) is UNVERIFIED.

---

## License analysis

### Hackathon rules (https://nebiusglobalaihackathon.devpost.com/rules)

- **Video:** "must not include third party trademarks, or copyrighted music or other material unless the Entrant has permission to use such material." Target code on screen is third-party copyrighted material, so the permission has to come from its license. Show no logos.
- **IP:** a Submission must be "(a) … original work product; (b) … solely owned by you … (c) not violate the intellectual property rights …".
  - Safe harbor: "may submit a Submission that includes the use of open source software … provided the Entrant complies with applicable open source licenses and … creates software that enhances and builds upon …"
  - Warranty: "submitted content is not copyrighted … or otherwise subject to third party intellectual property rights … unless entrant … has permission from their rightful owner to post the content."
- **Our repo** "must be public and open source by including an open source license file (such as Apache 2.0, MIT, or MPL 2.0)".
- **After the deadline**, Sponsor and Devpost may allow edits "for the purpose of adding, removing or replacing material that potentially infringes a third party mark or right".
- **Implications:**
  1. Never vendor target code into our tool repo. Clone it by SHA at runtime, which keeps clause (b) and the OSS-license requirement clean.
  2. The open-source safe harbor only covers OSI licenses. Non-OSI targets rely on the license grant alone.
  3. Keep the public fork outside the Submission, linked only as an artifact.

### Per-license verdicts

All five licenses were read in full: n8n `LICENSE.md` + `LICENSE_EE.md`, Directus `license`, Outline `LICENSE` (BSL 1.1), Elastic `ELASTIC-LICENSE-2.0.txt`, Joplin `packages/server/LICENSE.md`. The OSI terms are standard and cited from memory, so marked UNVERIFIED-text.

| License | Video OK? | Replay site with excerpts/diffs OK? | Public fork OK? | Obligations | Risk |
|---|---|---|---|---|---|
| **MIT** | Yes | Yes | Yes | Keep copyright + permission notice | Low |
| **Apache-2.0** | Yes | Yes | Yes | §4: LICENSE copy; "prominent notices" in modified files; keep NOTICE; no trademark grant (§6) | Low |
| **MPL-2.0** | Yes | Yes | Yes | Modified MPL files stay MPL, source available; keep notices | Low |
| **EPL-2.0** | Yes | Yes | Yes | Source of modified files under EPL; keep notices | Low |
| **AGPL-3.0 / GPL-3.0** | Yes | Yes (label each excerpt with path@SHA, license name and link) | Yes | §5a "prominent notices stating that you modified it… relevant date"; §5c whole fork under AGPL; source public. §13 triggers only if we *run* the modified server for remote users; a static replay doesn't. Our tool repo stays MIT/Apache because §5 aggregation applies if target code isn't bundled. | Low |
| **BSL 1.1** (Outline) | Yes | Yes | Yes | Grants "copy, modify, create derivative works, redistribute, and make non-production use". Our demo is non-production. All copies and derivatives stay under BSL with the same parameters. | Low–Med (not OSI, so outside the Devpost safe harbor) |
| **Elastic License 2.0** | Yes | Yes | Yes | No hosted/managed service, no license-key circumvention, keep notices, pass terms on to recipients | Low–Med (not OSI) |
| **MSCL-1.0-GPL** (Directus) | Yes | Yes ("publicly display" granted) | Yes | Any purpose except a "Competing Use"; explicitly lists "non-commercial research"/"education". Must include license copy or link, keep notices, add no restrictions. Becomes GPL-3.0 after 4 years. | Low–Med (not OSI) |
| **n8n SUL** | Gray | Gray | **Avoid** | "use or modify … only for … internal business purposes or for non-commercial or personal use"; "distribute … only … free of charge for non-commercial purposes"; "prominent notice" on modified copies; pass terms on. The FAQ allows "personal projects, learning or research", but a cash-prize entry is arguably commercial. LICENSE says non-master branches are "not licensed". | **Med–High** |
| **n8n EE / Flowise Commercial / Strapi `ee/`** | No excerpts | No | **No** | n8n EE: "forbidden to copy, merge, publish, distribute"; copying and modifying allowed only "for development and testing". Never publish modified EE files; keep them out of the moved set and out of excerpts. | **High** |
| **LobeHub Community** | Yes | Risky | **No** | "commercial license must be obtained … to develop and distribute a derivative work" | High |
| **Joplin Server Personal Use** | Risky | No | **No** | Personal, non-commercial only; bars modifying, publishing and displaying for commercial purposes | High |

### Recommendation on accepted licenses

- **Accept** OSI licenses: MIT, Apache-2.0, MPL-2.0, EPL-2.0, GPL-3.0, AGPL-3.0. They sit inside Devpost's open-source safe harbor, with no commercial ambiguity.
- **Accept with a notice block** BSL 1.1, ELv2 and MSCL. Their grants cover display, modification and redistribution for non-production or non-competing use.
- **Reject** SUL, any EE/Commercial directories, LobeHub, and Joplin Server, unless written permission is obtained.
- **For every target:**
  - Text-only project name with a "not affiliated" line; no logos.
  - Every excerpt labeled with repo@SHA, path, license name and a link.
  - Fork README states it was modified by architecture-cleaner, with the date, and keeps LICENSE/NOTICE.
  - Target code never enters our tool repo.
- With immich (AGPL), all of this is low-risk.
