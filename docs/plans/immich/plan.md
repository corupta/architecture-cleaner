# immich server/ plan

immich `server/` @ `02063972e8`. Planner: deterministic facts and seeds draft → Nemotron 3 Ultra (medium_effort) edits the draft (json_schema strict, K=3 in one n=K call) → the validator filters and ranks the edits → Nemotron 3 Ultra (medium_effort) reviews the winner (1 call) → the validator checks each suggestion.

- Movable files planned: **269**; pinned and left in place: **196** (168 migration-or-schema, 9 script-reference, 8 location-sensitive, 5 worker-or-bin, 5 test, 1 entrypoint).
- Final plan: **59 groups** (38 modules, 20 platform, 1 shared); cross-group edge ratio 0.8312; groups in cycles 55; TurboMQ sum 10.07.
- Placed away from the seeds draft: **44** files (16.4%); moved by the planner 8, by the critic 2; 30 contested.
- Cost: **$0.1998** in 2 calls (34703 prompt, 55027 completion tokens, 43261 of them reasoning).

## Candidates

| candidate | valid | groups | edit: group entries / moves | dropped by the validator | warnings | TurboMQ sum | cross-edge ratio | groups in cycles | placed away from draft | plan |
|---|---|---|---|---|---|---|---|---|---|---|
| seeds draft | yes | 81 | — | — | 47 | 10.19 | 0.8579 | 74 | 0 | `candidates/seeds-draft.yaml` |
| ultra#1 | yes | 52 | 81 / 58 | 10 | 29 | 9.16 | 0.8306 | 50 | 62 | `candidates/ultra-1.yaml` |
| ultra#2 | yes | 55 | 81 / 50 | 5 | 27 | 9.64 | 0.83 | 52 | 60 | `candidates/ultra-2.yaml` |
| ultra#3 (winner) | yes | 61 | 81 / 29 | 4 | 17 | 9.89 | 0.8351 | 57 | 41 | `candidates/ultra-3.yaml` |

Ranking: valid first, then fewer errors; among plans that keep at least 90% of the draft's TurboMQ sum, fewer validator warnings (the layout rules), then a higher TurboMQ sum and fewer groups in cycles. TurboMQ alone ranks the least-edited plan first (G1, and again here), and picking a plan without ground truth is still open, so every candidate is listed, and each one's full plan (before the critic) sits next to plan.yaml: `ac steps <plan dir>/candidates/<file>.yaml --out <dir>` makes steps from any of them.

## Groups

