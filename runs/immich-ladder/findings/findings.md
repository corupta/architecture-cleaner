# Findings log: `server/` @ `02063972e8`

Recorded, never fixed. The run only moved files; every finding below describes the code as the run found it, and the run left it exactly as it was.

- Run: branch `ac/s6-ladder`, status completed, `02063972e8` → `c4be040b57`, profile `immich`
- Source target: facts at 02063972e8: 269 movable files, 1759 edges, 269 placed by the plan
- Source boundaries: boundaries/report.json: 2 strongly connected sets, 8 back-edges
- Source facts: 3 tables with writers in several groups, 1 god-injection base classes
- Source analyzer: 458 production files analyzed, 0 import test code
- Source validator: 10 warnings on the run's plan
- Source certificate: 67 certificates read (steps, rungs, whole PR)
- Source run: 107 run.json findings
- Narration: Nemotron 3.5 Lightning (thinking off) wrote 1–2 sentences for 35 findings in 2 calls ($0.0010 when recorded, replayed now), 4 dropped by the guard and 1 not returned by the model (they keep their evidence only). Text only, under a lexical guard: it drops any narration naming a path, code identifier, capitalized name, the name in "the <name> table/module/class/…", or number (digits, or words up to twenty) that its evidence doesn't contain. It checks words, not claims: a number or name from the evidence can still be put to the wrong use.

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

## Module cycles (2)

### 42 folders form one import cycle

`F-f375142329cd` · module-cycle · source boundaries

> The R4 report shows that 42 out of 73 folders are strongly connected through imports, each reaching every other. With 328 edges over 1025 files inside the set, these 91 edges spanning 174 files are the only back-edges that close the cycles; removing them leaves the collection acyclic.

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

Files: `server/src/modules/album/album-user.repository.ts`, `server/src/modules/album/album.controller.ts`, `server/src/modules/asset/asset-ids.response.dto.ts`, `server/src/modules/asset/asset-media.dto.ts`, `server/src/modules/asset/asset-response.dto.ts`, `server/src/modules/asset/asset.dto.ts`, `server/src/modules/asset/editing.dto.ts`, `server/src/modules/auth/auth.controller.ts`, `server/src/modules/person/person.controller.ts`, `server/src/modules/person/person.dto.ts`, `server/src/modules/search/search.controller.ts`, `server/src/modules/server/server.controller.ts`, … 15 more

### module/notification and other:src/emails import each other

`F-848cb161117b` · module-cycle · source boundaries

> Module notification and other:src/emails are strongly connected, each reaching the other through imports; one edge over four files closes the cycle, and removing it makes the set acyclic.

```text
2 of 73 folders are strongly connected (from R4's boundary report (boundaries/report.json)): each reaches every other through imports.
Members: module/notification, other:src/emails.
Inside the set: 2 edges between them over 8 files. These 1 edges (4 files) close every cycle (R4's back-edges first); without them the set is acyclic:
- other:src/emails → module/notification (4 files, e.g. server/src/emails/album-invite.email.tsx → server/src/modules/notification/email.repository.ts)
```

Files: `server/src/emails/album-invite.email.tsx`, `server/src/modules/notification/email.repository.ts`

## God injection (1)

### BaseService injects 56 members into 51 classes

`F-190847636c3d` · god-injection · source facts

> BaseService receives 56 constructor-injected members, and 51 classes extend it so each inherits all 56; on average a subclass reads 5.7 of them, and the most-read members such as logger and repositories are accessed by many classes.

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

> The table asset is written by four files located in four separate plan groups: module/asset, module/duplicate, module/stack, and module/trash.

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

> Table cluster_group is written by two files in two plan groups: module/cluster-group and module/person.

```text
Table cluster_group is written by 2 files in 2 plan groups:
- module/cluster-group: server/src/repositories/cluster-group.repository.ts
- module/person: server/src/repositories/person.repository.ts
```

Files: `server/src/repositories/cluster-group.repository.ts`, `server/src/repositories/person.repository.ts`

### Table session_sync_checkpoint is written by 2 groups

`F-e7b889cd5d1e` · multi-writer-table · source facts

