> **Context.** G1 last step (plan §6). Planner v1 ("edit the draft") on immich, Ultra sample, after one evaluate round. The validator's TurboMQ pick was Super #2, which made no edits at all (85 groups, identical to the deterministic draft), so the Ultra plan is shown instead: it is the only candidate that actually edited the draft. All immich planning calls in G1 (v0, v1, v1b and the 2024-recovery run) cost about $0.41 together. Raw JSON: `~/ac-work/g1/immich-plan.v1.json`.
> **How to read the validator lines.** The cycle and "pulled toward" numbers are dominated by two things: `BaseService` injects 55 repositories into every service, and the registries (`controllers/index.ts`, `commands/index.ts`) import everything. Any grouping of immich inherits both, so treat them as findings, not plan defects.

# immich server/ plan v1 (G1), for corupta to rate 1–5

immich-app/immich `server/` @ `02063972e8` (AGPL-3.0; paths below are excerpts of that tree). Planner v1 (edit the draft): deterministic facts + seeds draft → Nemotron names/merges draft groups and moves misplaced files (json_schema strict) → 1 evaluate round. Shown: **immich/v1/ultra#1** (chosen by hand: see the candidates line).

- Movable files planned: **269**; pinned and left in place: **189** (schema/migrations, workers, bin, emails, main.ts, and 7 location-sensitive files: `src/constants.ts`, `src/main.ts`, `src/maintenance/maintenance-health.repository.ts`, `src/repositories/config.repository.ts`, `src/repositories/database.repository.ts`, `src/services/cli.service.ts`, `src/utils/misc.ts`).
- Groups: **65**; files in shared/platform: 32; cross-group edge ratio 0.862; group cycles: 62 groups; files pulled harder toward another group: 188.
- Candidates (TurboMQ sum, groups, files in group cycles, cross-edge ratio): immich/v1/super#2 (10.48, 85, 80, 0.866); immich/v1/ultra#1 (10.22, 65, 62, 0.862); deterministic draft (10.48).

**Rating question:** would you accept this plan after changing ≤10% of placements (≈27 files)? 1 = no, 3 = yes with ≤10% changes, 5 = as is.

## Groups

