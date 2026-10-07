# immich server/ plan

immich `server/` @ `02063972e8`. Planner: deterministic facts and seeds draft → Nemotron 3 Ultra (medium_effort) edits the draft (json_schema strict, K=3 in one n=K call) → the validator filters and ranks the edits → Nemotron 3 Ultra (medium_effort) reviews the winner (1 call) → the validator checks each suggestion.

- Movable files planned: **269**; pinned and left in place: **196** (168 migration-or-schema, 9 script-reference, 8 location-sensitive, 5 worker-or-bin, 5 test, 1 entrypoint).
- Final plan: **63 groups** (41 modules, 21 platform, 1 shared); cross-group edge ratio 0.8431; groups in cycles 57; TurboMQ sum 10.17.
- Placed away from the seeds draft: **38** files (14.1%); moved by the planner 9, by the critic 4; 30 contested.
- Cost: **$0.1786** in 2 calls (34353 prompt, 48097 completion tokens, 37794 of them reasoning).

## Candidates

| candidate | valid | groups | edit: group entries / moves | dropped by the validator | warnings | TurboMQ sum | cross-edge ratio | groups in cycles | placed away from draft |
|---|---|---|---|---|---|---|---|---|---|
| seeds draft | yes | 81 | — | — | 45 | 10.19 | 0.8579 | 74 | 0 |
| ultra#1 (winner) | yes | 70 | 81 / 9 | 0 | 7 | 10.30 | 0.8454 | 62 | 29 |
| ultra#2 | yes | 65 | 81 / 57 | 7 | 12 | 9.61 | 0.8431 | 59 | 39 |
| ultra#3 | yes | 57 | 81 / 28 | 6 | 12 | 10.10 | 0.842 | 55 | 33 |

Ranking: valid first, then fewer errors; among plans that keep at least 90% of the draft's TurboMQ sum, fewer validator warnings (the layout rules), then a higher TurboMQ sum and fewer groups in cycles. TurboMQ alone ranks the least-edited plan first (G1, and again here), and picking a plan without ground truth is still open, so every candidate is listed.

## Groups