| group | files | roles | from draft groups | files |
|---|---|---|---|---|
| module/asset | 20 | 8 dto, 4 repository, 3 controller, 3 service, 1 interceptor, 1 util | 9 asset, 4 asset-file, 4 asset-media, 1 asset-edit, 1 asset-job, 1 shared | `controllers/asset-file.controller.ts`, `controllers/asset-media.controller.ts`, `controllers/asset.controller.ts`, `dtos/asset-file.dto.ts`, `dtos/asset-ids.response.dto.ts`, `dtos/asset-media-response.dto.ts`, `dtos/asset-media.dto.ts`, `dtos/asset-response.dto.ts`, … 12 more |
| module/user | 14 | 5 dto, 3 service, 2 command, 2 controller, 1 repository, 1 util | 12 user, 1 shared, 1 user-method | `commands/list-users.command.ts`, `commands/reset-admin-password.command.ts`, `controllers/user-admin.controller.ts`, `controllers/user.controller.ts`, `dtos/calendar-heatmap.dto.ts`, `dtos/license.dto.ts`, `dtos/user-preferences.dto.ts`, `dtos/user-profile.dto.ts`, … 6 more |
| shared/shared | 14 | 8 util, 4 other, 1 dto, 1 service | 11 shared, 1 env, 1 notification, 1 person | `decorators.ts`, `dtos/env.dto.ts`, `enum.ts`, `services/api.service.ts`, `types.ts`, `utils/bytes.ts`, `utils/date.ts`, `utils/mime-types.ts`, … 6 more |
| module/auth | 11 | 3 command, 3 controller, 2 service, 1 dto, 1 guard, 1 repository | 6 auth, 3 oauth, 1 grant, 1 password-login | `commands/grant-admin.ts`, `commands/oauth-login.ts`, `commands/password-login.ts`, `controllers/auth-admin.controller.ts`, `controllers/auth.controller.ts`, `controllers/oauth.controller.ts`, `dtos/auth.dto.ts`, `middleware/auth.guard.ts`, … 3 more |
| module/maintenance | 10 | 2 controller, 2 repository, 2 service, 1 command, 1 dto, 1 guard, 1 util | 6 maintenance, 2 maintenance-worker, 1 maintenance-websocket, 1 shared | `commands/maintenance-mode.ts`, `controllers/maintenance.controller.ts`, `dtos/maintenance.dto.ts`, `maintenance/maintenance-auth.guard.ts`, `maintenance/maintenance-websocket.repository.ts`, `maintenance/maintenance-worker.controller.ts`, `maintenance/maintenance-worker.service.ts`, `repositories/app.repository.ts`, … 2 more |
| module/config | 7 | 4 controller, 1 dto, 1 service, 1 util | 5 config, 2 system-config | `controllers/config-admin.controller.ts`, `controllers/config-public.controller.ts`, `controllers/config-user.controller.ts`, `controllers/system-config.controller.ts`, `dtos/config.dto.ts`, `services/system-config.service.ts`, `utils/config.ts` |
| module/notification | 7 | 2 controller, 2 repository, 2 service, 1 dto | 6 notification, 1 email | `controllers/notification-admin.controller.ts`, `controllers/notification.controller.ts`, `dtos/notification.dto.ts`, `repositories/email.repository.ts`, `repositories/notification.repository.ts`, `services/notification-admin.service.ts`, `services/notification.service.ts` |
| module/search | 7 | 2 service, 2 util, 1 controller, 1 dto, 1 repository | 6 search, 1 smart-info | `controllers/search.controller.ts`, `dtos/search.dto.ts`, `repositories/search.repository.ts`, `services/search.service.ts`, `services/smart-info.service.ts`, `utils/search-cursor.ts`, `utils/search-filter.ts` |
| module/person | 6 | 2 controller, 2 repository, 1 dto, 1 service | 5 person, 1 person-user | `controllers/face.controller.ts`, `controllers/person.controller.ts`, `dtos/person.dto.ts`, `repositories/person-user.repository.ts`, `repositories/person.repository.ts`, `services/person.service.ts` |
| module/plugin | 6 | 3 dto, 1 controller, 1 repository, 1 service | 6 plugin | `controllers/plugin.controller.ts`, `dtos/json-schema.dto.ts`, `dtos/plugin-manifest.dto.ts`, `dtos/plugin.dto.ts`, `repositories/plugin.repository.ts`, `services/plugin.service.ts` |
| module/sync | 6 | 2 repository, 1 controller, 1 dto, 1 service, 1 util | 5 sync, 1 sync-checkpoint | `controllers/sync.controller.ts`, `dtos/sync.dto.ts`, `repositories/sync-checkpoint.repository.ts`, `repositories/sync.repository.ts`, `services/sync.service.ts`, `utils/sync.ts` |
| module/tag | 6 | 2 util, 1 controller, 1 dto, 1 repository, 1 service | 6 tag | `controllers/tag.controller.ts`, `dtos/tag.dto.ts`, `repositories/tag.repository.ts`, `services/tag.service.ts`, `utils/replace-template-tags.ts`, `utils/tag.ts` |
| module/workflow | 6 | 2 service, 1 controller, 1 dto, 1 repository, 1 util | 5 workflow, 1 workflow-execution | `controllers/workflow.controller.ts`, `dtos/workflow.dto.ts`, `repositories/workflow.repository.ts`, `services/workflow-execution.service.ts`, `services/workflow.service.ts`, `utils/workflow.ts` |
| platform/registry | 6 | 6 registry | 6 registry | `app.module.ts`, `commands/index.ts`, `controllers/index.ts`, `repositories/index.ts`, `services/base.service.ts`, `services/index.ts` |
| module/album | 5 | 2 repository, 1 controller, 1 dto, 1 service | 4 album, 1 album-user | `controllers/album.controller.ts`, `dtos/album.dto.ts`, `repositories/album-user.repository.ts`, `repositories/album.repository.ts`, `services/album.service.ts` |
| module/duplicate | 5 | 1 controller, 1 dto, 1 repository, 1 service, 1 util | 5 duplicate | `controllers/duplicate.controller.ts`, `dtos/duplicate.dto.ts`, `repositories/duplicate.repository.ts`, `services/duplicate.service.ts`, `utils/duplicate.ts` |
| module/shared-link | 5 | 2 repository, 1 controller, 1 dto, 1 service | 4 shared-link, 1 shared-link-asset | `controllers/shared-link.controller.ts`, `dtos/shared-link.dto.ts`, `repositories/shared-link-asset.repository.ts`, `repositories/shared-link.repository.ts`, `services/shared-link.service.ts` |
| module/system-metadata | 5 | 2 dto, 1 controller, 1 repository, 1 service | 4 system-metadata, 1 user | `controllers/system-metadata.controller.ts`, `dtos/onboarding.dto.ts`, `dtos/system-metadata.dto.ts`, `repositories/system-metadata.repository.ts`, `services/system-metadata.service.ts` |
| platform/logging | 5 | 2 interceptor, 1 filter, 1 repository, 1 util | 5 logging | `middleware/error.interceptor.ts`, `middleware/global-exception.filter.ts`, `middleware/logging.interceptor.ts`, `repositories/logging.repository.ts`, `utils/logger.ts` |
| platform/media | 5 | 2 util, 1 command, 1 repository, 1 service | 4 media, 1 shared | `commands/media-location.command.ts`, `repositories/media.repository.ts`, `services/media.service.ts`, `utils/editor.ts`, `utils/media.ts` |
| module/activity | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 activity | `controllers/activity.controller.ts`, `dtos/activity.dto.ts`, `repositories/activity.repository.ts`, `services/activity.service.ts` |
| module/api-key | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 api-key | `controllers/api-key.controller.ts`, `dtos/api-key.dto.ts`, `repositories/api-key.repository.ts`, `services/api-key.service.ts` |
| module/cluster-group | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 cluster-group | `controllers/cluster-group.controller.ts`, `dtos/cluster-group.dto.ts`, `repositories/cluster-group.repository.ts`, `services/cluster-group.service.ts` |
| module/database-backup | 4 | 1 controller, 1 dto, 1 service, 1 util | 4 database-backup | `controllers/database-backup.controller.ts`, `dtos/database-backup.dto.ts`, `services/database-backup.service.ts`, `utils/database-backups.ts` |
| module/download | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 download | `controllers/download.controller.ts`, `dtos/download.dto.ts`, `repositories/download.repository.ts`, `services/download.service.ts` |
| module/integrity | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 integrity | `controllers/integrity-admin.controller.ts`, `dtos/integrity.dto.ts`, `repositories/integrity.repository.ts`, `services/integrity.service.ts` |
| module/job | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 job | `controllers/job.controller.ts`, `dtos/job.dto.ts`, `repositories/job.repository.ts`, `services/job.service.ts` |
| module/library | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 library | `controllers/library.controller.ts`, `dtos/library.dto.ts`, `repositories/library.repository.ts`, `services/library.service.ts` |
| module/map | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 map | `controllers/map.controller.ts`, `dtos/map.dto.ts`, `repositories/map.repository.ts`, `services/map.service.ts` |
| module/memory | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 memory | `controllers/memory.controller.ts`, `dtos/memory.dto.ts`, `repositories/memory.repository.ts`, `services/memory.service.ts` |
| module/partner | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 partner | `controllers/partner.controller.ts`, `dtos/partner.dto.ts`, `repositories/partner.repository.ts`, `services/partner.service.ts` |
| module/queue | 4 | 2 dto, 1 controller, 1 service | 4 queue | `controllers/queue.controller.ts`, `dtos/queue-legacy.dto.ts`, `dtos/queue.dto.ts`, `services/queue.service.ts` |
| module/server | 4 | 1 controller, 1 dto, 1 repository, 1 service | 3 server, 1 server-info | `controllers/server.controller.ts`, `dtos/server.dto.ts`, `repositories/server-info.repository.ts`, `services/server.service.ts` |
| module/session | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 session | `controllers/session.controller.ts`, `dtos/session.dto.ts`, `repositories/session.repository.ts`, `services/session.service.ts` |
| module/stack | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 stack | `controllers/stack.controller.ts`, `dtos/stack.dto.ts`, `repositories/stack.repository.ts`, `services/stack.service.ts` |
| module/timeline | 4 | 2 dto, 1 controller, 1 service | 4 timeline | `controllers/timeline.controller.ts`, `dtos/bbox.dto.ts`, `dtos/time-bucket.dto.ts`, `services/timeline.service.ts` |
| module/trash | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 trash | `controllers/trash.controller.ts`, `dtos/trash.dto.ts`, `repositories/trash.repository.ts`, `services/trash.service.ts` |
| module/video-stream | 4 | 1 controller, 1 dto, 1 repository, 1 service | 3 video-stream, 1 hls | `controllers/video-stream.controller.ts`, `dtos/streaming.dto.ts`, `repositories/video-stream.repository.ts`, `services/hls.service.ts` |
| platform/storage | 4 | 2 service, 1 other, 1 repository | 3 storage, 1 storage-template | `cores/storage.core.ts`, `repositories/storage.repository.ts`, `services/storage-template.service.ts`, `services/storage.service.ts` |
| module/ocr | 3 | 1 dto, 1 repository, 1 service | 3 ocr | `dtos/ocr.dto.ts`, `repositories/ocr.repository.ts`, `services/ocr.service.ts` |
| module/version | 3 | 1 command, 1 repository, 1 service | 2 version, 1 version-history | `commands/version.command.ts`, `repositories/version-history.repository.ts`, `services/version.service.ts` |
| module/view | 3 | 1 controller, 1 repository, 1 service | 3 view | `controllers/view.controller.ts`, `repositories/view-repository.ts`, `services/view.service.ts` |
| platform/access | 3 | 2 util, 1 repository | 3 access | `repositories/access.repository.ts`, `utils/access.ts`, `utils/set.ts` |
| platform/database | 3 | 1 other, 1 service, 1 util | 3 database | `database.ts`, `services/database.service.ts`, `utils/database.ts` |
| platform/metadata | 3 | 1 repository, 1 service, 1 util | 3 metadata | `repositories/metadata.repository.ts`, `services/metadata.service.ts`, `utils/tasks.ts` |
| platform/bootstrap | 2 | 1 controller, 1 other | 1 auth, 1 shared | `app.common.ts`, `controllers/app.controller.ts` |
| platform/event | 2 | 1 repository, 1 util | 2 event | `repositories/event.repository.ts`, `utils/event.ts` |
| platform/file | 2 | 1 interceptor, 1 util | 2 file | `middleware/file-upload.interceptor.ts`, `utils/file.ts` |
| platform/telemetry | 2 | 1 repository, 1 service | 2 telemetry | `repositories/telemetry.repository.ts`, `services/telemetry.service.ts` |
| platform/websocket | 2 | 1 middleware, 1 repository | 2 websocket | `middleware/websocket.adapter.ts`, `repositories/websocket.repository.ts` |
| module/machine-learning | 1 | 1 repository | 1 machine-learning | `repositories/machine-learning.repository.ts` |
| platform/check | 1 | 1 command | 1 check | `commands/schema-check.ts` |
| platform/cron | 1 | 1 repository | 1 cron | `repositories/cron.repository.ts` |
| platform/crypto | 1 | 1 repository | 1 crypto | `repositories/crypto.repository.ts` |
| platform/http-client | 1 | 1 util | 1 fetch | `utils/fetch.ts` |
| platform/http-response | 1 | 1 util | 1 response | `utils/response.ts` |
| platform/move | 1 | 1 repository | 1 move | `repositories/move.repository.ts` |
| platform/process | 1 | 1 repository | 1 process | `repositories/process.repository.ts` |
| platform/transcoding | 1 | 1 service | 1 transcoding | `services/transcoding.service.ts` |

