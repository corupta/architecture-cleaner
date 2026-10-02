# Track 4b: certificate red-team

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

# Track 4b: Red-team of the mechanical move certificate

## 0. Verdict and top risks

The kickoff certificate is sound only for module-graph semantics as one resolver (tsc) sees them. As written it can issue a false certificate in at least 8 realistic ways. In several of them tsc and the test suite also pass, so the "second oracle" does not catch them either.

The 10 holes most likely to embarrass on camera, ranked by likelihood × damage:

| Rank | Hole | Kickoff catches? | tsc / tests catch? | Cheapest fix |
|---|---|---|---|---|
| 1 | Relative → `@/alias` specifier rewrite. It resolves for tsc and Jest, but prod Node has no alias hook, so the server crashes at boot. | No (KO2 uses "real resolution" = TS paths) | ✓ / ✓ (both pass) | Preserve specifier style (relative stays relative), plus resolve with the runtime alias mechanism |
| 2 | Moved test without its `__snapshots__/*.snap`. Outside CI, Jest writes the new snapshot and "new snapshots automatically pass" | No | ✓ / ✓ (vacuous pass) | Co-move bundle; run `jest --ci --json` and assert `snapshot.added == 0` |
| 3 | Moved module without its `__mocks__/<basename>`. `jest.mock('./x')` silently becomes an automock | No | ✓ / often ✓ | Co-move bundle; manual-mock resolution must be equal modulo pathMap |
| 4 | Glob/readdir loaders keep the same match **set** but a different **order**: route precedence, migration order | No (KO5 compares sets) | ✓ / usually ✓ | Ordered match-list comparison, or pin loader targets |
| 5 | Repo's pre-commit hook (`eslint --fix` with `import/order` alphabetize) re-sorts imports by the new specifiers. Evaluation order changes, which in cycles means TDZ / undefined decorator metadata | No, if the certificate runs before the commit | maybe | Certify the commit object, not the working tree; or commit with `--no-verify` |
| 6 | `rootDir` inference (TS ≤5.9). Colocating tests into `src/` changes the common root, so `dist/src/server.js` becomes `dist/server.js` | No (KO7 pins source entrypoints, not emitted paths) | ✓ / ✓ | Compare emitted paths of pinned entries before and after |
| 7 | `jest.mock(..., {virtual:true})` not rewritten. It silently mocks nothing and the real module runs. The TS language service does **not** rewrite jest.mock/vi.mock paths | Only if KO2 treats jest.* arguments as reference sites | ✓ / often ✓ | Exhaustive reference-site inventory (section C1) |
| 8 | Move across a nested `package.json "type"`, a tsconfig scope, or a Jest transform/project boundary. The AST is identical but emitted semantics differ (ESM vs CJS hoisting, `useDefineForClassFields`) | No | maybe | Per-file compile-context fingerprint must be equal |
| 9 | Untouched importers re-resolve differently (shadowing: new `foo.ts` next to `foo/index.ts`; folder named like an npm package under `baseUrl`) | Only if KO2 re-resolves **all** files, not only diffed ones | maybe | Re-resolve every reference in every tracked file |
| 10 | Executor stages a destination matching `.gitignore` (`git add -A`). The file is absent from the commit, but every working-tree check passes | No | ✓ / ✓ locally | Tracked-set equality on `git ls-tree` of the commit; run the oracle in a fresh worktree |

Structural problems with the kickoff design:

- **(i)** "The real resolution" is plural. tsc, Jest (unrs-resolver + moduleNameMapper), the prod runtime (Node + tsconfig-paths/module-alias/NODE_PATH/subpath imports) and any bundler each resolve differently.
- **(ii)** Specifier *form* is observable even when the resolved file is identical (Jest automock vs alias, ESM query strings, Node type-stripping extensions).
- **(iii)** Graph equality must be over **ordered** edge lists. An edge set loses evaluation order.
- **(iv)** Several things travel with a module but sit outside the import graph: sibling artifacts (`__mocks__`, `__snapshots__`, `.js`/`.d.ts` siblings), per-path compile context, and path-keyed consumers (globs, infra).
- **(v)** "Raw compiler API vs ts-morph" is not independent. ts-morph 28 bundles TS 6.0.

Ids used below: **KO1–KO7** are the kickoff checks; **K0–K8** are the replacement checks in section E1.

---

## 1. What a pure move can change: model

Runtime behavior after a move depends only on the following.

- **(a) Module identity:** the bijection from specifier occurrences to module records, as each consumer resolves them.
- **(b) Module code:** text outside the specifier spans.
- **(c) Per-module evaluation semantics:** module format, transpile options, transform.
- **(d) Entry sequence:** the process entry, Jest test files and setup files, and loader-discovered modules, *in order*.
- **(e) Host APIs that expose paths:**
  - `__filename`, `__dirname`, `import.meta.*`, `require.resolve`, `Error.stack`, `require.cache` keys;
  - fs paths derived from those;
  - `process.argv[1]`.
- **(f) Path-keyed external consumers:**
  - configs, globs, infra, CI and ignore files;
  - the npm package surface;
  - consumers outside the repo.

Evaluation order is a deterministic DFS over (d) and the ordered requested-module list of each module, under identity (a) and semantics (c). Paths enter the algorithm only through (a), (c), (d) and (e).

**Answer to "can a move change cycle entry or init order with an isomorphic graph?"**