| group | files | roles | from draft groups | files |
|---|---|---|---|---|
| module/user | 15 | 6 dto, 3 service, 2 command, 2 controller, 1 repository, 1 util | 13 user, 1 shared, 1 user-method | `commands/list-users.command.ts`, `commands/reset-admin-password.command.ts`, `controllers/user-admin.controller.ts`, `controllers/user.controller.ts`, `dtos/calendar-heatmap.dto.ts`, `dtos/license.dto.ts`, `dtos/onboarding.dto.ts`, `dtos/user-preferences.dto.ts`, … 7 more |
| module/asset | 14 | 5 dto, 4 repository, 2 util, 1 controller, 1 interceptor, 1 service | 9 asset, 2 shared, 1 asset-edit, 1 asset-job, 1 move | `controllers/asset.controller.ts`, `dtos/asset-ids.response.dto.ts`, `dtos/asset-response.dto.ts`, `dtos/asset.dto.ts`, `dtos/editing.dto.ts`, `dtos/exif.dto.ts`, `middleware/asset-upload.interceptor.ts`, `repositories/asset-edit.repository.ts`, … 6 more |
| shared/shared | 12 | 8 util, 4 other | 10 shared, 1 notification, 1 person | `decorators.ts`, `enum.ts`, `types.ts`, `utils/bytes.ts`, `utils/date.ts`, `utils/mime-types.ts`, `utils/object.ts`, `utils/pagination.ts`, … 4 more |
| module/maintenance | 9 | 2 controller, 2 service, 1 command, 1 dto, 1 guard, 1 repository, 1 util | 6 maintenance, 2 maintenance-worker, 1 maintenance-websocket | `commands/maintenance-mode.ts`, `controllers/maintenance.controller.ts`, `dtos/maintenance.dto.ts`, `maintenance/maintenance-auth.guard.ts`, `maintenance/maintenance-websocket.repository.ts`, `maintenance/maintenance-worker.controller.ts`, `maintenance/maintenance-worker.service.ts`, `services/maintenance.service.ts`, … 1 more |
| module/auth | 8 | 2 command, 2 controller, 2 service, 1 dto, 1 guard | 6 auth, 1 grant, 1 password-login | `commands/grant-admin.ts`, `commands/password-login.ts`, `controllers/auth-admin.controller.ts`, `controllers/auth.controller.ts`, `dtos/auth.dto.ts`, `middleware/auth.guard.ts`, `services/auth-admin.service.ts`, `services/auth.service.ts` |
| module/config | 7 | 4 controller, 1 dto, 1 service, 1 util | 5 config, 2 system-config | `controllers/config-admin.controller.ts`, `controllers/config-public.controller.ts`, `controllers/config-user.controller.ts`, `controllers/system-config.controller.ts`, `dtos/config.dto.ts`, `services/system-config.service.ts`, `utils/config.ts` |
| module/search | 7 | 2 service, 2 util, 1 controller, 1 dto, 1 repository | 6 search, 1 smart-info | `controllers/search.controller.ts`, `dtos/search.dto.ts`, `repositories/search.repository.ts`, `services/search.service.ts`, `services/smart-info.service.ts`, `utils/search-cursor.ts`, `utils/search-filter.ts` |
| module/system-metadata | 7 | 2 repository, 2 service, 1 controller, 1 dto, 1 util | 4 system-metadata, 3 metadata | `controllers/system-metadata.controller.ts`, `dtos/system-metadata.dto.ts`, `repositories/metadata.repository.ts`, `repositories/system-metadata.repository.ts`, `services/metadata.service.ts`, `services/system-metadata.service.ts`, `utils/tasks.ts` |
| module/notification | 6 | 2 controller, 2 service, 1 dto, 1 repository | 6 notification | `controllers/notification-admin.controller.ts`, `controllers/notification.controller.ts`, `dtos/notification.dto.ts`, `repositories/notification.repository.ts`, `services/notification-admin.service.ts`, `services/notification.service.ts` |
| module/person | 6 | 2 controller, 2 repository, 1 dto, 1 service | 5 person, 1 person-user | `controllers/face.controller.ts`, `controllers/person.controller.ts`, `dtos/person.dto.ts`, `repositories/person-user.repository.ts`, `repositories/person.repository.ts`, `services/person.service.ts` |
| module/plugin | 6 | 3 dto, 1 controller, 1 repository, 1 service | 6 plugin | `controllers/plugin.controller.ts`, `dtos/json-schema.dto.ts`, `dtos/plugin-manifest.dto.ts`, `dtos/plugin.dto.ts`, `repositories/plugin.repository.ts`, `services/plugin.service.ts` |
| module/sync | 6 | 2 repository, 1 controller, 1 dto, 1 service, 1 util | 5 sync, 1 sync-checkpoint | `controllers/sync.controller.ts`, `dtos/sync.dto.ts`, `repositories/sync-checkpoint.repository.ts`, `repositories/sync.repository.ts`, `services/sync.service.ts`, `utils/sync.ts` |
| module/tag | 6 | 2 util, 1 controller, 1 dto, 1 repository, 1 service | 6 tag | `controllers/tag.controller.ts`, `dtos/tag.dto.ts`, `repositories/tag.repository.ts`, `services/tag.service.ts`, `utils/replace-template-tags.ts`, `utils/tag.ts` |
| module/workflow | 6 | 2 service, 1 controller, 1 dto, 1 repository, 1 util | 5 workflow, 1 workflow-execution | `controllers/workflow.controller.ts`, `dtos/workflow.dto.ts`, `repositories/workflow.repository.ts`, `services/workflow-execution.service.ts`, `services/workflow.service.ts`, `utils/workflow.ts` |
| platform/registry | 6 | 6 registry | 6 registry | `app.module.ts`, `commands/index.ts`, `controllers/index.ts`, `repositories/index.ts`, `services/base.service.ts`, `services/index.ts` |
| module/album | 5 | 2 repository, 1 controller, 1 dto, 1 service | 4 album, 1 album-user | `controllers/album.controller.ts`, `dtos/album.dto.ts`, `repositories/album-user.repository.ts`, `repositories/album.repository.ts`, `services/album.service.ts` |
| module/duplicate | 5 | 1 controller, 1 dto, 1 repository, 1 service, 1 util | 5 duplicate | `controllers/duplicate.controller.ts`, `dtos/duplicate.dto.ts`, `repositories/duplicate.repository.ts`, `services/duplicate.service.ts`, `utils/duplicate.ts` |
| module/media | 5 | 2 service, 1 command, 1 repository, 1 util | 4 media, 1 transcoding | `commands/media-location.command.ts`, `repositories/media.repository.ts`, `services/media.service.ts`, `services/transcoding.service.ts`, `utils/media.ts` |
| module/shared-link | 5 | 2 repository, 1 controller, 1 dto, 1 service | 4 shared-link, 1 shared-link-asset | `controllers/shared-link.controller.ts`, `dtos/shared-link.dto.ts`, `repositories/shared-link-asset.repository.ts`, `repositories/shared-link.repository.ts`, `services/shared-link.service.ts` |
| module/activity | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 activity | `controllers/activity.controller.ts`, `dtos/activity.dto.ts`, `repositories/activity.repository.ts`, `services/activity.service.ts` |
| module/api-key | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 api-key | `controllers/api-key.controller.ts`, `dtos/api-key.dto.ts`, `repositories/api-key.repository.ts`, `services/api-key.service.ts` |
| module/asset-file | 4 | 1 controller, 1 dto, 1 repository, 1 service | 4 asset-file | `controllers/asset-file.controller.ts`, `dtos/asset-file.dto.ts`, `repositories/asset-file.repository.ts`, `services/asset-file.service.ts` |
| module/asset-media | 4 | 2 dto, 1 controller, 1 service | 4 asset-media | `controllers/asset-media.controller.ts`, `dtos/asset-media-response.dto.ts`, `dtos/asset-media.dto.ts`, `services/asset-media.service.ts` |
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
| platform/logging | 4 | 2 interceptor, 1 repository, 1 util | 4 logging | `middleware/error.interceptor.ts`, `middleware/logging.interceptor.ts`, `repositories/logging.repository.ts`, `utils/logger.ts` |
| platform/storage | 4 | 2 service, 1 other, 1 repository | 3 storage, 1 storage-template | `cores/storage.core.ts`, `repositories/storage.repository.ts`, `services/storage-template.service.ts`, `services/storage.service.ts` |
| module/oauth | 3 | 1 command, 1 controller, 1 repository | 3 oauth | `commands/oauth-login.ts`, `controllers/oauth.controller.ts`, `repositories/oauth.repository.ts` |
| module/ocr | 3 | 1 dto, 1 repository, 1 service | 3 ocr | `dtos/ocr.dto.ts`, `repositories/ocr.repository.ts`, `services/ocr.service.ts` |
| module/version | 3 | 1 command, 1 repository, 1 service | 2 version, 1 version-history | `commands/version.command.ts`, `repositories/version-history.repository.ts`, `services/version.service.ts` |
| module/view | 3 | 1 controller, 1 repository, 1 service | 3 view | `controllers/view.controller.ts`, `repositories/view-repository.ts`, `services/view.service.ts` |
| platform/access | 3 | 2 util, 1 repository | 3 access | `repositories/access.repository.ts`, `utils/access.ts`, `utils/set.ts` |
| platform/database | 3 | 1 other, 1 service, 1 util | 3 database | `database.ts`, `services/database.service.ts`, `utils/database.ts` |
| platform/http | 3 | 1 controller, 1 filter, 1 service | 1 auth, 1 logging, 1 shared | `controllers/app.controller.ts`, `middleware/global-exception.filter.ts`, `services/api.service.ts` |
| platform/event | 2 | 1 repository, 1 util | 2 event | `repositories/event.repository.ts`, `utils/event.ts` |
| platform/file-upload | 2 | 1 interceptor, 1 util | 2 file | `middleware/file-upload.interceptor.ts`, `utils/file.ts` |
| platform/telemetry | 2 | 1 repository, 1 service | 2 telemetry | `repositories/telemetry.repository.ts`, `services/telemetry.service.ts` |
| platform/websocket | 2 | 1 middleware, 1 repository | 2 websocket | `middleware/websocket.adapter.ts`, `repositories/websocket.repository.ts` |
| platform/app-repository | 1 | 1 repository | 1 shared | `repositories/app.repository.ts` |
| platform/bootstrap | 1 | 1 other | 1 shared | `app.common.ts` |
| platform/check | 1 | 1 command | 1 check | `commands/schema-check.ts` |
| platform/cron | 1 | 1 repository | 1 cron | `repositories/cron.repository.ts` |
| platform/crypto | 1 | 1 repository | 1 crypto | `repositories/crypto.repository.ts` |
| platform/email | 1 | 1 repository | 1 email | `repositories/email.repository.ts` |
| platform/env | 1 | 1 dto | 1 env | `dtos/env.dto.ts` |
| platform/fetch | 1 | 1 util | 1 fetch | `utils/fetch.ts` |
| platform/http-response | 1 | 1 util | 1 response | `utils/response.ts` |
| platform/machine-learning | 1 | 1 repository | 1 machine-learning | `repositories/machine-learning.repository.ts` |
| platform/process | 1 | 1 repository | 1 process | `repositories/process.repository.ts` |

