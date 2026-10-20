# ac run: `server/` @ `02063972e8` on `ac/s6-ladder`

- Status: **completed** (exit 0)
- Repository `/home/paseo/ac-work/s6/final-immich`, environment `/home/paseo/ac-targets/immich`, profile `immich`
- Plan: `planner` (sha256 `b4c7c548883c`), 59 steps, 367 moves
- Commits: `02063972e8` → `c4be040b57`
- Wall time: **1 h 55 m** (preflight 13.4 s, baseline 3 m 43 s, steps 1 h 34 m, rung certificates 13 m 19 s, whole-PR certificate 2 m 35 s)
- Cost: planner LLM spend of this run $0.0000 (budget run `s6`); findings narration $0.0010 in 2 calls when recorded (replayed: $0 now); the plan cost $0.1998 when it was recorded
- Whole PR: **PASS** (full) `certificate.json`, digest `sha256:9a5b2404631c`

## Rungs

| Rung | Status | Steps | Commits | Certificate | Duration |
|---|---|---|---|---|---|
| R0 | passed | – | – | – | 3 m 56 s |
| R1 | certified | 38 (38 certified, 0 pinned, 0 skipped) | 38 | PASS (full) `rungs/R1.json` | 1 h 00 m |
| R2 | certified | 21 (21 certified, 0 pinned, 0 skipped) | 21 | PASS (full) `rungs/R2.json` | 35 m 37 s |
| R3 | certified | 3 (3 certified, 0 pinned, 0 skipped) | 3 | PASS (full) `rungs/R3.json` | 7 m 49 s |
| R4 | certified | 1 (1 certified, 0 pinned, 0 skipped) | 1 | PASS (full) `rungs/R4.json` | 4 m 40 s |

## Steps