> Table session_sync_checkpoint is written by two files in two plan groups (module/session and module/sync) and read by one file in one group.

```text
Table session_sync_checkpoint is written by 2 files in 2 plan groups (and read by 1 file in 1 group):
- module/session: server/src/repositories/session.repository.ts
- module/sync: server/src/repositories/sync-checkpoint.repository.ts
```

Files: `server/src/repositories/session.repository.ts`, `server/src/repositories/sync-checkpoint.repository.ts`

## Back-edges against the boundary order (8)

### Back-edge module/auth → module/user

`F-0f4709d1dd31` · back-edge · source boundaries

> Module auth imports module user in four files, which violates the allow-list encoded in R4's module order; R4's baseline records this as a known violation.

```text
module/auth imports module/user in 4 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
- server/src/modules/auth/auth.controller.ts → server/src/modules/user/user.dto.ts
- server/src/modules/auth/auth.service.ts → server/src/modules/user/profile-image.ts
- server/src/modules/auth/auth.service.ts → server/src/modules/user/user.dto.ts
```

Files: `server/src/modules/auth/auth.controller.ts`, `server/src/modules/auth/auth.service.ts`, `server/src/modules/user/profile-image.ts`, `server/src/modules/user/user.dto.ts`

### Back-edge module/user → module/asset

`F-d23785863ced` · back-edge · source boundaries

> Module user imports module asset in four files, which violates the allow-list encoded in R4's module order; R4's baseline records this as a known violation.

```text
module/user imports module/asset in 4 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
- server/src/modules/user/user-admin.controller.ts → server/src/modules/asset/asset.dto.ts
- server/src/modules/user/user-admin.service.ts → server/src/modules/asset/asset.dto.ts
- server/src/modules/user/user-methods.ts → server/src/modules/asset/asset.repository.ts
```

Files: `server/src/modules/asset/asset.dto.ts`, `server/src/modules/asset/asset.repository.ts`, `server/src/modules/user/user-admin.controller.ts`, `server/src/modules/user/user-admin.service.ts`, `server/src/modules/user/user-methods.ts`

### Back-edge module/tag → module/asset

`F-8dbbbf14f9f3` · back-edge · source boundaries

> Three files under module/tag import module/asset, but R4's allow-list does not permit this dependency. R4's baseline marks these as known violations that remain unchanged.

```text
module/tag imports module/asset in 3 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
- server/src/modules/tag/tag.controller.ts → server/src/modules/asset/asset-ids.response.dto.ts
- server/src/modules/tag/tag.service.ts → server/src/modules/asset/asset-ids.response.dto.ts
- server/src/modules/tag/tag.service.ts → server/src/modules/asset/asset.util.ts
```

Files: `server/src/modules/asset/asset-ids.response.dto.ts`, `server/src/modules/asset/asset.util.ts`, `server/src/modules/tag/tag.controller.ts`, `server/src/modules/tag/tag.service.ts`

### Back-edge module/plugin → module/workflow

`F-834724fcbf9e` · back-edge · source boundaries

> Two files under module/plugin import module/workflow, but R4's allow-list does not allow this. R4's baseline records these as known violations.

```text
module/plugin imports module/workflow in 2 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
- server/src/modules/plugin/plugin.dto.ts → server/src/modules/workflow/workflow.ts
- server/src/modules/plugin/plugin.service.ts → server/src/modules/workflow/workflow.ts
```

Files: `server/src/modules/plugin/plugin.dto.ts`, `server/src/modules/plugin/plugin.service.ts`, `server/src/modules/workflow/workflow.ts`

### Back-edge module/database-backup → module/maintenance

`F-6a82ccadb707` · back-edge · source boundaries

> One file under module/database-backup imports module/maintenance, which R4's allow-list forbids. R4's baseline records this as a known violation.

```text
module/database-backup imports module/maintenance in 1 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
- server/src/modules/database-backup/database-backup.controller.ts → server/src/modules/maintenance/maintenance.service.ts
```

Files: `server/src/modules/database-backup/database-backup.controller.ts`, `server/src/modules/maintenance/maintenance.service.ts`