## Contested files moved by Nemotron (13)

- `app.common.ts` → platform/bootstrap (planner, draft "shared", contested): Bootstrap wiring (configureExpress, configureTelemetry) belongs to platform plumbing, not shared utilities.
- `commands/grant-admin.ts` → module/auth (critic, draft "grant", isolated): Grant/revoke admin commands belong to the auth feature.
- `commands/password-login.ts` → module/auth (critic, draft "password-login", isolated): Password‑login enable/disable commands are admin entry points for authentication.
- `controllers/app.controller.ts` → platform/http (planner, draft "auth", propagated-weak): Generic AppController is an HTTP entry point used by the platform, not part of the auth feature.
- `dtos/editing.dto.ts` → module/asset (planner, draft "shared", contested): Editing DTOs are specific to the asset‑edit sub‑feature which is merged into the asset module.
- `middleware/global-exception.filter.ts` → platform/http (planner, draft "logging", propagated-weak): Global exception filter is generic HTTP middleware, belongs to platform HTTP plumbing.
- `repositories/app.repository.ts` → platform/app-repository (planner, draft "shared", contested): AppRepository provides application‑level data access used by the platform bootstrap, not a shared utility.
- `repositories/move.repository.ts` → module/asset (critic, draft "move", seed): Move repository writes `move_history` which is tightly coupled to asset lifecycle; belongs to the asset feature.
- `services/api.service.ts` → platform/http (critic, draft "shared", contested): Service is not pure utility; move to HTTP plumbing where generic request/response helpers live.
- `utils/editor.ts` → module/asset (planner, draft "shared", contested): Editor utilities manipulate asset faces/EXIF and are tightly coupled to the asset domain.
- `utils/object.ts` → shared/shared (planner, draft "notification", propagated-weak): Pure object‑comparison helpers have no I/O and are used across many modules.
- `utils/pagination.ts` → shared/shared (planner, draft "person", propagated-weak): Pagination helpers are generic utilities with no domain‑specific logic.
- `utils/profile-image.ts` → module/user (planner, draft "shared", contested): Profile‑image generation is specific to user preferences and belongs to the user module.