| # | Rung | Group | Outcome | Attempts | Files moved | Specifier edits | Move | Certify | Total | Certificate |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | R1 | module/activity | certified | 1 | 6 | 17 in 12 files | 8.6 s | 2 m 13 s | 2 m 21 s | PASS `909262855d` |
| 2 | R1 | module/album | certified | 1 | 7 | 36 in 25 files | 8.8 s | 1 m 19 s | 1 m 28 s | PASS `1ebedaefc4` |
| 3 | R1 | module/api-key | certified | 1 | 6 | 14 in 11 files | 8.6 s | 1 m 19 s | 1 m 28 s | PASS `fd9e7e9b81` |
| 4 | R1 | module/asset | certified | 1 | 24 | 210 in 120 files | 10.2 s | 1 m 21 s | 1 m 31 s | PASS `1b81fb81f2` |
| 5 | R1 | module/auth | certified | 1 | 15 | 177 in 117 files | 10.2 s | 1 m 20 s | 1 m 30 s | PASS `e66b3538df` |
| 6 | R1 | module/cluster-group | certified | 1 | 4 | 14 in 12 files | 8.7 s | 1 m 21 s | 1 m 30 s | PASS `b0fd9e0919` |
| 7 | R1 | module/config | certified | 1 | 10 | 66 in 49 files | 9.3 s | 1 m 21 s | 1 m 30 s | PASS `a514c0d32d` |
| 8 | R1 | module/database-backup | certified | 1 | 6 | 15 in 10 files | 8.7 s | 1 m 20 s | 1 m 29 s | PASS `9aaae7b61c` |
| 9 | R1 | module/download | certified | 1 | 6 | 12 in 9 files | 8.6 s | 1 m 19 s | 1 m 28 s | PASS `d622988809` |
| 10 | R1 | module/duplicate | certified | 1 | 8 | 16 in 12 files | 8.9 s | 1 m 20 s | 1 m 29 s | PASS `9716936939` |
| 11 | R1 | module/integrity | certified | 1 | 5 | 12 in 10 files | 8.9 s | 1 m 20 s | 1 m 29 s | PASS `18639561a6` |
| 12 | R1 | module/job | certified | 1 | 6 | 24 in 22 files | 8.8 s | 1 m 20 s | 1 m 29 s | PASS `7586bf31ee` |
| 13 | R1 | module/library | certified | 1 | 5 | 19 in 14 files | 9.0 s | 1 m 20 s | 1 m 29 s | PASS `5f4a8c2859` |
| 14 | R1 | module/machine-learning | certified | 1 | 1 | 10 in 10 files | 8.7 s | 1 m 20 s | 1 m 29 s | PASS `78e92bbee7` |
| 15 | R1 | module/maintenance | certified | 1 | 13 | 42 in 25 files | 9.4 s | 1 m 19 s | 1 m 29 s | PASS `19d4f2d25e` |
| 16 | R1 | module/map | certified | 1 | 6 | 15 in 13 files | 8.9 s | 1 m 19 s | 1 m 28 s | PASS `c7010d48a6` |
| 17 | R1 | module/memory | certified | 1 | 6 | 18 in 15 files | 8.8 s | 1 m 19 s | 1 m 28 s | PASS `635253430a` |
| 18 | R1 | module/notification | certified | 1 | 12 | 35 in 21 files | 9.3 s | 1 m 19 s | 1 m 28 s | PASS `df5c32a7fd` |
| 19 | R1 | module/ocr | certified | 1 | 4 | 17 in 16 files | 8.8 s | 1 m 20 s | 1 m 29 s | PASS `e809b3f2a5` |
| 20 | R1 | module/partner | certified | 1 | 6 | 23 in 19 files | 9.0 s | 1 m 19 s | 1 m 28 s | PASS `41ce2ac126` |
| 21 | R1 | module/person | certified | 1 | 8 | 52 in 31 files | 9.3 s | 1 m 19 s | 1 m 28 s | PASS `b0b2ada7c8` |
| 22 | R1 | module/plugin | certified | 1 | 7 | 24 in 20 files | 9.0 s | 1 m 20 s | 1 m 29 s | PASS `770eaff65c` |
| 23 | R1 | module/queue | certified | 1 | 5 | 15 in 11 files | 8.9 s | 1 m 19 s | 1 m 28 s | PASS `4d14515931` |
| 24 | R1 | module/search | certified | 1 | 12 | 30 in 19 files | 9.6 s | 1 m 22 s | 1 m 32 s | PASS `265a27a32e` |
| 25 | R1 | module/server | certified | 1 | 5 | 15 in 12 files | 9.1 s | 1 m 21 s | 1 m 30 s | PASS `545f662ce9` |
| 26 | R1 | module/session | certified | 1 | 5 | 14 in 13 files | 9.0 s | 1 m 19 s | 1 m 28 s | PASS `cf929b5b12` |
| 27 | R1 | module/shared-link | certified | 1 | 7 | 25 in 15 files | 9.3 s | 1 m 21 s | 1 m 31 s | PASS `564f26960d` |
| 28 | R1 | module/stack | certified | 1 | 6 | 17 in 14 files | 9.3 s | 1 m 21 s | 1 m 31 s | PASS `bb1ddf305d` |
| 29 | R1 | module/sync | certified | 1 | 8 | 28 in 16 files | 9.4 s | 1 m 21 s | 1 m 31 s | PASS `97f130ff95` |
| 30 | R1 | module/system-metadata | certified | 1 | 7 | 33 in 30 files | 9.6 s | 1 m 21 s | 1 m 31 s | PASS `a5c2078b59` |
| 31 | R1 | module/tag | certified | 1 | 8 | 28 in 22 files | 9.5 s | 1 m 21 s | 1 m 31 s | PASS `f6df30cfea` |
| 32 | R1 | module/timeline | certified | 1 | 6 | 10 in 8 files | 9.0 s | 1 m 20 s | 1 m 29 s | PASS `9fa6c74137` |
| 33 | R1 | module/trash | certified | 1 | 6 | 11 in 9 files | 9.1 s | 1 m 20 s | 1 m 29 s | PASS `4710fd16f9` |
| 34 | R1 | module/user | certified | 1 | 19 | 84 in 55 files | 10.2 s | 1 m 24 s | 1 m 34 s | PASS `05d6528809` |
| 35 | R1 | module/version | certified | 1 | 4 | 12 in 11 files | 9.2 s | 1 m 23 s | 1 m 33 s | PASS `5e90d7f6c8` |
| 36 | R1 | module/video-stream | certified | 1 | 5 | 8 in 7 files | 9.2 s | 1 m 22 s | 1 m 31 s | PASS `06e897d20c` |
| 37 | R1 | module/view | certified | 1 | 4 | 7 in 7 files | 9.2 s | 1 m 22 s | 1 m 32 s | PASS `7c78bd44ab` |
| 38 | R1 | module/workflow | certified | 1 | 8 | 22 in 15 files | 9.2 s | 1 m 21 s | 1 m 30 s | PASS `87ea639f64` |
| 39 | R2 | platform/access | certified | 1 | 3 | 38 in 35 files | 9.6 s | 1 m 23 s | 1 m 33 s | PASS `5f9001a454` |
| 40 | R2 | platform/bootstrap | certified | 1 | 3 | 4 in 4 files | 9.1 s | 1 m 23 s | 1 m 32 s | PASS `97af69aa16` |
| 41 | R2 | platform/check | certified | 1 | 1 | 1 in 1 files | 8.8 s | 1 m 24 s | 1 m 33 s | PASS `9f7847f151` |
| 42 | R2 | platform/cron | certified | 1 | 1 | 7 in 7 files | 8.9 s | 1 m 23 s | 1 m 33 s | PASS `2eceadab13` |
| 43 | R2 | platform/crypto | certified | 1 | 1 | 12 in 12 files | 9.0 s | 1 m 23 s | 1 m 32 s | PASS `9278b63721` |
| 44 | R2 | platform/database | certified | 1 | 4 | 104 in 87 files | 10.1 s | 1 m 22 s | 1 m 33 s | PASS `02b9e74571` |
| 45 | R2 | platform/event | certified | 1 | 2 | 43 in 42 files | 9.5 s | 1 m 23 s | 1 m 32 s | PASS `bfe9c5cef8` |
| 46 | R2 | platform/file | certified | 1 | 2 | 27 in 25 files | 9.4 s | 1 m 23 s | 1 m 33 s | PASS `8107244c66` |
| 47 | R2 | platform/http-client | certified | 1 | 2 | 2 in 2 files | 9.0 s | 1 m 23 s | 1 m 32 s | PASS `6892882b6e` |
| 48 | R2 | platform/http-response | certified | 1 | 1 | 8 in 8 files | 8.9 s | 1 m 22 s | 1 m 31 s | PASS `20bf2ba2a0` |
| 49 | R2 | platform/logging | certified | 1 | 6 | 111 in 104 files | 10.1 s | 1 m 23 s | 1 m 33 s | PASS `b3c0561f18` |
| 50 | R2 | platform/media | certified | 1 | 8 | 15 in 14 files | 9.6 s | 1 m 23 s | 1 m 33 s | PASS `79c8b8b7a9` |
| 51 | R2 | platform/metadata | certified | 1 | 4 | 15 in 11 files | 9.3 s | 1 m 22 s | 1 m 31 s | PASS `1dc3abdb72` |
| 52 | R2 | platform/move | certified | 1 | 1 | 4 in 4 files | 9.0 s | 1 m 22 s | 1 m 31 s | PASS `f53cddd6e4` |
| 53 | R2 | platform/process | certified | 1 | 2 | 7 in 7 files | 9.1 s | 1 m 22 s | 1 m 31 s | PASS `7996d66314` |
| 54 | R2 | platform/registry | certified | 1 | 7 | 74 in 71 files | 10.6 s | 1 m 22 s | 1 m 33 s | PASS `821b5e167a` |
| 55 | R2 | platform/storage | certified | 1 | 7 | 55 in 45 files | 10.0 s | 1 m 22 s | 1 m 33 s | PASS `5b7d8e3365` |
| 56 | R2 | platform/telemetry | certified | 1 | 2 | 10 in 10 files | 9.4 s | 1 m 22 s | 1 m 31 s | PASS `514d1bd551` |
| 57 | R2 | platform/transcoding | certified | 1 | 2 | 2 in 2 files | 9.2 s | 1 m 21 s | 1 m 31 s | PASS `f64c793d74` |
| 58 | R2 | platform/websocket | certified | 1 | 2 | 8 in 8 files | 9.3 s | 1 m 22 s | 1 m 32 s | PASS `c4193cd30f` |
| 59 | R2 | shared/shared | certified | 1 | 20 | 700 in 411 files | 13.0 s | 1 m 22 s | 1 m 36 s | PASS `c974d003c3` |
| 60 | R3 | module/search | certified | 1 | 2 | 2 in 2 files | 8.8 s | 1 m 21 s | 1 m 30 s | PASS `b775e6f44e` |
| 61 | R3 | module/view | certified | 1 | 1 | 3 in 3 files | 9.1 s | 1 m 21 s | 1 m 31 s | PASS `70dc3f40d8` |
| 62 | R3 | shared/shared | certified | 1 | 2 | 13 in 13 files | 9.2 s | 1 m 21 s | 1 m 30 s | PASS `9457bec5a0` |
| 63 | R4 | boundaries | certified | 1 | – | – | 0.0 s | 4 m 16 s | 0.0 s | PASS `c57590c655` |

