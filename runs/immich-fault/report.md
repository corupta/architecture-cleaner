# ac run: `server/` @ `02063972e8` on `ac/s7-fault`

- Status: **stopped** (exit 0)
- Repository `/home/paseo/ac-work/s7/fault-immich`, environment `/home/paseo/ac-targets/immich`, profile `immich`
- Plan: `/workspace/architecture-cleaner/runs/immich-ladder/plan/plan.yaml` (sha256 `b4c7c548883c`), 59 steps, 367 moves
- Commits: `02063972e8` → `ac51228171`
- Wall time: **13 m 37 s** (preflight 14.2 s, baseline 3 m 50 s, steps 7 m 11 s, rung certificates 2 m 22 s, whole-PR certificate 0.0 s)
- Cost: planner LLM spend of this run $0.0000 (no planner call: the plan came from a file); the plan cost $0.1998 when it was recorded
- Injected fault (`--inject-fault 2:M2`): applied to step 2, M2 (Drop one importer rewrite): server/src/services/workflow-execution.service.ts: import specifier 'src/modules/album/album.dto.js' left as in base, 'src/dtos/album.dto.js'; the step ended certified

## Rungs

| Rung | Status | Steps | Commits | Certificate | Duration |
|---|---|---|---|---|---|
| R0 | passed | – | – | – | 4 m 04 s |
| R1 | running | 38 (3 certified, 0 pinned, 0 skipped, 35 pending) | 3 | PASS (full, partial) `rungs/R1.json` | 9 m 33 s |
| R2 | not-requested | 21 (0 certified, 0 pinned, 0 skipped, 21 pending) | 0 | – | 0.0 s |
| R3 | not-requested | 0 (0 certified, 0 pinned, 0 skipped) | 0 | – | 0.0 s |
| R4 | not-requested | 0 (0 certified, 0 pinned, 0 skipped) | 0 | – | 0.0 s |

## Steps

| # | Rung | Group | Outcome | Attempts | Files moved | Specifier edits | Move | Certify | Total | Certificate |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | R1 | module/activity | certified | 1 | 6 | 17 in 12 files | 8.8 s | 2 m 16 s | 2 m 25 s | PASS `909262855d` |
| 2 | R1 | module/album | certified after 1 replan, injected fault | 2 | 6 | 28 in 20 files | 18.3 s | 2 m 45 s | 3 m 15 s | PASS `78e6b72fe0` |
| 3 | R1 | module/api-key | certified | 1 | 6 | 14 in 11 files | 8.9 s | 1 m 22 s | 1 m 31 s | PASS `5791cb1a9e` |

### Failed attempts

| # | Attempt | State | Pinned | Detail |
|---|---|---|---|---|
| 2 | 1 (injected fault) | failed | 1 | certificate FAIL (K3a, K3b, K3c): K3a server/src/services/workflow-execution.service.ts: line 14: import 'src/dtos/album.dto.js': expected file server/src/modules/album/album.dto.ts (typescript), got unresolved under server/tsconfig.build.json, server/tsconfig.json; K3b server/src/services/workflow- |

## Totals

- 3 certified commits, 0 steps pinned, 0 skipped, 56 pending
- 18 files moved, 59 specifier edits
- 4 attempts: 0 declined by the executor, 1 failed certification (rolled back), 0 interrupted
- 1 files pinned

## Pins

| File | Step | Reason |
|---|---|---|
| `server/src/dtos/album.dto.ts` | 2 module/album | pinned |

## Findings

23 findings, recorded and never fixed. Full log: `findings/findings.md`; as JSON: `findings/findings.json`.

Narration: off; every finding shows its deterministic evidence only.