Contested files left where the draft put them (17): `commands/schema-check.ts` (platform/check, isolated), `controllers/face.controller.ts` (module/person, propagated-weak), `decorators.ts` (shared/shared, contested), `dtos/env.dto.ts` (platform/env, isolated), `dtos/exif.dto.ts` (module/asset, propagated-weak), `dtos/license.dto.ts` (module/user, propagated-weak), `enum.ts` (shared/shared, contested), `types.ts` (shared/shared, contested), `utils/bytes.ts` (shared/shared, contested), `utils/date.ts` (shared/shared, contested), `utils/fetch.ts` (platform/fetch, isolated), `utils/logger.ts` (platform/logging, propagated-weak), `utils/mime-types.ts` (shared/shared, contested), `utils/preferences.ts` (shared/shared, contested), `utils/request.ts` (shared/shared, contested), `utils/transform.ts` (shared/shared, contested), `validation.ts` (shared/shared, contested).

## Critic review

> The plan correctly isolates each business feature into its own module and keeps pure utilities in shared/. However three clear violations exist: (1) `services/api.service.ts` lives in `shared/` even though it is a service (impure‑shared warning). (2) `platform/ocr`, `platform/version` and `platform/metadata` own tables or routes, so they belong to feature modules, not plumbing. (3) Admin‑style CLI commands (`grant-admin`, `password-login`) sit in `platform/grant` and `platform/password-login` but belong to the `auth` feature. A few plumbing groups (hls, transcoding, smart) are only used by a single feature and can be merged there. The rest of the layout follows the naming and layering rules.