### Back-edge module/version → module/server

`F-86474a013374` · back-edge · source boundaries

> One file under module/version imports module/server, which R4's allow-list disallows. R4's baseline records this as a known violation.

```text
module/version imports module/server in 1 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
- server/src/modules/version/version.service.ts → server/src/modules/server/server.dto.ts
```

Files: `server/src/modules/server/server.dto.ts`, `server/src/modules/version/version.service.ts`

### Back-edge module/asset → module/person

`F-bdf320395cbd` · back-edge · source boundaries

> One file under module/asset imports module/person, which R4's allow-list forbids. R4's baseline records this as a known violation.

```text
module/asset imports module/person in 1 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
- server/src/modules/asset/asset-response.dto.ts → server/src/modules/person/person.dto.ts
```

Files: `server/src/modules/asset/asset-response.dto.ts`, `server/src/modules/person/person.dto.ts`

### Back-edge module/auth → module/config

`F-ddff071a1b0b` · back-edge · source boundaries

> One file under module/auth imports module/config, which R4's allow-list disallows. R4's baseline records this as a known violation.

```text
module/auth imports module/config in 1 files, against the module order R4's allow-list encodes; R4's baseline freezes it as a known violation.
- server/src/modules/auth/auth.service.ts → server/src/modules/config/config.dto.ts
```

Files: `server/src/modules/auth/auth.service.ts`, `server/src/modules/config/config.dto.ts`

## Coverage globs match other files, with no gate (1)

### Coverage globs match other files, with no gate: server/test/vitest.config.mjs

`F-89500b32bdee` · ungated-coverage-glob · source run · reported by steps 1–13, 15–39, 44–51, 54–57, 59

> The vitest config contains six distinct coverage-glob findings that match 107 steps, but no threshold or check gates the coverage, so the globs match differently for moved service and utility files without enforcing any rule.

```text
The run recorded 6 distinct findings in server/test/vitest.config.mjs, 107 times (steps 1–13, 15–39, 44–51, 54–57, 59):
- server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/services/**' (server/src/services/**) matches differently for server/src/services/activity.service.ts (moving to server/src/modules/activity/activity.service.ts), server/src/services/activity.service.spec.ts (moving t… (steps 1–13, 15–38, 44, 50–51, 54–57, 59)
- server/test/vitest.config.mjs line 21 [test.coverage.exclude]: coverage glob 'src/services/*.spec.ts' (server/src/services/*.spec.ts) matches differently for server/src/services/activity.service.spec.ts (moving to server/src/modules/activity/activity.service.spec.ts); nothing in server/test/vitest.… (steps 1–5, 7–12, 15–21, 23–37, 44, 50–51, 55, 57, 59)
- server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/utils/**' (server/src/utils/**) matches differently for server/src/utils/asset.util.ts (moving to server/src/modules/asset/asset.util.ts); nothing in server/test/vitest.config.mjs gates coverage (no threshold or check… (steps 4, 7–8, 10, 15, 24, 29, 31, 34, 38–39, 44–51, 59)
- server/test/vitest.config.mjs line 24 [test.coverage.exclude]: coverage glob 'src/services/index.ts' matches differently for server/src/services/index.ts (moving to server/src/platform/registry/services/index.ts); nothing in server/test/vitest.config.mjs gates coverage (no threshold or check-covera… (step 54)
- server/test/vitest.config.mjs line 19 [test.coverage.include]: coverage glob 'src/cores/**' (server/src/cores/**) matches differently for server/src/cores/storage.core.ts (moving to server/src/platform/storage/storage.core.ts), server/src/cores/storage.core.spec.ts (moving to server/src/platform/st… (step 55)
- server/test/vitest.config.mjs line 22 [test.coverage.exclude]: coverage glob 'src/services/api.service.ts' matches differently for server/src/services/api.service.ts (moving to server/src/shared/api.service.ts); nothing in server/test/vitest.config.mjs gates coverage (no threshold or check-coverage… (step 59)
```

Files: `server/test/vitest.config.mjs`

## Coverage globs match other files (1)

### Coverage globs match other files (K4): server/test/vitest.config.mjs

