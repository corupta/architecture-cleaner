# Track 3c: popular demo-target hunt

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# immich (deep check)

# immich-app/immich (server/) deep-check card

All file paths below are relative to `https://github.com/immich-app/immich/blob/02063972e82b1bfd17b6fc2e3b3ff39936229ea5/`. Every number comes from streaming the codeload tarball at that SHA into memory. I wrote nothing to disk and ran no code.

## 1. Identity
- URL: https://github.com/immich-app/immich
- License: AGPL-3.0, which is OSI-approved. `LICENSE` is the GNU AGPL v3 text, and `server/package.json` says "GNU Affero General Public License version 3". The repo does not say whether it is -only or -or-later: UNVERIFIED.
- Stars: 115,437 (repo page `aria-label`).
- Last commit: 2026-10-01T17:34:56Z (`commits/main.atom`).
- Pinned HEAD: `02063972e82b1bfd17b6fc2e3b3ff39936229ea5` (git ls-remote).

## 2. Subtree and size
- **Type-sliced subtree:** `server/src/` (NestJS 12, ESM nodenext).
- **Non-test .ts/.tsx under server/src:** 458 files, 61,117 LOC. Prior notes said 349 / 55.8k, which is stale.
- **Non-test files by folder:** schema 168 (migrations 101 + tables 65 + 3 files), repositories 57, services 56, dtos 52, controllers 47, utils 32, commands 10, root 9, emails 9, middleware 7, maintenance 5, workers 3, bin 2, cores 1.
- **Not TS:** `queries/` holds 37 `.sql` files.
- **Unit specs:** 105 `*.spec.ts`, co-located: services 46, controllers 35, utils 11, repositories 6, dtos 3, plus 4 elsewhere.
- **Layout excerpt:**
  ```
  server/src/{app.module.ts,app.common.ts,main.ts,constants.ts,enum.ts,types.ts,database.ts,decorators.ts,validation.ts}
  server/src/controllers/<x>.controller.ts (+index.ts)
  server/src/services/<x>.service.ts (+index.ts, shared/user-methods.ts)
  server/src/repositories/<x>.repository.ts (+index.ts)
  server/src/dtos/<x>.dto.ts
  server/src/schema/{index.ts,enums.ts,functions.ts,tables/*.table.ts,migrations/*.ts}
  server/src/{utils,middleware,maintenance,commands,workers,bin,emails,cores,queries}/
  server/test/{utils.ts,small.factory.ts,medium.factory.ts,factories/,fixtures/,repositories/*.mock.ts,medium/}
  ```
- **Moved set after pinning:** 250 non-test files plus 104 co-located specs = 354 files.
  - Pinned files total 208:
    - schema/: 168
    - src root files: 9
    - workers: 3
    - bin: 2
    - commands: 10
    - emails: 9
    - the controllers/services/repositories `index.ts` registries: 3
    - location-sensitive files: 4
  - My sketch mapping gave 37 module folders, 23 platform files and 15 shared files, with no target-name collisions.
  - Realistically there are 25–30 plausible domains after merging tiny ones.

## 3. Applicability

### Imports
- **Specifier forms in server/src:** 2,344 `src/` alias imports, 283 `test/` alias imports, and only 2 relative ones. 100% of internal specifiers end in `.js`.
  - Relative 1: `src/main.ts:177`, `import('./app.module.js')`.
  - Relative 2: `src/emails/components/futo.layout.tsx`, `./footer.template.js`.
  - Both files are pinned, so no relative specifier ever needs rewriting.
- **server/test:** 689 `src/` imports and 279 `test/` imports. These ripple, and they are all alias form.
- **Rewrite volume for the sketched layout:** 1,796 specifier rewrites across 412 files.
- **Alias stays valid under moves:** `server/tsconfig.json` maps `"src/*": ["./src/*"]`, and `server/test/vitest.config.mjs` sets `resolve.tsconfigPaths: true`. `src/modules/<m>/<f>.js` is a valid alias target.
- **Alias form is mandatory:** `server/eslint.config.mjs` bans relative imports through `no-restricted-imports` with `group: ['.*']`.
- How `nest build` resolves the alias at runtime is UNVERIFIED. There is no package.json `imports` field and no tsc-alias in server; it is presumably the Nest CLI path rewrite.

### Registries ("barrels")
- 5 `index.ts` files, none with `export *`: `controllers/`, `services/`, `repositories/`, `commands/` and `schema/`.
- They are DI arrays of class references (`services/index.ts`, `repositories/index.ts` ends in `];`), consumed by `app.module.ts:9-38`. This is DI by class ref, so it is fine. Pin them and rewrite their specifiers.

### Location-sensitive and name-keyed code
| File | What it does | Action |
|---|---|---|
| `src/constants.ts:52-54` | reads `join(dirname(import.meta.filename),'..','package.json')` | root, stays |
| `src/main.ts:101-102` | forks `workers/${ImmichWorker}.js`, a file-name-keyed loader | pin `main.ts` and `workers/*` |
| `src/maintenance/maintenance-health.repository.ts:10-11` | forks `../workers/api.js` | pin |
| `src/repositories/database.repository.ts:511` | `migrationFolder: join(import.meta.dirname,'..','schema/migrations')`, a folder loader | pin, and pin schema/migrations |
| `src/services/cli.service.ts:25` | `readdir(join(import.meta.dirname,'../schema/migrations'))` | pin |
| `src/repositories/config.repository.ts:161` | reads `join(import.meta.dirname,'..','..','helmet.json')` | pin |

- Optional enhancement: all four pinned repository/service files would stay valid under a depth-preserving move to a flat `src/platform/`, because `..` still resolves to `src/`. A planner could prove that the resolved path is unchanged.

### sync-sql (correction to prior notes)
- `src/bin/sync-sql.ts` keys its output by the **class name**, not the file name: `repoName.replaceAll(/[A-Z]/g, …)` applied to `Repository.name`. The proof is that `ViewRepository` in file `view-repository.ts` produces `queries/view.repository.sql`.
- It writes to `targetDir: './src/queries'`, which is relative to cwd. So pin `queries/`; file moves do not affect it.
- It needs Postgres (`.github/workflows/test.yml:760-841`, job `sql-schema-up-to-date` with a `services: postgres` block), so it is not an offline oracle.

### Other file-name-keyed behavior
- **Swagger CLI plugin** (`nest-cli.json` `plugins: @nestjs/swagger introspectComments`). It only introspects files ending `.dto.ts` or `.controller.ts`. That is the plugin's default behavior and is not visible in the repo: UNVERIFIED. `<stem>.<role>.ts` naming keeps those suffixes, so it must be preserved.
- **React-email dev:** `email dev --dir src/emails` (package.json, mise.toml). Pin `emails/`.
- **Coverage globs:** `vitest.config.mjs` `coverage.include: ['src/cores/**','src/services/**','src/utils/**']`. After the move, coverage scope silently shrinks. There are no thresholds, so tests still pass. Report as a finding.
- **Medium factory:** `test/medium.factory.ts` keys its repo cache by `key.name`, which is the class name and never changes.
- **Not found:** no DI tokens derived from file names, and no glob or readdir discovery of TS modules beyond migrations.

### Generated code and other workspace packages
- `queries/*.sql`, `open-api/immich-openapi-specs.json` and schema/migrations are committed generated artifacts.
- No other workspace package imports `server/src`. `e2e/src/**` `'src/utils.js'` is e2e's own alias. Web, CLI and e2e talk to the server through `@immich/sdk` over HTTP.
- Only docs and CI mention the paths:
  - `.github/pull_request_template.md:36-37`
  - `docs/docs/developer/architecture.mdx:64`
  - `.github/workflows/migration-order.yml:23-25` (references `server/src/schema/migrations`, which is pinned)

### CI gates that break even under pure-specifier edits (ci-unit runs format, lint, check, test; `server/mise.toml` `[tasks.ci-unit]`)
- **Prettier:** `printWidth: 120` in `server/.prettierrc`. 11 import lines in 10 files exceed 120 characters after the rewrite, so `prettier --check` fails.
- **ESLint import order:** `import-x/order` uses `alphabetize: asc`, and lint runs with `--max-warnings 0`.
  - About 176 files have sorted `src/` imports today that become unsorted after the rewrite. This is approximate; I did not model type-import groups.
  - Fixing the order means reordering import statements. That changes module evaluation order inside an 87-file value-import cycle, so it is not provably behavior-preserving on its own.
  - Planning decision: either leave lint red and report it, or run a separate "lint-normalize" step certified by tests plus an OpenAPI diff.

### Verdict
**Full, with pins.** The whole `server/src` package qualifies: NestJS DI by class ref, alias-only imports, and every loader is pinnable. About 45% of files are pinned, almost all of them schema/migrations.

## 4. Tests

### Runner and counts
- Vitest 4 with unplugin-swc (`server/test/vitest.config.mjs`).
  - include: `src/**/*.spec.ts`
  - globals: true
  - no setupFiles
  - env: `TZ=UTC`
- **Unit layer:** 105 spec files, all inside the subtree, with 1,827 `it`/`test` call sites (28 of them `.each`). That is roughly 1.85–2k cases; the exact count is UNVERIFIED without running.

### Offline evidence
- `test/utils.ts`: `newTestService` (line 394) and `getMocks` (line 309) automock every repository class.
- No unit spec references testcontainers, Kysely or Postgres.
- `utils/fetch.spec.ts` stubs global `fetch`.
- `repositories/storage.repository.spec.ts` uses mock-fs.
- The CI `server-unit-tests` job has no `services:` block (`test.yml:102-129`).

### Medium layer (not offline)
- 68 spec files in `test/medium/**`, about 707 call sites.
- `test/medium/globalSetup.ts` imports `GenericContainer` from testcontainers, so it needs Docker.
- `workflow-core-plugin.spec.ts` also needs the built `packages/plugin-core`.

### Can unit tests run without the plugin build and without Docker?
- **Docker:** not needed.
- **Plugin build:** partially needed.
  - `src/enum.ts:1` does `import { WorkflowTrigger } from '@immich/plugin-sdk'` and uses it as a runtime value: `z.enum(WorkflowTrigger)` at `enum.ts:1288-1289`. It is a real TS `enum` (`packages/plugin-sdk/src/types.ts:23`), and enum.ts has a fan-in of 205.
  - So almost every spec needs `@immich/plugin-sdk` resolvable at runtime. Its exports point only to `./dist/index.js` (`packages/plugin-sdk/package.json`).
  - **Required:** build plugin-sdk (`node esbuild.js && tsc --emitDeclarationOnly && tsc-alias`; esbuild has an arm64 binary). For runtime alone the esbuild step should suffice; that is UNVERIFIED. The tsc step needs `@immich/sdk` built (`tsc`, TS ^7; `@typescript/typescript-linux-arm64` exists on npm).
  - **Not required:** the plugin-core wasm build (extism-js plus binaryen through `//:plugins`). No unit spec touches `packages/plugin-core`; the core-plugin path appears only as a string in `test/repositories/config.repository.mock.ts:80`.
  - **Order risk:** `pnpm-workspace.yaml` sets `injectWorkspacePackages: true`. Build plugin-sdk **before** `pnpm install --filter immich`, or re-install afterwards. The ordering semantics are UNVERIFIED.

### Extra offline oracles
- **OpenAPI spec diff.** `src/bin/sync-open-api.ts` boots `ApiModule` with `{ preview: true }`, and the CI `generated-api-up-to-date` job (`test.yml:713-759`) has no DB service. So `nest build` followed by `node dist/bin/sync-open-api.js` should be reproducible offline, and the claim becomes "the API contract is byte-identical". Running it fully offline is UNVERIFIED.
- **`tsc --noEmit`.** Needs the sdk and plugin-sdk `.d.ts` files.

### Estimate
About 1,850–2,000 offline cases, comparable to mcphub's roughly 1,800.

## 5. Install weight (aarch64, Node 22)
- **Node:** upstream pins 24.21.0 (`.nvmrc`, `mise.toml`), so run a project-local Node 24 tarball. Running on Node 22 is UNVERIFIED.
- **pnpm:** `pnpm@11.27.1` (`package.json`).
- **Native deps:**
  - sharp ^0.35: has `@img/sharp-linux-arm64` (npm).
  - bcrypt 6.0.0: ships `prebuilds/linux-arm64/bcrypt.glibc.node` in its tarball.
  - @swc/core, esbuild and rollup: arm64 binaries.
  - exiftool-vendored: needs perl only at runtime.
- **Heavy JS:** NestJS 12, OpenTelemetry, react-email, testcontainers.
- **Monorepo prerequisite:** build `@immich/sdk` and `@immich/plugin-sdk` (TS 7 native binary).
- **Not needed:** no generators for unit tests. Java openapi-generator and Postgres are only needed for regenerating artifacts.
- **Overall:** heavier than mcphub. Medium–high; node_modules size is UNVERIFIED.

## 6. Demo appeal

### After-tree sketch
`src/modules/`:
- access, activity, album, api-key, asset, asset-media, auth, database-backup, download, duplicate, integrity, job
- library, maintenance, map, media, memory, metadata, notification, ocr, partner, person, search, server, session
- shared-link, stack, storage, sync, system-config, system-metadata, tag, timeline, trash, user, view, workflow

`src/platform/`: middleware, logging, crypto, cron, event, telemetry, websocket, process, base.service, api.service, machine-learning.

`src/shared/`: generic utils.

Pinned in place: root kernel (enum, types, database, decorators, validation, constants), schema/, workers/, bin/, commands/, emails/, queries/.

### Headline findings
1. **BaseService god-injection.** Every service extends `BaseService`, whose constructor injects 57 repositories (`src/services/base.service.ts:76` `BASE_SERVICE_DEPENDENCIES`, `:136+`).
   - 40 of 54 services reach at least one other domain's repository through `this.xRepository`. `metadata.service` reaches 7: album, asset, map, media, person, tag, user.
   - Import-graph rules cannot see this, which is a strong talking point for the dependency-cruiser rules.
2. **87-file value-import cycle (SCC)** spanning `database.ts`, `decorators.ts`, 10 DTOs, 7 repositories, and `schema/index.ts` plus its tables. Also:
   - a 6-file cycle: storage.core, auth.guard, auth.service, base.service, asset.util, profile-image
   - a 5-file cycle: emails and email.repository
3. **God files:**

   | File | LOC | Fan-in |
   |---|---|---|
   | `enum.ts` | 1,323 | 205 |
   | `asset.repository.ts` | 1,259 | — |
   | `metadata.service.ts` | 1,175 | — |
   | `utils/media.ts` | 1,143 | — |
   | `utils/database.ts` | 1,132 | — |
