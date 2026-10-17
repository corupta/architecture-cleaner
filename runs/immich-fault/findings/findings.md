# Findings log: `server/` @ `02063972e8`

Recorded, never fixed. The run only moved files; every finding below describes the code as the run found it, and the run left it exactly as it was.

- Run: branch `ac/s7-fault`, status stopped, `02063972e8` → `ac51228171`, profile `immich`
- Source target: facts at 02063972e8: 269 movable files, 1759 edges, 269 placed by the plan
- Source plan-graph: no committed boundary rules (R4 didn't run): cycles from the plan's groups over the facts, 1 strongly connected sets; no back-edges without R4's order
- Source facts: 3 tables with writers in several groups, 1 god-injection base classes
- Source analyzer: 458 production files analyzed, 0 import test code
- Source validator: 10 warnings on the run's plan
- Source certificate: 4 certificates read (steps, rungs, whole PR)
- Source run: 8 run.json findings
- Narration: off; every finding shows its deterministic evidence only.

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

## Module cycles (1)

### 55 groups form one import cycle

`F-f0f96c77a088` · module-cycle · source plan-graph

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

Files: `server/src/controllers/album.controller.ts`, `server/src/controllers/auth.controller.ts`, `server/src/controllers/search.controller.ts`, `server/src/controllers/server.controller.ts`, `server/src/controllers/shared-link.controller.ts`, `server/src/controllers/stack.controller.ts`, `server/src/controllers/tag.controller.ts`, `server/src/cores/storage.core.ts`, `server/src/dtos/asset-ids.response.dto.ts`, `server/src/dtos/asset-response.dto.ts`, `server/src/dtos/editing.dto.ts`, `server/src/dtos/license.dto.ts`, … 10 more

## God injection (1)

### BaseService injects 56 members into 51 classes

`F-190847636c3d` · god-injection · source facts

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
- AlbumService (server/src/services/album.service.ts): 7 (accessRepository, albumRepository, albumUserRepository, eventRepository, logger, mapRepository, userRepository)
- AssetMediaService (server/src/services/asset-media.service.ts): 7 (albumRepository, assetRepository, eventRepository, jobRepository, logger, sharedLinkRepository, storageRepository)
- ServerService (server/src/services/server.service.ts): 7 (configRepository, cryptoRepository, logger, serverInfoRepository, storageRepository, systemMetadataRepository, userRepository)
- JobService (server/src/services/job.service.ts): 6 (assetEditRepository, assetRepository, eventRepository, jobRepository, logger, websocketRepository)
- OcrService (server/src/services/ocr.service.ts): 6 (assetJobRepository, assetRepository, jobRepository, logger, machineLearningRepository, ocrRepository)
- SmartInfoService (server/src/services/smart-info.service.ts): 6 (assetJobRepository, databaseRepository, jobRepository, logger, machineLearningRepository, searchRepository)
- StorageService (server/src/services/storage.service.ts): 6 (assetRepository, configRepository, databaseRepository, logger, storageRepository, systemMetadataRepository)
- TranscodingService (server/src/services/transcoding.service.ts): 6 (databaseRepository, logger, processRepository, storageRepository, videoStreamRepository, websocketRepository)
- ClusterGroupService (server/src/services/cluster-group.service.ts): 5 (clusterGroupRepository, eventRepository, jobRepository, personRepository, userRepository)
- DownloadService (server/src/services/download.service.ts): 5 (assetRepository, downloadRepository, logger, storageRepository, userRepository)
- MaintenanceService (server/src/services/maintenance.service.ts): 5 (appRepository, eventRepository, logger, storageRepository, systemMetadataRepository)
- QueueService (server/src/services/queue.service.ts): 5 (cronRepository, databaseRepository, eventRepository, jobRepository, logger)
- SearchService (server/src/services/search.service.ts): 5 (assetRepository, machineLearningRepository, partnerRepository, personRepository, searchRepository)
- TagService (server/src/services/tag.service.ts): 5 (accessRepository, assetRepository, eventRepository, jobRepository, tagRepository)
- HlsService (server/src/services/hls.service.ts): 4 (cryptoRepository, storageRepository, videoStreamRepository, websocketRepository)
- SharedLinkService (server/src/services/shared-link.service.ts): 4 (cryptoRepository, logger, sharedLinkAssetRepository, sharedLinkRepository)
- SyncService (server/src/services/sync.service.ts): 4 (logger, sessionRepository, syncCheckpointRepository, syncRepository)
- SystemConfigService (server/src/services/system-config.service.ts): 4 (configRepository, eventRepository, logger, machineLearningRepository)
- TrashService (server/src/services/trash.service.ts): 4 (eventRepository, jobRepository, logger, trashRepository)
- DatabaseService (server/src/services/database.service.ts): 3 (configRepository, databaseRepository, logger)
- MapService (server/src/services/map.service.ts): 3 (albumRepository, mapRepository, partnerRepository)
- NotificationAdminService (server/src/services/notification-admin.service.ts): 3 (emailRepository, notificationRepository, userRepository)
- PartnerService (server/src/services/partner.service.ts): 3 (logger, partnerRepository, userRepository)
- SessionService (server/src/services/session.service.ts): 3 (cryptoRepository, logger, sessionRepository)
- StackService (server/src/services/stack.service.ts): 3 (assetRepository, eventRepository, stackRepository)
- ApiKeyService (server/src/services/api-key.service.ts): 2 (apiKeyRepository, cryptoRepository)
- AssetFileService (server/src/services/asset-file.service.ts): 2 (assetFileRepository, jobRepository)
- TelemetryService (server/src/services/telemetry.service.ts): 2 (telemetryRepository, userRepository)
- TimelineService (server/src/services/timeline.service.ts): 2 (assetRepository, partnerRepository)
- WorkflowService (server/src/services/workflow.service.ts): 2 (pluginRepository, workflowRepository)
- ActivityService (server/src/services/activity.service.ts): 1 (activityRepository)
- AuthAdminService (server/src/services/auth-admin.service.ts): 1 (userRepository)
- PluginService (server/src/services/plugin.service.ts): 1 (pluginRepository)
- SystemMetadataService (server/src/services/system-metadata.service.ts): 1 (systemMetadataRepository)
- ViewService (server/src/services/view.service.ts): 1 (viewRepository)
```

Files: `server/src/services/activity.service.ts`, `server/src/services/album.service.ts`, `server/src/services/api-key.service.ts`, `server/src/services/asset-file.service.ts`, `server/src/services/asset-media.service.ts`, `server/src/services/asset.service.ts`, `server/src/services/auth-admin.service.ts`, `server/src/services/auth.service.ts`, `server/src/services/base.service.ts`, `server/src/services/cli.service.ts`, `server/src/services/cluster-group.service.ts`, `server/src/services/database.service.ts`, … 40 more

## Tables written by several groups (3)

### Table asset is written by 4 groups

`F-471f7dbe2fc2` · multi-writer-table · source facts

```text
Table asset is written by 4 files in 4 plan groups (and read by 23 files in 22 groups):
- module/asset: server/src/repositories/asset.repository.ts
- module/duplicate: server/src/repositories/duplicate.repository.ts
- module/stack: server/src/repositories/stack.repository.ts
- module/trash: server/src/repositories/trash.repository.ts
```

Files: `server/src/repositories/asset.repository.ts`, `server/src/repositories/duplicate.repository.ts`, `server/src/repositories/stack.repository.ts`, `server/src/repositories/trash.repository.ts`

### Table cluster_group is written by 2 groups

`F-bdcfcf0f1886` · multi-writer-table · source facts

```text
Table cluster_group is written by 2 files in 2 plan groups:
- module/cluster-group: server/src/repositories/cluster-group.repository.ts
- module/person: server/src/repositories/person.repository.ts
```

Files: `server/src/repositories/cluster-group.repository.ts`, `server/src/repositories/person.repository.ts`

### Table session_sync_checkpoint is written by 2 groups

`F-e7b889cd5d1e` · multi-writer-table · source facts

```text
Table session_sync_checkpoint is written by 2 files in 2 plan groups (and read by 1 file in 1 group):
- module/session: server/src/repositories/session.repository.ts
- module/sync: server/src/repositories/sync-checkpoint.repository.ts
```

Files: `server/src/repositories/session.repository.ts`, `server/src/repositories/sync-checkpoint.repository.ts`

## Injected fault (--inject-fault) (1)

### Injected fault (--inject-fault): step 2

`F-0daf1592fc4d` · injected-fault · source run · reported by step 2

```text
step 2 (R1): seeded wrong move (--inject-fault): M2 (Drop one importer rewrite): server/src/services/workflow-execution.service.ts: import specifier 'src/modules/album/album.dto.js' left as in base, 'src/dtos/album.dto.js'
```

## Files pinned by a replan (1)

### Files pinned by a replan: step 2

`F-0056b169b7fc` · pinned · source run · reported by step 2

```text
step 2 (R1): attempt 1 (failed): certificate FAIL (K3a, K3b, K3c): K3a server/src/services/workflow-execution.service.ts: line 14: import 'src/dtos/album.dto.js': expected file server/src/modules/album/album.dto.ts (typescript), got unresolved under server/tsconfig.build.json, server/tsconfig.json; K3b server/src/services/workflow-execution.service.ts: site 7 'src/dtos/album.dto.js' (import): base server/src/modules/album/album.dto.ts, head unresolved; K3c server/src/services/workflow-execution.service.ts: nest-cli/emit: import 'src/dtos/album.dto.js' resolves to unresolved (ERR_MODULE_NOT_FOUND), expected server/src/modules/album/album.dto.ts; base server/src/services/workflow-execution.service.ts 'src/dtos/album.dto.js'
1 file: server/src/dtos/album.dto.ts
```

Files: `server/src/dtos/album.dto.ts`

## Coverage globs match other files, with no gate (1)

### Coverage globs match other files, with no gate: server/test/vitest.config.mjs

`F-89500b32bdee` · ungated-coverage-glob · source run · reported by steps 1–3

```text
The run recorded 2 distinct findings in server/test/vitest.config.mjs, 6 times (steps 1–3):
- server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/services/**' (server/src/services/**) matches differently for server/src/services/activity.service.ts (moving to server/src/modules/activity/activity.service.ts), server/src/services/activity.service.spec.ts (moving t… (steps 1–3)
- server/test/vitest.config.mjs line 21 [test.coverage.exclude]: coverage glob 'src/services/*.spec.ts' (server/src/services/*.spec.ts) matches differently for server/src/services/activity.service.spec.ts (moving to server/src/modules/activity/activity.service.spec.ts); nothing in server/test/vitest.… (steps 1–3)
```

Files: `server/test/vitest.config.mjs`

## Coverage globs match other files (1)

### Coverage globs match other files (K4): server/test/vitest.config.mjs

`F-800da5f4439a` · coverage-scope · source certificate · reported by steps 1–3, rungs/R1.json

```text
K4 reported 2 distinct findings in server/test/vitest.config.mjs, 8 times (steps 1–3, rungs/R1.json):
- line 19: 'src/services/**' is the glob server/src/services/** whose matches change (2 moved files, e.g. server/src/services/activity.service.spec.ts -> server/src/modules/activity/activity.service.spec.ts) of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activit… (steps 1–3, rungs/R1.json)
- line 21: 'src/services/*.spec.ts' is the glob server/src/services/*.spec.ts whose matches change (1 moved files, e.g. server/src/services/activity.service.spec.ts -> server/src/modules/activity/activity.service.spec.ts) of server/src/services/activity.service.spec.ts (moved to server/src/modules/ac… (steps 1–3, rungs/R1.json)
```

Files: `server/test/vitest.config.mjs`

## Emit without a rootDir (1)

### Emit without a rootDir (K7): e2e/tsconfig.json

`F-966da7d59056` · default-root-dir · source certificate · reported by steps 1–3, rungs/R1.json

```text
K7 reported one finding in e2e/tsconfig.json, 4 times (steps 1–3, rungs/R1.json):
- emits into e2e/dist without a rootDir; TypeScript 6.0+ and before 6.0's default stays e2e and e2e (steps 1–3, rungs/R1.json)
```

Files: `e2e/tsconfig.json`

## Docs name old paths (2)

### Docs name old paths (K4): docs/docs/developer/architecture.mdx

`F-68921a0c7282` · old-path-in-docs · source certificate · reported by steps 1–3, rungs/R1.json

```text
K4 reported 3 distinct findings in docs/docs/developer/architecture.mdx, 12 times (steps 1–3, rungs/R1.json):
- line 60: 'src/repositories' is the directory server/src/repositories, whose contents change with the move of server/src/repositories/activity.repository.ts (moved to server/src/modules/activity/activity.repository.ts) (steps 1–3, rungs/R1.json)
- line 60: 'src/services' is the directory server/src/services, whose contents change with the move of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activity.service.spec.ts) (steps 1–3, rungs/R1.json)
- line 64: 'src/controllers' is the directory server/src/controllers, whose contents change with the move of server/src/controllers/activity.controller.spec.ts (moved to server/src/modules/activity/activity.controller.spec.ts) (steps 1–3, rungs/R1.json)
```

Files: `docs/docs/developer/architecture.mdx`

### Docs name old paths (K4): .github/pull_request_template.md

`F-8759fa26d236` · old-path-in-docs · source certificate · reported by steps 1–3, rungs/R1.json

```text
K4 reported 3 distinct findings in .github/pull_request_template.md, 12 times (steps 1–3, rungs/R1.json):
- line 36: 'src/services/' is the directory server/src/services, whose contents change with the move of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activity.service.spec.ts) (steps 1–3, rungs/R1.json)
- line 37: 'src/repositories/' is the directory server/src/repositories, whose contents change with the move of server/src/repositories/activity.repository.ts (moved to server/src/modules/activity/activity.repository.ts) (steps 1–3, rungs/R1.json)
- line 37: 'src/services/' is the directory server/src/services, whose contents change with the move of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activity.service.spec.ts) (steps 1–3, rungs/R1.json)
```

Files: `.github/pull_request_template.md`

## A module loaded by a computed path (1)

### A module loaded by a computed path (K4): server/src/repositories/database.repository.ts

`F-70d9e19108a1` · opaque-dynamic-load · source certificate · reported by steps 1–3, rungs/R1.json

```text
K4 reported one finding in server/src/repositories/database.repository.ts, 4 times (steps 1–3, rungs/R1.json):
- line 510: import(filePath) loads a module by a path K4 can't evaluate (steps 1–3, rungs/R1.json)
```

Files: `server/src/repositories/database.repository.ts`

## Plan validator warnings (10)

### Plan warning (one-file-platform): platform/http-client

`F-14d96dec2313` · plan-warning · source validator

```text
The plan validator's rule one-file-platform, on the run's plan.yaml (group platform/http-client): platform/http-client holds one file, and no other planned group uses it: consider folding it into the concern or feature it serves
```

Files: `server/src/utils/fetch.ts`

### Plan warning (one-file-platform): platform/check

`F-175fe3a4820a` · plan-warning · source validator

```text
The plan validator's rule one-file-platform, on the run's plan.yaml (group platform/check): platform/check holds one file, and no other planned group uses it: consider folding it into the concern or feature it serves
```

Files: `server/src/commands/schema-check.ts`

### Plan warning (singleton-group): module/machine-learning

`F-545a4b88a62f` · plan-warning · source validator

```text
The plan validator's rule singleton-group, on the run's plan.yaml (group module/machine-learning): module/machine-learning holds one file
```

Files: `server/src/repositories/machine-learning.repository.ts`

### Plan warning (unsupported-merge): module/auth

`F-692ad4017c11` · plan-warning · source validator

```text
The plan validator's rule unsupported-merge, on the run's plan.yaml (group module/auth): module/auth takes draft group "grant" (src/commands/grant-admin.ts): no shared word, edge, table or route
```

### Plan warning (platform-feature): platform/move

`F-6dc722024105` · plan-warning · source validator

```text
The plan validator's rule platform-feature, on the run's plan.yaml (group platform/move): src/repositories/move.repository.ts writes tables (move_history): a feature, not plumbing
```

Files: `server/src/repositories/move.repository.ts`

### Plan warning (one-file-platform): platform/move

`F-af06f12438b8` · plan-warning · source validator

```text
The plan validator's rule one-file-platform, on the run's plan.yaml (group platform/move): platform/move holds one file, and only platform/storage uses it: consider folding it there
```

Files: `server/src/repositories/move.repository.ts`

### Plan warning (platform-feature): platform/bootstrap

`F-e1c975dc8064` · plan-warning · source validator

```text
The plan validator's rule platform-feature, on the run's plan.yaml (group platform/bootstrap): src/controllers/app.controller.ts serves routes: a feature, not plumbing
```

Files: `server/src/controllers/app.controller.ts`

### Plan warning (impure-shared): shared/shared

`F-e3b63d08f742` · plan-warning · source validator

```text
The plan validator's rule impure-shared, on the run's plan.yaml (group shared/shared): src/services/api.service.ts is a service; shared/ holds pure code only
```

Files: `server/src/services/api.service.ts`

### Plan warning (one-file-platform): platform/transcoding

`F-fa4aa2cae116` · plan-warning · source validator

```text
The plan validator's rule one-file-platform, on the run's plan.yaml (group platform/transcoding): platform/transcoding holds one file, and no other planned group uses it: consider folding it into the concern or feature it serves
```

Files: `server/src/services/transcoding.service.ts`

### Plan warning (unsupported-merge): module/auth

`F-ff0edb54f50f` · plan-warning · source validator

```text
The plan validator's rule unsupported-merge, on the run's plan.yaml (group module/auth): module/auth takes draft group "password-login" (src/commands/password-login.ts): no shared word, edge, table or route
```