- accepted: group platform/ocr → module/ocr
- accepted: group platform/version → module/version
- accepted: group platform/metadata → module/system-metadata
- rejected: group platform/grant → module/auth (adds a warning (unsupported-merge: module/auth takes draft group "grant" (src/commands/grant-admin.ts): no shared word, no edge))
- rejected: group platform/password-login → module/auth (adds a warning (unsupported-merge: module/auth takes draft group "password-login" (src/commands/password-login.ts): no shared word, no edge))
- accepted: group platform/hls → module/video-stream
- accepted: group platform/transcoding → module/media
- accepted: group platform/smart → module/search
- accepted: move src/services/api.service.ts → platform/http: Service is not pure utility; move to HTTP plumbing where generic request/response helpers live.
- accepted: move src/repositories/move.repository.ts → module/asset: Move repository writes `move_history` which is tightly coupled to asset lifecycle; belongs to the asset feature.
- accepted: move src/commands/password-login.ts → module/auth: Password‑login enable/disable commands are admin entry points for authentication.
- accepted: move src/commands/grant-admin.ts → module/auth: Grant/revoke admin commands belong to the auth feature.

## Validator

- warning platform-feature: src/controllers/app.controller.ts serves routes: a feature, not plumbing
- warning sub-feature: module/asset-file extends module/asset: 0 edges between them (0 module/asset-file → module/asset, 0 back)
- warning sub-feature: module/asset-media extends module/asset: 9 edges between them (6 module/asset-media → module/asset, 3 back)

Strongest graph disagreements left in the plan (own edge share vs the pulling group):

- `dtos/env.dto.ts` in platform/env (0) pulled to shared/shared (1)
- `middleware/websocket.adapter.ts` in platform/websocket (0) pulled to platform/bootstrap (1)
- `services/database.service.ts` in platform/database (0) pulled to shared/shared (0.71)
- `repositories/album-user.repository.ts` in module/album (0.33) pulled to shared/shared (0.67)
- `repositories/email.repository.ts` in platform/email (0) pulled to module/notification (0.67)
- `repositories/integrity.repository.ts` in module/integrity (0.33) pulled to shared/shared (0.67)
- `repositories/sync-checkpoint.repository.ts` in module/sync (0.33) pulled to shared/shared (0.67)
- `repositories/trash.repository.ts` in module/trash (0.33) pulled to shared/shared (0.67)
- `utils/event.ts` in platform/event (0.33) pulled to module/video-stream (0.67)
- `dtos/api-key.dto.ts` in module/api-key (0.4) pulled to shared/shared (0.6)
- `dtos/ocr.dto.ts` in module/ocr (0.2) pulled to module/asset (0.6)
- `repositories/app.repository.ts` in platform/app-repository (0) pulled to module/maintenance (0.6)