`F-800da5f4439a` · coverage-scope · source certificate · reported by steps 1–13, 15–39, 44–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json

> K4 reported six distinct coverage-glob findings in the vitest config that match 122 steps across certificate.json and rung JSON files, where globs such as 'src/services/**' change matches when files move to module folders.

```text
K4 reported 6 distinct findings in server/test/vitest.config.mjs, 122 times (steps 1–13, 15–39, 44–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json):
- line 19: 'src/services/**' is the glob server/src/services/** whose matches change (2 moved files, e.g. server/src/services/activity.service.spec.ts -> server/src/modules/activity/activity.service.spec.ts) of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activit… (steps 1–13, 15–38, 44, 50–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json)
- line 21: 'src/services/*.spec.ts' is the glob server/src/services/*.spec.ts whose matches change (1 moved files, e.g. server/src/services/activity.service.spec.ts -> server/src/modules/activity/activity.service.spec.ts) of server/src/services/activity.service.spec.ts (moved to server/src/modules/ac… (steps 1–5, 7–12, 15–21, 23–37, 44, 50–51, 55, 57, 59, certificate.json, rungs/R1.json, rungs/R2.json)
- line 19: 'src/utils/**' is the glob server/src/utils/** whose matches change (1 moved files, e.g. server/src/utils/asset.util.ts -> server/src/modules/asset/asset.util.ts) of server/src/utils/asset.util.ts (moved to server/src/modules/asset/asset.util.ts) [config at test.coverage.include]; coverage… (steps 4, 7–8, 10, 15, 24, 29, 31, 34, 38–39, 44–51, 59, certificate.json, rungs/R1.json, rungs/R2.json)
- line 24: 'src/services/index.ts' is the old path of server/src/services/index.ts (moved to server/src/platform/registry/services/index.ts) [config at test.coverage.exclude]; coverage now measures a different file set (no coverage threshold in this file, so no gate changes) (step 54, certificate.json, rungs/R2.json)
- line 19: 'src/cores/**' is the glob server/src/cores/** whose matches change (2 moved files, e.g. server/src/cores/storage.core.spec.ts -> server/src/platform/storage/storage.core.spec.ts) of server/src/cores/storage.core.spec.ts (moved to server/src/platform/storage/storage.core.spec.ts) [config a… (step 55, certificate.json, rungs/R2.json)
- line 22: 'src/services/api.service.ts' is the old path of server/src/services/api.service.ts (moved to server/src/shared/api.service.ts) [config at test.coverage.exclude]; coverage now measures a different file set (no coverage threshold in this file, so no gate changes) (step 59, certificate.json, rungs/R2.json)
```

Files: `server/test/vitest.config.mjs`

## Emit without a rootDir (1)

### Emit without a rootDir (K7): e2e/tsconfig.json

`F-966da7d59056` · default-root-dir · source certificate · reported by steps 1–62, certificate.json, rungs/R1.json, rungs/R2.json, rungs/R3.json, rungs/R4.json

> The e2e tsconfig emits into e2e/dist without specifying a rootDir, so TypeScript uses its default of e2e for both the input and output, a situation recorded 67 times across steps and rung files.

```text
K7 reported one finding in e2e/tsconfig.json, 67 times (steps 1–62, certificate.json, rungs/R1.json, rungs/R2.json, rungs/R3.json, rungs/R4.json):
- emits into e2e/dist without a rootDir; TypeScript 6.0+ and before 6.0's default stays e2e and e2e (steps 1–62, certificate.json, rungs/R1.json, rungs/R2.json, rungs/R3.json, rungs/R4.json)
```

Files: `e2e/tsconfig.json`

## Docs name old paths (3)

### Docs name old paths (K4): docs/docs/developer/architecture.mdx

`F-68921a0c7282` · old-path-in-docs · source certificate · reported by steps 1–40, 42–45, 49–59, certificate.json, rungs/R1.json, rungs/R2.json