## Contested files moved by Nemotron (10)

- `app.common.ts` → platform/bootstrap (planner, draft "shared", contested): Bootstrap wiring for Express and telemetry; belongs to platform plumbing.
- `controllers/app.controller.ts` → platform/bootstrap (planner, draft "auth", propagated-weak): Root app controller only serves health/info endpoints; platform plumbing.
- `dtos/editing.dto.ts` → module/asset (planner, draft "shared", contested): Editing DTOs are used by asset edit flows.
- `dtos/env.dto.ts` → shared/shared (planner, draft "env", isolated): Environment schema DTO is a pure type shared across config.
- `dtos/onboarding.dto.ts` → module/system-metadata (planner, draft "user", propagated-strong): Onboarding DTOs used by system‑metadata controller.
- `repositories/app.repository.ts` → module/maintenance (critic, draft "shared", contested): Only the maintenance module consumes this repository; fixes the impure‑shared warning.
- `utils/editor.ts` → platform/media (critic, draft "shared", contested): Utility is only imported by platform/media; moving it out of shared resolves the single‑consumer warning.
- `utils/object.ts` → shared/shared (planner, draft "notification", propagated-weak): Plain object utilities.
- `utils/pagination.ts` → shared/shared (planner, draft "person", propagated-weak): Pagination helpers used everywhere.
- `utils/profile-image.ts` → module/user (planner, draft "shared", contested): Profile image generation used by user feature.

