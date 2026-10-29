# Partial answer keys for real targets

The scrambles have complete answer keys by construction: we flattened feature-organized repos ourselves, and their
original folders are the key. A real type-sliced target has none. This folder holds partial keys taken from a
target's own history. So far there is one, for immich.

| File | What it is |
|---|---|
| `immich-2024.rsf` | The key: 47 lines `contain <feature> <path>`, with paths relative to `server/` as the bench's facts name immich's movable files at `02063972e8` (`src/services/album.service.ts`). |
| `immich-2024.lineage.tsv` | For each labeled file, its path at `40262c30` and the renames or content share that carry the label. |
| `derive-immich-2024.py` | Derives both files from an immich clone. It needs only the Python standard library and git. |

## immich-2024.rsf

immich's maintainers restructured `server/` by hand in March 2024. Before that, its domain layer was sliced by
feature (`src/domain/<feature>/`), while controllers, repositories and infrastructure sat in folders of their own.
The restructure moved everything into type folders (`services/`, `dtos/`, `cores/`, `interfaces/`, …), and immich
never went back. The key labels the files at our pinned commit (`02063972e8`, 2026-10-01) whose history puts them, or
the file they descend from, in a `domain/<feature>/` folder just before that restructure. No label comes from our
judgment, from file names, or from any plan. A file the history can't trace stays unlabeled.

### The rule

`derive-immich-2024.py` walks immich's first-parent history one commit at a time. It starts at `40262c30`
(2024-03-18, two days before the restructure's first commit; G2 started there too) and ends at `02063972e8`, looking
only at commits that touch `server/`: 26 up to `6e93ddf2`, the commit right after the restructure, and 2,205 from
there to the pin. The one merge in that range changes nothing under `server/` compared with its first parent.

1. **Seed.** Every file under `server/src/domain/<feature>/` at `40262c30` takes `<feature>`: 160 files (27 of
   them tests) in 25 features. Two kinds of file get no seed. `domain/repositories/` is a type folder, and the 6
   files at the `domain/` root belong to no feature.
2. **Renames** carry the label, as git detects them per commit at its default threshold (`diff-tree -M50%`). A
   deletion drops the label.
3. **Content.** Some files carry no label but are added, copied, renamed into or modified by a commit. Such a file
   takes feature F when at least 75% of its non-trivial lines are verbatim lines that a file labeled F had at the
   parent commit. The files that hold a line at the parent split into groups, one per feature plus one for all
   unlabeled files, and the line votes 1/n to each group: a line held by an F file and an unlabeled file gives F
   half a vote. A line found nowhere votes for no feature, but it still counts in the total. (Read the other way,
   with unlabeled holders not splitting the vote, the rule would label one more file: `dtos/asset-media.dto.ts`, at
   exactly 0.75 asset instead of 0.58.) The 75% is G2's content-merge share, and the line normalization is G2's as
   well: lines are stripped, and these don't count: lines under 16 characters, imports, lines that start with a
   closing bracket or a brace, `export {` and `export * from`, the decorators `@Is…`, `@Optional`, `@Validate…` and
   `@ApiProperty`, and comments.

The key keeps the labeled files under `server/src` at the pin that are not tests. All 47 are movable files of the
bench's facts at `02063972e8` (269 movable files, `buildFacts` with the immich profile; the same set
`docs/plans/immich/plan.yaml` lists).

### What we kept from G2

G2 (2026-10-02, docs/gates.md) mapped the `domain/<feature>/` folders onto `6e93ddf2` (`gt.rsf`: 53 files in 25
features, with 26 tests in `gt-tests.rsf`). Its `finalize.py` has three tiers:

- **Tier 1, kept:** renames found by git at its default threshold, either end to end or commit by commit
  (`rename-exact`, `rename-similar`, `rename-chain`, `same-path`). These are rule 2.
