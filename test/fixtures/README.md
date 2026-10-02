# Executor fixtures

Each fixture is a tiny repo plus a move request and the exact expected result. The fixtures are the executor's contract (plan §3.3). The expected trees are written by hand, independently of the implementation.

## Layout

```
test/fixtures/<name>/
  fixture.json     { "description": "...", "rows": [<capability rows from docs/research/04a §2: numbers, or strings such as "5b"; may be empty>], "typecheck": true|false }
  pathmap.json     { "moves": { "<old repo-relative path>": "<new repo-relative path>", ... } }
  before/          the repo as committed (every file is tracked)
  after/           the full expected tree after the move (applied fixtures only)
  expected.json    { "outcome": "applied" } or { "outcome": "declined", "reasons": ["<code>", ...] }
```

- Paths use `/`, are relative to the repo root, and name files, not directories.
- The fixture repo has no `node_modules`. It must not import packages, except where a test runner's globals are needed. For those, declare minimal ambient types in a tracked `.d.ts`, e.g. `declare const jest: { mock(path: string, factory?: () => unknown, options?: { virtual?: boolean }): void; requireActual<T = unknown>(path: string): T }`.
- With `"typecheck": true`, the harness checks that `before/` and `after/` both compile with zero diagnostics under TypeScript 6.0.3 and the fixture's `tsconfig.json` (with `ignoreDeprecations: "6.0"` added). Keep fixtures type-correct.
- Files must be byte-exact. `after/` is compared byte for byte, including line endings, BOM and trailing newlines.

## What the executor does (the contract the expected trees encode)

1. **Moves** exactly the files in `pathmap.json`, plus **co-moves**:
   - `<dir>/__mocks__/<basename>` moves with `<dir>/<basename>` to `<newdir>/__mocks__/<basename>`.
   - `<dir>/__snapshots__/<testfile>.snap` moves with `<dir>/<testfile>` to `<newdir>/__snapshots__/<testfile>.snap`.
   - Co-moved files are **not** listed in `pathmap.json`. They appear moved in `after/`.
2. **Rewrites** a module specifier only when its resolution would otherwise change, i.e. the importer or the target moved and the old text no longer reaches the mapped target. Everything else stays byte-identical. That includes specifiers in moved files that still resolve: an alias that still points at the same file is not touched.
3. **Edits only inside the quotes** of the specifier string. Quote style, semicolons, line endings, BOM and every other byte stay as they were.
4. **Keeps the form class** of each rewritten specifier:
   - **Relative stays relative.** Compute the shortest posix relative path from the importer's new directory to the target's new path. Start it with `./` unless it starts with `../`. One exception: a bare-form `/// <reference path="x.d.ts" />` stays bare while the target is still a sibling.
   - **Ending stays.** Same extension style as the original: none, `.js`, `.ts`, `.mjs`, `.cjs`, `.json`, `.css`… If the original addressed a directory index without `/index` (`./users`), keep the directory form while the target is still that directory's `index`; if it said `./users/index` or `./users/index.js`, keep that.
   - **Alias key stays.** A specifier written through a tsconfig `paths` key (`@app/*` → `src/*`) keeps the same key and gets the new tail under the mapped directory. A `baseUrl` bare path (`src/users/user.service` with `baseUrl: "."`) stays baseUrl-relative. A Jest `moduleNameMapper` alias in a mock string (`@/x` with `^@/(.*)$` → `<rootDir>/src/$1`) keeps the alias. If the new target is no longer under the alias's directory, the step is declined (`alias-escape`).
   - **Bare package specifiers are never touched.**
   - **Unresolved specifiers are never touched** (e.g. a `jest.mock('./missing', factory, { virtual: true })`), and they must stay unresolved.
5. **Which options resolve a file:** the tsconfig whose program includes it. A file outside every program (e.g. tests excluded by `include`) takes the options of the nearest ancestor `tsconfig.json`.
6. **Reference kinds covered:**
   - static `import` / `export … from` / `export * from` / `import type` / `export type`;
   - `import x = require('…')`;
   - `require('…')` and `require.resolve('…')` in `.ts`;
   - `import('…')` with a string literal or a no-substitution template;
   - `typeof import('…')`;
   - `jest.mock/doMock/unmock/requireActual/requireMock` and `vi.mock/doMock/unmock/importActual/importMock` with a string literal;
   - `declare module '<relative>'` augmentations;
   - `/// <reference path="…" />` (both `./x.d.ts` and the bare `x.d.ts` form, the latter meaning relative to the file);
   - asset specifiers (`import './styles.css'`, `import data from './data.json'`) resolved against the filesystem.
7. **Non-TS assets never move** (plan §2.4). Only their importers' specifiers change. Sibling-asset co-moves are out of MVP scope.
8. **Declines the whole step** (no file changes at all) with reason codes:
   - `destination-exists`: a destination path already exists and isn't itself being moved away.
   - `case-only-rename`: old and new paths differ only in letter case.
   - `location-sensitive`: a moved file uses `__dirname`, `__filename`, `import.meta.url`/`dirname`/`filename` or `process.cwd()`.
   - `dynamic-reference`: a moved file contains `import()`/`require()` of a non-literal (template with substitutions, variable).
   - `config-reference`: a config file (`package.json`, `tsconfig*.json`, `jest.config.*`, `vitest.config.*`, `nest-cli.json`) contains a moved file's path. That's the repo-relative or config-relative path, with or without its extension.
   - `module-format-change`: a moved file's implied module format (ESM vs CJS, from the nearest `package.json` `type` and the file extension) would change.
   - `compile-context-change`: the set of tsconfig programs that include a moved file would change, e.g. a test moved from an excluded `tests/` into an included `src/` (plan §3.4 K5).
   - `ignored-destination`: a destination is matched by `.gitignore`.
   - `alias-escape`: as above, including a directory-form alias (`@app/config` → `config/index.ts`) whose directory would become the alias root itself.
   - `unknown-source`: a pathmap source isn't a tracked file.