Contested files left where the draft put them (20): `commands/grant-admin.ts` (module/auth, isolated), `commands/password-login.ts` (module/auth, isolated), `commands/schema-check.ts` (platform/check, isolated), `controllers/face.controller.ts` (module/person, propagated-weak), `decorators.ts` (shared/shared, contested), `dtos/exif.dto.ts` (module/asset, propagated-weak), `dtos/license.dto.ts` (module/user, propagated-weak), `enum.ts` (shared/shared, contested), `middleware/global-exception.filter.ts` (platform/logging, propagated-weak), `services/api.service.ts` (shared/shared, contested), `types.ts` (shared/shared, contested), `utils/bytes.ts` (shared/shared, contested), `utils/date.ts` (shared/shared, contested), `utils/fetch.ts` (platform/http-client, isolated), `utils/logger.ts` (platform/logging, propagated-weak), `utils/mime-types.ts` (shared/shared, contested), `utils/preferences.ts` (shared/shared, contested), `utils/request.ts` (shared/shared, contested), `utils/transform.ts` (shared/shared, contested), `validation.ts` (shared/shared, contested).

## Critic review

> The plan correctly slices most business features into modules and keeps pure utilities in shared/. However, several validator warnings reveal misplaced plumbing and impure shared code: two repositories and a service live in shared/, five one‑file platform groups exist, three platform groups (ocr, version, app.controller) actually own tables or routes and belong in feature modules, and utils/editor.ts is only used by platform/media. Moving the offending files to their true owners and re‑classifying the three platform groups as modules removes all warnings without breaking cohesion. No unrelated merges are required.