| group | files | roles | examples |
|---|---|---|---|
| shared/infra | 20 | 9 util, 4 other, 2 dto, 1 command, 1 controller, 1 filter, 1 repository, 1 service | `commands/index.ts`, `controllers/index.ts`, `decorators.ts`, `dtos/calendar-heatmap.dto.ts`, … |
| module/asset | 11 | 4 dto, 3 repository, 1 controller, 1 interceptor, 1 service, 1 util | `controllers/asset.controller.ts`, `dtos/asset-ids.response.dto.ts`, `dtos/asset-response.dto.ts`, `dtos/asset.dto.ts`, … |
| module/user | 9 | 5 dto, 1 command, 1 controller, 1 repository, 1 service | `commands/list-users.command.ts`, `controllers/user.controller.ts`, `dtos/license.dto.ts`, `dtos/onboarding.dto.ts`, … |
| module/maintenance | 8 | 2 repository, 1 command, 1 controller, 1 dto, 1 guard, 1 service, 1 util | `commands/maintenance-mode.ts`, `controllers/maintenance.controller.ts`, `dtos/maintenance.dto.ts`, `maintenance/maintenance-auth.guard.ts`, … |
| module/app | 7 | 1 other, 1 module, 1 controller, 1 interceptor, 1 repository, 1 service, 1 util | `app.common.ts`, `app.module.ts`, `controllers/app.controller.ts`, `middleware/error.interceptor.ts`, … |
| module/person | 7 | 2 controller, 2 repository, 1 dto, 1 service, 1 util | `controllers/face.controller.ts`, `controllers/person.controller.ts`, `dtos/person.dto.ts`, `repositories/person-user.repository.ts`, … |
| module/search | 7 | 2 service, 2 util, 1 controller, 1 dto, 1 repository | `controllers/search.controller.ts`, `dtos/search.dto.ts`, `repositories/search.repository.ts`, `services/search.service.ts`, … |
| module/auth | 6 | 1 command, 1 controller, 1 dto, 1 guard, 1 repository, 1 service | `commands/password-login.ts`, `controllers/auth.controller.ts`, `dtos/auth.dto.ts`, `middleware/auth.guard.ts`, … |
| module/notification | 6 | 2 repository, 1 controller, 1 dto, 1 service, 1 util | `controllers/notification.controller.ts`, `dtos/notification.dto.ts`, `repositories/email.repository.ts`, `repositories/notification.repository.ts`, … |
| module/plugin | 6 | 3 dto, 1 controller, 1 repository, 1 service | `controllers/plugin.controller.ts`, `dtos/json-schema.dto.ts`, `dtos/plugin-manifest.dto.ts`, `dtos/plugin.dto.ts`, … |
| module/sync | 6 | 2 repository, 1 controller, 1 dto, 1 service, 1 util | `controllers/sync.controller.ts`, `dtos/sync.dto.ts`, `repositories/sync-checkpoint.repository.ts`, `repositories/sync.repository.ts`, … |
| module/tag | 6 | 2 util, 1 controller, 1 dto, 1 repository, 1 service | `controllers/tag.controller.ts`, `dtos/tag.dto.ts`, `repositories/tag.repository.ts`, `services/tag.service.ts`, … |
| module/workflow | 6 | 2 service, 1 controller, 1 dto, 1 repository, 1 util | `controllers/workflow.controller.ts`, `dtos/workflow.dto.ts`, `repositories/workflow.repository.ts`, `services/workflow-execution.service.ts`, … |
| module/album | 5 | 2 repository, 1 controller, 1 dto, 1 service | `controllers/album.controller.ts`, `dtos/album.dto.ts`, `repositories/album-user.repository.ts`, `repositories/album.repository.ts`, … |
| module/asset-media | 5 | 2 dto, 1 controller, 1 repository, 1 service | `controllers/asset-media.controller.ts`, `dtos/asset-media-response.dto.ts`, `dtos/asset-media.dto.ts`, `repositories/move.repository.ts`, … |
| module/config | 5 | 3 controller, 1 dto, 1 util | `controllers/config-admin.controller.ts`, `controllers/config-public.controller.ts`, `controllers/config-user.controller.ts`, `dtos/config.dto.ts`, … |
| module/duplicate | 5 | 1 controller, 1 dto, 1 repository, 1 service, 1 util | `controllers/duplicate.controller.ts`, `dtos/duplicate.dto.ts`, `repositories/duplicate.repository.ts`, `services/duplicate.service.ts`, … |
| module/shared-link | 5 | 2 repository, 1 controller, 1 dto, 1 service | `controllers/shared-link.controller.ts`, `dtos/shared-link.dto.ts`, `repositories/shared-link-asset.repository.ts`, `repositories/shared-link.repository.ts`, … |
| module/video-stream | 5 | 2 service, 1 controller, 1 dto, 1 repository | `controllers/video-stream.controller.ts`, `dtos/streaming.dto.ts`, `repositories/video-stream.repository.ts`, `services/hls.service.ts`, … |
| module/media | 4 | 1 command, 1 repository, 1 service, 1 util | `commands/media-location.command.ts`, `repositories/media.repository.ts`, `services/media.service.ts`, `utils/media.ts` |
| module/activity | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/activity.controller.ts`, `dtos/activity.dto.ts`, `repositories/activity.repository.ts`, `services/activity.service.ts` |
| module/api-key | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/api-key.controller.ts`, `dtos/api-key.dto.ts`, `repositories/api-key.repository.ts`, `services/api-key.service.ts` |
| module/asset-file | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/asset-file.controller.ts`, `dtos/asset-file.dto.ts`, `repositories/asset-file.repository.ts`, `services/asset-file.service.ts` |
| module/cluster-group | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/cluster-group.controller.ts`, `dtos/cluster-group.dto.ts`, `repositories/cluster-group.repository.ts`, `services/cluster-group.service.ts` |
| module/database-backup | 4 | 1 controller, 1 dto, 1 service, 1 util | `controllers/database-backup.controller.ts`, `dtos/database-backup.dto.ts`, `services/database-backup.service.ts`, `utils/database-backups.ts` |
| module/download | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/download.controller.ts`, `dtos/download.dto.ts`, `repositories/download.repository.ts`, `services/download.service.ts` |
| module/integrity | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/integrity-admin.controller.ts`, `dtos/integrity.dto.ts`, `repositories/integrity.repository.ts`, `services/integrity.service.ts` |
| module/job | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/job.controller.ts`, `dtos/job.dto.ts`, `repositories/job.repository.ts`, `services/job.service.ts` |
| module/library | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/library.controller.ts`, `dtos/library.dto.ts`, `repositories/library.repository.ts`, `services/library.service.ts` |
| module/map | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/map.controller.ts`, `dtos/map.dto.ts`, `repositories/map.repository.ts`, `services/map.service.ts` |
| module/memory | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/memory.controller.ts`, `dtos/memory.dto.ts`, `repositories/memory.repository.ts`, `services/memory.service.ts` |
| module/partner | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/partner.controller.ts`, `dtos/partner.dto.ts`, `repositories/partner.repository.ts`, `services/partner.service.ts` |
| module/queue | 4 | 2 dto, 1 controller, 1 service | `controllers/queue.controller.ts`, `dtos/queue-legacy.dto.ts`, `dtos/queue.dto.ts`, `services/queue.service.ts` |
| module/server | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/server.controller.ts`, `dtos/server.dto.ts`, `repositories/server-info.repository.ts`, `services/server.service.ts` |
| module/session | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/session.controller.ts`, `dtos/session.dto.ts`, `repositories/session.repository.ts`, `services/session.service.ts` |
| module/stack | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/stack.controller.ts`, `dtos/stack.dto.ts`, `repositories/stack.repository.ts`, `services/stack.service.ts` |
| module/system-metadata | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/system-metadata.controller.ts`, `dtos/system-metadata.dto.ts`, `repositories/system-metadata.repository.ts`, `services/system-metadata.service.ts` |
| module/timeline | 4 | 2 dto, 1 controller, 1 service | `controllers/timeline.controller.ts`, `dtos/bbox.dto.ts`, `dtos/time-bucket.dto.ts`, `services/timeline.service.ts` |
| module/trash | 4 | 1 controller, 1 dto, 1 repository, 1 service | `controllers/trash.controller.ts`, `dtos/trash.dto.ts`, `repositories/trash.repository.ts`, `services/trash.service.ts` |
| module/storage | 4 | 2 service, 1 other, 1 repository | `cores/storage.core.ts`, `repositories/storage.repository.ts`, `services/storage-template.service.ts`, `services/storage.service.ts` |
| module/oauth | 3 | 1 command, 1 controller, 1 repository | `commands/oauth-login.ts`, `controllers/oauth.controller.ts`, `repositories/oauth.repository.ts` |
| module/version | 3 | 1 command, 1 repository, 1 service | `commands/version.command.ts`, `repositories/version-history.repository.ts`, `services/version.service.ts` |
| module/view | 3 | 1 controller, 1 repository, 1 service | `controllers/view.controller.ts`, `repositories/view-repository.ts`, `services/view.service.ts` |
| platform/database | 3 | 1 other, 1 service, 1 util | `database.ts`, `services/database.service.ts`, `utils/database.ts` |
| module/ocr | 3 | 1 dto, 1 repository, 1 service | `dtos/ocr.dto.ts`, `repositories/ocr.repository.ts`, `services/ocr.service.ts` |
| module/access | 3 | 2 util, 1 repository | `repositories/access.repository.ts`, `utils/access.ts`, `utils/set.ts` |
| module/metadata | 3 | 1 repository, 1 service, 1 util | `repositories/metadata.repository.ts`, `services/metadata.service.ts`, `utils/tasks.ts` |
| module/admin | 2 | 2 command | `commands/grant-admin.ts`, `commands/reset-admin-password.command.ts` |
| module/auth-admin | 2 | 1 controller, 1 service | `controllers/auth-admin.controller.ts`, `services/auth-admin.service.ts` |
| module/notification-admin | 2 | 1 controller, 1 service | `controllers/notification-admin.controller.ts`, `services/notification-admin.service.ts` |
| module/system-config | 2 | 1 controller, 1 service | `controllers/system-config.controller.ts`, `services/system-config.service.ts` |
| module/user-admin | 2 | 1 controller, 1 service | `controllers/user-admin.controller.ts`, `services/user-admin.service.ts` |
| module/maintenance-worker | 2 | 1 controller, 1 service | `maintenance/maintenance-worker.controller.ts`, `maintenance/maintenance-worker.service.ts` |
| module/file | 2 | 1 interceptor, 1 util | `middleware/file-upload.interceptor.ts`, `utils/file.ts` |
| platform/logging | 2 | 1 interceptor, 1 repository | `middleware/logging.interceptor.ts`, `repositories/logging.repository.ts` |
| module/websocket | 2 | 1 middleware, 1 repository | `middleware/websocket.adapter.ts`, `repositories/websocket.repository.ts` |
| module/event | 2 | 1 repository, 1 util | `repositories/event.repository.ts`, `utils/event.ts` |
| platform/telemetry | 2 | 1 repository, 1 service | `repositories/telemetry.repository.ts`, `services/telemetry.service.ts` |
| module/schema-check | 1 | 1 command | `commands/schema-check.ts` |
| platform/environment | 1 | 1 dto | `dtos/env.dto.ts` |
| module/machine-learning | 1 | 1 repository | `repositories/machine-learning.repository.ts` |
| platform/process | 1 | 1 repository | `repositories/process.repository.ts` |
| platform/bootstrap | 1 | 1 service | `services/base.service.ts` |
| shared/user-method | 1 | 1 service | `services/shared/user-methods.ts` |
| platform/response | 1 | 1 util | `utils/response.ts` |

## Contested files (planner rationale)

- `repositories/album-user.repository.ts` → album: album‑user repository belongs to the album domain
- `services/api.service.ts` → app: api controller is part of the main app entry point
- `repositories/asset-edit.repository.ts` → asset: asset‑edit repository only touches asset tables
- `repositories/asset-job.repository.ts` → asset: asset‑job repository works on asset job tables
- `services/base.service.ts` → bootstrap: base bootstrap code is platform plumbing
- `commands/schema-check.ts` → schema-check: schema‑check command is a maintenance‑style schema validator
- `repositories/cron.repository.ts` → maintenance: cron repository schedules maintenance jobs
- `repositories/crypto.repository.ts` → auth: crypto repository provides auth‑related encryption
- `repositories/email.repository.ts` → notification: email repository sends notification e‑mails
- `dtos/env.dto.ts` → environment: env DTO validates process environment – platform config
- `services/hls.service.ts` → video-stream: HLS segmenter is part of video streaming pipeline
- `maintenance/maintenance-websocket.repository.ts` → maintenance: maintenance websocket guard belongs to maintenance feature
- `repositories/move.repository.ts` → asset-media: move repository manipulates asset media locations
- `commands/password-login.ts` → auth: password‑login command is an auth operation
- `repositories/person-user.repository.ts` → person: person‑user repository links persons to users
- `repositories/process.repository.ts` → process: process repository runs background workers – platform process
- `utils/response.ts` → response: response utilities are generic HTTP plumbing
- `repositories/server-info.repository.ts` → server: server‑info repository reads server metadata
- `repositories/shared-link-asset.repository.ts` → shared-link: shared‑link‑asset repository is a detail of shared links
- `services/smart-info.service.ts` → search: smart‑info service builds search‑related payloads
- `services/storage-template.service.ts` → storage: storage‑template repository manages storage layout
- `repositories/sync-checkpoint.repository.ts` → sync: sync‑checkpoint repository stores sync progress
- `services/transcoding.service.ts` → video-stream: transcoding service is part of video streaming
- `services/shared/user-methods.ts` → user-method: user‑method util is pure code shared by several modules
- `repositories/version-history.repository.ts` → version: version‑history repository records app version history
- `services/workflow-execution.service.ts` → workflow: workflow‑execution service runs workflow jobs

## Validator: strongest graph disagreements left in the plan

- `middleware/websocket.adapter.ts` in module/websocket (0 of its edge weight) but pulled to module/app (1)
- `commands/grant-admin.ts` in module/admin (0 of its edge weight) but pulled to shared/infra (1)
- `commands/list-users.command.ts` in module/user (0 of its edge weight) but pulled to shared/infra (1)
- `commands/maintenance-mode.ts` in module/maintenance (0 of its edge weight) but pulled to shared/infra (1)
- `commands/media-location.command.ts` in module/media (0 of its edge weight) but pulled to shared/infra (1)
- `commands/oauth-login.ts` in module/oauth (0 of its edge weight) but pulled to shared/infra (1)
- `commands/password-login.ts` in module/auth (0 of its edge weight) but pulled to shared/infra (1)
- `commands/schema-check.ts` in module/schema-check (0 of its edge weight) but pulled to shared/infra (1)
- `dtos/env.dto.ts` in platform/environment (0 of its edge weight) but pulled to shared/infra (1)
- `services/database.service.ts` in platform/database (0 of its edge weight) but pulled to shared/infra (0.78)
- `repositories/album-user.repository.ts` in module/album (0 of its edge weight) but pulled to shared/infra (0.75)
- `repositories/integrity.repository.ts` in module/integrity (0 of its edge weight) but pulled to shared/infra (0.75)