4. **Cross-module DB writes.** `database.repository` writes asset, asset_file, person and user. The `stack`, `trash` and `duplicate` repositories all write the `asset` table.
5. **Stalled migrations and naming drift:**
   - one leftover `cores/storage.core.ts`; the "cores" concept dates from 2024 #8120
   - `repositories/view-repository.ts` naming outlier; a separator rename normalizes it
   - orphan specs `controllers/config.controller.spec.ts` and `dtos/album-response.dto.spec.ts`, whose subjects were consolidated (#8201)
   - `queue-legacy.dto.ts`
   - `services/shared/user-methods.ts`
   - `docs/docs/developer/pr-checklist.md:81` still cites `server/src/infra/src/entities` from the pre-2024 layout
   - the PR template enforces the type layout (`.github/pull_request_template.md:36-37`)

### Narrative hook (verified)
Immich used to be **feature-sliced** and deliberately moved the other way:
- At `40262c30cb7d` (2024-03-18) the tree had 194 files under `server/src/domain/<feature>/`, for example `domain/album/album.service.ts`.
- At `6e93ddf2f183` (2024-03-22) domain/ had 0 files, services/ 52 and controllers/ 22.
- In between, maintainers jrasm91 and danieldietzler merged a run of single-step move PRs over about 30 hours on 2024-03-20/21: #8080 (absolute imports), #8118, #8119 (controllers), #8120 (cores), #8121, #8124, #8126, #8129, #8130, #8131 (dtos), #8133 (services), #8138, #8147, followed by #8201 on 03-22. Source: Sourcegraph commit search; the PR titles are on github.com/immich-app/immich/pull/<n>.

Pitch: "Immich did this by hand, one move per PR. We do it mechanically, certified by about 1.9k unit tests plus a byte-identical OpenAPI contract, and surface what the folders hide."

Risk: judges or maintainers may read it as reverting a deliberate choice. Frame it as a lens plus boundary findings, not "immich is wrong."

Maintainer discussion: none found.
- The PR bodies are empty (only the Cloudflare bot comments).
- GitHub discussion and issue searches for "folder structure", "nestjs modules", "code organization" and "project structure" returned only user feature requests.
- `docs/docs/developer/architecture.mdx:60` states the intent: "loosely follows Hexagonal Architecture… separate `src/repositories` from `src/services`". Role suffixes inside modules keep that separation.

## 7. Planner input size
- Moved set: 354 files × 80 ≈ 28k tokens.
- All of server/src plus test: 678 files × 80 ≈ 54k tokens.

## 8. Red flags and score
- **Lint and format:** the ci-unit lint and format gates break with specifier-only edits (176 order violations, 11 overflowing lines). Fixing them means reordering imports inside an 87-file cycle.
- **Prebuild step:** the unit tests need the `@immich/plugin-sdk` build, with an injectWorkspacePackages ordering subtlety.
- **Node version:** Node 24 is required upstream; Node 22 is UNVERIFIED.
- **Install:** heavier than mcphub.
- **Pins:** 45% of files are pinned, but almost all are schema/migrations, which is narratively fine.
- **Narrative:** the target reverses maintainers' explicit 2024 decision.
- **License:** AGPL-3.0. Fine for a public fork demo.
- **Moving codebase:** commits land daily, so pin the SHA.
- **Score: 8/10.** It clears the mcphub bar easily on popularity (115k stars vs 2.5k), with comparable offline test volume and a stronger oracle story (OpenAPI byte-diff). The deductions are for the lint/format gate conflict, the heavier setup, and the intent-reversal optics.

Web search (2 queries) found nothing usable, only mirror pages such as [ark.sudovanilla.org](https://ark.sudovanilla.org/Infrastructure/immich/src/commit/2bf764f560252061234eafb76c5aaca7ce431987/server). Every claim above comes from GitHub or Sourcegraph directly.


---

# n8n (deep check)

# n8n-io/n8n `packages/cli`: deep-check card

n8n's popularity is a big plus, but the default profile collides with n8n's module system, the license is not OSI-approved, and the target is changing under us. Rated **6/10** against the mcphub bar (section 8).

## 1. Identity
- **URL:** https://github.com/n8n-io/n8n
- **Stars:** 206,476 (from the `aria-label` on the repo page).
- **Last commit:** 2026-10-01T16:38:31Z (`commits/master.atom`).
- **Pinned HEAD:** `56aa3d8857ebb3304f28bc590e7eba36eab1219a` (master, from `git ls-remote`).
- **License:** custom and **not OSI-approved**. There is no SPDX ID; `LicenseRef-` would be needed (UNVERIFIED how GitHub labels it). The license is split three ways (`/LICENSE.md`):
  - The **Sustainable Use License 1.0** covers the default case.
  - Files with `.ee.` in the file name or `.ee` in the directory name fall under **`LICENSE_EE.md`** (n8n Enterprise License).
  - LICENSE.md also says: "Content of branches other than the main branch (i.e. "master") are not licensed."

### License text implications (not legal advice; nothing confirmed with n8n)

Relevant text:
- **SUL Limitations:** "use or modify the software only for your own internal business purposes or for non-commercial or personal use. You may distribute … or provide it to others only if you do so free of charge for non-commercial purposes." You must keep all notices.
- **SUL Notices:** "If you modify the software, you must include in any modified copies … a prominent notice stating that you have modified the software."
- **EE license:** "you are free to modify this Software and publish patches". You "may copy and modify the Software for development and testing purposes", but "it is forbidden to copy, merge, publish, distribute, sublicense, and/or sell the Software". n8n also owns all modifications.
- **n8n FAQ** (`n8n-io/n8n-docs@49668e5 docs/n8n-community-license/license-faq.md`): you may use n8n "for personal projects, learning or research". "Forks and derivative works are permitted for personal, non-commercial, or internal use only." For anything unclear it says to contact license@n8n.io.

What that means for each use:
- **(a) Diffs in a public YouTube video:**
  - For SUL files, a free, non-monetized video showing excerpts reads as "free of charge, non-commercial". This is low risk.
  - For `.ee` files, showing diffs fits "publish patches", but showing whole files would be publishing the Software.
  - Keep the n8n license notice visible, or credit it.
- **(b) Public fork branch or replay site of the restructured code, free of charge:**
  - SUL files are allowed if the copy is free, the notices are kept, and a prominent "modified" notice is added.
  - `.ee` files can only appear as patches, never as full files. In the scoped move set, 4 of the 109 moved files are `.ee`, and **53 of the 424** files whose import specifiers change are `.ee`. Mitigations: pin every `.ee` file and render only diffs for `.ee` paths in the replay.
  - The "branches other than master are not licensed" clause makes a branch on our fork ambiguous (UNVERIFIED). Publishing a patch series, or using the fork's master, avoids the question.
- **(c) Hackathon entry with prize money:**
  - Prize-driven competition use is not addressed in the license or the FAQ.
  - It can be read as "personal or research" use, or as commercial benefit. This is the ambiguous part (UNVERIFIED).
  - Our own repo stays OSS as long as no n8n code is committed into it, which CLAUDE.md already requires.
  - Recommendation: email license@n8n.io before building the demo around n8n.
  - The Devpost rules page returned 403, so its third-party-IP clause is UNVERIFIED.

## 2. Type-sliced subtree (pinned SHA, from the tree-list)

`packages/cli` has 4,291 files. `src/` has **2,058 non-test `.ts`** files and 1,436 test `.ts` files. They split into four parts:

| Part | Non-test `.ts` | Share |
|---|---|---|
| `src/modules/` (40 BackendModule dirs) | 1,323 | 64% |
| Pre-module feature folders at `src/<feature>/` (46 folders: auth, credentials, executions, workflows, webhooks, mfa, oauth, license, jwks, …) | ~505 | ~25% |
| Type-sliced remainder | 149 + 51 | ~10% |
| Root files (server.ts, workflow-runner.ts, …) | 30 | ~1% |

The type-sliced remainder:
- `controllers/`: 39 files (+21 tests)
- `services/`: 70 files (+62 tests, including `pruning/` and `ownership-transfer/`)
- `middlewares/`: 20 files (+4 tests; contains the `index.ts` and `list-query/index.ts` barrels)
- `utils/`: 20 files (+16 tests)
- `errors/`: 44 files
- `types/`, `constants/`, `config/`: 7 files
- `src/databases/` now holds only 3 tests; the repositories moved to `@n8n/db`.

The scoped move set is either 109 files (controllers + services) or 149 (plus middlewares and utils), with 83 or 103 co-located tests.

About 12 plausible domains:
- identity/auth
- user-management
- project/role
- folder
- tag
- ai
- node-catalog
- oauth
- workflow statistics and active workflows
- import-export
- pruning (feeds scheduling)
- instance/dev tooling, plus HTTP plumbing and middlewares as a platform piece

There is an independent ground truth for clustering. `/OWNERS` has **47 lines that map legacy files to teams**: iam, adore, ligo, ai, nodes, qa-dx. It is validated in CI by `ci-owners-validation.yml`.

## 3. Applicability

**How controllers are registered.** The `@RestController` decorator fills `ControllerRegistryMetadata`, and `ControllerRegistry.activate` walks the collected classes (`src/controller.registry.ts`; PR #9781 "Auto-register controllers at startup"). The decorators run because `src/server.ts` imports each controller for its side effect: 27 static `import '@/controllers/…'` lines plus conditional `await import('@/controllers/x.controller.js')` calls. There is no glob, only a list, so moving files means editing specifiers. Import order sets Express route order, and the graph-equality check preserves it.

**DI.** `@n8n/di` resolves by class reference (`Container.get(MeController)`, `mockInstance(UserService)`), so it does not depend on file paths.

**The `src/modules/` collision (main blocker for the default profile).**
- `ModuleRegistry.loadModules` imports `<modulesDir>/<name>/<name>.module.js` (or `<name>.ee/`) for a hard-coded list of default plus env-enabled names. See `packages/@n8n/backend-common/src/modules/module-registry.ts`. That is registration by file-name convention.
- The guide (`scripts/backend-module/backend-module-guide.md`) defines a module as optional and license- or env-gated. Its controllers are registered by `await import('./x.controller')` inside `init()`, and "How do modules interoperate with each other? This is not supported."
- So moving legacy controllers into `src/modules/<x>/` **cannot follow n8n's guide without touching registration**. That would require generating a `.module.ts` and switching to lazy, gated loading, which changes behavior and breaks our "no module files" rule.
- Moving them while leaving registration in `server.ts` preserves behavior, but it creates fake modules the guide doesn't recognize.
- **What does fit:** n8n's older convention of `src/<feature>/` folders (`src/workflows/workflows.controller.ts`, `src/auth/auth.service.ts`, `src/mfa/mfa.service.ts`). This needs a profile that targets existing feature folders.

**Specifiers.**
- The `@/*` alias maps to `./src/*` (tsconfig paths). Vitest has `@test` and `@test-integration` aliases.
- `module`/`moduleResolution` are `NodeNext`, compiled to CommonJS. Dynamic imports use `.js` suffixes.
- The compiler is **tsgo (TS 7.0.2)** via `@typescript/native`, with a TS 6.0.2 API kept for tooling (`pnpm-workspace.yaml`). `tsc-alias` rewrites paths in `dist`.
- Most imports use the alias, so files that move rarely need their own imports rewritten. There are **0 relative `vi.mock` calls** in the legacy dirs. **14 alias `vi.mock` strings** point at legacy files, plus `test/setup-mocks.ts`, which mocks `@/telemetry`, `@/push` and `@/eventbus/...`.

**Location-sensitive code.**
- None in the moved set. `translation.controller` `require()`s absolute paths built from `NODES_BASE_DIR`; the `readdir` calls in `export.service`, `import.service` and `compression.util` work on user data.
- `src/constants.ts` uses `CLI_DIR = resolve(__dirname,'..')`. It is a root file and must stay pinned.

**Path-carrying configs to rewrite.** All of these are covered by certificate check 5:
- `OWNERS` (47 lines)
- `packages/cli/eslint.config.mjs` and `oxlint.config.mts`: about 10 ratchet-allowlist paths each, plus `require('./src/services/ownership-transfer/ownership-transfer.manifest.json')`
- `.github/workflows/ci-pull-requests.yml` (`packages/cli/src/services/engine-*`)
- `.github/test-metrics/e2e-impact-map.json` (83 refs)
- message strings in `@n8n/eslint-config` rules
- **Lint scope depends on location.** For example, `./src/modules/**/*.repository.ts` is exempt from the TypeORM rule, so moving a file into `src/modules/` can change which lint rules apply to it.

**Imports from outside cli.** No workspace package imports these paths. However, `n8n` has **no `exports` map** (`main: dist/index`, `files: [dist]`), so every dist path is effectively public:
- `hooks.service.ts` says "used by cloud BE hooks … DO NOT … RENAME".
- `cweagans/n8n-oidc/hooks.js:314` (148★) requires `/usr/local/lib/node_modules/n8n/dist/services/jwt.service.js`.
- Both files need to be pinned or listed as residual risk.

**License travels with the path.** A `.ee` directory relicenses whatever is inside it. For example, `utils/circuit-breaker.ts` has a single consumer, `modules/log-streaming.ee`. Moving it there would quietly put it under the EE license. The tool must keep EE membership unchanged.

**The target is changing right now.** n8n is extracting `src/services/*` into a new `@n8n/backend-services` package:
- Merged: #39034 (adds the package), #39743, #39751, #39851, #39907, #39999 (2026-09-18 to 09-30).
- **Still open:** #39949, #39950, #39951, #39952, #40069 (2026-09-30 / 10-01).
- Its README states a rule that matches our `shared/` rule: "At least two backend modules must use the code. A service that one module uses belongs to that module."

**Verdict: scoped mode only**, with the profile targeting existing `src/<feature>/` folders. The default `src/modules/<x>` profile does not apply (registry collision and module semantics), and full mode does not apply (only ~10% of `src` is type-sliced).

## 4. Tests
- **Runner:** Vitest. Jest is gone from cli.
  - `vitest.config.ts` runs unit tests and excludes `*.integration.test.ts`.
  - `vitest.config.integration.ts` runs `test/integration/**` and `src/**/*.integration.test.ts`.
  - The base config uses `pool: 'forks'`, one process per file.
- **Offline:** yes.
  - `package.json` scripts set `DB_TYPE=sqlite`.
  - `test/global-setup.ts` calls `nock.disableNetConnect()`.
  - `@n8n/backend-test-utils/src/test-db.ts` uses a SQLite file inside a temporary `N8N_USER_FOLDER`.
  - The CI jobs "CLI Unit" and "CLI Integration" in `.github/workflows/test-unit-reusable.yml` have no `services:` block.
  - Postgres and testcontainers have separate configs (`*.testcontainers.ts`, `test:postgres`), which we skip.
  - Set `CI=true` locally to get the SQLite template DB; otherwise every file replays all migrations (`test/setup-sqlite-template.ts`).
- **Size (regex estimate, UNVERIFIED):**

| | Files | ≈ Cases |
|---|---|---|
| All cli unit tests | 1,283 | 21.8k |
| All cli integration tests | 428 | 7.3k |
| Test files that import the 149-file set | **352** (261 unit / 91 integration) | **≈8.9k**, all offline |

- **Prerequisite:** `vitest.workspace-externals.ts` loads `@n8n/*`, `n8n-core`, `n8n-workflow` and `n8n-nodes-base` **from their built `dist/`**. Every dependency of cli must be built before the tests run.

## 5. Install weight (aarch64, 12 cores, 61 GB RAM, Node 22.23.3)
- **Node version mismatch:** `engines.node >=24.0.0` (both root and cli). CI pins 26.5.1, so Node 24 or 26 has to be installed locally for the project.
- **Package manager:** `pnpm@12.4.2`. The monorepo has 73 workspace packages.
- **Native builds** (`pnpm-workspace.yaml` `allowBuilds`): `sqlite3` 5.1.7, `isolated-vm` ^7.0.1, `@confluentinc/kafka-javascript`, `@vscode/ripgrep` (downloads a binary). Prebuilt arm64 binaries for isolated-vm and kafka are UNVERIFIED; they may need node-gyp plus a toolchain.
- **Build:** at minimum `turbo run build --filter=n8n^...`, which covers nodes-base (7.8k files), nodes-langchain, the `@n8n/typeorm` fork, db, instance-ai, agents, …. CI sets `NODE_OPTIONS=--max-old-space-size=7168`.
- **Rough estimate (UNVERIFIED):** 30–60 min install plus build, several GB of `node_modules`, and 30–90 min for the full cli test suite.

## 6. Demo appeal
**After-tree sketch** (`*` = pinned):
- `auth/` += auth and password-reset controllers, api-key and session-cookie strategies, auth-strategy registry and types, static-auth, password.utility, jwt*
- `mfa/` += mfa.controller
- `user-management/` += users, me, owner, invitation, change-email and user-settings controllers, user.service, email-change, last-active-at
- `projects/` (new) += project and role controllers, project-pool-settings.controller.ee*, project.service.ee*, role-authorization, ownership, access, ownership-transfer/
- `folders/` (new) += folder.controller, folder.service, folder-finder
- `tags/` (new) += tags.controller, tag.service, annotation-tag *.ee*
- `ai/` (new) += 2 controllers, 10 services, 4 ai-proxy/retry utils
- `node-catalog/` += node-types, dynamic-node-parameters, translation, node-resource-explorer
- `oauth/` += oauth1/oauth2 controllers, flow and verifier proxies, protected-resource.registry
- `workflows/` += active-workflows, workflow-statistics, loader, review-policy
- `scheduling/` += pruning/*
- `import-export/` (new) += export and import services, compression, validate-database-type
- `platform/http/` += middlewares/*, cors, rate-limit, request-path, health-endpoint
- Stays put: `hooks.service`* and `server.ts` (only its import specifiers change)

**Headline findings** (computed over runtime imports, not type-only; regex-based, so approximate):
1. **163 cross-module import edges across 28 module pairs** (128 at runtime), e.g. mcp→agents 24 and promotions.ee→n8n-packages 27. The guide says modules don't interoperate, and PR #35907 already removed "accidental cross-module imports".
2. **Core imports module internals statically 92 times.** Starting from `src/commands/start.ts`, 109 files in ~12 modules are reached statically (data-table 23, source-control.ee 18, …). That undercuts the guide's "load only modules that are explicitly enabled".
3. **A 102-file runtime import cycle** covering workflow-runner, active-workflow-manager, wait-tracker, 9 legacy services, the agents module (39 files) and mcp (9).
4. **Hub and god files:**
   - Hubs: `ownership.service` (imported from 21 areas), `project.service.ee` (1,102 LOC, 15 areas).
   - Large files: `import.service` (1,170 LOC), `ai-preference.service` (824), `frontend.service` (823), `e2e.controller` (755).
5. **n8n's own rule flags 5 utils/services with a single module consumer:** instance-registry-proxy, ai-proxy-language-model, inverter, ttl-map, and circuit-breaker, which would cross the `.ee` license line if moved.
6. **Migrations running in parallel:**
   - legacy feature folders, BackendModules and `@n8n/backend-services` coexist
   - eslint and oxlint configs are both maintained
   - TypeORM ratchet allowlists
   - 3 transaction patterns coexist (`packages/cli/AGENTS.md`)
7. **Naming drift worth logging** (all are normalization-only renames): `cors-service.ts`, `static-auth-service.ts`, `errors/execution-not-found-error.ts`, and a misspelled root file `utlity.types.ts`.

**Narrative hook.**
- The "they stalled" story isn't true. Commit history (Sourcegraph commit search) shows steady modularization: #14084 sets up modules (2025-03), then #15769, #22453, #24117, #24304 and #24494 (LDAP, 2026-01). The guide's "Future work 4" says "Existing features that are not modules … should be turned into modules over time." The services→package extraction is happening this week.
- The honest pitch: our tool independently checks n8n's migration against n8n's own rules, using OWNERS teams and the backend-services ≥2-consumer rule as outside oracles.
- **Retrodiction demo idea:** run the tool on a SHA from before 2026-09-16 and see whether it classifies EventService, UrlService, CacheService and RoleService as shared.

## 7. Planner input size (≈80 tokens per file)
- Scoped, 109 files: ≈9k tokens. 149 files: ≈12k.
- Add ≈4–6k for context (46 feature folders, 40 module names, OWNERS teams, importer summary), for **≈15–18k** in total.
- The full cli `src` (2,058 files) would be ≈165k tokens, which isn't needed.

## 8. Red flags and score
**Red flags:**
1. The license is not OSI-approved. EE carve-outs, the prize-money ambiguity and the "non-master branches" clause need a mail to license@n8n.io.
2. `src/modules/` is a runtime-loaded BackendModule directory, so the tool's default target profile collides with it. A feature-folder profile is required.
3. A file-move wave into `@n8n/backend-services` is in progress, with 5 PRs still open. An upstream-PR story is dead; a pinned SHA is mandatory.
4. Node ≥24 versus the host's 22, plus a heavy monorepo build with native modules on aarch64.
5. Dist paths are effectively public (cloud and community hooks).
6. File paths carry license status (`.ee`).
7. About 460 files would get specifier edits, so a large diff.

**Score: 6/10.** Popularity is 10/10. Scoped mode genuinely applies (109–149 files, ~12 domains, class-reference DI, registration by list). The tests run offline (SQLite + nock, ≈8.9k relevant cases). The findings are strong.

The score is capped by the license risk for a prize entry, the conflict with n8n's module and package direction, the moving target, and setup weight. Compared with mcphub (OSI license, full mode, simple setup) it is less safe as the main certified run.

**Recommendation:** use n8n as a scoped second act: pinned SHA, `.ee` and hooks/jwt files pinned, a feature-folder profile, and diff-only publication. Keep mcphub as the main end-to-end certified demo. Before committing to n8n, email license@n8n.io.


---

# Unleash (deep check)

# Unleash/unleash: deep-check candidate card

## 1. Identity
| Field | Value | Evidence |
|---|---|---|
| URL | https://github.com/Unleash/unleash | |
| License | **AGPL-3.0-or-later** (OSI-approved). It was Apache-2.0 up to v7.x and switched at **v8.0.0 (2026-06-09)**, so the earlier research conflict comes from looking at different versions | `LICENSE` at HEAD is the 661-line AGPLv3 text. `package.json` `"license": "AGPL-3.0-or-later"`. At tags v7.0.0, v7.4.0 and v7.6.0 the LICENSE is Apache 2.0 and package.json says `Apache-2.0`. At v8.0.0, v8.1.0 and v8.2.0 both say AGPL. v8.0.0 release notes: "Announcement: Unleash open source moves to AGPLv3" (github.com/Unleash/unleash/releases/tag/v8.0.0). README badge also says AGPL-3.0-or-later. SDKs keep permissive licenses. |
| Stars | 13,850 | repo page `aria-label="13850 users starred"` |
| Last commit | 2026-10-02T01:53:42Z (commits land daily) | commits/main.atom |
| Pinned HEAD | `89672116b1a395f940eaebbb9ee1a4572e259e8e` (v8.2.0 line) | git ls-remote |

## 2. Type-sliced subtree: a stalled migration, quantified
**What the repo says about itself.** `AGENTS.md`: *"We promote packages by feature, not by layer …, although the legacy components are still packed by layer: Controllers (/src/lib/routes/), Services (/src/lib/services/), Stores (/src/lib/db/)"*. Root `CLAUDE.md` contains only `AGENTS.md`.

**Layout excerpt** (`src/lib/`, non-test .ts / test .ts):
```
src/lib/features/   324 / 141   (47 feature folders + index.ts barrel)   <- target convention
src/lib/openapi/    271 / 67    (spec/ = 346 files, generated barrel)    <- pin
src/lib/services/    36 / 15    LEGACY
src/lib/routes/      37 / 13    LEGACY (admin-api/, auth/, client-api/, edge-api/)
src/lib/db/          29 / 5     LEGACY (+crud/)
src/lib/types/stores 25 / 0     LEGACY store interfaces
src/test/fixtures/   27 fake-*-store.ts (prod code imports these)
src/lib/{util 54, types 28, middleware 26, addons 21, error 32, users/inactive 6, domain/project-health 3}
src/migrations 406 (js), src/test/e2e 85 tests
```

**Legacy remainder over time** (services + routes + db + types/stores, non-test .ts; counted via tree-list at each tag SHA):

| Release | Date | Legacy files | features/ files | Feature folders |
|---|---|---|---|---|
| v5.0.0 | 2023-04 | 178 | 17 | 5 |
| v6.0.0 | 2024-06 | 136 | 190 | 26 |
| v7.0.0 | 2025-06 | 132 | 294 | 38 |
| v8.0.0 | 2026-06 | 125 | 330 | 44 |
| **HEAD** | 2026-10-02 | **127** | 324 | 47 |

The legacy count fell by only 9 files in the 28 months since v6.0.0. New code goes to features/; old code stays where it is.

**Public trail of the migration (all merged PRs):**
- #3942 (2023-06, kwasniew): "Migrated playground backend to feature-oriented architecture … so that we don't have to jump between 3 different locations (routes, services and utils)".
- #4994 (2023-10, FredrikOseberg): "I left out variants controller … Should we move it?". Reply: "**we can move it any time**". It is still at `src/lib/routes/admin-api/project/variants.ts` three years later.
- Further PRs in the series: #5510, #5489, #5919, #6434, #6487, #7519, #9052, #9650, #11341 (PAT, 2026-02) and #11893 (settings, 2026-04-30: "Co-locate all settings related building blocks to have feature oriented structure as all new code").
- I found no ADR or GitHub issue about the migration itself. The `contributing/ADRs/` set has naming, preferred-export, write-model-vs-read-models and correct-type-dependencies, but nothing on folder structure for the backend.

**Their own migration PRs are pure moves, the same thing our tool does:**
- #11341 diffstat: `src/lib/{services => features/pat}/pat-service.ts`, `src/lib/{db => features/pat}/pat-store.ts`, `types/stores/… => features/pat/pat-store-type.ts`, and the fake moved from `src/test/fixtures` into the feature. It also included a hand-written `createPatService.ts`, which is new code our tool would not generate.
- #9650 renamed `environments.ts => project-environments-controller.ts`. That adds a role suffix, which our casing/separator-only rename rule does not allow.

**Conventions in `features/`:**
- Folders are kebab-case and named inconsistently: `segment`, `project` and `group` are singular; `users`, `events` and `settings` are plural; `apitokensv2`, `apitokencache` and `edgetokens` are not kebab-case.
- Files are flat and named after their class (naming ADR): `<x>-service.ts`, `<x>-store.ts`, `<x>-store-type.ts`, `<x>-controller.ts`, `<x>-read-model[-type].ts`.
- Composition roots are camelCase `create<X>Service.ts` files that also export `createFake<X>Service`.
- Fakes are either flat (`fake-<x>-store.ts`) or in `fakes/` (4 folders). Tests are colocated or in `tests/` (15 folders). Some folders have `types/`.
- Outliers: `client-feature-toggle.controller.ts` (dot role), `features/feature-toggle/legacy/`, and the `change-request-access-service` folder (role in the folder name).

**Does moving legacy into `features/<x>/` follow their convention?**
- **Yes for services, db and fixtures.** Names are already `group-service.ts`, `group-store.ts` and `fake-group-store.ts`, so they move verbatim with no rename.
- **Routes: partly.** Earlier moves kept suffixless controllers (`features/context/context.ts`, `playground/playground.ts`, `tag-type/tag-type.ts`), so moving `admin-api/tag.ts` unchanged has precedent.
- **types/stores: not without a rename.** 20 of the 25 interfaces collide by basename with `db/*-store.ts`; for example `db/access-store.ts` and `types/stores/access-store.ts` would both land in `features/access/`. Their convention renames to `-store-type.ts`. We need either a role-suffix rename rule or to pin `types/stores/`.
- **Route collisions:** `admin-api/addon.ts` vs `admin-api/project/addon.ts`, and `admin-api/api-token.ts` vs `project/api-token.ts`.

**Move set (scoped):**
- About 108 non-test files: services ~32, routes ~28, db ~21, fixtures fakes 27, plus ~33 colocated tests.
- Add 25 interfaces if a `-store-type` rename is allowed.
- **About 27 plausible domains.**
  - Completes 14 half-migrated folders: access, users, group, events, api-tokens, metrics, feature-toggle, project, project-insights, segment, context, tag-type, edgetokens, instance-stats.
  - Creates about 13 new ones: tags, addons, favorites, public-signup, strategy, sessions, feature-type, user-feedback, user-splash, project-health, email*, client-spec, version.

## 3. Applicability
- **Framework:** Express. Controllers extend `routes/controller.ts`, routes are registered by explicit class import (`routes/index.ts`, `routes/admin-api/index.ts`) and addons by explicit import (`addons/index.ts`). There is no DI-by-filename or glob loading in `src/lib`.
- **ESM specifiers:** `module`/`moduleResolution: NodeNext`. 6,398 of 6,405 relative specifiers end in `.js`. No `paths`/`baseUrl`. `allowJs: true`.
- **Dynamic imports:** 8 relative `import()` calls, e.g. `src/test/reset-cross-file-state.ts` → `../lib/util/anyEventEmitter.js`. No relative `vi.mock`.
- **Barrels:** 11 `export *` index files: `features/index.ts`, `internals.ts`, `types/index.ts` (re-exports `../db/db.js` and `../routes/unleash-types.js`), `openapi/index.ts`, `util/index.ts`, `middleware/index.ts`, and others. `services/index.ts` (750 lines) is the `createServices` composition root plus an `export {…}` public list. `db/index.ts` is `createStores`. **Pin `services/index.ts`, `db/index.ts`, `types/stores.ts`, `routes/index.ts`, `routes/admin-api/index.ts`, `routes/controller.ts`, `db/{db,db-pool,transaction}.ts` and `db/crud/*`** as platform. Only specifier edits are needed in them.
- **Location-sensitive code:**
  - `src/lib/services/email-service.ts:808,829`: `path.resolve(__dirname, '../../mailtemplates')`. **Pin it**, or it breaks under `features/email/`.
  - `util/version.ts` (`require('../../../package.json')`), `util/findPublicFolder.ts` and `migrator.ts` are outside the move set.
- **Glob/generated code:**
  - `.husky/update-openapi-spec-list.js` (run on pre-commit) readdirs `src/lib/openapi/spec` and regenerates `spec/index.ts`. **Pin all of openapi/.** Their own migrations never moved schemas.
  - `vitest.config.ts` assigns `src/test/e2e/**` to a separate project (unit uses `isolate:false`), so **pin `src/test/e2e/**`**.
  - `db-migrate` loads `src/migrations` by directory (pinned).
- **Imports into the subtree:**
  - 264 files outside legacy import legacy files (542 edges): features 162, test/e2e 32, fixtures 24, middleware 17, addons 8.
  - Within non-test code, features → legacy has 310 edges and legacy → features has 190.
  - The frontend imports nothing from backend src (scan of `frontend/src`: 0 hits).
  - **Ripple outside this repo:** `.github/workflows/notify_enterprise.yaml` dispatches `bricks-software/unleash-enterprise` `sync-oss-subtree.yml`, so the private enterprise repo vendors OSS as a subtree and may deep-import moved paths (UNVERIFIED, private repo). This likely explains the leftover compat shims (`services/event-service.ts` and `db/event-store.ts`, both marked "// For backward compatibility") and the `groupStore … kept for backward compatibility with enterprise` comment in `access-service.ts`.
  - The npm `exports` field is only `./dist/lib/server-impl.js`, so public npm consumers are insulated.
- **Lint hazard:** CI runs `biome check . --error-on-warnings`. organizeImports is off, but the formatter is on. Longer rewritten specifiers can push lines past the print width, and lint then fails. The tool needs a formatter pass on touched import lines (whitespace only) or must certify against that.
- **Tooling hazard:** the target uses **TypeScript 7.0.2**, the native compiler with a linux-arm64 package (npm registry). Our tool, including dependency-cruiser and ts-morph, must bring its own TS 5.x API (UNVERIFIED how depcruise behaves when the target's node_modules has TS 7).
- **Verdict: SCOPED**, with destination `src/lib/features/<existing-folder>` and house file names. A full move to `src/modules/` would create a third structure next to their own, fight their naming ADR (`x-service.ts`, not `x.service.ts`), and run into the 346 pinned openapi files.

**This needs two planner capabilities:**
- (a) an "adopt existing feature root and naming" mode;
- (b) a collision policy for `types/stores` (pin, or allow a `-type` suffix rename).

## 4. Tests
**Runner and CI:**
- Vitest 4.1.11 with two projects: `unit` (everything except `src/test/e2e/**`, `isolate:false`) and `e2e`.
- CI (`.github/workflows/build.yaml`) runs a `services: postgres` container and sets `TEST_DATABASE_URL`.

**Blocker: global setup needs Postgres.** `vitest.config.ts` sets `globalSetup: ['./src/test-setup.ts']` for every project. That file `pg.connect()`s and migrates a template DB, so even unit tests fail without Postgres. Two ways to run offline:
- Use a harness-supplied vitest config from outside the repo that keeps their `setupFiles` and drops `globalSetup` (UNVERIFIED that the remaining tests then pass).
- Run `embedded-postgres` (npm has `@embedded-postgres/linux-arm64` 18.4.0-beta.17, ~59 MB). That would make all 413 test files runnable, an install for build time.

**DB use, measured over the tarball** (a test counts as DB if it imports `database-init`/`dbInit`, directly or through a helper):

| Split | Test files | Cases (approx.) |
|---|---|---|
| All | 413 | ~2,590 |
| Need Postgres | **173** (unit project 89, e2e project 84) | ~1,446 |
| Offline (fakes + supertest) | **240** | **~1,143** |

- The earlier "89 of 326" figure is the unit project only: it has 328 test files, 89 of them DB. It does not count the separate e2e project.
- **Tests touching the move set** (located in it or importing it directly): 98 files. 55 are offline (~385 cases) and 43 need DB (~470 cases). 33 test files sit inside the legacy dirs (29 offline).
- Offline pattern example: `src/lib/routes/admin-api/tag.test.ts` uses `createStores()` from `test/fixtures/store.js`, then `createServices`, `getApp` and supertest.
- `nock` is used in 8 files (offline-safe). 3 files contain `.skip`.

## 5. Install weight (aarch64, Node 22)
- `engines.node >=22`. `packageManager: pnpm@11.15.1` via corepack.
- The pnpm workspace includes `frontend/` (4,616 files: React, MUI, Vite, Cypress, msw), and `allowBuilds` lists cypress, esbuild, ssh2 and cpu-features.
- **`prepare` runs a full build including the frontend** unless you pass `--ignore-scripts`. CI uses `pnpm install --frozen-lockfile --ignore-scripts`.
- The backend has no native addons: `pg`, `bcryptjs` and `re2js` are pure JS. TypeScript 7 and esbuild ship prebuilt arm64 binaries.
- Build is `pnpm build:backend` (tsc). Expect node_modules around 1 GB or more because of the frontend (UNVERIFIED). Medium-heavy, but no compilation from source.

## 6. Demo appeal
**After-tree (scoped):**
- Completed folders, where the scattered files land: `features/{access, users, group, events, api-tokens, metrics, feature-toggle, project, project-insights, segment, context, tag-type, edgetokens, instance-stats}`.
- New folders: `features/{tags, addons, favorites, public-signup, strategy, sessions, feature-type, user-feedback, user-splash, project-health, client-spec, version}`.
- `services/`, `db/` and `routes/` shrink to composition roots and platform files (index, controller, db-pool, transaction, crud). `email` stays pinned.

**Headline findings:**
1. **"We can move it any time"** (PR #4994, 2023): the variants controller is still in `routes/` three years later. The legacy count fell by only 9 files (136 → 127) in 28 months.
2. **Half-migrated domains spread over 5 places.** For example, `features/group/` holds only `createGroupService.ts`; `group-service.ts` is in services/, `group-store.ts` in db/, the interface in types/stores/ and the fake in test/fixtures/. The same holds for access and users.
3. **22 production files import `src/test/fixtures`**, including the npm entry `server-impl.ts` (it imports test-config, fake stores and e2e db helpers). Moving the fakes into `features/<x>/` removes the prod → test edge from directory structure with zero code edits.
4. **Their own ADR "correct-type-dependencies"** (domain code must not import OpenAPI types), turned into a depcruise rule, flags 43 domain-layer files, 16 of them store or store-type files. That includes `features/pat/pat-store-type.ts`, moved in February 2026.
5. **A 50-file runtime import cycle** (value imports only) through app.ts, create-config.ts, server-impl.ts, internals.ts, `features/index.ts`, `db/index.ts` and the `create*Service` factories.
6. **Their naming and export ADRs are not followed:**
   - 193 non-test files use `export default`, against the preferred-export ADR (55 legacy, 70 in features).
   - The `types` barrel re-exports `routes/` and `db/` (a layering inversion).
   - There are 2 backward-compat shims and duplicate or orphan tests (`services/scheduler-service.test.ts` vs `features/scheduler/…`, and `services/feature-service-potentially-stale.test.ts`).
   - Feature-folder naming is inconsistent (see section 2).

**God files:** `feature-toggle-service.ts` (2,586 LOC), `types/events.ts` (2,049), `project-service.ts` (1,424), `services/access-service.ts` (928), `db/access-store.ts` (916), `email-service.ts` (849), `routes/admin-api/user-admin.ts` (821).

**Hook:** a feature-flag company with 13.9k stars has publicly been "promoting packages by feature" for three years and stalled. Our agent finishes the migration in their own house conventions, file moves only, certified by their own ~1.1k offline tests and tsc, and turns their own ADRs into boundary rules that surface the violations.

## 7. Planner input size
- Scoped move set: ~170 files (with tests) × 80 ≈ **14k tokens**, plus a summary of the 47 existing feature folders (~3k).
- Whole backend context: 964 non-test .ts × 80 ≈ 77k tokens.

## 8. Red flags and score
**Red flags:**
- AGPL since v8, which is fine for a demo fork; never vendor it into our repo.
- `globalSetup` requires Postgres for every vitest run (needs a config override or embedded Postgres).
- Our default `src/modules/<x>/<stem>.<role>.ts` layout conflicts with their house convention, so the planner needs an adopt-existing-root mode.
- 20 + 2 basename collisions.
- Pin set: openapi/ (generated barrel), `src/test/e2e/**` (glob-assigned to a project), email-service.ts.
- The biome formatter can fail CI after specifier rewrites.
- The TS 7 target compiler may affect depcruise and ts-morph if they use the target's TS.
- The private enterprise subtree consumer means an upstream PR could break enterprise (UNVERIFIED). This doesn't affect the demo, but it is a reason a maintainer might not merge an upstream PR.
- Very high commit velocity, so pin the SHA.

**Score: 7/10 vs the mcphub bar.**
- Unleash has 5.5× the popularity, a far stronger and self-documented narrative, and the approach genuinely applies in scoped mode.
- mcphub has more offline cases (~1,800, no setup override needed) and needs zero planner changes.
- The score rises to 8 if the planner adds a house-convention mode and the offline vitest override (or embedded Postgres) is verified. It falls to 5 if offline vitest without `globalSetup` turns out not to work and embedded Postgres is ruled out.


---

# supabase, opencode, nestjs, vscode, Apache (applicability)

# Applicability check: user-named repos (supabase, opencode, nestjs, vscode, Apache), researched 2026-10-02

## Verdict summary

| Candidate | Fit | Offline tests | Score vs mcphub |
|---|---|---|---|
| **supabase/storage** | **scoped, partial**: layer-then-feature, not pure type-sliced | yes, about 1,700 unit call sites | **6/10** |
| supabase/postgres-meta | full (textbook type-sliced) | **no**: Docker Postgres only | 4/10 |
| supabase/supabase monorepo (studio, packages/pg-meta) | not applicable | n/a | 2/10 |
| supabase/cli (TS rewrite) | not applicable | n/a | 1/10 |
| anomalyco/opencode | not applicable | n/a | 1/10 |
| nestjs/nest + nestjs org | not applicable | n/a | 1/10 |
| microsoft/vscode | not applicable | n/a | 1/10 |
| Apache (ASF) GitHub org | not applicable: no TS type-sliced Node backend exists | n/a | 1/10 |

**Bottom line:** Only supabase/storage carries a brand judges will recognize, has offline tests, and can be targeted at all. Its source shape is `http/routes/<domain>/` plus `storage/protocols/<domain>/` plus `storage/events/<domain>/`. The demo would therefore be "merge each feature scattered across layer folders into one module", not "dissolve controllers/ and services/". That works only if the planner accepts type folders that already contain domain subfolders. If it doesn't, mcphub stays the better fit and storage becomes an optional second target for brand recognition.

---

## Card: supabase/storage

1. **Identity**
   - URL: https://github.com/supabase/storage
   - License: Apache-2.0 (OSI-approved), per the repo page and `LICENSE`.
   - Stars: 1,328 on the repo page. The Supabase brand itself has 110,988 stars on supabase/supabase.
   - Last commit: 2026-10-01T11:38Z (`commits/master.atom`).
   - Pinned HEAD: `76b70ba80e7c171d6b534db3c65430467a82f4bd`

2. **Subtree**
   - The code is split by layer first, then by domain, from `/tree-list/<sha>`:
     ```
     src/http/routes/{admin,bucket,cdn,health,iceberg,object,render,s3,tus,vector}/   89 non-test .ts
     src/storage/protocols/{iceberg,s3,tus,vector}/                                    36
     src/storage/events/{cdn,iceberg,jwks,lifecycle,migrations,objects,pgboss,upgrades}/ 22
     src/storage/{renderer,lifecycle,cdn,scanner}/                                     14
     src/storage/{storage,object,uploader,limits,range,locator}.ts + backend/ database/ schemas/  (core layer)
     src/internal/{auth,cache,cluster,concurrency,database,errors,monitoring,pubsub,queue,sharding,streams,...}  128 (plumbing)
     src/start/, src/scripts/, src/config.ts, src/app.ts, src/admin-app.ts
     ```
   - The repo has 368 non-test `src` .ts files in total.
   - The scoped move set is about **161 non-test files**, plus their co-located unit tests.
   - About 10 plausible domains: bucket, object, s3, tus, iceberg, vector, render, cdn, tenant/admin, jwks (health is trivial).

3. **Applicability**
   - **Framework:** Fastify. Routes are registered explicitly (`src/http/routes/index.ts` re-exports route plugins). Queue workers are registered explicitly in `src/storage/events/workers.ts` via `Queue.register(X)`. There are no autoload or glob loaders.
   - **Module setup:** CommonJS with `moduleResolution: node`, and no `.js` specifiers.
   - **Path aliases:** tsconfig `paths` defines `@internal/*` → `src/internal/*` and `@storage/*` → `src/storage/*`. The same aliases are duplicated in `vitest.unit.config.ts` and `vitest.integration.config.ts`, and resolved at build time by `resolve-tspaths`.
     - About 342 `from '@internal/…'` and 145 `from '@storage/…'` import sites (counted from the tarball).
     - Files moved out of `src/storage` would need their specifiers re-rooted, plus a new alias or relative paths, in three config files.
   - **Barrels:** `src/storage/index.ts`, `internal/*/index.ts`, `http/routes/index.ts`, and per-domain route `index.ts` files, which register plugins rather than just re-export.
   - **Location-sensitive files** (Sourcegraph regex search):
     - `src/storage/backend/file.ts` uses `__dirname` and is the only one in a would-move area.
     - `src/internal/monitoring/logger.ts` uses `resolve(__dirname,'logflare')`.
     - `internal/monitoring/pprof/{flame,download}.ts` use `cwd`.
     - `src/scripts/{migrations-types,orphan-client}.ts` use `__dirname` and `readdirSync`.
     - `src/start/tracing.ts` uses `require('../internal/…')`.
   - **Globs:** `build.js` uses esbuild `entryPoints: ['./src/**/*.ts']`. The unit config includes `src/**/*.test.ts` and excludes `src/test/**`. Both keep matching anything moved within `src/`.
   - **Entrypoints, all pinned:**
     - `acceptance/scripts/run-managed-local.ts` references `src/start/server.ts`.
     - `watt.storage.json` main is `./dist/start/server.js`.
     - `watt.json` loads the extension `dist/internal/monitoring/pprof/runtime-extension.js`.
   - **Module references inside tests:** 78 relative `vi.mock`/`doMock`/`importActual` calls in 39 files, plus 257 relative `import('…')` literals, mostly `typeof import()` in tests. The certificate must treat these as graph edges.
   - **Inbound imports:** no other package imports this repo. `src/test/*` (48 integration files) imports `src` heavily, which is handled by specifier rewrites.
   - **Verdict: SCOPED.** Move `http/routes` + `storage/protocols` + `storage/events` + `renderer/lifecycle/cdn/scanner` into `src/modules/<domain>`. Keep `internal/` as platform. Core `storage/*.ts` and `storage/database/pg.ts` go to shared or platform, or stay pinned. The premise is weaker than mcphub's because the domains are already visible as subfolders.

4. **Tests**
   - Runner: vitest.
   - 159 co-located unit test files: internal 60, storage 54, http 37, others 8. 48 integration files sit in `src/test/`.
   - **Offline evidence:** the `.github/workflows/ci.yml` job `test_unit` (L35-48) has no `services:` block. It only copies `.env.sample` and `.env.test.sample`, then runs `npm run test:unit:coverage`.
   - Integration tests use `test:integration:ci`, which runs `infra:restart:ci`. That is `docker compose` with Postgres, MinIO and the iceberg catalog, so it is **not offline**.
   - Sample unit test: `src/http/routes/bucket/lifecycle.test.ts` builds an in-process Fastify app and `vi.mock`s config.
   - **About 1,697 `it(`/`test(` call sites** run offline; `.each` expands this further. That is roughly mcphub's 1,800.

5. **Install on aarch64 with Node 22**
   - **Blocker:** `package.json` sets `engines.node ">=24.0.0"` and `.npmrc` sets `engine-strict=true`, so `npm ci` fails on Node 22. We need a project-local Node 24, or `--engine-strict=false` (risky, because the build targets `node24`).
   - npm 11.12.1 is the declared package manager.
   - Native packages, from lockfile `hasInstallScript`:
     - `fs-xattr@0.4.0` compiles with node-gyp and needs python3, make and g++.
     - `@datadog/pprof@5.15.1` uses prebuilds; arm64 support is UNVERIFIED.
     - `esbuild` has an arm64 binary; `protobufjs` has a postinstall script.
   - The dependency tree is heavy: 5 AWS SDK v3 clients, about 12 OpenTelemetry packages, and platformatic/watt.
   - No code generation is needed for unit tests.

6. **Demo appeal**
   - **After-tree:**
     - `modules/{bucket, object, s3, tus, iceberg, vector, render, cdn, tenant, jwks, health}`
     - `shared/{range, limits, …}`
     - `platform/{database, monitoring, queue, auth, cache, concurrency, errors, pubsub, sharding, streams, config, start}`
   - **Likely headline findings (sizes verified; the findings themselves are UNVERIFIED until the dependency graph is built):**
     - `src/storage/database/pg.ts` is a 2,528-line single DB adapter that every module writes through (cross-module DB writes).
     - `protocols/s3/s3-handler.ts` is 1,657 lines and `storage/object.ts` is 1,154.
     - Each operation has two front doors: `http/routes/bucket/createBucket.ts` and `http/routes/s3/commands/create-bucket.ts`. Merging them into one module makes the duplication obvious.
     - `http/routes/admin/tenants.ts` (869 lines) reaches into every domain.
     - Newer features (iceberg, vector) are spread across 4 to 5 folders each.
     - Mixed file naming (camelCase route files vs kebab-case S3 commands) shows why the rename-normalization step is useful.
   - **Hook:** "Supabase Storage: 10 features scattered across 4 layer folders become 10 modules. About 1,700 unit test call sites stay green, and every step is certified."

7. **Planner input:** about 161 × 80 ≈ 13k tokens scoped, or about 29k tokens for all 368 `src` files.

8. **Red flags**
   - Not pure type slicing, so the before/after is less dramatic.
   - Node 24 is required by engine-strict.
   - Dissolving the `@storage` alias root requires config edits.
   - 39 test files reference modules via `vi.mock` string literals.
   - The repo's own star count (1.3k) is below mcphub's 2.5k; only the brand recognition is strong.
   - **Score: 6/10.** Roughly on par with mcphub: stronger brand, weaker fit and more setup.

---

## Card: supabase/postgres-meta

1. **Identity**
   - URL: https://github.com/supabase/postgres-meta
   - License: Apache-2.0 (OSI-approved).
   - Stars: 1,250.
   - Last commit: 2026-08-31 (`commits/master.atom`).
   - Pinned HEAD: `f380cc5be21edef4e77d9838c732d1f20af0b3c0`

2. **Subtree**
   - Layout:
     ```
     src/lib/PostgresMeta<X>.ts (21), src/lib/sql/<x>.sql.ts (21), src/server/routes/<x>.ts (23 incl. generators/)
     ```
   - About 70 non-test files.
   - About 19 domains: columns, column-privileges, config, extensions, foreign-tables, functions, indexes, materialized-views, policies, publications, roles, schemas, table-privileges, tables, triggers, types, views, version, typegen.

3. **Applicability**
   - Fastify, with explicit route imports in `src/server/routes/index.ts`.
   - ESM with NodeNext resolution and `.js` specifiers.
   - `package.json` `main` is `dist/lib/index.js`, so `src/lib/index.ts` is a public library entrypoint and must be pinned.
   - `src/server/format-worker.js` is a piscina worker file, so it is location-sensitive.
   - Verdict: **full structural fit.**

4. **Tests**
   - vitest. The `test` script runs `db:run`, which is `cd test/db && docker compose up` (`package.json` L34-37). Fixtures live in `test/db/{Dockerfile,docker-compose.yml,00-init.sql}`.
   - About 0 offline cases. Our container has no Docker, so the suite can't run at all.

5. **Install:** npm. Native or heavy packages include `@sentry/profiling-node` (prebuilds) and `pgsql-parser` (whether its libpg-query is native or wasm is UNVERIFIED).

6. **Demo appeal**
   - After-tree: `modules/table/{table.route.ts, table.service.ts, table.sql.ts}` × 19 domains.
   - Hook: "the API behind Supabase Studio's table editor".
   - Finding: it has a divergent fork in `supabase/supabase/packages/pg-meta`.

7. **Planner input:** about 6k tokens.

8. **Red flags:** tests need Docker Postgres, and the repo is small. **Score: 4/10.**

---

## Not applicable

- **supabase/supabase** (Apache-2.0, 110,988 stars, HEAD `6143441493991f511f18f104d1f89bc7533efdd9`)
  - `apps/studio` (5,344 files) is a Next.js frontend with file-system routing in `pages/` and `routes/`, partway through a TanStack migration (`apps/studio/TANSTACK_MIGRATION.md`). It is outside the backend scope.
  - `packages/pg-meta` (about 100 `src` files) already groups by area under `sql/studio/<area>/`. Its tests need Docker Postgres (`test/run-tests.sh`, `test/db/docker-compose.yml`).
  - Studio deep-imports it via `@supabase/pg-meta/src/…` (confirmed in `apps/studio/data/fetchers.ts` and `apps/studio/hooks/analytics/useDbQuery.tsx`; total count UNVERIFIED), so moves would ripple into the frontend. No other TS backend exists under `apps/`.
- **supabase/cli** (2,430 stars, HEAD `703afc860284dc9203d816eff4d0893f6f9c1c97`)
  - It is being rewritten in TypeScript: `apps/cli` has 1,933 files and `packages/stack` 199.
  - It is Effect-based and organized by command (`apps/cli/src/commands/<cmd>/`). `packages/stack/src/services/` holds Docker service definitions, not a technical-type layer.
  - Most stack tests are `*.integration`/`*.docker.e2e`.
- **anomalyco/opencode** (canonical; `github.com/sst/opencode` redirects there per the Location header. MIT, 211,350 stars, last commit 2026-10-01, HEAD `a79ecfe109294909a239c98fb89f02979d5aa10b`)
  - `packages/opencode/src` (366 non-test TS) is already split by domain: `session/`, `tool/`, `provider/`, `lsp/`, `mcp/`, `permission/`, `plugin/`, `server/routes/instance/`, and so on. `packages/core/src` follows the same pattern.
  - Runtime is Bun (`"packageManager": "bun@1.3.14"`, `"test": "bun test …"`) with Effect. There is nothing to un-slice.
- **nestjs/nest** (MIT, 76,778 stars, last commit 2026-10-01, HEAD `7fb52e7f4f7314fbc117e369a09297bc2ecadf6b`)
  - It's a framework library. `packages/common` is split by type: interfaces 71, decorators 29, exceptions 24, pipes 21, utils 15, services 10.
  - But `packages/common/package.json` exports `"./*": "./*.js"`, so every file path is public API and moving any file is a breaking change for users.
  - The largest sample app is `sample/37-outbox` at 30 .ts files, and samples are organized by feature (`cats/`).
  - The org's ~50 source repos (orgs/nestjs/repositories) are all libraries, integrations, starters or sites. None is an application.
- **microsoft/vscode** (MIT, 193,356 stars, last commit 2026-10-02, HEAD `ef6de2591ba739498e9a32775a6d811e29ac5cfc`)
  - `src/vs` is organized by layer (base/platform/editor/workbench) and by runtime target (common/browser/node/electron-*). These boundaries are enforced by path-keyed `local/code-layering` and `local/code-import-patterns` rules in `eslint.config.js` (L117, L1548).
  - `workbench/contrib` already has 100 feature folders.
  - `extensions/typescript-language-features/src` (136 non-test TS) is mixed: `commands/` by type, `languageFeatures/` by feature. It's a client extension, not a backend. Its tests run in the Electron extension host: `src/test/unit/index.ts` requires `test/integration/electron/testrunner`, and `onEnter.test.ts` imports `vscode`.
  - `extensions/copilot` (4,157 files) follows the same layering as vscode itself.
- **Apache (ASF) GitHub org**
  - A Sourcegraph search over `github.com/apache/*` for TS files in `src/(controllers|services|routes|models|repositories)/` returned 16 repos. Every hit is a frontend or tiny:
    - superset-frontend, nifi-frontend, rocketmq-dashboard `web/`, amoro-web, answer `ui/` (its backend is Go)
    - ambari-web, atlas dashboard, camel-karavan webui, dubbo-go-pixiu `admin/web`, devlake config-ui, iggy `web/`
  - A backend-side search found only:
    - `apache/age-viewer` `backend/src`: 28 **JS** files with textbook controllers/services/models/routes, 392 stars, no test suite in its file list (HEAD `8a7f0be`).
    - `skywalking-banyandb` `canopy/server`: one route file, 354 stars.
  - echarts is a TS library already organized by chart and component.
  - Conclusion: ASF has no TS type-sliced Node backend.

## Notes for the orchestrator

- None of the user-named "very popular" repos is a type-sliced TypeScript backend. Popular TS projects at that scale are already organized by feature or layer (opencode, vscode), are libraries with path-as-API (nest), or are frontends (studio, ASF UIs).
- If brand recognition is the priority, supabase/storage is the only workable option. It requires:
  - (a) planner support for type folders that already contain domain subfolders
  - (b) a project-local Node 24
  - (c) alias re-rooting across `tsconfig.json` and both vitest configs


---

# Tier-2 popular candidates

## Ranking (judged against the mcphub bar: 2.5k stars, Apache-2.0, 226 files, ~1,800 offline jest cases)

| # | Candidate | Mode | Score | One-line reason |
|---|---|---|---|---|
| 1 | LibreChat `packages/data-schemas` | scoped | **8** | 45k stars, MIT, pure TS. Four parallel type folders (schema/models/methods/types) with one file per entity. About 3,045 offline cases. No imports reach into it from outside, and nothing is loaded by glob. |
| 2 | Logto `packages/core` | scoped (libraries/queries/middleware) | 6 | 14.6k stars, MPL-2.0, about 2,948 mock-based offline cases. Downsides: ESM `#src/*.js` specifiers, ~189 `mockEsm('#src/…')` path strings, jest runs on compiled `build/`, and `routes/` must stay where it is. |
| 3 | Seerr `server/` | full | 6 | 12.8k stars, MIT, simple layout, sqlite `:memory:` tests. Only about 221 cases, `__dirname` pins (including `entity/User.ts`), and 140 frontend files import `@server/*`. |
| 4 | Infisical `backend` | scoped (routes v1–v4) | 5 | 29.5k stars. `services/` is already sliced by feature; only the routers are sliced by API version. 8 router file names collide across versions. Native-dep risk on arm64. |
| 5 | LibreChat `api/` (JS) | full, but JS | 5 | 377 JS files and about 5,356 offline cases. Breaks the TS-only decision, and upstream is already moving `api/` into `packages/`. |
| 6 | Budibase `packages/server` | n/a | 3 | Tests start CouchDB and MinIO through testcontainers. GPL-3.0. |
| 7 | NocoDB `packages/nocodb` | n/a | 2 | Now under the Sustainable Use License (not OSI). The jest regex matches 0 files. `~/` resolves to a private `src/ee` overlay first. |
| 8 | ToolJet `server` | n/a | 2 | Already split into `src/modules`. Loads code by template-literal path, tests need Postgres, and `server/ee` is a private submodule. |
| 9 | Medusa v1.x `packages/medusa` | decline | 2 | services, repositories and models are found by glob and registered under names taken from their file names. |

**Recommendation:** use LibreChat `packages/data-schemas` as the headline target. It is popular, the approach applies cleanly, and the test certificate is strong. Keep mcphub as the full-mode demo, since data-schemas is only a data layer with no controllers or routes. Logto is the second scoped option if the team accepts handling `mockEsm` specifiers and the build-before-test step.

---

## 1. LibreChat `packages/data-schemas` — score 8

1. **Repo facts**
   - The repo has moved to https://github.com/LibreChat-AI/LibreChat (the old danny-avila URL returns 301).
   - License: MIT, which is OSI-approved. Evidence: `/LICENSE` and the `license` field in `packages/data-schemas/package.json`.
   - 45,192 stars. Last commit 2026-10-01 (`commits/main.atom`). HEAD `f10b1d91f1eee3a2c82d5247bf620351486b7c1b`.
2. **Type-sliced subtree:** `packages/data-schemas/src/`
   - Layout (files including tests): `methods/` 101, `schema/` 59, `models/` 53, `types/` 45. Also `utils/`, `app/`, `config/`, `migrations/`, `tenant/`, `common/`, `admin/`, `crypto/` and `index.ts`.
   - Non-test files we would move: methods 47 + schema 52 + models 48 + types 45 = **192 files (53k LOC)**. The whole package has 244 non-test files and 94 test files.
   - About 45 entity stems, which cluster into roughly 12 plausible domains:
     - agent: agent, agentApiKey, agentCategory, action, assistant, toolCall, codeEnvironment
     - conversation: convo/conversation, message, conversationTag, share/sharedLink, queuedTurn
     - file
     - identity: user, session, token, key, refreshTokenBridge, openidRefreshFlight, pluginAuth
     - access-control: accessRole, aclEntry, role, group/userGroup, systemGrant
     - prompt: prompt, promptGroup, categories
     - skill: skill, skillFile, skillSync*
     - schedule/trigger: schedule, scheduleRun, triggerDelivery, triggerLaneSequence, triggerUserPurge
     - mcp: mcpServer, mcpAuthority, mcpAuthorizationFenceRetry
     - billing: balance, transaction, tx, spendTokens
     - memory, chatProject, favorite, banner/config, auditLog
3. **Applicability**
   - Plain mongoose factories with explicit imports. `models/index.ts` imports every `create*Model` by name, and `methods/index.ts` composes `create*Methods` the same way.
   - Path alias `~/*` → `src/*` in `tsconfig.json` and the jest `moduleNameMapper`. Imports in the subtree: 381 `~/…` specifiers and 280 relative ones. No `.js` specifiers.
   - Existing barrels (`methods|models|schema|types/index.ts`, with `types/index.ts` at fan-in 87) stay as composition roots and only get specifier edits.
   - Location-sensitive code:
     - `config/utils.ts` uses `process.cwd()` for the log directory. It sits in `config/`, which we would not move.
     - `methods/documentdb.spec.ts:33` uses `path.join(__dirname,'../../../..')` and needs a pin.
   - No glob loaders and no generated code.
   - **No imports from outside reach into the subtree.** All 1,123 external importers use the package root `@librechat/data-schemas`. The `exports` field only exposes `.` and `./capabilities` from `dist/`. No consumer jest or tsconfig maps the package to its `src`.
   - `tsdown.config.mjs` entries are `src/index.ts` and `src/admin/capabilities.ts`, neither of which moves.
   - Test mocks: 36 `jest.mock('~/config/winston')` (not moved) and `jest.mock('~/models/plugins/mongoMeili')`. The rewriter must treat `jest.mock` strings as specifiers.
   - **Verdict: scoped.** The full package is 244 files. The moved set is ≥40 files with ≥4 domains.
4. **Tests**
   - Jest 30 with babel. 94 spec files and about 3,045 `it/test` calls (each `it.each` counted once).
   - 60 files start `MongoMemoryServer`. `jest.globalSetup.mjs` downloads the mongod binary once. No test uses an external `MONGO_URI`.
   - `testPathIgnorePatterns` excludes `/misc/`, which holds the docker-only ferretdb and documentdb suites.
   - The CI job `.github/workflows/backend-review.yml` builds data-provider and then data-schemas, and has no `services:` block.
   - Offline once the binary is cached: about 3,000 cases. Spec files by folder: 53 methods, 7 schema, 5 models.
5. **Install weight**
   - Two paths: npm workspaces at the root (`api`, `client`, `packages/*`), or `cd packages/data-schemas && npm ci` as the publish workflow does. The second pulls peer dependencies from npm, including `librechat-data-provider`.
   - No native addons in the package. mongodb-memory-server downloads mongod once (about 100 MB, UNVERIFIED). The host is Ubuntu 22.04 aarch64, and MongoDB publishes ubuntu2204 arm64 builds (UNVERIFIED for the default version of mongodb-memory-server 11).
   - CI uses Node 24.16. Node 22 compatibility is UNVERIFIED.
6. **Demo appeal**
   - After-tree: `src/modules/{agent,conversation,message,file,user,session,access-role,acl-entry,prompt,skill,schedule,trigger-delivery,mcp-server,transaction,balance,memory,…}/<stem>.{schema,model,methods,types}.ts` plus `src/shared/` (utils, retry, string) and `src/platform/` (config/winston, tenantContext, models/plugins/tenantIsolation and mongoMeili, the index aggregators).
   - Headline findings:
     - God files: `methods/triggerDelivery.ts` 4,351 LOC, `message.ts` 3,782, `conversation.ts` 3,620, `queuedTurn.ts` 3,010.
     - Naming drift made obvious without renaming anything: `models/convo.ts` vs `methods/conversation.ts`, `models/sharedLink.ts` vs `methods/share.ts`, `types/prompts.ts` vs `methods/prompt.ts`.
     - 0 import cycles: CI enforces this through `config/circular-deps.mjs`, and my SCC scan agrees.
     - Cross-entity DB writes inside `methods/` are UNVERIFIED.
   - Hook: "LibreChat's data layer: 45 entities spread across 4 parallel folders become 45 cohesive modules, with 3,000 tests green."
   - Bonus: the `api/` and `packages/api` suites consume the rebuilt `dist/` as a second witness.
7. **Planner input:** 244 × 80 ≈ 20k tokens (the moved set alone is about 15k).
8. **Red flags**
   - It is a persistence package, not a controller/service backend. The HTTP layer lives in the JS `api/` and the already feature-sliced `packages/api`.
   - Very active repo, so the SHA must be pinned.
   - Stem drift means clustering needs the LLM (which also showcases Nemotron).
   - **Score 8.**

## 2. Logto `packages/core` — score 6

1. **Repo facts:** https://github.com/logto-io/logto. License MPL-2.0 (OSI). 14,649 stars. Last commit 2026-09-30. HEAD `c814034401b0e13a6f461e0b0835ad3bbb84c9c2`.
2. **Subtree and layout**
   - `src/` non-test files: routes 208, libraries 67, queries 59, utils 52, middleware 42, oidc 28, sso 19, plus routes-me, tenants and others. 563 non-test `.ts` in total.
   - `routes/` has feature subfolders (experience 79, interaction 28, applications 24, admin-user 23, …) plus flat files with `*.openapi.json` siblings.
   - Scoped moved set: libraries + queries + middleware ≈ **168 files**.
   - 15+ domains: user, application, organization, role/scope, connector/social, sso-connector, sign-in-experience, hook, domain, passcode/verification, logto-config, one-time-token, subscription/quota, saml-application, secret, resource.
3. **Applicability**
   - Koa with hand-written DI containers `tenants/Queries.ts` (fan-in 97) and `tenants/Libraries.ts`, which use explicit imports. That is fine.
   - ESM (`"type":"module"`, `imports {"#src/*":"./build/*"}`). Specifiers look like `#src/x.js`: 1,603 `#src` and 936 relative.
   - **Location-sensitive code:**
     - `routes/swagger/utils/documents.ts:247` does `findUp('routes')` from `import.meta.url`, and `general.ts:80` recursively `readdir`s for `*.openapi.json`.
     - The `copy:apidocs` script rsyncs `src/routes` to `build/routes`.
     - So `routes/` is pinned.
   - **Test harness is path-sensitive:**
     - `jest.setup.js` checks `testPath.endsWith('/libraries/logto-config.test.js')` and `'/env-set/oidc.test.js'`.
     - It also has a stale `testPathIgnorePatterns '/build/routes/session/'`.
     - 89 test files call `mockEsm('#src/…')` (94 `#src`, 55 relative), plus 46 dynamic `import('#src/…')`. The rewriter must handle `mockEsm`/`mockEsmDefault`/`mockEsmWithActual`.
   - Also location-sensitive: `utils/connectors/index.ts:126` (`import.meta.url` dirname), plus `pkg-dir` in `workers/` and `libraries/script-runner`.
   - No other package imports `@logto/core` internals.
   - **Verdict: scoped.** A full move is not applicable because of the openapi scan.
4. **Tests**
   - Jest 29 with `--experimental-vm-modules`, run on tsc output (`roots: ['./build']`). 323 test files, about 2,948 cases. In scope: libraries 57 files/571 cases, queries 15/118, middleware 33/261.
   - Offline: `jest.setup.js` sets `DB_URL='postgres://mock.db.url'`, uses mockEsm for env-set, and nock. The CI job `main-test` in `.github/workflows/main.yml` has no `services:` block.
   - About 2,900 cases run offline.
5. **Install weight**
   - pnpm 10 monorepo with 20 packages plus about 70 connector packages, and a `pnpm:devPreinstall` connector sync.
   - Core tests need `pnpm build:test`. That requires built workspace deps (`@logto/schemas` has a generator, plus shared, phrases, connector-kit, core-kit) and `rsync`.
   - No obvious native addons (hash-wasm and xmllint are wasm). Heavy overall; time UNVERIFIED.
6. **Demo appeal**
   - After-tree: `modules/{user,application,organization,role,scope,connector,sso-connector,sign-in-experience,hook,domain,verification,…}/<stem>.{library,queries,middleware}.ts`. `routes/` stays pinned and is reported as a finding.
   - Findings:
     - A 35-file import cycle inside `routes/` (experience).
     - God file `routes/experience/classes/experience-interaction.ts` at 1,604 LOC.
     - The DI container `tenants/Queries.ts` is a 97-fan-in hub.
     - `queries/` is imported by 12 different top-level areas.
   - Hook: "Auth platform core, 3-layer slicing, hand-rolled DI made visible."
7. **Planner input:** 563 × 80 ≈ 45k tokens (scoped set about 13k).
8. **Red flags:** ESM plus mockEsm strings, compile-then-test, path-sensitive setup, routes pinned, heavy monorepo build. **Score 6.**

## 3. Seerr `server/` — score 6

1. **Repo facts:** https://github.com/seerr-team/seerr. MIT (OSI). 12,768 stars. Last commit 2026-09-29. HEAD `e9590629b8215676a352ec2413d7c8ee7e6974df`.
2. **Layout**
   - `server/{routes 26, entity 14, lib 39, api 21, interfaces/api 14, models 6, subscriber 4, utils 18, constants 7, middleware 3, job 2, migration 75, i18n, templates, test}`.
   - About **166 non-test, non-migration `.ts` files**.
   - Domains: request, media (incl. season), issue, user (incl. settings), notification, discover/search, blocklist, watchlist, override-rule, settings, plus external clients (tmdb, plex, jellyfin, servarr).
3. **Applicability**
   - Express plus TypeORM. Entities and subscribers are listed explicitly in `server/datasource.ts`. Migrations are found by glob (`server/migration/sqlite/**/*.ts`), so that folder is pinned.
   - Path alias `@server/*` (root `tsconfig.json` and `server/tsconfig.json`).
   - `__dirname` pins: `entity/User.ts:222,259` (email templates), `lib/notifications/agents/email.ts`, `lib/settings/index.ts` and `migrator.ts` (readdir of `migrations`), `logger.ts`, `utils/appDataVolume.ts`, `utils/appVersion.ts`, `api/animelist.ts`, `lib/imageproxy.ts`, `routes/settings/index.ts`, `i18n/index.ts`, `index.ts`. That is about 12 pinned files.
   - **Ripple:** 140 frontend `src/` files import `@server/*` (278 specifiers: models 72, constants 65, interfaces 55, lib 38, entity 26).
   - **Verdict: full,** with pins and frontend specifier edits.
4. **Tests**
   - `node:test` via `server/test/index.mts`, which globs `server/**/*.test.ts` and so survives moves.
   - 19 test files, about 221 cases. Supertest plus `setupTestDb` on sqlite `:memory:` (`datasource.ts:95`), with `mock.method` stubs (e.g. `routes/request.test.ts`).
   - Fully offline, but a thin certificate.
5. **Install weight**
   - pnpm 10 with Next 16 and cypress (use `CYPRESS_INSTALL_BINARY=0`). Native deps: bcrypt 6, sqlite3 ^5.1.7, sharp, listed in `onlyBuiltDependencies`. arm64 prebuilds UNVERIFIED for sqlite3.
   - Node `^22.19.0` is fine.
6. **Demo appeal**
   - After-tree: `modules/{media,request,issue,user,notification,discover,blocklist,watchlist,override-rule,settings}`, `platform/{datasource,logger,i18n}`, `shared/`.
   - Findings:
     - A **24-file import cycle** datasource ↔ entities ↔ subscribers ↔ notifications.
     - God files: `api/themoviedb/index.ts` 1,497 LOC, `lib/availabilitySync.ts` 1,218, `subscriber/MediaRequestSubscriber.ts` 1,142.
     - Entity `User` is pinned by template paths.
   - Hook: self-hosted media request app, cycle broken into visible boundaries.
7. **Planner input:** 166 × 80 ≈ 13k tokens.
8. **Red flags:** few tests, the central `User` entity is pinned, the frontend ripple is large, judges may not recognize the name. **Score 6.**

## 4. Infisical `backend` — score 5

1. **Repo facts**
   - https://github.com/Infisical/infisical. 29,558 stars. Last commit 2026-10-02. HEAD `4d1b96ba3da97ee1cf758286b6e80c794542a74b`.
   - License: MIT outside `ee/`. The root LICENSE says `ee/` follows "ee/LICENSE", but **no `ee/LICENSE` exists in the tree** (UNVERIFIED terms). `backend/package.json` says ISC.
2. **Layout**
   - `src/services/<feature>/` is already feature-sliced: 1,749 files in 124 folders.
   - The type-sliced part is `src/server/routes/v1..v4/`: **325 non-test routers** (v1 has 303 including provider subfolders such as app-connection-routers with 86).
   - `src/db/schemas` (296) is generated by `scripts/generate-schema-types.ts`, so it is pinned.
   - The backend has 2,930 non-test files outside `db/`.
3. **Applicability**
   - Fastify with explicit router registration. `@app/*` alias. Some `__dirname` use in the vitest config only (not scanned in src).
   - **8 router file names collide across versions** (identity-router, organization-router, user-router, password-router, certificate-authority-router, pki-alert-router, deprecated-project(-membership)-router). Without renames we need version subfolders.
   - The target would be to merge routers into the existing `services/<feature>/`, not to create `src/modules/`. That needs a target-layout variant.
   - `ee/` must be excluded.
   - **Verdict: scoped with a layout variant.**
4. **Tests**
   - Vitest (`vitest.unit.config.mts`, `src/**/*.test.ts`). 293 files, about 3,934 cases. Only about 4 files reference DB or socket patterns.
   - But the CI step "Start Secret Rotation testing databases" runs `docker-compose.e2e-dbs.yml` (Postgres, MySQL, Oracle) before `test:unit` (`.github/workflows/run-backend-tests.yml`). Some DB-dependent unit tests are therefore UNVERIFIED.
   - Estimate: about 3,800 offline cases.
5. **Install weight**
   - Single `npm ci` with 206 dependencies.
   - Native: `odbc` (node-pre-gyp from IBM releases; arm64 prebuilt UNVERIFIED; falling back to a source build needs unixODBC headers), `pkcs11js` (always node-gyp), `re2` (prebuilt or a long C++ build), `argon2`, `bcrypt`.
6. **Demo appeal:** "finish the migration". Services are already feature-folders, but 325 routers are sliced by API version; co-locate them. Findings would include features spread across 4 API versions and deprecated-* routers.
7. **Planner input:** about 325 × 80 ≈ 26k tokens plus 124 feature names (the full backend would be about 234k, too big).
8. **Red flags:** half-applicable premise, filename collisions, ee license ambiguity, native deps, CI starts DBs before unit tests. **Score 5.**

## 5. LibreChat `api/` (JS) — score 5 (only if the TS-only decision is relaxed)

- Same repo, SHA and license as card 1.
- `api/` is 637 `.js` files and 0 `.ts`. Non-test: 377.
- Layout: `server/services` 111 (with Files/, Endpoints/, Config/ subfolders), `server/routes` 73 (agents/, files/, admin/), `server/controllers` 34 (with agents/ holding 43 files including tests), `server/middleware` 68.
- `~` alias via `_moduleAliases` and the jest `moduleNameMapper`.
- Tests: 260 files, about 5,356 cases, jest plus mongodb-memory-server, offline.
- Red flags: the TS-only decision, partially feature-foldered already, and upstream is actively moving it into TS `packages/api` (1,447 files, feature-sliced). Moving files would collide with that migration.
- Planner input about 30k tokens.

## 6. Budibase `packages/server` — score 3

- https://github.com/Budibase/budibase. GPL-3.0 (`packages/server/LICENSE`). 28,328 stars. Last commit 2026-10-01. HEAD `ee2f184b682a2cf5ec06cf167381d0ff3b21b756`.
- Type-sliced: `src/api/controllers` 132 and `api/routes` 67 non-test. `sdk/workspace` (152) is already feature-sliced. 587 non-test `.ts` in total.
- **Not offline:** root `globalSetup.ts` starts `GenericContainer("budibase/database:2.1.0")` (CouchDB) and `budibase/minio` through testcontainers and calls `docker context ls`.
- jest maps `@budibase/pro` to `../pro/src`.
- Capped by the rules. Planner input about 47k tokens.

## 7. NocoDB `packages/nocodb` — score 2

- https://github.com/nocodb/nocodb. **License: "Sustainable Use License" v1.0, not OSI** (`/LICENSE.md`, "Updated on: January 29, 2026"; package.json `license` agrees). 65,149 stars. Last commit 2026-10-01. HEAD `799d458a25ba98d8073e6c4b5f1de0245ed5d358`.
- NestJS. 1,265 non-test files: controllers 78, services 163, models 96, helpers 130, utils 68, db 173, meta 240.
- **Tests:** `jest.config.js` has `testRegex: '(Integration|Source)\\.spec\\.ts$'`, which matches **0 files**, and `--passWithNoTests` is set. The 115 `*.spec.ts` files are Nest "should be defined" boilerplate, some stale (`controllers/auth.controller.spec.ts` imports `./auth/auth.controller`).
- **Location-sensitive by design:** `~/` and `@/` resolve to `<rootDir>/ee/$1` first (jest and tsconfig). `src/ee` is absent from the public tree, so moves would break the private EE overlay.
- Planner input about 100k tokens.

## 8. ToolJet `server` — score 2

- https://github.com/ToolJet/ToolJet. AGPL-3.0. 41,025 stars. Last commit 2026-10-01. HEAD `678fb8f69b8448592df5f35e77d5a13e87275b63`.
- Already split: `src/modules/<feature>` holds 1,173 files. Leftover type folders: `entities` 102, `dto` 24, `helpers` 21.
- Loads code by path: `src/modules/ai/module.ts:32` uses ``await import(`${importPath}/ai/controller`)`` via `getImportPath` (`modules/app/constants/index.ts`).
- Private `server/ee` submodule (github.com/ToolJet/ee-server returns 404). `@entities/*` aliases are shared with ee.
- Tests: `test/modules/*/unit/*spec.ts`, with Postgres truncation and transactions (`test/jest-global-setup.ts`, `jest-transaction-setup.ts`).

## 9. Medusa v1.x `packages/medusa` — decline, score 2

- https://github.com/medusajs/medusa. MIT. 36,546 stars (driven by v2). Branch `v1.x` HEAD `55491df168e9dc09b4beff65dcbb200e804abc1a`, last commit 2026-06-01. `develop` is v2 and already modular.
- v1 is type-sliced: services 68, repositories 70, models 84; `api/routes/admin` has 40 feature folders.
- **Declined:** `loaders/services.ts`, `repositories.ts` and `models.ts` use `glob.sync(path.join(__dirname,"../services/*.js"))` plus `formatRegistrationName(fn)`. Strategies and subscribers are loaded the same way. Pinning all of them leaves only `api/`, which is already feature-sliced.
- 212 `__tests__` files (mock-based, likely offline, not verified further).


---

# Open sweep

## Ranked NEW candidates (scored against the mcphub bar)

| # | Repo | Stars | License | Type-sliced subtree, non-test .ts | Offline tests | Verdict | Score |
|---|---|---|---|---|---|---|---|
| 1 | paperclipai/paperclip | 95,874 | MIT | `server/src/{services 430 flat + subdirs, routes 75, middleware 16}` | ~10.6k cases / 878 files. ~6.3k mocked; ~4.3k use embedded Postgres (local binary, no Docker) | scoped (server/src) | 8 |
| 2 | Dokploy/dokploy | 37,609 | Apache-2.0, except `*/proprietary/` dirs (own license, not OSI) | `packages/server/src/{services 58, db/schema 52, utils 115}` + `apps/dokploy/server/api/routers 62` | 957 cases / 117 files, DB mocked globally | scoped (2 packages) | 8 |
| 3 | monkeytypegame/monkeytype | 20,800 | GPL-3.0 | `backend/src/{api/controllers 14, api/routes 17, dal 15, middlewares 8, utils 15, queues/workers/jobs}`, 100 files | 513 unit cases / 24 files offline; integration uses testcontainers (excluded) | full | 7.5 |
| 4 | Crosstalk-Solutions/project-nomad | 38,878 | Apache-2.0 | `admin/app/{services 37, controllers 19, models 14, validators 15, jobs 12, utils, middleware}`, 152 files | ~708 cases / 59 `node:test` files, pure, offline | full | 7 |
| 5 | firecrawl/firecrawl | 187,617 | AGPL-3.0 | `apps/api/src/{controllers v0/v1/v2 101, routes 9, services 110, lib 203}` | 2,504 cases / 245 non-snips files (132 use vi.mock); CI runs redis+rabbitmq+postgres; offline share UNVERIFIED | scoped | 6 |
| 6 | Termix-SSH/Termix | 15,296 | Apache-2.0 | `src/backend/{database/routes 44, database/repositories 41, utils 52}` | 2,240 backend cases / 271 files; in-memory SQLite (`TestSqliteDatabase`) | scoped | 6 |
| 7 | civitai/civitai | 7,268 | Apache-2.0 | `src/server/{services ~600 flat, routers 110, controllers 47, schema 100}`, already `<stem>.<role>.ts` | 20,571 cases / 1,493 server test files; DB tier self-skips without DATABASE_URL | scoped, risky | 5.5 |
| 8 | Chocobozzz/PeerTube | 15,341 | AGPL-3.0 | `server/core/{lib 387, initializers 133, models 125, middlewares 112, controllers 101, helpers 97}` | Not offline: CI needs postgres, redis, openldap, s3-ninja, keycloak | layout fits, tests don't | 5 |

Runners-up, all capped at 5 or below:
- **trigger.dev** (16,454 stars, Apache-2.0): `apps/webapp/app` has services 237, presenters 107 and models 24. Remix's `.server.ts` suffix carries meaning, so files can't be renamed freely. The vitest `include` lists exact source globs, and 271 of 713 test files use `@internal/testcontainers`.
- **bluewave-labs/checkmate** (10,903 stars, AGPL-3.0): already half-migrated to `server/src/domain/<feature>`. Only `api/{routes 18, controllers 16, validation 15, middleware 10}` is left.
- **misskey** (11,336 stars, AGPL-3.0): `packages/backend/src` has core 179 and models 119, but the tests need PG and Redis.

---

### 1. paperclipai/paperclip (score 8)
1. https://github.com/paperclipai/paperclip
   - MIT (OSI), 95,874 stars, last commit 2026-10-02.
   - HEAD `b31ce54b814100e82c8194c678f9658af4e871b3` (branch master).
2. Subtree is `server/src/`.
   - `services/` holds 430 top-level files plus subdirs: native-runtime 85, connectors 18, recovery 13, photon 8, runtime-exposure 6.
   - Also `routes/` 75, `middleware/` 16, and an existing `modules/` with 39 files.
   - Movable set is about 520 files. There are more than 20 domains, judging by filename prefix: chat 60, plugin 28, issue 22, agent 20, execution 14, company 12, workspace 12, tool 11, environment 10, run 9, heartbeat 8, github 7, skill 7, slack 7, plus decision, project, secret, budget, approval and others.
3. Applicability:
   - Express app, ESM. `tsconfig.base.json` uses `module`/`moduleResolution: NodeNext`, so every specifier ends in `.js`.
   - Barrels already exist: `services/index.ts` (219 lines), `middleware/index.ts`, `routes/index.ts`.
   - 26 location-sensitive files in services/routes use `__dirname`, `import.meta.url`, `readdirSync` or `new Worker` (e.g. `plugin-loader.ts`, `skills-catalog.ts`, `built-in-agents.ts`, `native-runtime/*`). They get pinned.
   - The build copies `src/services/scripts/` by path, so that folder is pinned too.
   - Things the tool must rewrite: 603 relative `vi.mock` specifiers in 191 test files, 23 relative dynamic imports, and 42 imports into `server/src` from outside `server/`.
   - 41 test files call `readFileSync` or `readdirSync` and may read sources by path. Needs checking.
   - **Narrative risk:** `server/src/modules/README.md` defines the maintainers' own target: hexagonal `domain/application/adapters`, one `index.ts` entry per module, enforced by `pnpm check:module-boundaries`. Our flat `<stem>.<role>.ts` with no barrels doesn't match that convention.
   - Verdict: scoped on `server/src/{services,routes,middleware}`.
4. Tests: vitest. Config is `server/vitest.config.ts` with `maxWorkers: 1`, `pool: forks`, serial, and setup `src/__tests__/setup-supertest.ts`.
   - 878 test files, about 10,634 `it`/`test` lines (Sourcegraph).
   - 279 files (about 4,330 cases) use `startEmbeddedPostgresTestDatabase` (`server/src/__tests__/helpers/embedded-postgres.ts` → `@paperclipai/db`). That starts a real local Postgres binary, which counts as offline but slow.
   - Linux-arm64 binary availability for `embedded-postgres` is UNVERIFIED.
   - The remaining ~6.3k cases are mocked.
5. Install weight is heavy.
   - pnpm 9.15 monorepo with about 50 packages. Engines `node >=24.11.0` and `.nvmrc` 24, so Node 22 on the host is a mismatch.
   - Native and binary deps: sharp, embedded-postgres, ssh2, heif2jpeg. `test:run` needs `preflight:workspace-links` plus the plugin-sdk `ensure-build-deps` step.
6. Demo appeal:
   - After-tree: `modules/{chat, plugin, issue, agent, execution, company, workspace, tool, environment, run, heartbeat, skill, decision, project, secret, budget, approval, …}`, plus `platform/` for middleware and runtime and `shared/`.
   - Headline: "95k-star repo with a 430-file flat `services/` folder, plus a stalled migration (3 modules done, README written, boundary script in place). We finish the grouping mechanically and certify it."
7. Planner input: about 520–650 files × 80 ≈ 42–52k tokens.
8. Red flags:
   - Daily churn, so pin the SHA.
   - Node 24.11 required.
   - ESM `.js` specifiers.
   - Size: 3,580 .ts files in the repo.
   - Serial test runtime is long (UNVERIFIED how long).
   - Convention clash with their hexagonal modules.

### 2. Dokploy/dokploy (score 8)
1. https://github.com/Dokploy/dokploy
   - `LICENSE.MD`: Apache-2.0 for everything outside `/proprietary` dirs. `LICENSE_PROPRIETARY.md` applies inside them and is not OSI.
   - 37,609 stars, last commit 2026-10-01 (branch canary). HEAD `48504fde4eb210056f7d9f80406f9692a1a7ea8a`.
2. Subtree layout:
   - `packages/server/src/{services 58, db/schema 52, utils 115 (docker, backups, builders, vault, notifications, restore, traefik, databases, dns, providers…), setup 9, emails 19}` = 276 files.
   - Plus `apps/dokploy/server/api/routers/` with 62 files.
   - About 35 domains: application, compose, postgres/mysql/mariadb/mongo/redis/libsql, domain, certificate, port, redirect, security, mount, backup, volume-backup, destination, deployment, preview-deployment, rollback, schedule, server, cluster, docker, registry, ssh-key, git-provider (github/gitlab/gitea/bitbucket), notification, project, environment, user, admin, settings, ai, patch, tag, vault-provider, dns-provider, transfer.
3. Applicability:
   - tRPC + Drizzle. `moduleResolution: Bundler`, so specifiers are extensionless.
   - `packages/server/src/index.ts` is a 153-line `export *` barrel.
   - `package.json` exports `.`, `./db`, `./setup/*` and `./constants`. Pin `db/index.ts`, `setup/`, `constants/`.
   - Path aliases: `@dokploy/server/*` → `packages/server/src/*` in `apps/dokploy/tsconfig.json`.
   - Specifiers from outside the package: 180 bare `@dokploy/server` and about 200 deep ones, e.g. `@dokploy/server/services/permission` ×36 and `/db/schema` ×23. All are rewritable.
   - The esbuild entry glob `./src/**/*.ts` still matches after moves.
   - Location-sensitive: only 4 files (`constants/index.ts`, `templates/index.ts` use cwd; `services/settings.ts`, `utils/filesystem/directory.ts` use readdirSync).
   - Routers can't cross into packages/server, so the result is two module trees.
   - Verdict: scoped.
4. Tests: vitest, config `apps/dokploy/__test__/vitest.config.ts`.
   - It aliases `@dokploy/server` to `packages/server/src`, so no build is needed.
   - `__test__/setup.ts` runs `vi.mock("@dokploy/server/db")` with a chainable fake. The comment there says it is so tests "never open a real TCP connection to PostgreSQL".
   - Tests import through the barrel (e.g. `__test__/compose/domain/labels.test.ts`), so they survive moves.
   - 117 files, about 957 cases offline. Some deploy/docker suites may shell out (UNVERIFIED).
5. Install weight is medium-heavy.
   - pnpm 10.22, engines `node ^24.4.0`, so Node 22 is a mismatch.
   - Native deps: bcrypt and node-pty (likely builds from source on linux-arm64, needing python3/make/g++), plus ssh2, dockerode and a Next.js app.
6. Demo appeal:
   - After-tree: `modules/{application, compose, database-postgres…, domain, certificate, backup, deployment, server, cluster, git-provider, notification, registry, project, user, …}/{x.service.ts, x.schema.ts}` plus `x.router.ts` on the app side.
   - Likely finding: utils/ holding domain logic.
   - Hook: "the self-hosted Vercel/Heroku alternative".
7. Planner input: 338 files × 80 ≈ 27k tokens.
8. Red flags: proprietary dirs must be excluded; Node 24; node-pty build; cross-package specifier rewrite.

### 3. monkeytypegame/monkeytype (score 7.5)
1. https://github.com/monkeytypegame/monkeytype
   - GPL-3.0, 20,800 stars, last commit 2026-10-01. HEAD `bcbf5c390a789acfcef5f458740366f6011b971c`.
2. Subtree is `backend/src/`, 100 non-test files.
   - Layout: `api/controllers` 14, `api/routes` 17, `dal` 15, `middlewares` 8, `utils` 15, `init` 5, `jobs` 5, `queues` 5, `workers` 3, `services` 2.
   - About 12 domains: user, result, leaderboard, quote, preset, config, ape-key, connections, psa, admin, configuration, webhooks/public.
3. Applicability:
   - Express + ts-rest, CJS.
   - 9 location-sensitive files to pin: `version.ts`, `init/redis.ts` (readdirSync over `../../redis-scripts`), `init/configuration.ts`, `init/firebase-admin.ts`, `init/email-client.ts`, `dal/new-quotes.ts`, `api/routes/{index,swagger,docs}.ts` (all `__dirname`).
   - Imports into the backend come only from `__tests__`. Contracts live in the `@monkeytype/*` workspace packages.
   - Tests mock by path (`vi.mock("../src/init/db")` in `__tests__/setup-tests.ts`), so mock specifiers must be rewritten.
   - Verdict: full.
4. Tests: vitest projects in `backend/vitest.config.ts`.
   - The "unit" project mocks db, logger and firebase. Integration projects use `testcontainers` mongo:5.0.13 and redis:6.2.6 (`__tests__/__integration__/global-setup.ts`) and are not offline.
   - Unit: 24 files, 513 cases.
5. Install weight is medium.
   - pnpm 11 + turbo; root engines `node >=24 <25`.
   - `@monkeytype/{contracts,schemas,util}` export `dist/` at runtime, so they need a tsup build first.
   - bcrypt native.
6. Demo appeal:
   - After-tree: `modules/{user, result, leaderboard, quote, preset, config, ape-key, connection, psa, admin}/{x.controller,x.route,x.dal}.ts`, plus `platform/{init, queues, workers, jobs, middlewares}`.
   - Hook: "the typing-test site every developer knows".
7. Planner input: 100 × 80 ≈ 8k tokens.
8. Red flags: smaller than mcphub (100 vs 226 files, 513 vs ~1,800 cases); Node 24; integration suite not offline.

### 4. Crosstalk-Solutions/project-nomad (score 7)
1. https://github.com/Crosstalk-Solutions/project-nomad
   - Apache-2.0, 38,878 stars, last commit 2026-09-30. HEAD `5e1702efebfc5549f870911b2b042ed3bd312fcd`.
2. Subtree is `admin/app/`, 152 files.
   - Layout: services 37, controllers 19, validators 15, models 14, jobs 12, middleware 4, utils about 40, data, exceptions.
   - About 13 domains: zim/kiwix, maps, chat/ollama, rag, benchmark, download, drug-reference, condition, system-update/auto-update, docs, collection, creator-pack, eval, settings.
3. Applicability:
   - AdonisJS 6, ESM. Imports go through the subpath map in `admin/package.json` (`"#services/*": "./app/services/*.js"`, …), so moving needs a new `#modules/*` entry plus specifier rewrites.
   - Jobs are imported explicitly in `commands/queue/work.ts`, so no glob loading.
   - Location-sensitive: only `controllers/openapi_controller.ts` (`import.meta`). The rest uses `process.cwd()` or `app.makePath`, which don't depend on file location.
   - Imports into app/ from elsewhere: tests 113, commands 58, start 38, providers 15, inertia frontend 14.
   - snake_case files (`zim_service.ts`) become `zim.service.ts` by separator normalization.
   - Verdict: full.
4. Tests: `node --test "tests/unit/**/*.spec.ts"`.
   - 59 unit specs, about 708 cases. Pure, e.g. `tests/unit/app_auto_update.spec.ts`, whose own comment calls the code it tests "pure, offline".
5. Install weight is light-medium. Node 22 (Dockerfile `node:22-slim`), so no mismatch. better-sqlite3 and sharp have prebuilds; tesseract.js is wasm.
6. Demo appeal: "an offline survival computer". After-tree as above, plus `platform/{docker, queue, system}`.
7. Planner input: 152 × 80 ≈ 12k tokens.
8. Red flags: judges may not recognize the brand (it's a Crosstalk Solutions YouTube project); framework-convention folders (`node ace make:*` scaffolding) will feel "fought against".

### 5. firecrawl/firecrawl (score 6)
- HEAD `e76d5b6fcdce84a8a8ec85e17969e018c9c17147`. 187,617 stars, AGPL-3.0, last commit 2026-10-01.
- Subtree `apps/api/src` is 556 files. lib/ is a 203-file junk drawer.
- Controllers are sliced by API version (v0 19, v1 26, v2 55), so the same stem repeats across versions (crawl, scrape). That clashes with the casing-only rename rule and needs nested version dirs.
- Entrypoints to pin: `services/queue-worker.ts`, `services/worker/nuq-worker.ts`, `services/indexing/index-worker.ts`, `harness.ts` (all referenced from package.json scripts).
- Tests:
  - vitest. The `apps/api/vitest.config.ts` comment says "this suite talks to real services".
  - 95 snips/e2e files need a running stack.
  - 245 other files hold about 2,504 cases. The offline share is UNVERIFIED.
- Native deps: `@mendable/firecrawl-rs` (napi; arm64 prebuilt UNVERIFIED) and koffi.
- Planner input ≈ 44k tokens.

### 6. Termix-SSH/Termix (score 6)
- HEAD `28e74de4523c647c2668884568067587957c57a8`. Apache-2.0, 15,296 stars, Node `>=22.12` (no mismatch).
- Movable: routes 44, repositories 41, utils 52 (about 140 files). Domains: host, credential, user, auth, rbac, plugin, audit-log, session, folder, tls, settings, api-key.
- Siblings `hosts/`, `sync/`, `auth/` are already feature folders, so this is a stalled migration.
- Tests mirror the source tree under `src/backend/tests/`. They use the `TestSqliteDatabase` helper (e.g. `tests/database/repositories/api-key-repository.test.ts`), so they're offline. 886 cases cover the movable dirs.
- Install: electron and node-pty are heavy.

### 7. civitai/civitai (score 5.5)
- HEAD `2c182051e9ceb16326a4da4488adcb72d14acd4f`. Apache-2.0, 7,268 stars, but the brand is iconic in AI.
- Already named `x.service.ts`, `x.router.ts`, `x.controller.ts`, `x.schema.ts`, so it needs zero renames.
- Red flags:
  - 164 test files read sources by path (the `no-*` architecture guard tests).
  - 4,325 `vi.mock` specifiers.
  - Node 24.
  - 5,641 .ts files.
  - Next.js `pages/api` routes are pinned.

### 8. Chocobozzz/PeerTube (score 5)
- HEAD `faa76bad2c1969a088ef1df38dc666dfe7259b5c`.
- A textbook type-sliced server (about 1,050 files), but `.github/workflows/test.yml` needs redis, postgres:14, openldap, s3-ninja and keycloak services.

---

## Popular TS backends checked this session that are already feature-modular or don't fit

**Feature-modular:**
- openclaw/openclaw (391k): `src/{agents, gateway, channels, plugins, cron…}`
- AFFiNE (73k): `server/src/{core, plugins}/<feature>`
- umami (39k): Next app routes + `queries/`
- activepieces (24.8k): `server/api/src/app/<feature>`
- teable (21.9k): `nestjs-backend/src/features`
- documenso (15.3k): `lib/server-only/<domain>`
- formbricks (13k): `apps/web/modules/<feature>`
- typebot (10.5k): `packages/<feature>`
- fluxer (10.4k): `api/<domain>/{services, repositories, controllers}`, already domain-first
- huly platform (27.8k): `server/<service>`
- RSSHub (46k): `lib/routes/<namespace>`, loaded by file convention
- worldmonitor (88k): `server/worldmonitor/<domain>`

**Mixed or partial:**
- dub (24.9k): `apps/web/lib/<domain>`
- cherry-studio (52k, AGPL): `src/main/features` + `services/<subsystem>`, Electron main process
- claude-mem (95k): services grouped by subsystem
- Rocket.Chat main server: `lib/`, `meteor-methods/`, `modules/`

**Other reasons:**
- lobehub (83k): services already in `<domain>/` subfolders; LobeHub Community License is not OSI.
- karakeep (29k): only 53 trpc files.
- Zero (10.8k): 92 files.
- postiz: `apps/backend` has 55 files.
- langfuse (35k): web is feature-sliced; tests need PG/ClickHouse.
- Vendure (8.5k, now vendurehq/vendure): library with public barrels; `entity/<domain>` already.
- Nango (12.5k, license "Other"): controllers nested by URL path.

**Type-sliced but JS, so outside TS-only scope:**
- uptime-kuma (92k): 210 js / 5 ts
- anything-llm (66.7k): `server/utils` has 370 js files
- parse-server (21.4k)
- audiobookshelf (14.5k)
- habitica (14.2k)
- kutt (11.1k)

All counts above come from the GitHub tree-list at the pinned SHAs, raw file reads, and Sourcegraph stream counts. Test-case numbers count `it(`/`test(` lines statically, so `.each` expansions aren't included.


---

# Open sweep: deep check of top 3

## Deep-check: top 3 from the sweep (pinned SHAs, counts re-derived from in-memory tarball streams)

**Notes that apply to all three**
- **Host.** aarch64, Node v22.23.3, 12 cores, 61 GB RAM, non-root user `paseo`. python3, make and g++ are present.
- **Node version.** All three repos require Node 24, which the host lacks. Only monkeytype enforces it at install (see its card).
- **TypeScript 7.** All three pin TypeScript 7.0.2, the Go-native tsc. It is now the npm `latest` tag and ships `@typescript/typescript-linux-arm64` (https://registry.npmjs.org/typescript).
  - Implication: our analyzer should bundle its own TS 5.x/6.x API, for example via ts-morph, and use the repo's tsc 7 only as the typecheck gate.
  - Whether TS 7.0 exposes a JS compiler API is UNVERIFIED.
- **tree-list caveat.** GitHub tree-list leaves out `vendor/` paths. `paperclip/server/src/vendor/paperclip-runner/index.ts` exists on raw (HTTP 200) but is missing from tree-list. I checked all movable-set counts below against the tarball.
- **Test-case counts** are static matches of `it(`/`test(` lines, so `.each` expansions are not counted.

---

### 1. Dokploy/dokploy — score 8 (best fit against the mcphub bar)

1. **Repo facts.**
   - URL: https://github.com/Dokploy/dokploy
   - License (`LICENSE.MD`): Apache-2.0 (OSI) for everything outside `/proprietary` directories. Content inside them falls under `LICENSE_PROPRIETARY.md`, which is not OSI.
   - 37,609 stars. Last commit 2026-10-01T14:35Z (default branch `canary`).
   - HEAD `48504fde4eb210056f7d9f80406f9692a1a7ea8a`.
2. **Subtree.** Two type-sliced trees.
   - `packages/server/src/` has 276 ts/tsx files:
     - `services/` 53, plus 5 under `services/proprietary/`. The sweep's 58 included the proprietary ones.
     - `db/schema/` 51 (the sweep said 52), plus `schema.dbml`.
     - `utils/` 115 across 22 subfolders: backups 10, builders 10, docker 11, vault 10, traefik 9, notifications 9, restore 9, dns 7, providers 7, databases 7, and others.
     - Also: `setup` 9, `emails/emails` 18 tsx, `lib` 7, `db/validations` 3, `templates` 3, and an `index.ts` barrel.
   - `apps/dokploy/server/api/routers/` has 51 files plus 7 in `proprietary/`.
   - Movable set is about 217 package files (services 53, schema ~49, utils 115) plus 51 routers.
   - Domains are unusually clean:
     - 36 stems appear in all three of services, schema and routers. The union is 71 stems.
     - After merging plurals that gives about 45 domains: application, compose, postgres, mysql, mariadb, mongo, redis, libsql, domain, certificate, port, redirect, security, mount, backup, volume-backup, destination, deployment, preview-deployment, rollback, schedule, server, cluster, docker, registry, ssh-key, git-provider, github, gitlab, gitea, bitbucket, notification, project, environment, user, admin, settings, ai, patch, tag, vault-provider, dns-provider, transfer, network, …
3. **Applicability: scoped, as two module trees.**
   - **Stack.** tRPC + Drizzle, `moduleResolution: Bundler`, extensionless specifiers.
   - **Self-alias.** `@dokploy/server/*` → `./src/*` is used *inside* the package itself: 424 specifiers, versus 849 relative ones. The rewriter must be alias-aware.
   - **Specifiers from outside the package.** 586 in total, 187 of them through the barrel:
     - `__test__` 252
     - `server/api` 173
     - Next `pages` 71 and `components` 30
     - `server/{utils,wss,db,queues}` 38
     - `apps/schedules` 2, `apps/api` 1
   - **Pins:**
     - The `package.json` exports: `db/index.ts`, `setup/*`, `constants/`. `scripts/switchToDist.js` rewrites those exports at build time.
     - `db/schema/index.ts`, which drizzle reaches through `apps/dokploy/server/db/drizzle.config.ts`.
     - `db/schema/dbml.ts`, a generator script.
     - Every `/proprietary/` directory. Moving a file out of one would change its license.
   - **Location-sensitive files.** Only 4: `constants/index.ts` and `templates/index.ts` use `process.cwd()`; `services/settings.ts` and `utils/filesystem/directory.ts` use readdirSync.
   - **Build glob.** The esbuild entry `./src/**/*.ts` (`packages/server/esbuild.config.ts`) still matches after moves.
   - **Routers.** Can't move into the package because they depend on app context. The result is `packages/server/src/modules/*` plus `apps/dokploy/server/modules/*`.
4. **Tests.**
   - vitest. Config is `apps/dokploy/__test__/vitest.config.ts`:
     - includes `__test__/**/*.test.ts`, `pool: forks`
     - aliases `@dokploy/server` to `packages/server/src`, so no build is needed
     - setup `__test__/setup.ts` runs `vi.mock("@dokploy/server/db")` with a chain fake
   - 117 files with 971 cases (the sweep said 957).
   - **Correction to the sweep: the tests do not survive moves through the barrel.** Only 69 of 252 specifiers use the barrel. There are 40+ deep `vi.mock` targets, for example `@dokploy/server/utils/process/execAsync` ×7 and `services/proprietary/license-key` ×6. These must be rewritten, or the mocks silently stop applying.
   - **CI is not offline.** `.github/workflows/pull-request.yml` installs Nixpacks and Railpack, runs `docker swarm init`, then `pnpm server:build`.
   - **Locally:**
     - `deploy/application.real.test.ts` (6 cases) is ungated. It git-clones github.com/Dokploy/examples and runs nixpacks/docker, so exclude it from the baseline.
     - `setup/monitoring-setup.real.test.ts` (4 cases) uses `skipIf(!hasDocker()||…||!process.env.CI)`.
     - `compose/env-file-literals.test.ts` (1 case) uses `skipIf(!hasDocker())`.
     - 13 injection tests shell out to local `/bin/sh` only.
   - **Roughly 960 cases run offline**, and fast, because they are parallel forks.
5. **Install: medium-heavy.**
   - pnpm 10.22, engines `node ^24.4.0`. There is no engine-strict setting, so a Node 22 mismatch only warns.
   - The whole workspace includes a Next.js app.
   - `node-pty@1.1.0` ships prebuilds only for darwin/win32 (npm tarball), so on Linux it runs `node-gyp rebuild`. The host toolchain is present.
   - `bcrypt@5.1.1` has a `linux-arm64-glibc` prebuilt (kelektiv release assets).
   - Also ssh2 and cpu-features.
6. **Demo appeal.**
   - After-tree: `modules/<domain>/{x.service.ts, x.schema.ts}` in the package, with `x.router.ts` on the app side. `utils/{docker,traefik,process,filesystem}` goes to `platform/`.
   - Headline findings:
     - A 47-file import cycle covering the entire `db/schema`. Drizzle relations make the whole data model one cycle.
     - A 15-file runtime cycle across `services/{application,compose,deployment,domain,github,patch,preview-deployment,rollbacks}` and `utils/{builders,docker,providers,cluster}`. After the move it becomes a cycle between about 8 modules.
     - A 9-file cycle inside `utils/backups`.
     - The package barrel `index.ts` sits in a cycle with `utils/volume-backups`.
     - Routers write to the DB directly, bypassing services: `organization.ts`, `tag.ts`, `user.ts`.
     - `services/transfer.ts` imports 10 other services.
     - The 115-file `utils/` folder holds domain logic.
     - Large files: `services/notification.ts` 1,240 lines, `routers/project.ts` 1,287.
   - Hook: "the self-hosted Vercel/Heroku alternative: three parallel type folders zipped into ~45 feature modules."
7. **Planner input.** About 268 files × 80 ≈ 21k tokens.
8. **Red flags, then score 8.**
   - Two trees in two packages.
   - Proprietary carve-out pins.
   - Self-alias plus deep-mock rewriting.
   - Node 24 required.
   - node-pty builds from source.
   - The 47-file schema cycle may read as noise rather than a finding.

---

### 2. paperclipai/paperclip — score 7 (biggest name, heaviest ops; the sweep said 8)

1. **Repo facts.**
   - URL: https://github.com/paperclipai/paperclip
   - MIT (OSI). 95,876 stars. Last commit 2026-10-02T02:29Z (`master`).
   - HEAD `b31ce54b814100e82c8194c678f9658af4e871b3`.
2. **Subtree.** `server/src/`.
   - `services/` has 430 flat files plus feature subfolders: native-runtime 85, connectors 18, recovery 13, photon 8, runtime-exposure 6. `routes/` has 75 and `middleware/` 16.
   - Existing `modules/` holds 25 source files, 13 tests and a README: active-run-watchdog, run-dispatch, wake-queue.
   - **Movable flat set: 521** (430 + 75 + 16), or 651 including subfolders.
   - **Domains.** 128 distinct first-word prefixes. 21 prefixes have ≥5 files and cover 270 of the 430; 74 prefixes are singletons.
     - Prefixes with ≥5 files: chat 60, plugin 28, issue 23, agent 21, execution 14, company 13, workspace 12, tool 11, environment 11, run 9, heartbeat 8, skill 8, github 7, slack 7, adapter 6, connection 6, remote 6, decision 6, local 5, managed 5.
     - Estimate 30–40 real domains. Grouping the long tail is real LLM work.
3. **Applicability: scoped (`services` flat, `routes`, `middleware`), with caveats.**
   - **ESM.** NodeNext (`tsconfig.base.json`), so every specifier ends in `.js`.
   - **Barrels.** `services/index.ts` has 219 lines and 69 export-from lines; 34 server files import it. `routes/index.ts` has 43 lines.
   - **Location-sensitive.** 30 files flagged; about 20 genuinely depend on their location:
     - files using `import.meta.url`, `__dirname` or `createRequire`, e.g. `plugin-loader.ts` (`REPO_ROOT = ../../..`), `skills-catalog.ts`, `built-in-agents.ts`, `default-agent-instructions.ts` (`../onboarding-assets/`), `routes/access.ts`, `routes/plugins.ts`
     - files loaded by path: `agent-avatar-pool.ts` loads `./agent-avatar-worker.ts` by URL; `services/scripts/*` is read by URL and copied by the build script in `server/package.json`
   - **Generated file inside the movable set.** `services/native-runtime/runner-api-reference.ts`, written by `scripts/generate-runner-api-reference.mjs`.
   - **Code to rewrite:**
     - 41 import specifiers coming from outside `server/` (scripts, tests/e2e, tests/lifecycle-baseline, cli, paperclip-runner)
     - 27 relative dynamic `import()` calls
     - 606 relative `vi.mock` specifiers in 192 files
   - **Path-as-data our rule can't rewrite.** 65 files outside `server/src` name `server/src/{services,routes,middleware}/…` as strings:
     - `scripts/general-server-shard-durations.json`
     - the hard-coded test list in `scripts/run-vitest-stable.mjs`
     - `packages/paperclip-runner/scripts/check-api-authority.mjs`
     - `generate-protocol-coverage.mjs`
     - `tests/lifecycle-baseline/inventory.mjs`
     - Mitigation: pin `native-runtime/` and any test file named in those lists.
   - **Convention clash.**
     - `server/src/modules/README.md` mandates hexagonal `domain/application/adapters` with a single `index.ts` entry.
     - `scripts/check-module-boundaries.mjs` treats *any* folder under `server/src/modules/` as a module and fails on imports that bypass `index.ts`. CI runs it (`pr-trusted.yml` L316).
     - Our barrel-free output therefore **must not live under `modules/`**. It needs a different root, e.g. `server/src/features/`, which reads as a third convention.
4. **Tests.**
   - vitest 4.1. Config is `server/vitest.config.ts`: `include src/**/*.test.ts`, `maxWorkers: 1`, `pool: forks`, sequential, setup `src/__tests__/setup-supertest.ts`.
   - 900 test files with 11,082 cases (the sweep said 878 and ~10.6k).
   - **Embedded Postgres.** 280 files (about 4,500 cases) use it via `packages/db/src/test-embedded-postgres.ts`.
     - Most use `describeEmbeddedPostgres = support.supported ? describe : describe.skip`. About 63 files have no gate and would fail rather than skip.
     - `embedded-postgres@18.1.0-beta.16` declares the `@embedded-postgres/linux-arm64` optional dependency (npm registry). Initdb needs a non-root user, and we are non-root.
   - **Other dependencies.** About 600 cases spawn subprocesses (local git, etc.). 2 files use docker, 2 make real `fetch` calls, 2 are env-gated.
   - **CI.** No `services:` block, so CI is offline-capable. But the server suite takes **about 3,184 s serial** wall time on x64 (comment at `.github/workflows/pr-trusted.yml` L494–504, dated 2026-09-15) and is split across 15 shards.
   - **About 10.5k cases run offline,** at roughly 53+ minutes per full run before any arm64 slowdown (arm64 speed UNVERIFIED).
   - The certifier needs import-graph-impacted test subsets per step, with a full run only at the end.
5. **Install: heavy.**
   - pnpm 9.15.4, engines `node >=24.11.0`. `.npmrc` has no engine-strict, so the mismatch only warns.
   - About 50 workspace packages, including a 2,240-file UI.
   - 56 `.rs` files in `packages/paperclip-runner/runner`. Probably not needed for server vitest (UNVERIFIED).
   - Native: sharp, embedded-postgres, ssh2, heif2jpeg.
   - `test:run` needs `preflight:workspace-links` and the plugin-sdk `ensure-build-deps` step, because plugin-sdk exports `dist/`.
   - A postinstall step links the plugin SDK.
6. **Demo appeal: strongest narrative of the three.**
   - After-tree: `features/{chat, plugin, issue, agent, execution, company, workspace, tool, environment, run, heartbeat, skill, github, slack, decision, …}`, plus `platform/` for middleware, logger and errors.
   - God files (line counts):
     - `services/chat-channels.ts` 38,468
     - `services/heartbeat.ts` 30,290
     - `services/tool-access.ts` 20,307
     - `routes/issues.ts` 18,757
     - `services/issues.ts` 13,417
   - **A 78-file static import cycle that includes their own three "clean" hexagonal modules** (`modules/*/adapters/postgres.ts`, `index.ts`).
   - Lazy `import()` calls used to break cycles: issues↔heartbeat, execution-workspaces→issues/heartbeat.
   - Fan-in: `errors.ts` 222, `activity-log.ts` 83.
   - Stalled migration: 3 modules done versus 430 flat services.
7. **Planner input.** 521–651 files × 80 ≈ 42–52k tokens.
8. **Red flags, then score 7.**
   - Test loop of about 53 minutes or more.
   - Clash with the existing `modules/` convention and boundary checker.
   - About 20 pins plus a generated file plus path-as-data in CI scripts.
   - ESM `.js` specifiers.
   - Daily churn.
   - Node 24.11.
   - Heaviest install.

---

### 3. monkeytypegame/monkeytype — score 7 (the sweep said 7.5)

1. **Repo facts.**
   - URL: https://github.com/monkeytypegame/monkeytype
   - GPL-3.0 (OSI). 20,800 stars. Last commit 2026-10-01T22:18Z (`master`).
   - HEAD `bcbf5c390a789acfcef5f458740366f6011b971c`.
2. **Subtree.** `backend/src/` has **97 .ts files** (the sweep said 100):
   - `api/controllers` 14, `api/routes` 17, `dal` 15, `middlewares` 8, `utils` 15, `init` 5, `jobs` 5, `queues` 5, `workers` 3, `services` 2
   - `constants` 2, plus `app.ts`, `server.ts`, `version.ts`, `anticheat`, `api/{types,ts-rest-adapter}`
   - Domains: 10–14. user, result, leaderboard, quote, preset, config, ape-key, connection, psa, admin, configuration, plus webhooks, public and dev, which are cross-cutting.
3. **Applicability: full.**
   - Express + ts-rest. **CJS**: NodeNext with no `"type"` in `backend/package.json`, so specifiers are extensionless.
   - **9 pins.** All use `__dirname`; the sweep's list is confirmed:
     - `version.ts`
     - `init/{redis, configuration, firebase-admin, email-client}`
     - `dal/new-quotes.ts` (`../../../../monkeytype-new-quotes`)
     - `api/routes/{index, swagger, docs}.ts`
   - `workers/*` `new Worker` is BullMQ, not a file loader, so it is not a pin.
   - Imports into `src` come only from `backend/__tests__` (137) and `__migration__` (3).
   - The relative `vi.mock("../src/init/…")` calls in `__tests__/setup-tests.ts` must be rewritten.
4. **Tests.**
   - vitest 4.1.0 projects (`backend/vitest.config.ts`).
   - **Unit: 24 files, 514 cases, offline.** db, configuration, logger and firebase-admin are mocked; DALs are stubbed with `vi.spyOn`.
   - Integration: 13 files, 202 cases, using testcontainers `mongo:5.0.13` and `redis:6.2.6` (`__tests__/__integration__/global-setup.ts`). Not offline.
5. **Install: medium-light, but there is a hard blocker.**
   - `pnpm-workspace.yaml` sets `engineStrict: true`, and the engines field is `node >=24 <25`, so **install fails on Node 22**. We'd need Node 24 installed locally to the project.
   - The 5 `@monkeytype/*` packages export `dist/`, so a tsup build is needed first.
   - `bcrypt@5.1.1` has an arm64 prebuilt.
   - Use `--filter @monkeytype/backend...` to skip the 1,739-file frontend.
6. **Demo appeal.**
   - After-tree: `modules/{user, result, leaderboard, quote, preset, config, ape-key, connection, psa, admin}/{x.controller, x.route, x.dal}.ts` plus `platform/{init, queues, workers, jobs, middlewares}`.
   - Headline findings:
     - A 14-file cycle spanning `api/types`, `dal/{ape-keys, connections, logs, user}`, `init/{configuration, db, firebase-admin}`, `middlewares/{auth, context, utility}` and `utils/{auth, error, misc}`.
     - `dal/user.ts` (1,381 lines) is imported by 12 files, including other DALs, `middlewares/permission` and `workers/later-worker`.
     - `services/user-deletion.ts` writes across 7 DALs.
     - `controllers/user.ts` (1,263 lines) pulls in 9 DALs.
   - The pinned files leave visible leftovers in `api/routes/` and `dal/`.
7. **Planner input.** 97 × 80 ≈ 8k tokens.
8. **Red flags, then score 7.** Below the mcphub bar on size (97 vs 226 files) and offline cases (514 vs ~1,800), but the brand is far stronger. Also the engine-strict Node 24 requirement and integration tests that need Docker.

---

### Verdict
Dokploy (8) beats the mcphub bar on popularity (15×) and still has a clean fit, fast offline tests and a ready-made domain triad.

Paperclip (7) has the best name and the best story. It would force two design requirements on the tool: impacted-subset certification and a configurable root folder name. It is the stretch target.

Monkeytype (7) is the lowest-risk recognizable full-mode demo, but it is small.

All three have at least 3 viable deep-checked candidates, and none is "not applicable".