Group cycles: 57 groups (module/activity, module/album, module/api-key, module/asset, module/asset-file, module/asset-media, …).

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

| step | rung | group | moves (with tests) | kept in a subfolder (basename collision) |
|---|---|---|---|---|
| 1 | R1 | module/activity | 6 | — |
| 2 | R1 | module/album | 7 | — |
| 3 | R1 | module/api-key | 6 | — |
| 4 | R1 | module/asset | 17 | — |
| 5 | R1 | module/asset-file | 4 | — |
| 6 | R1 | module/asset-media | 6 | — |
| 7 | R1 | module/auth | 11 | — |
| 8 | R1 | module/cluster-group | 4 | — |
| 9 | R1 | module/config | 10 | — |
| 10 | R1 | module/database-backup | 6 | — |
| 11 | R1 | module/download | 6 | — |
| 12 | R1 | module/duplicate | 8 | — |
| 13 | R1 | module/integrity | 5 | — |
| 14 | R1 | module/job | 6 | — |
| 15 | R1 | module/library | 5 | — |
| 16 | R1 | module/maintenance | 12 | — |
| 17 | R1 | module/map | 6 | — |
| 18 | R1 | module/media | 8 | — |
| 19 | R1 | module/memory | 6 | — |
| 20 | R1 | module/notification | 10 | — |
| 21 | R1 | module/oauth | 4 | — |
| 22 | R1 | module/ocr | 4 | — |
| 23 | R1 | module/partner | 6 | — |
| 24 | R1 | module/person | 8 | — |
| 25 | R1 | module/plugin | 7 | — |
| 26 | R1 | module/queue | 5 | — |
| 27 | R1 | module/search | 12 | — |
| 28 | R1 | module/server | 5 | — |
| 29 | R1 | module/session | 5 | — |
| 30 | R1 | module/shared-link | 7 | — |
| 31 | R1 | module/stack | 6 | — |
| 32 | R1 | module/sync | 8 | — |
| 33 | R1 | module/system-metadata | 10 | — |
| 34 | R1 | module/tag | 8 | — |
| 35 | R1 | module/timeline | 6 | — |
| 36 | R1 | module/trash | 6 | — |
| 37 | R1 | module/user | 20 | — |
| 38 | R1 | module/version | 4 | — |
| 39 | R1 | module/video-stream | 5 | — |
| 40 | R1 | module/view | 4 | — |
| 41 | R1 | module/workflow | 8 | — |
| 42 | R2 | platform/access | 3 | — |
| 43 | R2 | platform/app-repository | 1 | — |
| 44 | R2 | platform/bootstrap | 1 | — |
| 45 | R2 | platform/check | 1 | — |
| 46 | R2 | platform/cron | 1 | — |
| 47 | R2 | platform/crypto | 1 | — |
| 48 | R2 | platform/database | 4 | `utils/database.ts` |
| 49 | R2 | platform/email | 2 | — |
| 50 | R2 | platform/env | 1 | — |
| 51 | R2 | platform/event | 2 | — |
| 52 | R2 | platform/fetch | 2 | — |
| 53 | R2 | platform/file-upload | 2 | — |
| 54 | R2 | platform/http | 5 | — |
| 55 | R2 | platform/http-response | 1 | — |
| 56 | R2 | platform/logging | 5 | — |
| 57 | R2 | platform/machine-learning | 1 | — |
| 58 | R2 | platform/process | 2 | — |
| 59 | R2 | platform/registry | 7 | `commands/index.ts`, `controllers/index.ts`, `repositories/index.ts`, `services/index.ts` |
| 60 | R2 | platform/storage | 7 | — |
| 61 | R2 | platform/telemetry | 2 | — |
| 62 | R2 | platform/websocket | 2 | — |
| 63 | R2 | shared/shared | 17 | — |