## Totals

- 63 certified commits, 0 steps pinned, 0 skipped, 0 pending
- 372 files moved, 2492 specifier edits
- 63 attempts: 0 declined by the executor, 0 failed certification (rolled back), 0 interrupted
- 0 files pinned

## Findings

45 findings, recorded and never fixed. Full log: `findings/findings.md`; as JSON: `findings/findings.json`.

Narration: Nemotron 3.5 Lightning (thinking off) wrote 1–2 sentences for 35 findings in 2 calls ($0.0010 when recorded, replayed now), 4 dropped by the guard and 1 not returned by the model (they keep their evidence only). Text only, under a lexical guard: it drops any narration naming a path, code identifier, capitalized name, the name in "the <name> table/module/class/…", or number (digits, or words up to twenty) that its evidence doesn't contain. It checks words, not claims: a number or name from the evidence can still be put to the wrong use.

| Kind | Findings | Source |
|---|---|---|
| Module cycles | 2 | boundaries |
| God injection | 1 | facts |
| Tables written by several groups | 3 | facts |
| Back-edges against the boundary order | 8 | boundaries |
| Coverage globs match other files, with no gate | 1 | run |
| Coverage globs match other files | 1 | certificate |
| Emit without a rootDir | 1 | certificate |
| Docs name old paths | 3 | certificate |
| A module loaded by a computed path | 1 | certificate |
| Stack-trace text names moved paths | 12 | certificate |
| Inert tool config added | 2 | certificate |
| Plan validator warnings | 10 | validator |