- rejected: group platform/check → module/maintenance (a merge without evidence: no edge between the files of platform/check and module/maintenance, no table or route both use)
- accepted: group platform/hls → module/video-stream (evidence: 2 edges)
- accepted: group platform/mail → module/notification (evidence: 3 edges)
- rejected: group platform/move → module/asset (a merge without evidence: no edge between the files of platform/move and module/asset, no table or route both use)
- accepted: group platform/ocr → module/ocr
- accepted: group platform/version → module/version
- rejected: move src/commands/schema-check.ts → module/maintenance: Schema‑check is a maintenance CLI command; moves the one‑file platform/check group into the maintenance feature. (a merge without evidence: no edge between the files of platform/check and module/maintenance, no table or route both use)
- rejected: move src/repositories/move.repository.ts → module/asset: Move repository writes the move_history table used by asset handling; belongs to the asset feature, not plumbing. (a merge without evidence: no edge between the files of platform/move and module/asset, no table or route both use)
- rejected: move src/controllers/app.controller.ts → module/server: AppController serves HTTP routes (health/check) and is a feature entry point; moves it out of platform/bootstrap. (a move without evidence: no edge between src/controllers/app.controller.ts and the files of module/server, no table or route both use)
- accepted: move src/repositories/app.repository.ts → module/maintenance: Only the maintenance module consumes this repository; fixes the impure‑shared warning. (evidence: 3 edges)
- rejected: move src/services/api.service.ts → platform/http-client: Generic HTTP client service is plumbing used by many features; belongs in platform/http‑client, removing it from shared. (a move without evidence: no edge between src/services/api.service.ts and the files of platform/http-client, no table or route both use)
- accepted: move src/utils/editor.ts → platform/media: Utility is only imported by platform/media; moving it out of shared resolves the single‑consumer warning. (evidence: 1 edge)

