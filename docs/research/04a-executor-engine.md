# Track 4a: executor engine feasibility

Raw research report (2026-10-01/02), kept verbatim. See README.md for method caveats.


---

# Report

# Track 4a: Executor engine feasibility (ts-morph move vs TS language service vs our own engine)

Notes on method:
- Everything below comes from reading code and docs. Nothing was executed.
- Plan mode was active, so I made no clones in `/tmp`. I read source with `curl` to stdout from `raw.githubusercontent.com` and unpkg.
- Snapshots used: ts-morph `latest` (28.0.0, 2026‑04‑12); TypeScript `release-6.0` / npm 6.0.3; typescript-go `main` (file last touched 2026‑08‑19). `microsoft/TypeScript@main` now returns 404 for `src/services/*`.

## 0. Key findings

1. **Do not use ts-morph `move()` as the executor.**
   - It only rewrites specifiers that start with `./` or `../` and that it could resolve.
   - It strips every extension (`.js`, and `.json` too), which breaks NodeNext ESM and JSON imports.
   - It rewrites the style of every relative literal in moved files, and handles `/index` differently per moduleResolution.
   - It ignores `paths` and `baseUrl`. Its performance is superlinear.
   - Open issues: [#1612](https://github.com/dsherret/ts-morph/issues/1612), [#1613](https://github.com/dsherret/ts-morph/issues/1613), [#837](https://github.com/dsherret/ts-morph/issues/837), [#1494](https://github.com/dsherret/ts-morph/issues/1494), [#953](https://github.com/dsherret/ts-morph/issues/953).
2. **TS `getEditsForFileRename` (GEFR) is much better.**
   - It edits only the text inside the quotes and keeps the original style: relative vs non-relative, `.js`, `/index`.
   - It handles `paths`, `baseUrl`, `#imports`, JSON, import types and relative triple-slash references.
   - It still misses: `require()` in `.ts` files, `jest.mock`/`vi.mock`, `declare module '../x'` augmentations, asset imports (css/graphql/ambient `*.x`), files outside the program, and tsconfigs other than the program's own.
   - It can switch the alias key (first match in `paths` order wins), and it can **insert** a tsconfig `include` entry.
   - It takes one old→new prefix per call.
3. **TypeScript 7 is `latest` on npm (7.0.2, 2026‑07‑08) and ships no JS API.**
   - The package has no `main`; it exports only `./unstable/*`.
   - We must pin **typescript@6.0.x** (or `@typescript/typescript6`, which provides `tsc6`). Sources: [TS 7.0 post](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), npm registry.
   - **TS 6.0 changed the default resolution.** With moduleResolution unset, TS 6.0 computes `bundler` for everything except node16/nodenext/amd/umd/system, including `module: commonjs` (release-6.0 `src/compiler/utilities.ts`, `_computedOptions.moduleResolution`). TS ≤5 computed node10. A shim is needed (§6).
4. **Recommended engine:** use TS 6.0 as the resolver and specifier generator, but run our own single pass.
   - Steps: resolve every module reference → apply the `pathMap` → regenerate the specifier in its original style → apply edits limited to the inside of the quotes → re-resolve **every** reference against a virtual post-move filesystem.
   - GEFR stays as a differential test oracle, not as the executor.
5. **Effort:** core move executor about 20–32 focused hours. MVP cut about 16–20 h. Symbol-rename rung +8–12 h.

## 1. How each engine works (code references)

**ts-morph move** ([SourceFile.ts](https://github.com/dsherret/ts-morph/blob/latest/packages/ts-morph/src/compiler/ast/module/SourceFile.ts))
- `move()` (L318–337) gathers references in two directions:
  - `literalReferences`: literals in this file that point at other files.
  - `referencingLiterals`: literals in other files that point at this file.
  - Both come from `SourceFileReferenceContainer`.
- `updateStringLiteralReferences` (L1024–1029) runs only `if (ModuleUtils.isModuleSpecifierRelative(text))`. That check is `startsWith("./") || startsWith("../")` ([ModuleUtils.ts](https://github.com/dsherret/ts-morph/blob/latest/packages/ts-morph/src/utils/compiler/ModuleUtils.ts)).
- Where literals come from ([SourceFileReferenceContainer.ts](https://github.com/dsherret/ts-morph/blob/latest/packages/ts-morph/src/utils/references/SourceFileReferenceContainer.ts)):
  - The source is `compilerNode.imports` (the TS parser's list).
  - Each literal is resolved through checker symbols: ImportDecl/ExportDecl, ImportEquals, ImportTypeNode and CallExpression branches.
  - Literals that don't resolve go to `#unresolvedLiterals` and are never rewritten.
  - Any other parent kind only gets `logger.warn("Unknown import string literal parent")`. This is how JSDoc `@import` is lost.
- The new specifier comes from `Directory.getRelativePathAsModuleSpecifierTo` ([Directory.ts](https://github.com/dsherret/ts-morph/blob/latest/packages/ts-morph/src/fileSystem/Directory.ts), L875–925):
  - L878: `.replace(/((\.d\.ts$)|(\.[^/.]+$))/i, "")` strips **any** extension.
  - Node10 collapses `…/index`.
  - Classic, Node16, NodeNext and Bundler emit an explicit `/index`.
- `Directory.move` (L660–705) passes the old directory path, so **every** relative literal in every moved file is re-rendered. That includes literals between co-moved files whose relative path did not change.
- On disk, `Directory.move` moves the whole directory, including non-TS files (`TransactionalFileSystem.queueMoveDirectory` → `moveSync`).
- Edits go through `StringLiteral.setLiteralValue`, which replaces `[start+1, width-2]`, so quotes are kept. Every edit then reparses the file ([performance docs](https://ts-morph.com/manipulation/performance): "the program is reset between manipulations").
- Tests cover only import, `import()`, `export *` and `import = require` ([sourceFileTests.ts](https://github.com/dsherret/ts-morph/blob/latest/packages/ts-morph/src/tests/compiler/ast/module/sourceFileTests.ts), L44–59). The tests also show `require("./../X")` being rewritten to `"../dir/NewFile"`, which is a style normalization.

**TS GEFR** ([getEditsForFileRename.ts, release-6.0](https://github.com/microsoft/TypeScript/blob/release-6.0/src/services/getEditsForFileRename.ts))
- `updateImports` (L177) iterates `program.getSourceFiles()` (L185). For each file it processes:
  - `referencedFiles`, but only when `pathIsRelative` is true (L198, L294).
  - `sourceFile.imports` (L299).
- Ambient-module targets are skipped (L205).
- An edit is made only when the importer moved and the specifier is relative, or when the target moved.
- The new text comes from `moduleSpecifiers.updateModuleSpecifier(..., oldImportSpecifier)`.
- The replaced range is `createStringRange` = `[start+1, end-1]` (L305), and no edit is made if the text is unchanged.
- `updateTsconfigFiles` (L104–127) edits only `program.getCompilerOptions().configFile`:
  - `files`/`include`/`exclude`
  - file-path options
  - `paths` values
  - It **inserts** a new `include` entry when the new path falls outside the include globs (L127).
- How style is kept ([moduleSpecifiers.ts](https://github.com/microsoft/TypeScript/blob/release-6.0/src/compiler/moduleSpecifiers.ts), L182–266):
  - `relativePreference` comes from the old specifier (relative → Relative, otherwise NonRelative).
  - The ending comes from the old specifier: `.js` → JsExtension, `/index` → Index, otherwise inferred from the file.
- Alias choice (`tryGetModuleNameFromPaths`): `for (const key in paths)` returns the **first** matching key. If nothing non-relative matches, it falls back to the relative path (`getLocalModuleSpecifier`, `if (!maybeNonRelative) return relativePath`).
- What `imports` contains ([program.ts](https://github.com/microsoft/TypeScript/blob/release-6.0/src/compiler/program.ts) `collectExternalModuleReferences` ~L3318, [utilities.ts](https://github.com/microsoft/TypeScript/blob/release-6.0/src/compiler/utilities.ts) `forEachDynamicImportOrRequireCall` ~L12172):
  - import/export declarations and `import = require`
  - `import()` with a StringLiteralLike argument
  - literal import types (`typeof import('./x')`)
  - JSDoc `@import`, in JS files only
  - `require()` **only when `isJavaScriptFile`**
- `declare module "…"` names go to `moduleAugmentations` / `ambientModuleNames`, **not** to `imports`.
- typescript-go ports the same algorithm ([internal/ls/file_rename.go](https://github.com/microsoft/typescript-go/blob/main/internal/ls/file_rename.go): `ReferencedFiles` + `Imports()`) and exposes it as LSP `workspace/willRenameFiles`. TS 7 therefore has the same coverage, but only over LSP.

## 2. Capability matrix

Legend: ✅ handled · ◐ partial · ❌ not handled. "Build" is what our engine needs.

| # | Reference kind | ts-morph `move`/`moveToDirectory`/`Directory.move` | TS GEFR (VS Code, Kiro) | Build | Evidence |
|---|---|---|---|---|---|
| 1 | Relative `import`/`export … from` | ◐ rewritten, but style normalized (extension stripped, `/index` changed, `./../`→`../`), and all relative literals in moved files re-rendered | ✅ style preserved, only changed specifiers edited | verification only | Directory.ts L878; GEFR L299–305; moduleSpecifiers L182–266 |
| 2 | `export * from` | ◐ (as row 1) | ✅ | – | ExportDeclaration ∈ `imports`; ts-morph test L52–59 |
| 3 | `import type` / `export type` | ◐ (as row 1) | ✅ | – | same node kinds |
| 4 | `import x = require('./x')` | ◐ (as row 1) | ✅ | – | `isAnyImportOrReExport`; ts-morph test L52–59 |
| 5a | `require('./x')` in **.js** inside the program (allowJs) | ◐ | ✅ | – | `isJavaScriptFile && isRequireCall` |
| 5b | `require('./x')` / `require.resolve()` in **.ts** | ❌ | ❌ | extractor + `ts.resolveModuleName` (mode = require) | same gate; ts-morph only reads `imports` |
| 6 | `import('./x')` literal | ◐ (string literal tested; no-substitution template UNVERIFIED) | ✅ (StringLiteralLike, including template without substitutions) | – | utilities.ts L12172; checker.ts L50284–50295 |
| 7 | `` import(`./l/${x}`) ``, `require(var)` | ❌ | ❌ | hazard: pin, co-move or decline | not in `imports` |
| 8 | `jest.mock/doMock/unmock/requireActual/requireMock`, `vi.mock/doMock/importActual/importMock` | ❌ | ❌ ([PR #62834](https://github.com/microsoft/TypeScript/pull/62834) declined 2025‑12‑10, "avoiding taking new PRs to this codebase"; [#62835](https://github.com/microsoft/TypeScript/issues/62835) open) | extractor + Jest-semantics resolution (relative to the test file, `moduleNameMapper`, `moduleDirectories`). Exception: `vi.mock(import('./x'))` is an `import()` and is handled by both ([vitest docs](https://vitest.dev/api/vi.html)) | – |
| 8b | `__mocks__/x.ts` next to the module; `__snapshots__/x.test.ts.snap` | ❌ (only `Directory.move` moves them, and only incidentally) | ❌ | co-move rules. Jest manual mocks must sit "in a `__mocks__/` subdirectory immediately adjacent to the module" ([Jest](https://jestjs.io/docs/manual-mocks)). Snapshots aren't written in CI ([Jest](https://jestjs.io/docs/snapshot-testing)) | – |
| 9 | `typeof import('./x')` | ◐ (ImportTypeNode branch) | ✅ | – | checker.ts L50317–50318 |
| 10 | `/// <reference path>` | ❌ (not in `imports`) | ◐ only `./`/`../` forms; bare `path="x.d.ts"` is skipped | handle the bare form | GEFR L198, L294; tsgo `renameFromIndex` test |
| 11 | `declare module '../models/user'` augmentation | ❌ | ❌ (`moduleAugmentations` ≠ `imports`) | extractor + rewrite | program.ts `collectModuleReferences` |
| 12 | tsconfig `paths` alias | ❌ (relative-only gate; [#837](https://github.com/dsherret/ts-morph/issues/837) open since 2020, [#829](https://github.com/dsherret/ts-morph/issues/829), [#1494](https://github.com/dsherret/ts-morph/issues/1494), [PR #1495](https://github.com/dsherret/ts-morph/pull/1495) open/unmerged) | ◐ stays non-relative, but the **key may change** (first match in `paths` order), and it **silently falls back to relative** if no pattern matches | keep the original alias key first; flag any fallback; check the Jest `moduleNameMapper` covers the chosen alias | `tryGetModuleNameFromPaths` |
| 13 | `baseUrl` bare path | ❌ | ✅ (`maybeNonRelative = relativeToBaseUrl`) | needs `ignoreDeprecations:"6.0"` on TS 6; removed in TS 7 | [TS 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), [TS 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) |
| 14 | `.js` extension (NodeNext/ESM) | ❌ stripped, so ESM breaks ([#1612](https://github.com/dsherret/ts-morph/issues/1612), open 2025‑02‑06) | ✅ (`hasJSFileExtension(old)`; [#24493](https://github.com/microsoft/TypeScript/issues/24493), [#50725](https://github.com/microsoft/TypeScript/issues/50725) fixed). Caveat: with `allowImportingTsExtensions`/`rewriteRelativeImportExtensions` under Node16+ ESM the allowed endings are `[Ts, Js]`, so `.js` may become `.ts` (code-read, UNVERIFIED) | post-pass that forces the original ending | moduleSpecifiers L203–208 |
| 15 | Directory/index imports (`./users` ↔ `./users/index`) | ❌ style changes. Under TS 6.0 the default moduleResolution is bundler, so ts-morph 28 turns `./users` into `../users/index` even on legacy CJS repos | ✅ (tsgo `getEditsForFileRename_renameFromIndex`; [#26028](https://github.com/microsoft/TypeScript/issues/26028) fixed) | – | Directory.ts L893–921 |
| 16 | package.json `imports` (`#x`) / self-`exports` | ❌ | ◐ keeps `#…` if an imports pattern still matches, otherwise falls back; package.json is never edited | rewrite package.json `imports`/`exports`/`main`/`types`/`bin`, or decline | `tryGetModuleNameFromPackageJsonImports` |
| 17 | JSON import | ❌ if tracked, `./data.json` becomes `./data` (L878 regex; code-read) | ✅ with `resolveJsonModule` ([#26927](https://github.com/microsoft/TypeScript/issues/26927) fixed) | – | – |
| 18 | Asset imports (`.css`, `.graphql`, JSON without `resolveJsonModule`) when the **importer** moves | ❌ (unresolved, never updated) | ❌ (ambient `*.css` skipped at L205; unresolved → no edit) | resolve against the filesystem + co-move | GEFR `getSourceFileToImportFromResolved` |
| 19 | Files outside the program (tests or scripts excluded by `include`) | ❌ (only Project files) | ❌ (`program.getSourceFiles()`) | union inventory, each file paired with its owning tsconfig's options | GEFR L185 |
| 20 | Multiple tsconfigs (`.build`/`.spec`/`extends` base) | ❌ never touches tsconfig | ◐ only the leaf `configFile`; `paths` in an `extends` base are untouched; may **insert** an `include` entry ([#37949](https://github.com/microsoft/TypeScript/issues/37949) "invalid and/or unexpected tsconfig changes") | per-option-group programs; own config rewriting; **drop TS's tsconfig edits** | GEFR L104–127 |
| 21 | Quotes / byte-identical outside specifiers | ◐ quotes kept, but specifier text normalized (rows 1/14/15); a reparse per edit | ✅ inside-quote range only; tsconfig insertion is formatted | span edits with a guard (`text.slice(s,e) === old`) | StringLiteral.ts; GEFR L305 |
| 22 | Moving across a package.json `"type"` or nested `node_modules` boundary | ❌ | ❌ | check `impliedNodeFormat` is equal; re-resolve bare specifiers from the new location | – |
| 23 | Filesystem operations | `Directory.move` moves the whole directory; `SourceFile.move` moves one file | edits only | `git mv` + co-move | TransactionalFileSystem.ts |

## 3. Symbol rename coverage (`findRenameLocations`)

| Case | TS LS | ts-morph `rename()` | Build |
|---|---|---|---|
| Ordinary cross-file identifiers | ✅ | ✅ | – |
| Shorthand `{ foo }` / destructuring `{ foo } = o` | ✅ only with `providePrefixAndSuffixTextForRename=true`, which emits `foo: bar` / `bar: foo` and keeps the object shape ([findAllReferences.ts](https://github.com/microsoft/TypeScript/blob/release-6.0/src/services/findAllReferences.ts) L758–790). With `false` the rename cascades into the property and **changes object/JSON keys**. | ❌ by default: `usePrefixAndSuffixTextForRename: false` (ManipulationSettingsContainer L71) | hybrid (below) |
| Import/export specifiers | prefix/suffix=true gives `import { bar as foo }` / `export { bar as foo }`: public name kept, importer locals not renamed. false cascades through importers and changes the public export name. | follows the flag | hybrid: cascade internally, alias at the pinned public surface |
| `export { Old as New }` | renames only `Old` ("For `export { foo as bar }`, rename `foo`, but not `bar`", findAllReferences ~L2043) | same | – |
| `obj['Old']` string access | included when the checker resolves it to the same symbol; untyped/`any`/computed access missed (UNVERIFIED) | same | finding |
| Declaration files | project `.d.ts` included. Library/node_modules elements are refused only by `getRenameInfo` ([rename.ts](https://github.com/microsoft/TypeScript/blob/release-6.0/src/services/rename.ts) L97–165). | ❌ calls `findRenameLocations` directly with no `getRenameInfo` gate ([renameNode.ts](https://github.com/dsherret/ts-morph/blob/latest/packages/ts-morph/src/compiler/ast/base/helpers/renameNode.ts)) | gate with `getRenameInfo`; drop locations outside the repo |
| Strings/comments | off by default (textual if enabled) | off | never enable |
| `X.name`, `constructor.name`, decorators, DI string tokens, ORM names derived from class names | ❌ | ❌ | kickoff certificate #6 |
| Default-import local names | UNVERIFIED | UNVERIFIED | spike test |

## 4. Performance and memory (200–500 files)

**ts-morph move is superlinear**: references come from the checker, and the program resets after every manipulation.
- [#1613](https://github.com/dsherret/ts-morph/issues/1613): about 5 s without moves, about 3 min (tsx) and 10+ min (Bun/Deno) with moves.
- [#953](https://github.com/dsherret/ts-morph/issues/953): "Too slow to move".
- [SiroSuzume/mcp-ts-morph](https://github.com/SiroSuzume/mcp-ts-morph) measured "369s for 34 files in src/types/" on a 3000+ file monorepo. It monkey-patches `_getReferencesForMoveInternal` and `_updateReferencesForMoveInternal` to no-ops (`src/ts-morph/rename-file-system/_utils/skip-ts-morph-ref-update.ts`).

**TS LS on a warm LS**:
- [ts-refactor-mcp](https://cdn.jsdelivr.net/npm/ts-refactor-mcp@0.1.2/README.md) self-reports 5–30 s warm-up and 10–100 ms per move (UNVERIFIED).
- Historic slow cases were large project-reference solutions: [#41508](https://github.com/microsoft/TypeScript/issues/41508) 92 s on TS 4.1; [#29031](https://github.com/microsoft/TypeScript/issues/29031), [#40615](https://github.com/microsoft/TypeScript/issues/40615).
- One prefix per call means N file moves need N calls, each followed by a host update and a program rebuild. That makes it order-dependent and costs roughly N × rebuild (rebuild cost UNVERIFIED).

**Our single pass** is O(#literals) using `ts.createModuleResolutionCache`. The post-move check needs only re-resolution, not a type checker, so it should take seconds for 500 files (UNVERIFIED). A type checker or LS is needed only for symbol renames.

**Memory**: a 500-file TS 6 program is likely low hundreds of MB (UNVERIFIED). The host here is **aarch64** (Jetson-class), so benchmark locally during the spike.

## 5. One Project vs language service

- **ts-morph Project**: fine for read-only analysis. Never use it for manipulations in the executor (reset and reparse per edit). It bundles TS 6.0.2 (`@ts-morph/common` 0.29, no TS dependency), so use `import { ts } from "ts-morph"` to avoid loading two TypeScript copies.
- **Raw `ts.createProgram`**: enough for move steps (resolution plus AST).
- **Raw `ts.createLanguageService`**: needed only for `getRenameInfo` / `findRenameLocations`, and for the GEFR oracle in tests.

## 6. Getting the resolved target of every specifier

1. Pin typescript@6.0.3 locally (or `typescript@npm:@typescript/typescript6`; npm shows 6.0.2 with bin `tsc6`).
2. Parse every `tsconfig*.json` with `ts.getParsedCommandLineOfConfigFile`, which handles `extends`.
3. Group files by a resolution-options fingerprint: `module`, `moduleResolution`, `paths`, `baseUrl`, `rootDirs`, `allowJs`, `resolveJsonModule`, `customConditions`, `moduleSuffixes`, `allowImportingTsExtensions`, `resolvePackageJsonImports`.
4. Assign each file to its owning tsconfig (the oxc-resolver approach of "Honoring include/exclude/files"). Orphan files take the root tsconfig's options plus `allowJs`.
5. **Legacy shim**: if the repo's own TS is below 6 and `moduleResolution` is unset, set `moduleResolution: node10` (or classic for amd/umd/system) and `ignoreDeprecations: "6.0"`. Deprecated options still work in 6.0 with that flag ([TS 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)).
6. Give the CompilerHost a `resolveModuleNameLiterals` wrapper.
   - It records (file, literal span) → `ResolvedModuleWithFailedLookupLocations`.
   - It delegates to `ts.resolveModuleName(text, containingFile, options, host, cache, redirectedReference, mode)`, with `mode = ts.getModeForUsageLocation(file, literal, options)`.
   - All of these are public in the 6.0.3 `.d.ts` (L9340, L9591, L9337).
7. For references outside `imports`, call `ts.resolveModuleName` directly, with mode CommonJS for require-like calls. For assets, check exact filesystem paths.
8. **Post-move**: build a virtual `ModuleResolutionHost` (`fileExists`/`readFile`/`directoryExists`/`realpath` mapped through the inverse `pathMap`) and use `ts.getImpliedNodeFormatForFile` for the new paths.
9. **Specifier generation**: `ts.moduleSpecifiers.updateModuleSpecifier(opts, oldSf, newImporterPath, newTargetPath, host, oldText)` with `ts.createModuleSpecifierResolutionHost(program, lsHost)`.
   - Both are internal but present in the 6.0.3 runtime bundle (`typescript.js` L1876, L424, L49904–49917).
   - 6.0 is "the last release based on the current JavaScript codebase", so that internal surface is effectively frozen.
   - Then run a post-pass that keeps the original alias key and the original ending.

## 7. Alternatives

| Option | Verdict |
|---|---|
| ts-morph move | Rejected (§0, §2) |
| TS GEFR via in-memory LS or tsserver | Use as the **differential oracle** in tests, and as a fallback if our generator stalls. Kiro "smart relocate" is the same thing (it uses `vscode.WorkspaceEdit.renameFile`; [Kiro blog, 2026‑02‑05](https://kiro.dev/blog/refactoring-made-right/)). ts-refactor-mcp is too (tsserver GEFR per file). |
| typescript-go LSP `willRenameFiles` | Same algorithm, LSP only; TS 7.0 has no API and 7.1 is expected to bring a "new (and different) API". Not worth it. |
| jscodeshift | No resolution, and recast reprinting risks formatting drift. No. |
| ast-grep (`@ast-grep/napi` 0.45.3, arm64 binaries available) | Optional, for hazard-scan rules only. |
| oxc-parser 0.152.0 + oxc-resolver 11.24.2 (arm64 binaries available) | Recommended for the **checker's** independent graph. The parser gives an ESM module record with spans (static/dynamic imports, `import.meta`). The resolver is a Rust port of enhanced-resolve plus tsconfig paths, extends and references ([README](https://github.com/oxc-project/oxc-resolver)). Semantics differ from TS (`extensionAlias` needed, `.d.ts` handled differently), so disagreements become preflight findings. The kickoff plan (raw TS API vs ts-morph) shares TS's resolver on both sides, so their failures are correlated. |
| enhanced-resolve | Same semantics as oxc-resolver, slower. Skip. |
| TS `organizeImports` / ts-morph `fixMissingImports` | **Never use**: they reorder, merge and drop imports, which breaks byte-identity. |
| [SiroSuzume/mcp-ts-morph](https://github.com/SiroSuzume/mcp-ts-morph) (updated 2026‑06‑11) | Has its own updater, but only for Import/ExportDeclaration. Aliases fall back to relative (a TODO in `update-module-specifiers.ts`). Its README says dynamic `require`/`import()` aren't detected. |
| t09tanaka/ts-rename-helper-mcp, trkbt10/mcp-typescript-tools | Not inspected (UNVERIFIED). |

## 8. Recommended engine design: resolve → map → respecify → re-resolve

1. **Inventory**: all `*.{ts,tsx,mts,cts,js,mjs,cjs}` files, excluding `node_modules`/outDir, each paired with its option group.
2. **Extract `ModuleRef`** = {file, kind, literalStart, literalEnd, text}. Kinds: TS `imports`, `referencedFiles` (including bare paths), augmentations, `require`/`require.resolve` in TS, the jest/vi family, and asset specifiers.
3. **Resolve (before)** to one of: a repo file, an external package, or unresolved-with-text.
4. **Map**: `pathMap` plus co-move rules (`__mocks__`, `__snapshots__`, `.d.ts`/`.js` siblings, assets).
5. **Respecify**, only where the importer or the target moved and the specifier is path-like (relative, alias, baseUrl, `#`):
   - TS `updateModuleSpecifier`
   - keep the alias key
   - keep the ending
   - keep the `./../` style where it is still valid
   - Assets: compute the relative path ourselves, keeping the extension verbatim.
6. **Edit** only inside the quotes. Assert each original slice matches. Refuse overlapping edits. Read and write raw UTF-8 so BOM and CRLF survive. Never apply TS's tsconfig edits.
7. **Self-verify on the virtual post-move host**: for **every** reference in every file, `after == pathMap(before)`; unresolved references stay unresolved with the same text; `impliedNodeFormat` is unchanged per file. Then `git mv` and write.
8. **Manifest per step**: edits by kind, pinned or hazard references, fallbacks. This feeds certificate #1 (diff confinement).
9. **Decline or pin** when a moved file or its targets touch template dynamic imports, `require(var)`, `require.context`/`import.meta.glob`, `__dirname`/`fs` literals, or `new Worker`.
10. **Tests**: a fixture repo per matrix row; random `pathMap` fuzzing compared against sequential GEFR, with every divergence explained by a matrix row.

Caveat: git rename detection defaults to 50% similarity ([git-diff -M](https://git-scm.com/docs/git-diff)). Tiny barrel files may show up as delete+add, so mention it in the PR notes.

## 9. Must build ourselves

1. Union inventory with per-tsconfig option groups and the TS 6.0 legacy-default shim.
2. Extractors for `require`/`require.resolve` in `.ts`, the jest/vi mock family, `declare module '<relative>'`, bare-form triple-slash references, and asset specifiers.
3. Jest/Vitest resolution approximation (`moduleNameMapper`, `moduleDirectories`, `roots`, Vite aliases), or decline when it's ambiguous.
4. Alias-key preservation, ending preservation, and fallback flagging.
5. Filesystem-based asset resolution and co-move rules (`__mocks__`, `__snapshots__`, siblings).
6. Inside-quote edit applier with slice guard, BOM/CRLF safety, and `git mv`.
7. Virtual post-move resolver with full re-resolution, an `impliedNodeFormat` check, and a re-check of bare specifiers for moved files.
8. Config/path rewriting across **all** tsconfigs (including `extends` bases), Jest config, and package.json `main`/`bin`/`scripts`/`imports`/`exports`. Or for MVP: decline the step if any config references a moved path.
9. Hazard scan feeding pin, co-move or decline.
10. Rename rung (if chosen):
    - `getRenameInfo` gate and repo-only filtering.
    - Hybrid prefix/suffix: cascade internally, but use `a: b` at shorthand and destructuring sites and `x as y` at the pinned public surface.
    - Policy for default-import local names.
    - Observability scan.
11. Fixture corpus plus a GEFR differential harness.

## 10. Effort (focused hours)

| Work item | Hours |
|---|---|
| Loader, option groups, shim | 3 |
| Reference extractor (all kinds) | 3 |
| Resolver (recorded + extras + assets + Jest approximation) | 3–5 |
| Specifier generator (TS internal + post-passes) | 2–4 |
| Edit applier + `git mv` | 2 |
| Self-verification on the virtual host | 3 |
| Co-move rules | 2 |
| Fixtures + differential harness | 5–7 |
| **Core move executor** | **~23–29 (range 20–32)** |
| MVP cut (decline on config hits, no Jest mapper, smaller fixture set) | ~16–20 |
| Config/glob rewriting (instead of declining) | +5–8 |
| Symbol-rename rung | +8–12 |
| Fallback alternative: sequential GEFR + gap passes (alias drift, order dependence, weaker certificate) | ~10–12 |

## 11. To settle in a 1–2 h spike (all UNVERIFIED)

- Does ts-morph rewrite no-substitution template literals?
- Is `.js` rewritten to `.ts` under NodeNext with `allowImportingTsExtensions`?
- Does rename cascade into default-import local names?
- Is string element access included in rename locations?
- How much of the LS program is reused when root files change?
- Do TS 6 deprecated options really produce only diagnostics through the API?
- Real timings and memory for program build and the full pass on 200/500-file repos on this aarch64 host.