Top 8:

1. **42 folders form one import cycle**: The R4 report shows that 42 out of 73 folders are strongly connected through imports, each reaching every other. With 328 edges over 1025 files inside the set, these 91 edges spanning 174 files are the only back-edges that close the cycles; removing them leaves the collection acyclic.

   <details><summary>Evidence</summary>

   ```text
   42 of 73 folders are strongly connected (from R4's boundary report (boundaries/report.json)): each reaches every other through imports.
   Members: module/album, module/asset, module/auth, module/config, module/database-backup, module/job, module/library, module/machine-learning, module/maintenance, module/map, module/ocr, module/partner, module/person, module/plugin, module/queue, module/search, module/server, module/session, module/shared-link, module/system-metadata, module/tag, module/user, module/version, module/workflow, other:src, other:src/maintenance, other:src/repositories, other:src/schema, other:src/schema/tables, other:src/services, other:src/utils, platform/access, platform/cron, platform/database, platform/event, platform/file, platform/http-response, platform/logging, platform/media, platform/move, platform/storage, shared.
   Inside the set: 328 edges between them over 1025 files. These 91 edges (174 files) close every cycle (R4's back-edges first); without them the set is acyclic:
   - other:src/schema/tables → other:src/schema (21 files, e.g. server/src/schema/tables/album-asset.table.ts → server/src/schema/functions.ts)
   - module/person → module/asset (6 files, e.g. server/src/modules/person/person.controller.ts → server/src/modules/asset/asset-ids.response.dto.ts)
   - module/album → module/asset (5 files, e.g. server/src/modules/album/album.controller.ts → server/src/modules/asset/asset-ids.response.dto.ts)
   - module/search → module/asset (5 files, e.g. server/src/modules/search/search.controller.ts → server/src/modules/asset/asset-response.dto.ts)
   - module/shared-link → module/asset (5 files, e.g. server/src/modules/shared-link/shared-link.controller.ts → server/src/modules/asset/asset-ids.response.dto.ts)
   - platform/database → other:src/schema/tables (5 files, e.g. server/src/platform/database/database.ts → server/src/schema/tables/album.table.ts)
   - module/auth → module/user (4 files, e.g. server/src/modules/auth/auth.controller.ts → server/src/modules/user/user.dto.ts)
   - module/user → module/asset (4 files, e.g. server/src/modules/user/user-admin.controller.ts → server/src/modules/asset/asset.dto.ts)
   - platform/access → module/person (4 files, e.g. server/src/platform/access/access.repository.ts → server/src/modules/person/person.dto.ts)
   - platform/media → module/asset (4 files, e.g. server/src/platform/media/media.repository.ts → server/src/modules/asset/editing.dto.ts)
   - module/album → other:src/schema/tables (3 files, e.g. server/src/modules/album/album-user.repository.ts → server/src/schema/tables/album-user.table.ts)
   - module/server → module/user (3 files, e.g. server/src/modules/server/server.controller.ts → server/src/modules/user/license.dto.ts)
   - module/shared-link → other:src/schema/tables (3 files, e.g. server/src/modules/shared-link/shared-link.repository.ts → server/src/schema/tables/asset-exif.table.ts)
   - module/tag → module/asset (3 files, e.g. server/src/modules/tag/tag.controller.ts → server/src/modules/asset/asset-ids.response.dto.ts)
   - platform/file → module/asset (3 files, e.g. server/src/platform/file/file-upload.interceptor.ts → server/src/modules/asset/asset-media.dto.ts)
   - … 76 more edges (96 files)
   ```

   </details>

