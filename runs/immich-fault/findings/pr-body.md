## Restructure `server/` into feature modules

This PR moves 18 files of `server/src/` into 3 feature modules, in 3 commits. Only paths and import specifiers change, and every commit carries a certificate that proves it.

- **Status:** stopped; `02063972e8` → `ac51228171` on `ac/s7-fault`, wall time 13 m 37 s
- **Steps:** 59 (R1 38, R2 21, R3 0, R4 0): 3 certified, 0 pinned, 0 skipped
- **Files:** 18 moved; 59 import specifiers rewritten in 30 files (K2 of `rungs/R1.json`, base..head); nothing else edited
- **Pins:** 1 files the run left in place after a failure; 196 files the plan never moves (168 migration-or-schema, 9 script-reference, 8 location-sensitive, 5 test, 5 worker-or-bin, 1 entrypoint)

### Certificates

| Certificate | Range | Verdict | Checks | Digest |
|---|---|---|---|---|
| R1 rung (`rungs/R1.json`) | `02063972e8..ac51228171` | PASS (full, partial) | pass: K0 K1 K2 K3a K3b K3c K4 K6 K7 K8 | `sha256:8ea0a7596256d5ec…` |

Each of the 3 step commits carries its static certificate (every check but the oracles) as trailers: `Ac-Certificate`, `Ac-Certificate-Base-Tree`, `Ac-Certificate-Tree`, `Ac-Certificate-Digest`. Rung ends and the whole PR add the target's oracles (K8).

### How to verify

```sh
ac certify <checkout> 02063972e8..ac51228171 --profile immich --oracles
ac certify <checkout> <commit>~1..<commit> --profile immich   # one step, static checks
```

The certifier reads only the two committed trees and infers the moves itself, so it certifies any diff. The digest leaves out commit SHAs and machine paths: the same trees and checks give the digest in the trailer.

### Findings: recorded, never fixed

23 findings. A refactor should make existing problems obvious and leave them alone: these are recorded for follow-up, and this PR fixes none of them. Full log: `findings/findings.md` in the run directory.

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

### Residual risk

- No whole-PR certificate yet: see the rung certificates.

### Plan

Plan (from `immich-ladder/plan/plan.yaml`, sha256 `b4c7c548883c`): deterministic facts and seeds draft → Nemotron 3 Ultra (medium_effort) edits the draft (json_schema strict, K=3 in one n=K call) → the validator filters and ranks the edits → Nemotron 3 Ultra (medium_effort) reviews the winner (1 call) → the validator checks each suggestion. The plan cost $0.1998 when it was recorded; this run spent $0.0000 on it. Nemotron only plans: every step is deterministic and certified.