- **Content-merge, kept:** a file with no rename origin whose traced lines come from one feature at a share of 0.75
  or more. This is rule 3, with one change: we measure the share over all of a file's non-trivial lines, not only
  over the lines found in the older tree. On G2's data the two measures agree, because all three of its
  content-merge files (`asset.dto.ts`, `user.dto.ts`, `user-profile.dto.ts`) were fully traced. After 2024 they
  don't, because files mix moved code with new code. Measured over traced lines only, a 3-line file with one traced
  line would count as 100% one feature (`dtos/bbox.dto.ts` would be labeled `smart-info`).
- **Tier 2 (`gt-extended.rsf`), dropped:** it gave the files of `domain/repositories/` the feature folder they had
  before #4403 (2023-10-09). By March 2024 the maintainers had already moved those files out of the feature folders
  into a type folder, and the key is the March 2024 layout. Dropping it changes nothing at the pin: every file tier 2
  labels (`interfaces/*.interface.ts` after the restructure) was deleted before `02063972e8`.

Stopped at `6e93ddf2` (`--at 6e93ddf2`), the script reproduces G2's 53 files and 26 tests exactly, with the same
features.

### From 6e93ddf2 to 02063972e8

44 of the 53 files keep their path: 22 services, 20 DTOs, `cores/storage.core.ts` and `utils/media.ts`. Several were
rewritten in place at some point. For example, git's rewrite detection (`-B`) flags 21 of the 24 labeled DTOs in
`7d8f843be6` (2026-04-14, the class-validator to zod migration). These files keep their label, because their path
never changed. Since the zod migration, 8 labeled files keep no verbatim line of
their 2024 version (`download`, `time-bucket`, `stack`, `job`, `partner`, `api-key`, `tag` and the renamed `server`
`.dto.ts`), so their labels rest on the path or the rename alone; most still hold their 2024 DTOs, rewritten. Two
hold none of their March 2024 DTOs: `dtos/job.dto.ts`, whose content `d784d431d0` (2025-11-14, "job vs queue
naming") moved into the new `dtos/queue.dto.ts`, all but `JobCreateDto` (added 2024-09-16), and `dtos/stack.dto.ts`,
whose `UpdateStackParentDto` was removed when `8338657ea` (2024-08-19, "refactor(server): stacks") began what became a
stack feature of its own. The rule follows git's notion of the same file, the path; a content rule would drop at
least these two labels.

We also ran git's rename and copy detection at 10% instead of 50%. For the labeled files, it finds only two more
renames, R018 and R022 in the table below. Everything else it finds at low similarity is a copy, a new file next to a
labeled one that stays. Rule 3 judges those copies, and the closest ones are listed under "Splits" below.

Here is what happened to the other 9.

| File at 6e93ddf2 (feature) | What happened | Where its lines are at that commit | Label at the pin |
|---|---|---|---|
| `dtos/server-info.dto.ts` (server-info) | `a2364a12cf` (2024-06-28, "move /server-info endpoints to /server") renamed it, R100 | `dtos/server.dto.ts` | `dtos/server.dto.ts`: server-info |
| `services/server-info.service.ts` (server-info) | the same commit, R097 | `services/server.service.ts` | `services/server.service.ts`: server-info |
| `cores/access.core.ts` (access) | `8285803c95` (2024-08-20, "refactor: access core") turned the class into functions in `utils/access.ts`, a 15-line permission helper that already existed | 72 of its 156 lines (46%); rule 3's access share of `utils/access.ts`: 47% | none |
| `cores/system-config.core.ts` (system-config) | `a019fb670e` (2024-09-30, "refactor(server): config service"); git pairs it with the new `utils/config.ts` only below its default threshold (R018) | 27 of its 67 lines (40%); rule 3's system-config share of `utils/config.ts`: 42% | none |
| `cores/user.core.ts` (user) | `f63d251490` (2024-09-30, "refactor(server): user core") moved it into the new `utils/user.ts` (R022), and `43d18ccc36` (2024-10-24) deleted that file too | 8 of its 24 lines, 53% of `utils/user.ts`; its `createUser` then moved into `BaseService` | none, no descendant |
| `dtos/system-config.dto.ts` (system-config) | `e529557160` (2026-08-20, "feat: new config endpoints") deleted it | 125 of its 297 lines (42%); rule 3's system-config share of the new `dtos/config.dto.ts`: 39% | none |
| `dtos/model-config.dto.ts` (smart-info) | the same commit | 4 of its 24 lines, into `dtos/config.dto.ts` | none |
| `dtos/audit.dto.ts` (audit) | `094a41ac9a` (2025-04-30, "remove audit file report") deleted it | nowhere | none |
| `services/audit.service.ts` (audit) | cut down to the audit-log cleanup job by `094a41ac9a`, then deleted with the audit table by `d410131312` (2026-04-15, "remove old timeline sync endpoints") | nowhere | none |

The threshold is rule 3's 75%. Only the two server-info renames pass. Both are renames git finds by itself, at 100%
and 97%. The three merges fall well below it, with rule 3 shares of 39% to 47%. (Rule 3's share counts a receiving file's
lines found in any of the feature's labeled files, a line also found elsewhere by half; a plain count of the lines
that come from the one deleted file gives other numbers, about 30% to 60% depending on what counts as a line, and
none near 75%.) Whether `utils/access.ts` "is" the
access core is a judgment call: the commit says it is, but more than half of its lines were rewritten, and the rule
counts only verbatim lines. Two features drop out. `access` lost its only file. `audit` was removed from immich.

**Splits.** Since 2024, several new files have been carved out of labeled ones. Rule 3 decides those too. It labels
one:

- `dtos/session.dto.ts` is labeled **auth**, at exactly the threshold. `4478e524f8` (2024-04-19, "refactor(server):
  sessions") made it from `auth.dto.ts`'s device DTO, renamed to `SessionResponseDto`. 10 of its 12 lines are
  `auth.dto.ts`'s, but 2 of them also appear in an unlabeled entity, so those count half: 9 of 12 is 0.75. One line
  fewer and it would be unlabeled. The session service and controller created in the same commit stay unlabeled.

The rule turns down these (feature share at creation):

| File | Created by | Share |
|---|---|---|
| `services/queue.service.ts` | `d784d431d0` (2025-11-14, "job vs queue naming") | job 73% |
| `services/timeline.service.ts` | `b8c5363a15` (2024-03-29, "move timeline operations to their own controller/service") | asset 66% |
| `services/duplicate.service.ts` | `ff52300624` (2024-05-16, "duplicate controller and service") | search 60% |
| `services/user-admin.service.ts` | `75830a4878` (2024-05-26, "user endpoints") | user 59% |
| `dtos/asset-media.dto.ts` | `4f21f6a2e1` (2024-05-23, "API operation replaceAsset") | asset 58% |
| `dtos/queue.dto.ts` | `d784d431d0` (2025-11-14, "job vs queue naming"), out of `dtos/job.dto.ts` | job 31% (its identifiers were renamed from job to queue) |

Three of them (queue, timeline, duplicate) are the kind of file whose 2024 feature its name doesn't reveal. All six
stay out because they are new files that also hold new code, and 75% is the bar G2 set before any of this was looked
at.

### What the key covers

47 of the 269 movable files (17.5%), in 23 features:

| Folder | Labeled / movable |
|---|---|
| `services/` | 23 / 55 |
| `dtos/` | 22 / 52 |
| `cores/` | 1 / 1 |
| `utils/` | 1 / 31 |
| `repositories/` | 0 / 55 |
| `controllers/` | 0 / 47 |
| `commands/` | 0 / 10 |
| `middleware/` | 0 / 7 |
| root (`src/*.ts`) | 0 / 7 |
| `maintenance/` | 0 / 4 |

- **Feature sizes.** asset has 7 files, auth and user 3 each, and 14 features have 2 (activity, album, api-key,
  download, job, library, media, partner, person, search, server-info, shared-link, storage, tag). The other 6 have a
  single file each: database, metadata, smart-info, storage-template, system-config and trash. A one-file feature
  tests only that its file isn't grouped with another labeled feature's files.
- **Names.** 41 of the 47 files name their feature in the file name (the stem is the feature or starts with
  `<feature>-`, as in G2's prefix rule). The 6 that don't are `exif.dto.ts`, `stack.dto.ts` and `time-bucket.dto.ts`
  (asset), `server.dto.ts` and `server.service.ts` (server-info), and `session.dto.ts` (auth).
- **Dropped:** of G2's 53 files, 9 left their path and 2 of those were followed by rename; of its 25 features,
  `access` and `audit` (see the table above). One file was added: `session.dto.ts`.

### Tests

The bench's movable files contain no tests. `src/planner/facts.ts` takes tests out of the candidates, and a test
moves with its subject (`FileFact.tests`) or stays pinned. So the key leaves tests out. 24 tests move with labeled
files. The walk labels 26 tests: G2's 26, minus `audit.service.spec.ts`, plus `timeline.service.spec.ts` (asset 76%,
whose subject falls below the rule). The script prints them but doesn't write them to the key.

### What it can't measure

- **Only the domain layer.** Services, DTOs, one core and one util carry labels. Controllers (47), repositories (55),
  commands, middleware and shared code carry none. Those are the files where planners differ, so the key says nothing
  about them.
- **Names give it away.** 41 of the 47 files name their feature, so every reasonable method lands near the top. On the
  2024 snapshot, G2's name-token baseline scored 91.7 and its LLM planner 93.8. MoJoFM over this key mostly checks
  that no method separates `album.service.ts` from `album.dto.ts`.
- **2024's layout, which the maintainers then left.** The features are 2024's: `server-info` (now `server.*`) and
  `smart-info`. Where immich split a feature since (sessions out of auth, queue out of job, timeline out of asset), the
  key still holds the 2024 grouping, or none at all. A plan that follows today's code can lose points for it. Two
  labels ride on a path whose March 2024 DTOs are gone (`job.dto.ts`, `stack.dto.ts`, above), and 8 on a path or a
  rename with no verbatim 2024 line left.
- **Verbatim lines only.** Code that moved but was rewritten, such as re-indented or turned from a class into
  functions, counts as new. That is why `utils/access.ts` stays unlabeled. Fuzzier matching would label more files,
  but it would also need a threshold of its own.
- **One file sits on the threshold** (`session.dto.ts`, see above).

### Reproduce

The script runs only read-only git commands, but it needs every blob under `server/` between the two commits. A
`blob:none` clone fetches missing blobs one at a time, into its own object store. Prefetch them in one request
instead:

```sh
C=/tmp/immich-history
git clone -q --filter=blob:none --no-checkout https://github.com/immich-app/immich.git "$C"
{ git -C "$C" ls-tree -r 40262c30cb7d43e059a3dbe0a146a5dd988ab0e6 -- server/src | awk '$2 == "blob" {print $3}'
  git -C "$C" rev-list --objects --missing=print 40262c30cb7d43e059a3dbe0a146a5dd988ab0e6..02063972e82b1bfd17b6fc2e3b3ff39936229ea5 -- server | sed -n 's/^?//p'
} | git -C "$C" -c fetch.negotiationAlgorithm=noop fetch -q origin --no-tags --no-write-fetch-head \
      --recurse-submodules=no --filter=blob:none --stdin
python3 bench/ground-truth/derive-immich-2024.py "$C"                 # writes the .rsf and .tsv next to the script
python3 bench/ground-truth/derive-immich-2024.py "$C" --at 6e93ddf2   # G2's mapping, printed only
```

The clone takes about 40 MB, and the walk takes under half a minute. From a fresh clone (2026-10-29), it rewrote
both files byte for byte. The printed report also lists every labeled file that was deleted without a rename and
where its lines went, plus every content share between 50% and 75% the rule turned down.