2. **BaseService injects 56 members into 51 classes**: BaseService receives 56 constructor-injected members, and 51 classes extend it so each inherits all 56; on average a subclass reads 5.7 of them, and the most-read members such as logger and repositories are accessed by many classes.

   <details><summary>Evidence</summary>

   ```text
   BaseService (server/src/services/base.service.ts) takes 56 constructor-injected members (56 of them repositories), and 51 classes extend it, so each receives all 56.
   Each subclass reads 5.7 of them on average through this.<member> (median 5, min 1, max 15 in MetadataService); every member has a reader.
   Most read: logger (33 classes), jobRepository (23 classes), assetRepository (21 classes), eventRepository (18 classes), userRepository (18 classes).
   Per class (members read of 56):
   - MetadataService (server/src/services/metadata.service.ts): 15 (albumRepository, assetJobRepository, assetRepository, cryptoRepository, databaseRepository, eventRepository, jobRepository, logger, … 7 more)
   - PersonService (server/src/services/person.service.ts): 15 (assetJobRepository, assetRepository, clusterGroupRepository, cryptoRepository, databaseRepository, jobRepository, logger, machineLearningRepository, … 7 more)
   - AssetService (server/src/services/asset.service.ts): 13 (albumRepository, assetEditRepository, assetJobRepository, assetRepository, eventRepository, jobRepository, logger, ocrRepository, … 5 more)
   - AuthService (server/src/services/auth.service.ts): 10 (apiKeyRepository, cryptoRepository, eventRepository, jobRepository, logger, mediaRepository, oauthRepository, sessionRepository, … 2 more)
   - LibraryService (server/src/services/library.service.ts): 10 (assetJobRepository, assetRepository, cronRepository, cryptoRepository, databaseRepository, eventRepository, jobRepository, libraryRepository, … 2 more)
   - UserService (server/src/services/user.service.ts): 10 (albumRepository, assetRepository, configRepository, cryptoRepository, eventRepository, jobRepository, logger, mediaRepository, … 2 more)
   - CliService (server/src/services/cli.service.ts): 9 (appRepository, assetRepository, cryptoRepository, databaseRepository, personRepository, sessionRepository, storageRepository, systemMetadataRepository, … 1 more)
   - DuplicateService (server/src/services/duplicate.service.ts): 9 (albumRepository, assetJobRepository, assetRepository, cryptoRepository, duplicateRepository, eventRepository, jobRepository, logger, … 1 more)
   - IntegrityService (server/src/services/integrity.service.ts): 9 (assetRepository, cronRepository, databaseRepository, eventRepository, integrityRepository, jobRepository, logger, storageRepository, … 1 more)
   - NotificationService (server/src/services/notification.service.ts): 9 (albumRepository, assetJobRepository, assetRepository, emailRepository, jobRepository, logger, notificationRepository, userRepository, … 1 more)
   - VersionService (server/src/services/version.service.ts): 9 (configRepository, cronRepository, databaseRepository, jobRepository, logger, serverInfoRepository, systemMetadataRepository, versionRepository, … 1 more)
   - MediaService (server/src/services/media.service.ts): 8 (assetJobRepository, assetRepository, jobRepository, logger, mediaRepository, ocrRepository, personRepository, storageRepository)
   - MemoryService (server/src/services/memory.service.ts): 8 (accessRepository, assetRepository, databaseRepository, logger, memoryRepository, personRepository, systemMetadataRepository, userRepository)
   - StorageTemplateService (server/src/services/storage-template.service.ts): 8 (albumRepository, assetJobRepository, databaseRepository, jobRepository, logger, moveRepository, storageRepository, userRepository)
   - UserAdminService (server/src/services/user-admin.service.ts): 8 (albumRepository, assetRepository, cryptoRepository, eventRepository, jobRepository, logger, sessionRepository, userRepository)
   - WorkflowExecutionService (server/src/services/workflow-execution.service.ts): 8 (configRepository, cryptoRepository, databaseRepository, jobRepository, logger, pluginRepository, storageRepository, workflowRepository)
   … 35 more lines in findings/findings.md
   ```

   </details>

