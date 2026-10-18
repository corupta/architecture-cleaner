# Bug-hunt corpus

The S3 adversarial bug hunts (`~/ac-work/s3/bug-hunt.json`, `bug-hunt-round2.json`, 42 reports) as committed trees, plus the certifier false passes the S7 review confirmed (`S7R-*`: a move the executor applies as it must that a check let through). Each applicable case is an executor output that changed behavior or was wrong. The certifier must reject every one of them with its static checks, without K8. `test/certificate/hunt.test.ts` certifies each case in-process.

## Layout

```
test/certificate/hunt/
  index.json          case id -> { report, title, applicable, expectedChecks, controls }
  <case id>/
    case.json         see below
    before/           the repo as committed before the step (tracked files only)
    after/            the bad output tree (applicable cases only)
    good/             optional: a correct output tree; certifying before -> good must PASS
    environment/      optional: untracked installs (node_modules) the case is about
```

`case.json` holds:
- `id`, `report`: the case id and the report it comes from. Variants of one report get a suffix, e.g. `SEM-1b` and `SF-2-sibling`. The primary case of every report is named after the report.
- `source`, `lens`, `title`, `severity`: copied from the report.
- `applicable`: false when the report has no bad applied tree, for example a crash (MSF-3) or an unjustified decline (MC-1). The reason is in `notes`.
- `expectedChecks`: `[{ check, reason }]`, our best judgement of which checks should reject the tree.
- `origin`: where `before/`, `after/`, `good/` and `environment/` came from. Most `after/` trees are the executor's output exactly as it was staged in the confirmation repo. Where none was staged, or the output came from the now-fixed executor's own rollback, the tree was built by hand from the report's "actual" field.
- `identityControl: true`: the case also certifies `before -> before` (an empty commit), which must PASS.
- `runner`: the test runner the case needs installed.
  - `vitest`: the checkout gets `node_modules -> <this repo>/node_modules`. The confirmers ran these repros the same way.
  - `jest`: Jest isn't a dependency of this repo. Set `AC_HUNT_JEST_NODE_MODULES` to an installed `node_modules` that has jest, e.g. `~/ac-targets/g3/mcphub/node_modules` (Jest 30). Without it, the checkout has no Jest, and K3b/K6 can't run Jest on these cases.

## Storage rules

- Our `.gitignore` drops directories named `node_modules` and `dist`. They are stored as `_node_modules` and `_dist`, and the loader restores the real names. Only directories are renamed.
- Symlinks are stored as symlinks (`MSF-5`, `MC-3`). Bytes are exact, including non-UTF-8 (`MSF-4`) and BOMs (`JSM-3`). Exec bits are kept.
- `environment/` is copied into the checkout after both commits, so it stays untracked, as an installed `node_modules` would be. `context.environment` then picks it up. The checkout's working tree is left at the head commit.
- The corpus is excluded from `tsconfig.json` and from vitest's test globs. Its trees aren't ours to compile or run.

## Loading a case

1. `git init` a temp repo.
2. Commit `before/` with `git add -A -f`. Every stored file was tracked in the original repo, even where the case's own `.gitignore` would match it.
3. Replace the working tree with `after/` (or `good/`, or `before/` again for the identity control), then commit.
4. Copy `environment/`, and add the `node_modules` link for the case's `runner`.
5. Certify `HEAD~1..HEAD` with `environment = the temp repo`, `profile = null`, and `only = K0, K1, K2, K3a, K3b, K3c, K4, K6`. `AC_HUNT_CHECKS=K3a,K3c` narrows the run while you develop a check.