- **No**, if the graph is isomorphic *as ordered adjacency lists* and (a), (c) and (d) are preserved.
- **Yes** in each of these cases:
  1. Import order changes. An executor `organizeImports`, the repo's lint-staged `import/order` fix, or an AST printer can each do it. eslint-plugin-import alphabetizes "based on specifier", is autofixable, and never moves unbound (side-effect) imports, but it *does* move bound ones (https://raw.githubusercontent.com/import-js/eslint-plugin-import/main/docs/rules/order.md).
  2. Identity splits or merges: case aliasing, a different alias target, ESM query/fragment.
  3. Module format flips. ESM evaluates all static imports before the body (MDN: imports are hoisted and "their side effects are produced before the rest of the module's code runs", https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import). tsc-emitted CJS runs `require`s at statement position.
  4. Loader-derived entry order changes:
     - glob ≥9: "Result sets are never sorted" (https://raw.githubusercontent.com/isaacs/node-glob/main/changelog.md);
     - fast-glob: "arbitrary order" (https://raw.githubusercontent.com/mrmlnc/fast-glob/master/README.md);
     - umzug: "lexicographically sorted based on their paths" (https://raw.githubusercontent.com/sequelize/umzug/main/README.md).
  5. A barrel is inserted (already in the kickoff).
- **Why it matters:** with `emitDecoratorMetadata`, `design:type` references a class at decoration time. Cycle-entry changes then become TDZ errors or undefined metadata. Evidence:
  - TypeORM ships a `Relation<>` wrapper specifically "to circumvent ESM modules circular dependency issue caused by reflection metadata" (https://github.com/typeorm/typeorm/issues/6974, https://typeorm.io/#relations-in-esm-projects).
  - Nest: "A circular dependency can also be caused by using 'barrel files'… The order of instantiation is indeterminate" (https://docs.nestjs.com/fundamentals/circular-dependency).
- **Spec detail:** the ECMAScript rule that `[[RequestedModules]]` follows source-text occurrence order is **UNVERIFIED this session** (the spec fetch truncated). It is standard behavior.
- **Oracle caveat:** ts-jest and babel-jest usually run tests as CJS while prod may be ESM. A move-induced ESM-only TDZ can pass Jest. Tests are a weak oracle for evaluation-order bugs; see the K8 runtime load trace.

---

## 2. (A) False certificates: all checks pass, behavior changes

Status legend: **C** = kickoff catches it, **P** = partially, **M** = misses it. "tsc/tests" says whether the second oracle would catch it.

### A.1 Resolution and module identity

| # | Concrete scenario | Why checks pass | Kickoff | tsc/tests | Cheapest fix |
|---|---|---|---|---|---|
| A1 | `import {x} from '../services/user'` is rewritten to `'@/user/service'`. tsconfig `paths` and Jest `moduleNameMapper` both map `@/`. Prod runs `node dist/server.js` without tsconfig-paths. TS: "`paths` does not change the import path in the code emitted… very easy to create path aliases that appear to work in TypeScript but will crash at runtime" (https://www.typescriptlang.org/docs/handbook/modules/reference.html). ts-node needs `tsconfig-paths/register` (https://typestrong.org/ts-node/docs/paths/). Node type-stripping: "tsconfig paths won't be transformed and therefore produce an error" (https://nodejs.org/api/typescript.html) | TS-resolution identity is equal; the graph is equal | M | ✓/✓ (both pass) | Specifier-form class preserved (K3). Resolve with the runtime alias mechanism too |
| A2 | Three alias tables diverge: tsconfig `paths` → `src/`, `moduleNameMapper` → somewhere else, module-alias `_moduleAliases` (paths relative to package.json; "does not function with Jest… use moduleNameMapper", https://raw.githubusercontent.com/ilearnio/module-alias/dev/README.md) → `dist/`. A form change switches the physical copy, giving duplicate class instances: `instanceof` false; `toStrictEqual` fails because `typeEquality` compares `a.constructor === b.constructor` (https://raw.githubusercontent.com/jestjs/jest/main/packages/expect-utils/src/utils.ts) | Single-resolver identity is equal | M | maybe | K3 per-consumer resolution plus form preservation |
| A3 | Form is observable at an identical resolved file. Jest: "Modules that are mapped to an alias are unmocked by default, regardless of whether automocking is enabled" (https://jestjs.io/docs/configuration), so with `automock:true`, relative→alias flips mocked/real. Node ESM: "Modules are loaded multiple times if the import specifier… has a different query or fragment" (https://nodejs.org/api/esm.html) | Identity is equal *by construction*, even with Jest's resolver | M | maybe | Form-class preservation; decline `automock:true` (K0) |
| A4 | `legacy/x.js` + `legacy/x.d.ts` pair; plan moves the `.d.ts` (and the importers) only. TS looks up `.ts`, `.tsx`, `.d.ts` before `.js` (TS reference, extension-substitution table, link above). Runtime `require('../new/x')` fails | TS identity is equal | M | ✓/✓ if not covered | K1 co-move bundle by stem; K3 runtime resolver |
| A5 | Stale `user.js` next to `user.ts` (tracked or untracked). Jest default `moduleFileExtensions` is `["js","mjs","cjs","jsx","ts",...]`, js first (https://jestjs.io/docs/configuration), so before the move Jest loads **user.js**. After moving `user.ts` alone, Jest loads `user.ts` and test behavior changes | TS identity is equal | M | maybe | K0: decline if any stem has both `.ts` and `.js`; K3 with Jest's resolver; K8 fresh worktree |
| A6 | Unmodified importers re-resolve differently: (i) move creates `src/foo.ts` while `src/foo/index.ts` exists; (ii) a moved folder is named like an npm package and resolves under `baseUrl` (a TS ≤5.x lookup root; TS 6.0 "will no longer be considered a look-up root", https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) or Jest `moduleDirectories` | KO1 diff-confines the comparison to changed files | P (C only if KO2 re-resolves all files) | maybe | K3 over **all** tracked files |
| A7 | Importers outside the tsconfig program (`scripts/*.ts`, `seeds/`, `jest.config.ts`, `*.js` tooling) are not rewritten by a program-driven executor | Not in the program, so tsc never sees them; tests don't cover them | P | ✓/✓ | Enumerate files with `git ls-files`, not `program.getSourceFiles()` |
| A8 | Case aliasing. Node: "on case-insensitive file systems… `require('./foo')` and `require('./FOO')` return two different objects" (https://nodejs.org/api/modules.html#module-caching-caveats). Executor emits `./User` for `user.ts`: on macOS that is a duplicate instance; on Linux it is unresolved | Resolver returns specifier casing on case-insensitive FS | P | Linux CI ✗ / macOS ✓ | Compare on `fs.realpathSync.native`; run checker on case-sensitive FS; TS `forceConsistentCasingInFileNames` |
| A9 | Symlinked dirs in the repo. Node caches by realpath (modules doc). Jest 30's default resolver is `unrs-resolver`, which "realpaths by default" (https://raw.githubusercontent.com/jestjs/jest/main/packages/jest-resolve/src/defaultResolver.ts). The haste crawler doesn't follow symlinks unless `haste.enableSymlinks` (incompatible with watchman). Moved tests become undiscoverable, or pathMap is ambiguous | pathMap is defined on lexical paths | M | maybe | K0: decline tracked symlinks in the moved region |
| A10 | Resolution depends on untracked or ignored files: generated client (Prisma v7: "the `output` field is required", https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client), stale `dist/`, `config.local.ts` in an optional `try{require()}` | Checker runs on the dev working tree | M | differs on CI | K8: certify in a fresh worktree from the commit plus an explicit generate step; list untracked resolution targets as residual |
| A11 | Tool's TS ≠ repo's TS. ts-morph 28 bundles TS 6.0 (https://github.com/dsherret/ts-morph/releases); TS 6.0 changed the `baseUrl` lookup and the `rootDir` default. A legacy TS 5.x repo resolves differently | Model mismatch | M | — | Resolve with the repo's installed `typescript`; decline on mismatch when `baseUrl` is used |

### A.2 Evaluation order and compile context

| # | Scenario | Why it passes | Kickoff | tsc/tests | Fix |
|---|---|---|---|---|---|
| A12 | Import reorder by the executor's printer/organizeImports, or by the repo's husky + lint-staged `eslint --fix` (`import/order` alphabetize by specifier) *after* certification. A↔B cycle entry flips, giving TDZ "Cannot access 'X' before initialization" or `undefined` metadata | KO3 compares edge **sets**; KO2 runs before the hook | P | maybe (CJS tests may mask ESM prod) | Certificate on the commit tree (post-hook), or `git commit --no-verify` ("Bypass the pre-commit and commit-msg hooks", https://git-scm.com/docs/git-commit); ordered graph |
| A13 | Move across a nested `package.json` with `"type"`. Under node16/nodenext, ".ts… are ES modules if the nearest ancestor package.json contains `"type": "module"`" (TS reference). That gives ESM hoisting vs CJS order, `__dirname` undefined, different `exports` conditions, different `#imports` table | AST and graph equal | M | maybe | K5 context fingerprint; K0 decline nested package.json under source roots |
| A14 | Move across a tsconfig scope (`useDefineForClassFields` default depends on target, https://www.typescriptlang.org/tsconfig/; decorators flags), a Jest `transform` regex keyed by path, Jest `projects` (different `testEnvironment`), or babel/swc `overrides` | AST equal | P (KO5 include sets) | maybe | K5 fingerprint per moved file |
| A15 | Loader order. `controllers: [path.join(__dirname + '/controllers/*.js')]` (routing-controllers README, https://raw.githubusercontent.com/typestack/routing-controllers/develop/README.md) with an unsorted glob. Express routes and middleware match in definition order (https://expressjs.com/en/guide/routing.html), so `/users/me` vs `/users/:id` resolve to a different handler. Also umzug path-sorted migrations and knex multi-dir (`sortDirsSeparately`) | KO5 compares match **sets** | M | rarely | K5 ordered lists in the consumer's order; simplest is to pin loader targets |
| A16 | New barrel (kickoff example) | — | C (KO3) | — | — (necessary, not sufficient) |

### A.3 Jest/Vitest co-located artifacts

| # | Scenario | Why it passes | Kickoff | tsc/tests | Fix |
|---|---|---|---|---|---|
| A17 | Jest resolves user-module manual mocks at `path.join(dirname(modulePath),'__mocks__',basename(modulePath))` after a global name-keyed lookup (https://raw.githubusercontent.com/jestjs/jest/main/packages/jest-runtime/src/internals/Resolution.ts). Vitest looks "alongside", else "auto-mocks exports" (https://vitest.dev/api/vi.html). Moving `user.ts` without `__mocks__/user.ts` turns `jest.mock('./user')` into an automock | `__mocks__` isn't in the import graph | M | often ✓ | K1 bundle; K6 mock-resolution equality |
| A18 | Mocks are also keyed globally by name: "duplicate manual mock found… Jest will use the mock file found in: …" (https://github.com/jestjs/jest/issues/2070, open since 2016-11). Feature layouts with generic basenames (`service.ts`, `index.ts`) create collisions. Root `__mocks__/<pkg>` auto-mocks node modules and "will need to live in one of the `roots`" (https://jestjs.io/docs/configuration) | Not modeled | M | maybe | K6: haste mock-map before/after; decline new basename collisions |
| A19 | `jest.mock`/`vi.mock` specifier not rewritten. TS LS `getEditsForFileRename` doesn't update them: https://github.com/microsoft/TypeScript/issues/62835 (opened 2025-12-04, open). The fix PR https://github.com/microsoft/TypeScript/pull/62834 was closed unmerged ("avoiding taking new PRs to this codebase"); its test name `getEditsForFileRename_requireInTs` suggests `require()` in `.ts` isn't updated either (**UNVERIFIED** detail). Non-virtual throws; `{virtual:true}` ("mocks of modules that don't exist anywhere", https://jestjs.io/docs/jest-object) silently mocks nothing | Only an import-centric extractor | P (open question in kickoff) | virtual: ✓/often ✓ | C1 reference-site inventory |
| A20 | Snapshot file left behind. Snapshots live in `__snapshots__/<test>.snap`. "new snapshots automatically pass", and are not written only with `--ci` (https://jestjs.io/docs/snapshot-testing, https://jestjs.io/docs/cli) | Not in the graph | M | ✓/✓ locally | K1 bundle; K6 `--ci --json`, assert `snapshot.added/filesAdded/unchecked == 0` (fields in https://raw.githubusercontent.com/jestjs/jest/main/packages/jest-test-result/src/types.ts) |
| A21 | Test discovery drift. Moved test leaves `roots` (default `["<rootDir>"]`), `testMatch`, or enters `testPathIgnorePatterns`. Jest stays green with fewer tests | KO5 lists testMatch only | P | ✓/✓ | K6 `jest --listTests` ("Lists all test files that Jest will run") equal modulo pathMap; `numTotalTests` equal |
| A22 | `coverageThreshold` per path or glob, `collectCoverageFrom`. The CI gate flips | — | P | CI | Config inventory (K5) |

### A.4 Location and host observation

| # | Scenario | Kickoff | Fix |
|---|---|---|---|
| A23 | Path-exposing APIs missing from KO4's list: `__filename` (logger names, snapshots with paths), `import.meta.filename/dirname` (Node ≥20.11, symlinks resolved, https://nodejs.org/api/esm.html), `import.meta.resolve`, `require.resolve` (incl. `delete require.cache[require.resolve('./cfg')]`; `require.cache` "keyed by the resolved filename", modules doc), `module.filename/id`, `require.main.filename`, `process.argv[1]`, `createRequire(import.meta.url)`, `new URL(rel, import.meta.url)`, `child_process.fork(path.join(__dirname,…))`, `err.stack` parsing | P | Expanded token list (E2) |
| A24 | npm deps that observe the **caller's** location (parent-module, caller-path, callsites, get-caller-file, import-fresh, require-directory/require-all, yargs `commandDir`). Invisible to a source-token scan (package list **UNVERIFIED** as exhaustive) | M | Dependency allowlist: if the repo depends on one of these, inspect call sites or pin |
| A25 | The moved files are **targets** of a location loader, not the loader itself. `@fastify/autoload`: "routes will be automatically prefixed with the subdirectory name" (default true, https://github.com/fastify/fastify-autoload), so moving route files changes URLs. sequelize-typescript `models: [__dirname + '/models']` (https://raw.githubusercontent.com/sequelize/sequelize-typescript/master/README.md). TypeORM/type-graphql entity and resolver globs | P ("moved together with its targets" needs target-set computation) | Statically evaluate loader path expressions (literal concatenation only) → target set → pin; decline if not evaluable |
| A26 | cwd-relative paths: `fs.readFileSync('src/templates/x.hbs')`; swagger-jsdoc `apis` "relative to the current working directory" (https://github.com/Surnet/swagger-jsdoc), so the generated OpenAPI doc changes. Moving the *asset* breaks it, not moving the reader | P | MVP moves TS modules only (no assets); old-path-string scan over all tracked files |

### A.5 Build, emit and deploy

| # | Scenario | Kickoff | Fix |
|---|---|---|---|
| A27 | `rootDir` default (TS ≤5.9) is "the longest common path of all non-declaration input files" (https://www.typescriptlang.org/tsconfig/). TS 6.0: "always the directory containing the tsconfig.json" (TS 6.0 blog, 2026-03-23). Example: `include: ["src","test"]` then colocating tests into `src/` changes the root from `.` to `src`, so `dist/src/server.js` becomes `dist/server.js`. That breaks `node dist/src/server.js`, Dockerfile `CMD`, `main`/`bin`. tsc ✓ tests ✓ | M | K7: emitted path of each pinned entry identical (`tsc --listEmittedFiles`, or compute from the parsed config); or K0 requires explicit `rootDir` |
| A28 | Path strings in infra: Dockerfile `COPY`/`CMD`, Procfile, pm2/nodemon, `serverless.yml`/Lambda handler ("the file name and the name of the exported handler method, separated by a dot", https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html), k8s, GitHub Actions `paths` ("If at least one path matches… the workflow runs", https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions), CODEOWNERS (org only) | P | Old-path-string scan (all tracked files); rewrite plus ordered match-set check, or residual |
| A29 | `package.json` `sideEffects` array: unlisted files "may be pruned" (https://webpack.js.org/guides/tree-shaking/). A moved polyfill gets tree-shaken in a bundled prod build (Lambda / esbuild users) | M | Add to config inventory |
| A30 | `package.json` `files`/`exports` subpath patterns, `.npmignore`, `.dockerignore`: artifact contents change | P | Config inventory, ignore-file match-status equality |
| A31 | Source-map `sources`, coverage paths, stack traces (Sentry): observability, not behavior | — | Residual list |

### A.6 Git mechanics

| # | Scenario | Kickoff | Fix |
|---|---|---|---|
| A32 | Destination matches `.gitignore` and the executor stages with `git add -A`. The file is missing from the commit but still in the working tree, so every check and test passes; a fresh clone breaks | M | K1: `git ls-tree -r <commit>` set == pathMap(before set); K8 fresh worktree |
| A33 | Executable bit lost (`bin` scripts with shebang) when the executor writes a new file instead of renaming; tracked symlinks (mode 120000) pointing at moved files left dangling | M | K1 compare git modes; scan symlink targets |
| A34 | Case-only renames (`Models/`→`models/`) on case-insensitive checkouts (**UNVERIFIED** specifics: `core.ignorecase` behavior) | M | Forbid case-only path changes in MVP |

### A.7 Renames (only if the rename rung ships)

| # | Scenario | Kickoff | Fix |
|---|---|---|---|
| A35 | Class name observed **inside libraries**, invisible to a source scan: <br>• TypeORM: "If not specified, then table name is generated from entity class name" (https://typeorm.io/docs/help/decorator-reference) <br>• sequelize-typescript: "@Table sets options.tableName=<CLASS_NAME> and options.modelName=<CLASS_NAME>" <br>• `@nestjs/typeorm` `getRepositoryToken` returns `` `${dataSourcePrefix}${entity.name}Repository` `` (https://raw.githubusercontent.com/nestjs/typeorm/master/lib/common/typeorm.utils.ts) <br>• Jest pretty-format prints `` `${getConstructorName(val)} {` `` in snapshots (https://raw.githubusercontent.com/jestjs/jest/main/packages/pretty-format/src/index.ts) <br>• type-graphql type names (override via `@ObjectType("Name")`, https://typegraphql.com/docs/types-and-fields.html) | P (KO6 lists decorators and base classes) | Never rename decorated classes, subclasses of framework bases, or classes whose instances reach snapshots. MVP: no symbol renames |
| A36 | **File**-name conventions: <br>• Nest Swagger CLI plugin analyzes only `['.dto.ts','.entity.ts']` / `.controller.ts` (https://docs.nestjs.com/openapi/cli-plugin) <br>• sequelize-typescript `modelMatch` filename↔class <br>• knex stores migration **file names** and validates they still exist (`disableMigrationsListValidation` default false, https://knexjs.org/guide/migrations.html) <br>• TypeORM migration names stored in DB (**UNVERIFIED**) <br>• snapshot file names | M (KO6 is symbol-level) | Pin migrations/seeders; no file renames on convention-suffixed files |
| A37 | Name-derived strings built dynamically (`` `${name}Repository` ``, `'User'+'Service'`, `Symbol.for('UserService')`, mongoose model names): an exact-string scan misses them | P | Treat any `.name` / `constructor.name` use plus string-token DI in the repo as a decline trigger for renames |

---

## 3. (B) False rejections that would make the tool useless

| # | Source | Fix |
|---|---|---|
| B1 | Executor formatting churn: quote style, semicolons, reprinted import clauses, organizeImports. ts-morph manipulation may reprint with its default `quoteKind` (**UNVERIFIED**) | Executor does **span-only text edits** on specifier literals. Use TS LS `getEditsForFileRename` (span edits) plus your own pass for the sites it misses (A19). Then a byte-level check (K2) is both strictest and false-rejection-free |
| B2 | Benign specifier spellings (`./x` vs `./x/index` vs `./x.js`, alias vs relative) | Normalization makes them equal. The form-class rule (K3) allows relative→relative with the **same** extension and index convention. Alias→alias only if the target stays under the same alias root; anything else is declined in MVP (it is unsafe per A1/A3, so not really a false rejection) |
| B3 | Path normalization: `/tmp` vs `/private/tmp` on macOS, Windows separators, case, trailing slashes | Compare in the `realpathSync.native` domain; POSIX separators |
| B4 | Unresolvable-but-fine specifiers: CSS/asset stubs via `moduleNameMapper`, `declare module '*.svg'`, optional `require` in try/catch | Opaque token: identical string; if relative, the importer must be unmoved |
| B5 | Rewritten globs that are equivalent but textually different | Compare **ordered match lists**, never strings |
| B6 | Emitted artifacts (source maps, coverage) differ | Exclude from comparison; residual |
| B7 | Test-oracle flake. Jest sorts by failed-first, then duration, then file size, from a cache keyed by `test.path` (https://raw.githubusercontent.com/jestjs/jest/main/packages/jest-test-sequencer/src/index.ts). After a move, order and worker assignment change and expose order-dependent tests (shared DB, ports). Specifier edits also change file sizes | At baseline run tests N× and once with `--runInBand`; quarantine flaky tests; record per-file pass sets, not just green/red |
| B8 | Lint in the oracle (`import/order`, eslint `files` overrides by path) | Keep lint out of the pass/fail oracle; report warning-count diffs as findings |
| B9 | Git rename detection shows delete+add for small files with many specifier edits | Certificate uses pathMap, never git `-M`; PR body lists the pathMap |
| B10 | Old-path scan hits in README, CHANGELOG, comments | Classify by file kind: docs → finding, configs/infra → block |
| B11 | Tool's TS 6.0 semantics on a TS 5.x repo (`baseUrl`) → spurious "unresolved" | Use the repo's own `typescript` for resolution facts |

---

## 4. (C) Core mechanics, precisely

### C1. Reference-site inventory

Every site whose string literal names a module or path must be extracted. Any non-literal form is a hazard (pin or decline).

- **Static (TS AST):**
  - `ImportDeclaration`: value, `import type`, inline `{ type X }`, side-effect-only;
  - `ExportDeclaration` with a specifier: named, `*`, `* as ns`, `export type`;
  - `ImportEqualsDeclaration` with an `ExternalModuleReference` (`import x = require('…')`);
  - `ImportTypeNode` (`import('…').T`, `typeof import('…')`);
  - `ModuleDeclaration` with a string-literal name (relative augmentation `declare module '../models/user'`);
  - triple-slash `/// <reference path|types>`;
  - JSDoc `{import('…')}` and `@import`.
- **Calls with literal (or no-substitution template) argument:**
  - `require`, `require.resolve`, `import()`, `import.meta.resolve`;
  - `createRequire(…)(lit)`, `new URL(lit, import.meta.url)`, `new Worker(lit)`;
  - `jest.{mock,unmock,doMock,dontMock,requireActual,requireMock,createMockFromModule,setMock}` (https://jestjs.io/docs/jest-object) and `jest.unstable_mockModule` (https://jestjs.io/docs/ecmascript-modules), with the `virtual` flag recorded;
  - `vi.{mock,doMock,unmock,importActual,…}`;
  - `import.meta.glob(lit)`: Vite/Vitest globs are "treated like import specifiers… relative… or alias" (https://vite.dev/guide/features).
- **Docblocks:** `@jest-environment <path>`.
- **Configs** (string fields carrying paths or globs):
  - Jest: `roots`, `testMatch`, `testPathIgnorePatterns`, `moduleNameMapper` targets, `setupFiles*`, `globalSetup/Teardown`, `snapshotResolver`, `transform` keys, `projects`, `coverageThreshold`, `collectCoverageFrom`;
  - tsconfig: `files`, `include`, `exclude`, `paths` targets, `references`, `rootDir`, `outDir`, `typeRoots`;
  - package.json: `main`, `types`, `bin`, `exports`, `imports`, `files`, `sideEffects`, `scripts`, `_moduleAliases`;
  - ORM/loader configs, swagger-jsdoc `apis`;
  - Dockerfile, Procfile, serverless/pm2/nodemon, CI, CODEOWNERS, ignore files.

### C2. Normalization

For each tracked file `f` (from `git ls-files`), each site `s` in source order, and each consumer resolver `R ∈ {tsc(repo's TS), jest(resolver+mapper), runtime(node+alias hooks), bundler if any}` that loads `f`:

```
tok_R(f,s) = FILE(realpath_native(p))            if R resolves s from f to tracked file p
           | EXT(realpath_native(p))             node_modules (must be byte-equal, NOT mapped)
           | BUILTIN(s)                          byte-equal
           | OPAQUE(s)                           unresolved: s byte-equal; if relative ⇒ f unmoved
form(s)    = (relative|alias:<prefix>|bare|subpath-import|absolute, ext-style, explicit-index?, query/fragment)
```

The certificate holds iff all of the following:

- For every `f`, every `R`, and every site index `i`:
  - `tok_R(after, pathMap(f), i) == map(tok_R(before, f, i))`, where `map` applies pathMap to `FILE` only;
  - `formClass(after_i) == formClass(before_i)`.
- The bytes of `after(pathMap(f))` equal the bytes of `before(f)` outside the specifier spans.
- Sites are compared **as ordered lists**. This also implies ordered graph equality for every syntactic edge, so a separate graph check adds value only as a second implementation and for non-syntactic edges: loaders, configs, runtime trace.

### C3. Edge kinds

- `value-import`, `type-only-syntax`, `side-effect`, `reexport-named`, `reexport-star`, `import-equals`, `require`, `require-resolve`, `dynamic-import`, `type-import-node`, `triple-slash`, `augmentation`, `mock(kind, virtual)`, `url/worker`, `glob-loader(ordered)`, `config-edge`.
- **Elision is consumer-dependent:**
  - tsc elides type-only-used imports (TS reference) except where `emitDecoratorMetadata` retains them;
  - isolated transpilers elide syntactically;
  - Node type-stripping keeps every non-`type` import ("Without the `type` keyword, Node.js will treat the import as a value import", https://nodejs.org/api/typescript.html).
- **For pure moves this does not matter for soundness:** text and resolved identities are invariant, so each consumer's elision decisions are invariant. It matters only if you want the extracted graph to *describe* runtime. So compare all sites, type-only included; it is cheap and keeps tsc in agreement.

### C4. Soundness (pure moves)

Runtime behavior is preserved modulo path strings if all hold:

1. Site extraction is complete (C1) and no non-literal site exists in the affected region.
2. Every consumer resolver is modeled (K3), and form is preserved (A3).
3. Each moved file's compile context is invariant (K5).
4. Entry and loader order is invariant (K5/K6).
5. Co-located artifacts travel with their module (K1).
6. No moved file, and no file whose path-referenced assets moved, uses a path-exposing API (K4).
7. Path-keyed consumers are invariant (K5/K7).
8. The certificate is computed on the committed tree in a clean worktree (K1/K8).

The kickoff design as written violates conditions 2, 3, 4 (sets), 5, 7 (emit layout) and 8.

**Completeness:** it is deliberately incomplete. Any move touching a location-sensitive file, a loader target, a form change or a context boundary is rejected. That is acceptable for an MVP and is honest "decline with reasons" material.

**What it never proves:**

- consumers outside the repo (deep imports, Lambda handler strings in Terraform or the console, other services);
- runtime fs content (assets, templates, SQL);
- env-dependent resolution (`NODE_PATH`, untracked files);
- `Error.stack` text;
- performance (load-order-dependent warm-up);
- CI trigger and review-routing changes (Actions `paths`, CODEOWNERS);
- anything the tests don't exercise when the certificate passes but the test oracle is weak.

---

## 5. (D) How independent is "raw compiler API vs ts-morph"?

**State as of 2026-10:**

- `typescript@latest` is **7.0 (Go)**, GA 2026-07-08, and "does not ship with an API… We expect TypeScript 7.1 to ship with a new (and different) API". TS 6 remains available as `@typescript/typescript6` (https://devblogs.microsoft.com/typescript/?p=5246).
- ts-morph 28.0.0 (`@ts-morph/common` ~0.29) bundles **TS 6.0** (https://github.com/dsherret/ts-morph/releases, https://registry.npmjs.org/ts-morph/latest). The release date shown on that page (2024) is likely misreported; it is **UNVERIFIED**.

| Option | Shares with the TS-API checker | Independent of it | Verdict |
|---|---|---|---|
| ts-morph vs raw TS 6 API | Scanner, parser, `resolveModuleName`, tsconfig parsing, quite possibly the identical TS version | Glue code only | Catches bugs in *our* normalization code (useful), but not modeling errors (A1–A5). Don't call it independent in the README |
| `tsc` 7 (tsgo) as the type-check oracle | Same spec and design (a faithful port) | Implementation | Good second oracle for tsc; whether it supports `--traceResolution` for parsing is **UNVERIFIED** |
| esbuild metafile (all files as entries, `packages:'external'`) | Nothing | Parser and resolver (tsconfig-aware); `ImportKind = entry-point / import-statement / require-call / dynamic-import / require-resolve / import-rule / composes-from / url-token` (https://raw.githubusercontent.com/evanw/esbuild/main/lib/shared/types.ts) | Cheap independent runtime-ish graph; blind to `jest.mock` and type-only edges |
| dependency-cruiser | TS parsing goes through `tsc`; the swc parser is deprecated (https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md) | Resolver is **enhanced-resolve**. Rich `dependencyTypes`: type-only, import-equals, triple-slash, jsdoc, pre-compilation-only, aliased-tsconfig-paths, aliased-subpath-import (https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) | Already planned for boundary rules, so reuse it as a graph cross-check. `exoticRequireStrings: ['jest.mock',…]` handling member calls is **UNVERIFIED** |
| oxc-parser + oxc-resolver | Nothing | "Rust port of enhanced-resolve, tsconfig-paths-webpack-plugin and tsconfck" (https://github.com/oxc-project/oxc-resolver) | Truly different implementation |
| **Jest's own resolver** (unrs-resolver since Jest 30, 2025-06-04, https://jestjs.io/blog/2025/06/04/jest-30) plus `moduleNameMapper`, via a custom `resolver` that logs and delegates | — | It *is* the test runtime | Not "independent", but **ground truth** for one consumer. Removes the A2/A3/A5 modeling gap. unrs-resolver has the same self-description as oxc-resolver; whether it is a fork is **UNVERIFIED** |
| Runtime load trace: CJS `Module._load` hook / ESM loader hook / Jest resolver log during the test run and a prod boot smoke; compare ordered `(parent, specifier, resolved)` sequences modulo pathMap | — | Observes reality: dynamic edges, glob loaders, real order, prod ESM vs test CJS | Strongest independent evidence on exercised paths |

Knight & Leveson found that independently developed versions fail in correlated ways ("An experimental evaluation of the assumption of independence in multiversion programming", IEEE TSE 1986, https://api.crossref.org/works/10.1109/TSE.1986.6312924). So prefer **diversity of observables** (static model vs consumer-native resolution vs runtime trace) over two codings of the same model.

**Recommendation:**

- **A (primary):** TS 6 API for sites, using the repo's TS for TS resolution.
- **B:** Jest's resolver (programmatic or logging hook) plus the runtime alias mechanism. Add oxc-parser and oxc-resolver as a second extractor if time allows.
- **C:** runtime load trace from the test run and a 10-second prod boot.
- Keep ts-morph executor-side only, with span-only edits.

Translation-validation framing for the README: Pnueli, Siegel & Singerman, "Translation validation", TACAS 1998 (https://api.crossref.org/works/10.1007/BFb0054170); Necula, "Translation validation for an optimizing compiler", PLDI 2000 (https://api.crossref.org/works/10.1145/349299.349314).

---

## 6. (E) Deliverables

### E1. Minimal sound certificate for an MVP that only moves TS modules

Ordered cheapest first. Each check is deterministic and needs no LLM.

- **K0 Envelope preflight (once per repo; decline with reasons):**
  - one effective tsconfig scope over all movable files (`tsc --showConfig -p`);
  - no nested `package.json` (`type`/`imports`) under source roots;
  - Jest config statically loadable (`jest --showConfig`);
  - `automock` false;
  - no tracked symlinks in movable dirs;
  - no stem with both `.ts` and `.js`;
  - runtime alias mechanism identified: none / tsconfig-paths / module-alias / subpath imports / `NODE_PATH` (an unknown mechanism means decline);
  - repo TS version known (and `baseUrl` absent, or use repo TS);
  - generated code produced offline or pinned;
  - explicit `rootDir`, or K7 enabled.
- **K1 Move-set integrity:**
  - pathMap total and injective;
  - destinations didn't exist;
  - no case-only changes or case-insensitive collisions;
  - co-move bundles by stem: `.ts/.tsx/.d.ts/.js/.js.map/.json` siblings, `__mocks__/<basename>`, `__snapshots__/<testbasename>.snap`;
  - `git ls-tree -r` of the new commit == pathMap(old tree) as a set, with git modes equal;
  - tracked symlink targets unaffected;
  - match status under `.gitignore`, `.dockerignore`, `.npmignore` and package.json `files` unchanged.
- **K2 Byte-span confinement:** for every tracked file, the new bytes at `pathMap(f)` equal the old bytes at `f`, except inside recognized reference-site literal spans (C1) and recognized config path/glob strings.
- **K3 Multi-resolver identity equality** over **all** tracked JS/TS-family files: ordered `tok_R` lists equal modulo pathMap for each consumer `R`, form class preserved, OPAQUE rules applied.
- **K4 Location scan:**
  - moved files, and files whose resolved targets moved, contain no E2 file-level tokens;
  - the old-path-string scan (repo-relative path with and without extension, `dist/` equivalent, moved dir prefixes) over all tracked files finds no hits outside K2-recognized spans (docs files produce findings only).
- **K5 Config and context:**
  - for each inventory entry, the ordered match list in the consumer's order equals pathMap(before);
  - per moved file, the context fingerprint is equal: effective compilerOptions, nearest package.json `type`/`imports`, Jest project + transform + environment, babel/swc config.
- **K6 Jest inventory:**
  - `jest --listTests` mapped equality;
  - manual-mock resolution for every `jest.mock` without a factory is mapped-equal;
  - haste mock map has no new basename collisions;
  - test run with `--ci --json`: `snapshot.added == filesAdded == unchecked == 0`; per-test-file `numTotalTests` equal.
- **K7 Emit layout:** for every pinned entry (`main`, `bin`, Docker `CMD`, scripts), the emitted path is identical; the emitted set equals mapped(before) under `outDir`.
- **K8 Oracles** in a fresh worktree of the commit, after hooks or with `--no-verify` recorded:
  - `tsc` (repo TS, plus TS 7 if available);
  - `jest --ci`;
  - optional runtime load trace with ordered sequences equal modulo pathMap.

**MVP cut if time is short:** K0, K1, K2, K3 (TS plus Jest resolver), K4 tokens, K6 (`--listTests`, `--ci`, snapshot counters), K8. Defer: full K5 ordering logic (replace it with "pin all loader targets"), K7 (replace with "require explicit `rootDir`"), and the runtime trace.

### E2. Hazard list: triggers for "pin or decline"

- **Repo-level decline (K0):**
  - nested package.json or tsconfig scopes over movable code;
  - `automock: true`;
  - unknown alias mechanism;
  - symlinks in the tree;
  - `.ts`/`.js` same-stem pairs;
  - monorepo package boundary crossing;
  - TS version mismatch with `baseUrl`;
  - generated code not reproducible offline;
  - Jest/Vitest config not statically loadable;
  - package self-reference imports (`my-pkg/…` resolving to own `dist`).
- **File-level pin (the file uses):**
  - `__dirname`, `__filename`, `import.meta.{url,dirname,filename,resolve}`, `require.resolve`, `createRequire`, `module.{filename,id,paths}`, `require.main`, `require.cache`, `process.argv[1]`;
  - `.stack` access or `Error.prepareStackTrace`;
  - `new Worker`, `fork`/`spawn`/`exec` with paths;
  - `fs.*`/`path.resolve`/`path.join` with relative literals; `process.cwd()`;
  - `readdir*`; glob libs; `import.meta.glob`; `require.context`;
  - non-literal `require`/`import()`/`jest.mock`;
  - `jest.mock(..., {virtual:true})` pointing at a moved or relative path;
  - `@jest-environment` with a path;
  - repo depends on caller-location libraries (A24).
- **Target-level pin (files matched by):**
  - any code or config glob/dir loader: fastify-autoload dirs, routing-controllers, type-graphql and TypeORM globs, sequelize-typescript `models`, swagger-jsdoc `apis`, oclif/yargs command dirs;
  - migrations and seeders (knex, umzug, TypeORM);
  - fs-read assets;
  - Jest setup/global/env files;
  - entrypoints (`main`, `bin`, `exports`, Docker, Procfile, serverless handlers, scripts);
  - generated dirs;
  - root `__mocks__` (node-module mocks);
  - `.d.ts` global augmentation files (or require that `include` membership is unchanged);
  - files listed in `sideEffects`.
- **Rename-level decline (later rung):**
  - decorated classes and subclasses of framework bases;
  - classes reaching snapshots;
  - any `.name` / `constructor.name` use;
  - string-token DI;
  - convention-suffixed file names (`.dto.ts`, `.entity.ts`, `.controller.ts`, modelMatch);
  - migration files.

### E3. Mutation catalog for the checker

Each mutant is applied to the executor's **output tree**. "Killer" is the check that must reject it statically. "Kickoff" says whether the kickoff checks KO1–KO7 would. "Tests" says whether the typical test oracle would.

| ID | Operator | Concrete instance | Killer | Kickoff | Tests |
|---|---|---|---|---|---|
| M1 | Retarget to same-basename file | `../services/user` → `../billing/user` (both exist) | K3 | ✓ | maybe |
| M2 | Drop one importer rewrite | Old specifier left in one file | K3 | ✓ | ✓ |
| M3 | Drop `jest.mock` rewrite (non-virtual) | `jest.mock('../services/user')` stale | K3 (site inventory) | P | ✓ (throws) |
| M4 | Drop `jest.mock(…, {virtual:true})` rewrite | Mock silently inert | K3 | P | ✗ often |
| M5 | Drop `jest.requireActual` rewrite inside a factory | Partial mock loads the wrong module | K3 | P | maybe |
| M6 | Move module, leave `__mocks__/<basename>` | Manual mock → automock | K1, K6 | ✗ | ✗ often |
| M7 | Move test, leave `__snapshots__/*.snap` | Vacuous pass without `--ci` | K1, K6 | ✗ | ✗ (non-CI) |
| M8 | Swap two files' contents under an identity pathMap claim | `a.ts`↔`b.ts` bodies | K2 | ✓ | maybe |
| M9 | Add new barrel and route importers through it | `billing/index.ts` | K1 (unmapped file), K2, K3 | ✓ | ✗ |
| M10 | Reorder two bound imports | Simulates organizeImports or lint-staged | K2 (ordered) | P (sets) | ✗ often |
| M11 | Relative → tsconfig alias (same file) | `'../user/service'` → `'@/user/service'` | K3 form class + runtime resolver | ✗ | ✗ (prod-only crash) |
| M12 | Toggle `import`↔`import type` | Elision and evaluation change | K2 | ✓ | maybe |
| M13 | Change extension style | `./x` → `./x.js` (or drop `.js` under nodenext) | K3 form class | ✗ | maybe |
| M14 | Move `__dirname` user without its asset | `templates/` left behind | K4 | ✓ | maybe |
| M15 | Move a glob/autoload target | Route file out of `routes/` (fastify prefix change) | K5 / target pin | P | maybe |
| M16 | Flip loader order, same set | Rename dir prefix so two controllers swap lexicographic order | K5 ordered | ✗ | ✗ |
| M17 | Move across nested `package.json "type"` or tsconfig scope | `src/legacy/` (CJS) → `src/billing/` (ESM) | K0/K5 fingerprint | ✗ | maybe |
| M18 | Move `.d.ts` without its `.js` sibling | Legacy JS + declarations | K1 bundle, K3 runtime | ✗ | maybe |
| M19 | Case-mismatched specifier | `./User` for `user.ts` | K3 (`realpath.native`) | P | Linux ✓ / macOS ✗ |
| M20 | Move test outside `roots`/`testMatch` | `test/x.spec.ts` → `src/x.ts` | K6 `--listTests` | P | ✗ (fewer tests, green) |
| M21 | Leave infra path stale | Dockerfile `CMD node dist/controllers/server.js`, `main` | K4 old-path scan, K7 | P | ✗ |
| M22 | Colocate tests into `src/` under inferred `rootDir` | `dist/src/server.js` → `dist/server.js` | K7 | ✗ | ✗ |
| M23 | Stage into a `.gitignore`d path | `config/local/…` | K1 tree-set on commit | ✗ | ✗ locally |
| M24 | Lose exec bit / break tracked symlink | `bin/cli.ts` mode 100755 → 100644 | K1 modes | ✗ | ✗ |
| M25 | Miss non-import sites | `require('./x')` in `.ts`, `import x = require()`, `export * from`, `import('./x')`, `require.resolve('./x')`, `/// <reference path>`, `declare module '../x'` | K3 (inventory); diverse extractor (D) | P | mixed |
| M26 | Edit a non-reference string containing the path | Log message or test name rewritten | K2 | ✗ | ✗ |
| M27 | Create a shadowing file | New `src/foo.ts` beside `src/foo/index.ts`; untouched importers flip | K3 over all files | P | maybe |
| M28 | Move folder named like an npm package under `baseUrl`/`moduleDirectories` | `src/utils/` vs npm `utils` | K3 over all files | P | maybe |
| M29 | Introduce a `__mocks__` basename collision | Second `__mocks__/service.ts` | K6 haste map | ✗ | maybe |
| M30 | Update `paths`/`moduleNameMapper` target strings inconsistently | tsconfig updated, Jest mapper not | K3 multi-resolver, K5 | P | ✓ |
| M31 | (Rename rung) rename TypeORM entity without `name` | Table name changes | Rename observability (decorated → decline) | P | maybe |
| M32 | (Rename rung) rename `*.dto.ts` → `*.ts` | Nest Swagger plugin skips the file | File-convention rule | ✗ | ✗ |

**Protocol:**

- Generate mutants on 3 OSS repos from real executor outputs.
- Required: 100% killed by K0–K7 alone (without K8).
- Any mutant killed only by tests, or by nothing, is a soundness hole; log it in the findings.
- Equivalent mutants (for example an alias rewrite where every resolver agrees) are still rejected by the form rule, by design.
- Also run the converse cross-check: "certificate ✓, tests ✓, load-trace ✗" counts as a hole.

---

## 7. Open items and UNVERIFIED

- ECMAScript `[[RequestedModules]]` source-order wording (the spec fetch truncated; MDN only confirms hoisting).
- Whether ts-morph's specifier setter preserves quote style.
- tsgo `--traceResolution` support.
- dependency-cruiser `exoticRequireStrings` with member calls like `jest.mock`.
- unrs-resolver fork lineage.
- TypeORM migration-name storage details.
- Behavior of TS 6.0 `baseUrl` under `ignoreDeprecations`.
- The caller-location package list in A24 is illustrative, not exhaustive.
- The ts-morph 28 release date shown on the releases page (2024) looks wrong.

## 8. Sources (dated where known)

- **Node:**
  - https://nodejs.org/api/modules.html (case-insensitive caching, realpath, `require.cache`)
  - https://nodejs.org/api/esm.html (`import.meta.dirname` v20.11; query/fragment duplicates)
  - https://nodejs.org/api/typescript.html (type stripping default v22.18/v23.6; no `paths`)
- **TypeScript:**
  - https://www.typescriptlang.org/docs/handbook/modules/reference.html
  - https://www.typescriptlang.org/tsconfig/
  - https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ (2026-03-23)
  - https://devblogs.microsoft.com/typescript/?p=5246 (TS 7.0, 2026-07-08)
  - https://github.com/microsoft/TypeScript/issues/62835 (2025-12-04)
  - https://github.com/microsoft/TypeScript/pull/62834 (closed 2025-12)
- **ts-morph:** https://github.com/dsherret/ts-morph/releases, https://registry.npmjs.org/ts-morph/latest
- **Jest:**
  - https://jestjs.io/docs/configuration (v30.5)
  - https://jestjs.io/docs/manual-mocks
  - https://jestjs.io/docs/snapshot-testing
  - https://jestjs.io/docs/cli
  - https://jestjs.io/docs/jest-object
  - https://jestjs.io/docs/ecmascript-modules
  - https://jestjs.io/blog/2025/06/04/jest-30
  - https://github.com/jestjs/jest/issues/2070
  - Jest sources: `jest-runtime/src/internals/Resolution.ts`, `jest-resolve/src/{resolver,defaultResolver}.ts`, `jest-test-sequencer/src/index.ts`, `pretty-format/src/index.ts`, `expect-utils/src/utils.ts`, `jest-test-result/src/types.ts` (raw.githubusercontent.com, main)
- **Vitest/Vite:** https://vitest.dev/api/vi.html, https://vite.dev/guide/features
- **Frameworks:**
  - https://docs.nestjs.com/fundamentals/circular-dependency
  - https://docs.nestjs.com/openapi/cli-plugin
  - https://raw.githubusercontent.com/nestjs/typeorm/master/lib/common/typeorm.utils.ts
  - https://typeorm.io/docs/help/decorator-reference
  - https://github.com/typeorm/typeorm/issues/6974
  - https://raw.githubusercontent.com/sequelize/sequelize-typescript/master/README.md
  - https://typegraphql.com/docs/types-and-fields.html
  - https://github.com/fastify/fastify-autoload
  - https://raw.githubusercontent.com/typestack/routing-controllers/develop/README.md
  - https://expressjs.com/en/guide/routing.html
  - https://knexjs.org/guide/migrations.html
  - https://raw.githubusercontent.com/sequelize/umzug/main/README.md
  - https://github.com/Surnet/swagger-jsdoc
  - https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client (v7)
  - https://raw.githubusercontent.com/ilearnio/module-alias/dev/README.md
- **Globs and bundlers:**
  - https://raw.githubusercontent.com/isaacs/node-glob/main/changelog.md
  - https://raw.githubusercontent.com/mrmlnc/fast-glob/master/README.md
  - https://webpack.js.org/guides/tree-shaking/
  - https://raw.githubusercontent.com/evanw/esbuild/main/lib/shared/types.ts
- **Graph tools:**
  - https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
  - https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md
  - https://github.com/oxc-project/oxc-resolver
  - https://github.com/unrs/unrs-resolver
- **Tooling and infra:**
  - https://raw.githubusercontent.com/import-js/eslint-plugin-import/main/docs/rules/order.md
  - https://git-scm.com/docs/git-commit
  - https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
  - https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html
  - https://typestrong.org/ts-node/docs/paths/
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import
- **Papers:**
  - Pnueli/Siegel/Singerman, TACAS 1998 (10.1007/BFb0054170)
  - Necula, PLDI 2000 (10.1145/349299.349314)
  - Knight & Leveson, IEEE TSE 1986 (10.1109/TSE.1986.6312924)