3. **Table asset is written by 4 groups**: The table asset is written by four files located in four separate plan groups: module/asset, module/duplicate, module/stack, and module/trash.

   <details><summary>Evidence</summary>

   ```text
   Table asset is written by 4 files in 4 plan groups (and read by 23 files in 22 groups):
   - module/asset: server/src/repositories/asset.repository.ts
   - module/duplicate: server/src/repositories/duplicate.repository.ts
   - module/stack: server/src/repositories/stack.repository.ts
   - module/trash: server/src/repositories/trash.repository.ts
   ```

   </details>

4. **Back-edge module/auth → module/user**: Module auth imports module user in four files, which violates the allow-list encoded in R4's module order; R4's baseline records this as a known violation.

   <details><summary>Evidence</summary>

   ```text
   module/auth imports module/user in 4 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
   - server/src/modules/auth/auth.controller.ts → server/src/modules/user/user.dto.ts
   - server/src/modules/auth/auth.service.ts → server/src/modules/user/profile-image.ts
   - server/src/modules/auth/auth.service.ts → server/src/modules/user/user.dto.ts
   ```

   </details>

5. **Coverage globs match other files, with no gate: server/test/vitest.config.mjs**: The vitest config contains six distinct coverage-glob findings that match 107 steps, but no threshold or check gates the coverage, so the globs match differently for moved service and utility files without enforcing any rule.

   <details><summary>Evidence</summary>

   ```text
   The run recorded 6 distinct findings in server/test/vitest.config.mjs, 107 times (steps 1–13, 15–39, 44–51, 54–57, 59):
   - server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/services/**' (server/src/services/**) matches differently for server/src/services/activity.service.ts (moving to server/src/modules/activity/activity.service.ts), server/src/services/activity.service.spec.ts (moving t… (steps 1–13, 15–38, 44, 50–51, 54–57, 59)
   - server/test/vitest.config.mjs line 21 [test.coverage.exclude]: coverage glob 'src/services/*.spec.ts' (server/src/services/*.spec.ts) matches differently for server/src/services/activity.service.spec.ts (moving to server/src/modules/activity/activity.service.spec.ts); nothing in server/test/vitest.… (steps 1–5, 7–12, 15–21, 23–37, 44, 50–51, 55, 57, 59)
   - server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/utils/**' (server/src/utils/**) matches differently for server/src/utils/asset.util.ts (moving to server/src/modules/asset/asset.util.ts); nothing in server/test/vitest.config.mjs gates coverage (no threshold or check… (steps 4, 7–8, 10, 15, 24, 29, 31, 34, 38–39, 44–51, 59)
   - server/test/vitest.config.mjs line 24 [test.coverage.exclude]: coverage glob 'src/services/index.ts' matches differently for server/src/services/index.ts (moving to server/src/platform/registry/services/index.ts); nothing in server/test/vitest.config.mjs gates coverage (no threshold or check-covera… (step 54)
   - server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/cores/**' (server/src/cores/**) matches differently for server/src/cores/storage.core.ts (moving to server/src/platform/storage/storage.core.ts), server/src/cores/storage.core.spec.ts (moving to server/src/platform/st… (step 55)
   - server/test/vitest.config.mjs line 22 [test.coverage.exclude]: coverage glob 'src/services/api.service.ts' matches differently for server/src/services/api.service.ts (moving to server/src/shared/api.service.ts); nothing in server/test/vitest.config.mjs gates coverage (no threshold or check-coverage… (step 59)
   ```

   </details>