```text
K4 reported 3 distinct findings in docs/docs/developer/architecture.mdx, 138 times (steps 1–40, 42–45, 49–59, certificate.json, rungs/R1.json, rungs/R2.json):
- line 60: 'src/repositories' is the directory server/src/repositories, whose contents change with the move of server/src/repositories/activity.repository.ts (moved to server/src/modules/activity/activity.repository.ts) (steps 1–6, 9–22, 24–31, 33–39, 42–43, 45, 49–56, 58, certificate.json, rungs/R1.json, rungs/R2.json)
- line 60: 'src/services' is the directory server/src/services, whose contents change with the move of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activity.service.spec.ts) (steps 1–13, 15–38, 44, 50–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json)
- line 64: 'src/controllers' is the directory server/src/controllers, whose contents change with the move of server/src/controllers/activity.controller.spec.ts (moved to server/src/modules/activity/activity.controller.spec.ts) (steps 1–13, 15–18, 20–34, 36–38, 40, 54, certificate.json, rungs/R1.json, rungs/R2.json)
```

Files: `docs/docs/developer/architecture.mdx`

### Docs name old paths (K4): .github/pull_request_template.md

`F-8759fa26d236` · old-path-in-docs · source certificate · reported by steps 1–39, 42–45, 49–59, certificate.json, rungs/R1.json, rungs/R2.json

> The pull request template references three directories (src/services, src/repositories, and again src/services) whose contents change as files move to module folders, recorded 146 times across steps and rung JSON files.

```text
K4 reported 3 distinct findings in .github/pull_request_template.md, 146 times (steps 1–39, 42–45, 49–59, certificate.json, rungs/R1.json, rungs/R2.json):
- line 36: 'src/services/' is the directory server/src/services, whose contents change with the move of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activity.service.spec.ts) (steps 1–13, 15–38, 44, 50–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json)
- line 37: 'src/repositories/' is the directory server/src/repositories, whose contents change with the move of server/src/repositories/activity.repository.ts (moved to server/src/modules/activity/activity.repository.ts) (steps 1–6, 9–22, 24–31, 33–39, 42–43, 45, 49–56, 58, certificate.json, rungs/R1.json, rungs/R2.json)
- line 37: 'src/services/' is the directory server/src/services, whose contents change with the move of server/src/services/activity.service.spec.ts (moved to server/src/modules/activity/activity.service.spec.ts) (steps 1–13, 15–38, 44, 50–51, 54–57, 59, certificate.json, rungs/R1.json, rungs/R2.json)
```

Files: `.github/pull_request_template.md`

### Docs name old paths (K4): docs/docs/features/supported-formats.md

`F-b033494c9d5b` · old-path-in-docs · source certificate · reported by step 59, certificate.json, rungs/R2.json

> Docs reference the old path for mime-types.ts in three locations; the refactoring left the outdated path intact in documentation.

```text
K4 reported one finding in docs/docs/features/supported-formats.md, 3 times (step 59, certificate.json, rungs/R2.json):
- line 6: '//github.com/immich-app/immich/blob/main/server/src/utils/mime-types.ts' is the old path of server/src/utils/mime-types.ts (moved to server/src/shared/mime-types.ts) (step 59, certificate.json, rungs/R2.json)
```

Files: `docs/docs/features/supported-formats.md`

## A module loaded by a computed path (1)

### A module loaded by a computed path (K4): server/src/repositories/database.repository.ts

`F-70d9e19108a1` · opaque-dynamic-load · source certificate · reported by steps 1–62, certificate.json, rungs/R1.json, rungs/R2.json, rungs/R3.json

```text
K4 reported one finding in server/src/repositories/database.repository.ts, 66 times (steps 1–62, certificate.json, rungs/R1.json, rungs/R2.json, rungs/R3.json):
- line 510: import(filePath) loads a module by a path K4 can't evaluate (steps 1–62, certificate.json, rungs/R1.json, rungs/R2.json, rungs/R3.json)
```

Files: `server/src/repositories/database.repository.ts`

## Stack-trace text names moved paths (12)

### Stack-trace text names moved paths (K4): server/src/services/metadata.service.ts

`F-49561c40d405` · stack-text · source certificate · reported by step 51, certificate.json, rungs/R2.json