## Validator

- warning impure-shared: src/services/api.service.ts is a service; shared/ holds pure code only
- warning one-file-platform: platform/check holds one file, and no other planned group uses it: consider folding it into the concern or feature it serves
- warning one-file-platform: platform/http-client holds one file, and no other planned group uses it: consider folding it into the concern or feature it serves
- warning one-file-platform: platform/move holds one file, and only platform/storage uses it: consider folding it there
- warning one-file-platform: platform/transcoding holds one file, and no other planned group uses it: consider folding it into the concern or feature it serves
- warning platform-feature: src/controllers/app.controller.ts serves routes: a feature, not plumbing
- warning platform-feature: src/repositories/move.repository.ts writes tables (move_history): a feature, not plumbing
- warning singleton-group: module/machine-learning holds one file
- warning unsupported-merge: module/auth takes draft group "grant" (src/commands/grant-admin.ts): no shared word, edge, table or route
- warning unsupported-merge: module/auth takes draft group "password-login" (src/commands/password-login.ts): no shared word, edge, table or route

Strongest graph disagreements left in the plan (own edge share vs the pulling group):

- `dtos/onboarding.dto.ts` in module/system-metadata (0) pulled to module/user (1)
- `middleware/websocket.adapter.ts` in platform/websocket (0) pulled to platform/bootstrap (1)
- `services/database.service.ts` in platform/database (0) pulled to shared/shared (0.71)
- `repositories/album-user.repository.ts` in module/album (0.33) pulled to shared/shared (0.67)
- `repositories/integrity.repository.ts` in module/integrity (0.33) pulled to shared/shared (0.67)
- `repositories/sync-checkpoint.repository.ts` in module/sync (0.33) pulled to shared/shared (0.67)
- `repositories/trash.repository.ts` in module/trash (0.33) pulled to shared/shared (0.67)
- `utils/event.ts` in platform/event (0.33) pulled to module/video-stream (0.67)
- `dtos/api-key.dto.ts` in module/api-key (0.4) pulled to shared/shared (0.6)
- `utils/workflow.ts` in module/workflow (0.2) pulled to module/plugin (0.6)
- `controllers/app.controller.ts` in platform/bootstrap (0) pulled to module/auth (0.5)
- `controllers/library.controller.ts` in module/library (0.33) pulled to shared/shared (0.5)

Group cycles: 55 groups (module/activity, module/album, module/api-key, module/asset, module/auth, module/cluster-group, …).

## Pinned

| reason | files |
|---|---|
| migration-or-schema (168) | `schema/enums.ts`, `schema/functions.ts`, `schema/index.ts`, `schema/migrations/1744910873969-InitialMigration.ts`, `schema/migrations/1744991379464-AddNotificationsTable.ts`, `schema/migrations/1745244781846-AddUserAvatarColorColumn.ts`, `schema/migrations/1745902563899-AddAssetVisibilityColumn.ts`, `schema/migrations/1746636476623-DropExtraIndexes.ts`, `schema/migrations/1746768490606-AddUserPincode.ts`, `schema/migrations/1746844028242-AddLockedVisibilityEnum.ts`, … 158 more |
| script-reference (9) | `emails/album-invite.email.tsx`, `emails/album-update.email.tsx`, `emails/components/button.component.tsx`, `emails/components/footer.template.tsx`, `emails/components/futo.layout.tsx`, `emails/components/immich.layout.tsx`, `emails/license.email.tsx`, `emails/test.email.tsx`, `emails/welcome.email.tsx` |
| location-sensitive (8) | `constants.ts`, `maintenance/maintenance-health.repository.ts`, `repositories/config.repository.ts`, `repositories/database.repository.ts`, `repositories/storage.repository.spec.ts`, `services/cli.service.ts`, `services/library.service.spec.ts`, `utils/misc.ts` |
| test (5) | `controllers/config.controller.spec.ts`, `dtos/album-response.dto.spec.ts`, `repositories/config.repository.spec.ts`, `services/cli.service.spec.ts`, `utils/misc.spec.ts` |
| worker-or-bin (5) | `bin/sync-open-api.ts`, `bin/sync-sql.ts`, `workers/api.ts`, `workers/maintenance.ts`, `workers/microservices.ts` |
| entrypoint (1) | `main.ts` |