| Kind | Findings | Source |
|---|---|---|
| Module cycles | 1 | plan-graph |
| God injection | 1 | facts |
| Tables written by several groups | 3 | facts |
| Injected fault (--inject-fault) | 1 | run |
| Files pinned by a replan | 1 | run |
| Coverage globs match other files, with no gate | 1 | run |
| Coverage globs match other files | 1 | certificate |
| Emit without a rootDir | 1 | certificate |
| Docs name old paths | 2 | certificate |
| A module loaded by a computed path | 1 | certificate |
| Plan validator warnings | 10 | validator |

Top 8:

1. **55 groups form one import cycle**

   <details><summary>Evidence</summary>

   ```text
   55 of 59 groups are strongly connected (from the planner's facts at 02063972e8, grouped by the run's plan.yaml): each reaches every other through imports.
   Members: module/activity, module/album, module/api-key, module/asset, module/auth, module/cluster-group, module/config, module/database-backup, module/download, module/duplicate, module/integrity, module/job, module/library, module/machine-learning, module/maintenance, module/map, module/memory, module/notification, module/ocr, module/partner, module/person, module/plugin, module/queue, module/search, module/server, module/session, module/shared-link, module/stack, module/sync, module/system-metadata, module/tag, module/timeline, module/trash, module/user, module/version, module/video-stream, module/view, module/workflow, platform/access, platform/bootstrap, platform/cron, platform/database, platform/event, platform/file, platform/http-response, platform/logging, platform/media, platform/metadata, platform/move, platform/registry, platform/storage, platform/telemetry, platform/transcoding, platform/websocket, shared/shared.
   Inside the set: 506 edges between them over 1437 file pairs. These 118 edges (193 file pairs) close every cycle; without them the set is acyclic:
   - module/search → module/asset (7 file pairs, e.g. server/src/controllers/search.controller.ts → server/src/dtos/asset-response.dto.ts)
   - module/auth → module/user (6 file pairs, e.g. server/src/controllers/auth.controller.ts → server/src/dtos/user.dto.ts)
   - module/album → module/asset (5 file pairs, e.g. server/src/controllers/album.controller.ts → server/src/dtos/asset-ids.response.dto.ts)
   - module/shared-link → module/asset (5 file pairs, e.g. server/src/controllers/shared-link.controller.ts → server/src/dtos/asset-ids.response.dto.ts)
   - platform/media → module/asset (5 file pairs, e.g. server/src/repositories/media.repository.ts → server/src/dtos/editing.dto.ts)
   - platform/storage → module/asset (5 file pairs, e.g. server/src/cores/storage.core.ts → server/src/repositories/asset.repository.ts)
   - module/stack → module/asset (4 file pairs, e.g. server/src/controllers/stack.controller.ts → server/src/dtos/asset-ids.response.dto.ts)
   - module/tag → module/asset (4 file pairs, e.g. server/src/controllers/tag.controller.ts → server/src/dtos/asset-ids.response.dto.ts)
   - platform/access → module/person (4 file pairs, e.g. server/src/repositories/access.repository.ts → server/src/dtos/person.dto.ts)
   - module/asset → platform/registry (3 file pairs, e.g. server/src/services/asset-file.service.ts → server/src/services/base.service.ts)
   - module/job → module/asset (3 file pairs, e.g. server/src/services/job.service.ts → server/src/dtos/asset-response.dto.ts)
   - module/notification → module/asset (3 file pairs, e.g. server/src/services/notification.service.ts → server/src/dtos/asset-response.dto.ts)
   - module/partner → module/user (3 file pairs, e.g. server/src/dtos/partner.dto.ts → server/src/dtos/user.dto.ts)
   - module/search → module/person (3 file pairs, e.g. server/src/controllers/search.controller.ts → server/src/dtos/person.dto.ts)
   - module/server → module/user (3 file pairs, e.g. server/src/controllers/server.controller.ts → server/src/dtos/license.dto.ts)
   - … 103 more edges (130 file pairs)
   ```

   </details>

2. **BaseService injects 56 members into 51 classes**

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