> In server/src/services/metadata.service.ts a stack-trace text at line 170 now names the new path after the file was moved to server/src/platform/metadata/metadata.service.ts; two stack-trace reads passed along as text recorded three times.

```text
K4 reported one finding in server/src/services/metadata.service.ts, 3 times (step 51, certificate.json, rungs/R2.json):
- moved to server/src/platform/metadata/metadata.service.ts; 2 stack-trace reads passed along as text (line 170); their frames now name the new path (step 51, certificate.json, rungs/R2.json)
```

Files: `server/src/services/metadata.service.ts`

### Stack-trace text names moved paths (K4): server/src/services/workflow-execution.service.ts

`F-6ab2e0a4c68b` · stack-text · source certificate · reported by step 38, certificate.json, rungs/R1.json

> In server/src/services/workflow-execution.service.ts line 197, a stack-trace text now names the new path after the file moved to server/src/modules/workflow/workflow-execution.service.ts; one stack-trace read passed along as text recorded three times.

```text
K4 reported one finding in server/src/services/workflow-execution.service.ts, 3 times (step 38, certificate.json, rungs/R1.json):
- moved to server/src/modules/workflow/workflow-execution.service.ts; 1 stack-trace reads passed along as text (line 197); their frames now name the new path (step 38, certificate.json, rungs/R1.json)
```

Files: `server/src/services/workflow-execution.service.ts`

### Stack-trace text names moved paths (K4): server/src/services/auth.service.ts

`F-991694f69a68` · stack-text · source certificate · reported by step 5, certificate.json, rungs/R1.json

> Stack-trace text in one file still references the old path of auth.service.ts after its move; the frames now use the new module location.

```text
K4 reported one finding in server/src/services/auth.service.ts, 3 times (step 5, certificate.json, rungs/R1.json):
- moved to server/src/modules/auth/auth.service.ts; 1 stack-trace reads passed along as text (line 403); their frames now name the new path (step 5, certificate.json, rungs/R1.json)
```

Files: `server/src/services/auth.service.ts`

### Stack-trace text names moved paths (K4): server/src/repositories/websocket.repository.ts

`F-a1ef2439353b` · stack-text · source certificate · reported by step 58, certificate.json, rungs/R2.json

```text
K4 reported one finding in server/src/repositories/websocket.repository.ts, 3 times (step 58, certificate.json, rungs/R2.json):
- moved to server/src/platform/websocket/websocket.repository.ts; 1 stack-trace reads passed along as text (line 95); their frames now name the new path (step 58, certificate.json, rungs/R2.json)
```

Files: `server/src/repositories/websocket.repository.ts`

### Stack-trace text names moved paths (K4): server/src/services/person.service.ts

`F-a3f6cf654776` · stack-text · source certificate · reported by step 21, certificate.json, rungs/R1.json

> Two stack-trace reads in person.service.ts reference the moved path after the module relocation.

```text
K4 reported one finding in server/src/services/person.service.ts, 3 times (step 21, certificate.json, rungs/R1.json):
- moved to server/src/modules/person/person.service.ts; 2 stack-trace reads passed along as text (line 321); their frames now name the new path (step 21, certificate.json, rungs/R1.json)
```

Files: `server/src/services/person.service.ts`

### Stack-trace text names moved paths (K4): server/src/services/notification.service.ts

`F-a9fafedd2e0c` · stack-text · source certificate · reported by step 18, certificate.json, rungs/R1.json

> Two stack-trace reads in notification.service.ts now name the moved service path after the module relocation.

```text
K4 reported one finding in server/src/services/notification.service.ts, 3 times (step 18, certificate.json, rungs/R1.json):
- moved to server/src/modules/notification/notification.service.ts; 2 stack-trace reads passed along as text (line 88); their frames now name the new path (step 18, certificate.json, rungs/R1.json)
```

Files: `server/src/services/notification.service.ts`

### Stack-trace text names moved paths (K4): server/src/services/duplicate.service.ts

`F-ab4403001c97` · stack-text · source certificate · reported by step 10, certificate.json, rungs/R1.json

