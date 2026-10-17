## Restructure `server/` into feature modules

This PR moves 367 files of `server/src/` into 38 feature modules, 20 platform concerns and `shared/`, then renames 5 files to the house naming, and adds boundary rules with a frozen baseline, in 63 commits. Only paths and import specifiers change, and every commit carries a certificate that proves it.

- **Status:** completed; `02063972e8` → `c4be040b57` on `ac/s6-ladder`, wall time 1 h 55 m
- **Steps:** 63 (R1 38, R2 21, R3 3, R4 1): 63 certified, 0 pinned, 0 skipped
- **Files:** 367 moved, 5 renamed; 2474 import specifiers rewritten in 515 files (K2 of `certificate.json`, base..head); nothing else edited
- **Pins:** 0 files the run left in place after a failure; 196 files the plan never moves (168 migration-or-schema, 9 script-reference, 8 location-sensitive, 5 test, 5 worker-or-bin, 1 entrypoint)

### Certificates

| Certificate | Range | Verdict | Checks | Digest |
|---|---|---|---|---|
| R1 rung (`rungs/R1.json`) | `02063972e8..2f35e608a3` | PASS (full) | pass: K0 K1 K2 K3a K3b K3c K4 K6 K7 K8 | `sha256:d03d02e7de2c1d09…` |
| R2 rung (`rungs/R2.json`) | `2f35e608a3..775d52db5e` | PASS (full) | pass: K0 K1 K2 K3a K3b K3c K4 K6 K7 K8 | `sha256:0d0cf9a3bae58090…` |
| R3 rung (`rungs/R3.json`) | `775d52db5e..91a57545b7` | PASS (full) | pass: K0 K1 K2 K3a K3b K3c K4 K6 K7 K8 | `sha256:043030173380b8fd…` |
| R4 rung (`rungs/R4.json`) | `91a57545b7..b609f38a4a` | PASS (full) | pass: K0 K1 K2 K3a K3b K3c K4 K6 K7 K8 | `sha256:c57590c655d8e83e…` |
| **Whole PR** (`certificate.json`) | `02063972e8..c4be040b57` | PASS (full) | pass: K0 K1 K2 K3a K3b K3c K4 K6 K7 K8 | `sha256:9a5b2404631c2ac6…` |

Each of the 62 step commits carries its static certificate (every check but the oracles) as trailers: `Ac-Certificate`, `Ac-Certificate-Base-Tree`, `Ac-Certificate-Tree`, `Ac-Certificate-Digest`. Rung ends and the whole PR add the target's oracles (K8).

### How to verify

```sh
ac certify <checkout> 02063972e8..c4be040b57 --profile immich --oracles
ac certify <checkout> <commit>~1..<commit> --profile immich   # one step, static checks
```

The certifier reads only the two committed trees and infers the moves itself, so it certifies any diff. The digest leaves out commit SHAs and machine paths: the same trees and checks give the digest in the trailer.

### Findings: recorded, never fixed

45 findings. A refactor should make existing problems obvious and leave them alone: these are recorded for follow-up, and this PR fixes none of them. Full log: `findings/findings.md` in the run directory.

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

### Residual risk

- consumers outside the repository (deep imports, handler strings in infrastructure, other services)
- runtime file-system contents (assets, templates, SQL read at runtime)
- environment-dependent resolution (NODE_PATH, untracked or generated files)
- stack-trace and source-map text
- CI triggers and review routing keyed by path (workflow `paths`, CODEOWNERS)

### Plan

Plan (planned in this run, sha256 `b4c7c548883c`): deterministic facts and seeds draft → Nemotron 3 Ultra (medium_effort) edits the draft (json_schema strict, K=3 in one n=K call) → the validator filters and ranks the edits → Nemotron 3 Ultra (medium_effort) reviews the winner (1 call) → the validator checks each suggestion. The plan cost $0.1998 when it was recorded; this run spent $0.0000 (budget run `s6`). Nemotron only plans: every step is deterministic and certified.

Findings narrated by Nemotron 3.5 Lightning (thinking off): 35 of 45, $0.0010. The evidence under each finding is deterministic.