3. **Table asset is written by 4 groups**

   <details><summary>Evidence</summary>

   ```text
   Table asset is written by 4 files in 4 plan groups (and read by 23 files in 22 groups):
   - module/asset: server/src/repositories/asset.repository.ts
   - module/duplicate: server/src/repositories/duplicate.repository.ts
   - module/stack: server/src/repositories/stack.repository.ts
   - module/trash: server/src/repositories/trash.repository.ts
   ```

   </details>

4. **Injected fault (--inject-fault): step 2**

   <details><summary>Evidence</summary>

   ```text
   step 2 (R1): seeded wrong move (--inject-fault): M2 (Drop one importer rewrite): server/src/services/workflow-execution.service.ts: import specifier 'src/modules/album/album.dto.js' left as in base, 'src/dtos/album.dto.js'
   ```

   </details>

5. **Files pinned by a replan: step 2**

   <details><summary>Evidence</summary>

   ```text
   step 2 (R1): attempt 1 (failed): certificate FAIL (K3a, K3b, K3c): K3a server/src/services/workflow-execution.service.ts: line 14: import 'src/dtos/album.dto.js': expected file server/src/modules/album/album.dto.ts (typescript), got unresolved under server/tsconfig.build.json, server/tsconfig.json; K3b server/src/services/workflow-execution.service.ts: site 7 'src/dtos/album.dto.js' (import): base server/src/modules/album/album.dto.ts, head unresolved; K3c server/src/services/workflow-execution.service.ts: nest-cli/emit: import 'src/dtos/album.dto.js' resolves to unresolved (ERR_MODULE_NOT_FOUND), expected server/src/modules/album/album.dto.ts; base server/src/services/workflow-execution.service.ts 'src/dtos/album.dto.js'
   1 file: server/src/dtos/album.dto.ts
   ```

   </details>

6. **Coverage globs match other files, with no gate: server/test/vitest.config.mjs**

   <details><summary>Evidence</summary>

   ```text
   The run recorded 2 distinct findings in server/test/vitest.config.mjs, 6 times (steps 1–3):
   - server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/services/**' (server/src/services/**) matches differently for server/src/services/activity.service.ts (moving to server/src/modules/activity/activity.service.ts), server/src/services/activity.service.spec.ts (moving t… (steps 1–3)
   - server/test/vitest.config.mjs line 21 [test.coverage.exclude]: coverage glob 'src/services/*.spec.ts' (server/src/services/*.spec.ts) matches differently for server/src/services/activity.service.spec.ts (moving to server/src/modules/activity/activity.service.spec.ts); nothing in server/test/vitest.… (steps 1–3)
   ```

   </details>

7. **Coverage globs match other files (K4): server/test/vitest.config.mjs**

   <details><summary>Evidence</summary>

   ```text
   K4 reported 2 distinct findings in server/test/vitest.config.mjs, 8 times (steps 1–3, rungs/R1.json):
   - line 19: 'src/services/**' is the glob server/src/services/** whose matches change (2 moved files, e.g. server/src/services/activity.service.spec.ts -> server/src/modules/activity/activity.service.spec.ts) of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activit… (steps 1–3, rungs/R1.json)
   - line 21: 'src/services/*.spec.ts' is the glob server/src/services/*.spec.ts whose matches change (1 moved files, e.g. server/src/services/activity.service.spec.ts -> server/src/modules/activity/activity.service.spec.ts) of server/src/services/activity.service.spec.ts (moved to server/src/modules/ac… (steps 1–3, rungs/R1.json)
   ```

   </details>

8. **Emit without a rootDir (K7): e2e/tsconfig.json**

   <details><summary>Evidence</summary>

   ```text
   K7 reported one finding in e2e/tsconfig.json, 4 times (steps 1–3, rungs/R1.json):
   - emits into e2e/dist without a rootDir; TypeScript 6.0+ and before 6.0's default stays e2e and e2e (steps 1–3, rungs/R1.json)
   ```

   </details>