```text
K4 reported one finding in server/src/services/duplicate.service.ts, 3 times (step 10, certificate.json, rungs/R1.json):
- moved to server/src/modules/duplicate/duplicate.service.ts; 1 stack-trace reads passed along as text (line 104); their frames now name the new path (step 10, certificate.json, rungs/R1.json)
```

Files: `server/src/services/duplicate.service.ts`

### Stack-trace text names moved paths (K4): server/src/services/storage-template.service.ts

`F-ab71273b30ce` · stack-text · source certificate · reported by step 55, certificate.json, rungs/R2.json

```text
K4 reported one finding in server/src/services/storage-template.service.ts, 3 times (step 55, certificate.json, rungs/R2.json):
- moved to server/src/platform/storage/storage-template.service.ts; 1 stack-trace reads passed along as text (line 263); their frames now name the new path (step 55, certificate.json, rungs/R2.json)
```

Files: `server/src/services/storage-template.service.ts`

### Stack-trace text names moved paths (K4): server/src/utils/logger.ts

`F-b5d99548eaf9` · stack-text · source certificate · reported by step 49, certificate.json, rungs/R2.json

> One stack-trace in logger.ts reads passed-along text that now names the relocated utility path.

```text
K4 reported one finding in server/src/utils/logger.ts, 3 times (step 49, certificate.json, rungs/R2.json):
- moved to server/src/platform/logging/logger.ts; 1 stack-trace reads passed along as text (line 24); their frames now name the new path (step 49, certificate.json, rungs/R2.json)
```

Files: `server/src/utils/logger.ts`

### Stack-trace text names moved paths (K4): server/src/repositories/metadata.repository.ts

`F-cd5da954f0ed` · stack-text · source certificate · reported by step 51, certificate.json, rungs/R2.json

```text
K4 reported one finding in server/src/repositories/metadata.repository.ts, 3 times (step 51, certificate.json, rungs/R2.json):
- moved to server/src/platform/metadata/metadata.repository.ts; 1 stack-trace reads passed along as text (line 133); their frames now name the new path (step 51, certificate.json, rungs/R2.json)
```

Files: `server/src/repositories/metadata.repository.ts`

### Stack-trace text names moved paths (K4): server/src/services/asset-media.service.ts

`F-d7f70626dd55` · stack-text · source certificate · reported by step 4, certificate.json, rungs/R1.json

```text
K4 reported one finding in server/src/services/asset-media.service.ts, 3 times (step 4, certificate.json, rungs/R1.json):
- moved to server/src/modules/asset/asset-media.service.ts; 1 stack-trace reads passed along as text (line 224); their frames now name the new path (step 4, certificate.json, rungs/R1.json)
```

Files: `server/src/services/asset-media.service.ts`

### Stack-trace text names moved paths (K4): server/src/services/version.service.ts

`F-dad88f8446e6` · stack-text · source certificate · reported by step 35, certificate.json, rungs/R1.json

```text
K4 reported one finding in server/src/services/version.service.ts, 3 times (step 35, certificate.json, rungs/R1.json):
- moved to server/src/modules/version/version.service.ts; 1 stack-trace reads passed along as text (line 140); their frames now name the new path (step 35, certificate.json, rungs/R1.json)
```

Files: `server/src/services/version.service.ts`

## Inert tool config added (2)

### Inert tool config added (K1): server/.dependency-cruiser.json

`F-06567c18470b` · tool-config-added · source certificate · reported by certificate.json, rungs/R4.json

> K1 added a dependency-cruiser config at the package root that proves inert: no tsconfig program loads it, no reference references it, no published package packs it, and no other file names or globs it; CI path filters still trigger its jobs.

```text
K1 reported one finding in server/.dependency-cruiser.json, 2 times (certificate.json, rungs/R4.json):
- added at the package root and proven inert: in no tsconfig program, loaded by no reference, packed by no published package, named or globbed by no other file, and the tool runs nowhere; CI path filters match it, so it triggers their jobs: 'server/**' in .github/workflows/docker.yml (line 45), 'serv… (certificate.json, rungs/R4.json)
```

Files: `server/.dependency-cruiser.json`

### Inert tool config added (K1): server/.dependency-cruiser-known-violations.json