6. **Coverage globs match other files (K4): server/test/vitest.config.mjs**: K4 reported six distinct coverage-glob findings in the vitest config that match 122 steps across certificate.json and rung JSON files, where globs such as 'src/services/**' change matches when files move to module folders.

   <details><summary>Evidence</summary>

   ```text
   K4 reported 6 distinct findings in server/test/vitest.config.mjs, 122 times (steps 1–13, 15–39, 44–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json):
   - line 19: 'src/services/**' is the glob server/src/services/** whose matches change (2 moved files, e.g. server/src/services/activity.service.spec.ts -> server/src/modules/activity/activity.service.spec.ts) of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activit… (steps 1–13, 15–38, 44, 50–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json)
   - line 21: 'src/services/*.spec.ts' is the glob server/src/services/*.spec.ts whose matches change (1 moved files, e.g. server/src/services/activity.service.spec.ts -> server/src/modules/activity/activity.service.spec.ts) of server/src/services/activity.service.spec.ts (moved to server/src/modules/ac… (steps 1–5, 7–12, 15–21, 23–37, 44, 50–51, 55, 57, 59, certificate.json, rungs/R1.json, rungs/R2.json)
   - line 19: 'src/utils/**' is the glob server/src/utils/** whose matches change (1 moved files, e.g. server/src/utils/asset.util.ts -> server/src/modules/asset/asset.util.ts) of server/src/utils/asset.util.ts (moved to server/src/modules/asset/asset.util.ts) [config at test.coverage.include]; coverage… (steps 4, 7–8, 10, 15, 24, 29, 31, 34, 38–39, 44–51, 59, certificate.json, rungs/R1.json, rungs/R2.json)
   - line 24: 'src/services/index.ts' is the old path of server/src/services/index.ts (moved to server/src/platform/registry/services/index.ts) [config at test.coverage.exclude]; coverage now measures a different file set (no coverage threshold in this file, so no gate changes) (step 54, certificate.json, rungs/R2.json)
   - line 19: 'src/cores/**' is the glob server/src/cores/** whose matches change (2 moved files, e.g. server/src/cores/storage.core.spec.ts -> server/src/platform/storage/storage.core.spec.ts) of server/src/cores/storage.core.spec.ts (moved to server/src/platform/storage/storage.core.spec.ts) [config a… (step 55, certificate.json, rungs/R2.json)
   - line 22: 'src/services/api.service.ts' is the old path of server/src/services/api.service.ts (moved to server/src/shared/api.service.ts) [config at test.coverage.exclude]; coverage now measures a different file set (no coverage threshold in this file, so no gate changes) (step 59, certificate.json, rungs/R2.json)
   ```

   </details>

7. **Emit without a rootDir (K7): e2e/tsconfig.json**: The e2e tsconfig emits into e2e/dist without specifying a rootDir, so TypeScript uses its default of e2e for both the input and output, a situation recorded 67 times across steps and rung files.

   <details><summary>Evidence</summary>

   ```text
   K7 reported one finding in e2e/tsconfig.json, 67 times (steps 1–62, certificate.json, rungs/R1.json, rungs/R2.json, rungs/R3.json, rungs/R4.json):
   - emits into e2e/dist without a rootDir; TypeScript 6.0+ and before 6.0's default stays e2e and e2e (steps 1–62, certificate.json, rungs/R1.json, rungs/R2.json, rungs/R3.json, rungs/R4.json)
   ```

   </details>

8. **Docs name old paths (K4): docs/docs/developer/architecture.mdx**

   <details><summary>Evidence</summary>

   ```text
   K4 reported 3 distinct findings in docs/docs/developer/architecture.mdx, 138 times (steps 1–40, 42–45, 49–59, certificate.json, rungs/R1.json, rungs/R2.json):
   - line 60: 'src/repositories' is the directory server/src/repositories, whose contents change with the move of server/src/repositories/activity.repository.ts (moved to server/src/modules/activity/activity.repository.ts) (steps 1–6, 9–22, 24–31, 33–39, 42–43, 45, 49–56, 58, certificate.json, rungs/R1.json, rungs/R2.json)
   - line 60: 'src/services' is the directory server/src/services, whose contents change with the move of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activity.service.spec.ts) (steps 1–13, 15–38, 44, 50–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json)
   - line 64: 'src/controllers' is the directory server/src/controllers, whose contents change with the move of server/src/controllers/activity.controller.spec.ts (moved to server/src/modules/activity/activity.controller.spec.ts) (steps 1–13, 15–18, 20–34, 36–38, 40, 54, certificate.json, rungs/R1.json, rungs/R2.json)
   ```

   </details>