## Steps

| step | rung | group | moves (with tests) | kept in a subfolder (name clash) |
|---|---|---|---|---|
| 1 | R1 | module/activity | 6 | — |
| 2 | R1 | module/album | 7 | — |
| 3 | R1 | module/api-key | 6 | — |
| 4 | R1 | module/asset | 24 | — |
| 5 | R1 | module/auth | 15 | — |
| 6 | R1 | module/cluster-group | 4 | — |
| 7 | R1 | module/config | 10 | — |
| 8 | R1 | module/database-backup | 6 | — |
| 9 | R1 | module/download | 6 | — |
| 10 | R1 | module/duplicate | 8 | — |
| 11 | R1 | module/integrity | 5 | — |
| 12 | R1 | module/job | 6 | — |
| 13 | R1 | module/library | 5 | — |
| 14 | R1 | module/machine-learning | 1 | — |
| 15 | R1 | module/maintenance | 13 | — |
| 16 | R1 | module/map | 6 | — |
| 17 | R1 | module/memory | 6 | — |
| 18 | R1 | module/notification | 12 | — |
| 19 | R1 | module/ocr | 4 | — |
| 20 | R1 | module/partner | 6 | — |
| 21 | R1 | module/person | 8 | — |
| 22 | R1 | module/plugin | 7 | — |
| 23 | R1 | module/queue | 5 | — |
| 24 | R1 | module/search | 12 | — |
| 25 | R1 | module/server | 5 | — |
| 26 | R1 | module/session | 5 | — |
| 27 | R1 | module/shared-link | 7 | — |
| 28 | R1 | module/stack | 6 | — |
| 29 | R1 | module/sync | 8 | — |
| 30 | R1 | module/system-metadata | 7 | — |
| 31 | R1 | module/tag | 8 | — |
| 32 | R1 | module/timeline | 6 | — |
| 33 | R1 | module/trash | 6 | — |
| 34 | R1 | module/user | 19 | — |
| 35 | R1 | module/version | 4 | — |
| 36 | R1 | module/video-stream | 5 | — |
| 37 | R1 | module/view | 4 | — |
| 38 | R1 | module/workflow | 8 | — |
| 39 | R2 | platform/access | 3 | — |
| 40 | R2 | platform/bootstrap | 3 | — |
| 41 | R2 | platform/check | 1 | — |
| 42 | R2 | platform/cron | 1 | — |
| 43 | R2 | platform/crypto | 1 | — |
| 44 | R2 | platform/database | 4 | `utils/database.ts` |
| 45 | R2 | platform/event | 2 | — |
| 46 | R2 | platform/file | 2 | — |
| 47 | R2 | platform/http-client | 2 | — |
| 48 | R2 | platform/http-response | 1 | — |
| 49 | R2 | platform/logging | 6 | — |
| 50 | R2 | platform/media | 8 | — |
| 51 | R2 | platform/metadata | 4 | — |
| 52 | R2 | platform/move | 1 | — |
| 53 | R2 | platform/process | 2 | — |
| 54 | R2 | platform/registry | 7 | `commands/index.ts`, `controllers/index.ts`, `repositories/index.ts`, `services/index.ts` |
| 55 | R2 | platform/storage | 7 | — |
| 56 | R2 | platform/telemetry | 2 | — |
| 57 | R2 | platform/transcoding | 2 | — |
| 58 | R2 | platform/websocket | 2 | — |
| 59 | R2 | shared/shared | 20 | — |