`F-d75862632092` · tool-config-added · source certificate · reported by certificate.json, rungs/R4.json

> K1 added a dependency-cruiser-known-violations config at the package root that proves inert: no tsconfig program loads it, no reference references it, no published package packs it, and no other file names or globs it; CI path filters still trigger its jobs.

```text
K1 reported one finding in server/.dependency-cruiser-known-violations.json, 2 times (certificate.json, rungs/R4.json):
- added at the package root and proven inert: in no tsconfig program, loaded by no reference, packed by no published package, named or globbed by no other file, and the tool runs nowhere; CI path filters match it, so it triggers their jobs: 'server/**' in .github/workflows/docker.yml (line 45), 'serv… (certificate.json, rungs/R4.json)
```

Files: `server/.dependency-cruiser-known-violations.json`

## Plan validator warnings (10)

### Plan warning (one-file-platform): platform/http-client

`F-14d96dec2313` · plan-warning · source validator

> The platform/http-client group in plan.yaml contains only one file and no other planned group uses it, so the one-file-platform rule flags it for possible folding.

```text
The plan validator's rule one-file-platform, on the run's plan.yaml (group platform/http-client): platform/http-client holds one file, and no other planned group uses it: consider folding it into the concern or feature it serves
```

Files: `server/src/utils/fetch.ts`

### Plan warning (one-file-platform): platform/check

`F-175fe3a4820a` · plan-warning · source validator

> The platform/check group in plan.yaml contains only one file and no other planned group uses it, so the one-file-platform rule flags it for possible folding.

```text
The plan validator's rule one-file-platform, on the run's plan.yaml (group platform/check): platform/check holds one file, and no other planned group uses it: consider folding it into the concern or feature it serves
```

Files: `server/src/commands/schema-check.ts`

### Plan warning (singleton-group): module/machine-learning

`F-545a4b88a62f` · plan-warning · source validator

> Rule singleton-group flags module/machine-learning because the plan holds only one file in that group.

```text
The plan validator's rule singleton-group, on the run's plan.yaml (group module/machine-learning): module/machine-learning holds one file
```

Files: `server/src/repositories/machine-learning.repository.ts`

### Plan warning (unsupported-merge): module/auth

`F-692ad4017c11` · plan-warning · source validator

> Plan rule unsupported-merge reports that module/auth has a draft group "grant" with no shared word, edge, table or route.

```text
The plan validator's rule unsupported-merge, on the run's plan.yaml (group module/auth): module/auth takes draft group "grant" (src/commands/grant-admin.ts): no shared word, edge, table or route
```

### Plan warning (platform-feature): platform/move

`F-6dc722024105` · plan-warning · source validator

> Rule platform-feature on group platform/move notes that move.repository.ts writes to table move_history, classifying it as a feature rather than plumbing.

```text
The plan validator's rule platform-feature, on the run's plan.yaml (group platform/move): src/repositories/move.repository.ts writes tables (move_history): a feature, not plumbing
```

Files: `server/src/repositories/move.repository.ts`

### Plan warning (one-file-platform): platform/move

`F-af06f12438b8` · plan-warning · source validator

> Rule one-file-platform on group platform/move flags that the group holds a single file used only by platform/storage, suggesting a potential fold.

```text
The plan validator's rule one-file-platform, on the run's plan.yaml (group platform/move): platform/move holds one file, and only platform/storage uses it: consider folding it there
```

Files: `server/src/repositories/move.repository.ts`

### Plan warning (platform-feature): platform/bootstrap

`F-e1c975dc8064` · plan-warning · source validator

> Rule platform-feature on group platform/bootstrap notes that app.controller.ts serves routes, classifying it as a feature rather than plumbing.

```text
The plan validator's rule platform-feature, on the run's plan.yaml (group platform/bootstrap): src/controllers/app.controller.ts serves routes: a feature, not plumbing
```

Files: `server/src/controllers/app.controller.ts`

### Plan warning (impure-shared): shared/shared

`F-e3b63d08f742` · plan-warning · source validator

> Rule impure-shared on group shared/shared flags that src/services/api.service.ts is a service, while shared/ should hold only pure code.

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

