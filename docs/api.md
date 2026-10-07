# API reference

REST + JSON over HTTPS, implemented in `services/api` (Fastify). Request bodies and query strings are validated by the zod schemas in `packages/validation`. The same schemas are used by the app, so client and server agree on every DTO. The typed client in `packages/api-client` wraps all of this.

## Conventions

| Topic | Rule |
|---|---|
| Base URL | `PUBLIC_API_URL`, for example `https://api.example.com`. Local: `http://localhost:4000`. |
| Auth | `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes; renew with `POST /auth/refresh`. Refresh tokens rotate, so always store the new one. |
| Success | `{ "data": … }` and, for lists, `{ "data": [...], "meta": { "nextCursor": "…" \| null } }` |
| Errors | `{ "error": { "code", "message", "details"?, "requestId" } }`. `details` maps a dotted field path to messages. |
| Error codes | `bad_request` 400 · `unauthorized` 401 · `forbidden` 403 · `not_found` 404 (also returned for rows you cannot access) · `conflict` 409 · `precondition_failed` 412 · `validation_failed` 422 · `rate_limited` 429 · `internal_error` 500 · `service_unavailable` 503 |
| Pagination | `?limit=1..200` (default 50) and an opaque `?cursor=` taken from `meta.nextCursor` |
| IDs and dates | UUIDs everywhere. Clients may supply the `id` when creating offline-capable records, which makes retries idempotent. Dates are `YYYY-MM-DD`; timestamps are ISO-8601 UTC. Money is **integer cents**. |
| Limits | JSON bodies 2 MB, sync push 5 MB (200 operations). Rate limit 300 requests/min per token (or per IP when anonymous); `/auth/*` 20/min. |
| Health | `GET /health` (liveness), `GET /health/ready` (checks the database; 503 when it is down) |

### Realtime

`GET /realtime?token=<accessToken>` upgrades to a WebSocket.
- The server sends `{"type":"ready"}`, then change hints such as `{"type":"task.updated","organizationId","projectId","entityType","entityId"}`.
- Events are filtered to projects the user can access, and external users never receive internal events.
- Hints carry no record data. Clients respond by running a sync or refetching. Close code `4401` means the token was rejected; reconnect after refreshing it.

### Files

The API never streams large files through itself.
1. Register the file (photo or document) and receive an upload ticket `{ url, method: "PUT", headers, expiresAt }`.
2. `PUT` the bytes directly to object storage.
3. Call the `complete` endpoint. The server checks that the object exists (`HEAD`) before it marks it uploaded.

Download URLs in responses are signed and expire after `SIGNED_URL_TTL_SECONDS` (15 minutes by default).

## Examples

### Sign in

```http
POST /auth/login
{ "email": "pm@bluelagoon.test", "password": "PoolDemo2026!" }
```
```json
{ "data": { "mfaRequired": false,
  "tokens": { "accessToken": "eyJ…", "refreshToken": "…", "expiresIn": 900 },
  "user": { "id": "…", "fullName": "Morgan Lee", "role": "project_manager", "organizationId": "…" } } }
```

With two-step verification turned on, the response is `{ "mfaRequired": true, "mfaTicket": "…" }`. Then call `POST /auth/mfa/verify` with `{ "ticket", "code" }`.

### Create a project (client, property and schedule in one call)

```http
POST /projects
{ "name": "Nguyen Backyard Pool", "type": "new_construction", "status": "contract",
  "contractAmountCents": 7500000, "plannedStartDate": "2026-11-02",
  "client": { "firstName": "Linh", "lastName": "Nguyen", "phone": "+1 480 555 0101", "preferredContact": "phone" },
  "property": { "address": { "line1": "1 Palm Ct", "city": "Tempe", "region": "AZ", "postalCode": "85281", "country": "US" } } }
```

The response is `201` with the project. With a start date, the stage template generates stages, tasks and dependencies, and the schedule is calculated (`GET /projects/:id/schedule`).

### Offline sync

```http
POST /sync/push
{ "deviceId": "ios-3f2a…",
  "operations": [{ "id": "<op uuid>", "projectId": "…", "entityType": "checklist_item", "entityId": "…",
    "operation": "update", "payload": { "isChecked": true }, "baseVersion": 4,
    "baseValues": { "isChecked": false }, "createdAt": "2026-10-06T15:02:11Z" }] }
```

Each operation gets one of these results:
- `applied` (new `version` and `record`)
- `duplicate` (the same op id was already applied, so a retry is safe)
- `conflict` (`serverRecord` and `conflictingFields`, for fields both sides changed)
- `rejected` (`code`, `message`, `retryable`)

```http
POST /sync/pull
{ "cursor": null, "limit": 500 }
```

The response is `{ changes: [{ entityType, entityId, seq, deleted, record }], cursor, hasMore, serverTime, accessibleProjectIds }`. Repeat with the returned `cursor` while `hasMore` is true. See [offline-sync.md](offline-sync.md).

### Photo upload

```http
POST /projects/:projectId/photos
{ "id": "<client uuid>", "taskId": "…", "kind": "progress", "caption": "Rebar tied",
  "takenAt": "2026-10-06T15:04:00Z", "mimeType": "image/jpeg", "byteSize": 812345,
  "location": { "latitude": 33.42, "longitude": -111.94, "accuracyMeters": 6 } }
→ { "data": { "photo": { …, "uploadStatus": "pending" }, "upload": { "url", "method": "PUT", "headers", "expiresAt" } } }

PUT <upload.url>              (raw JPEG bytes, with upload.headers)
POST /photos/:id/complete     → photo with uploadStatus "uploaded"; a thumbnail job follows
```

The stage is inherited from the task. Re-registering the same `id` returns a fresh ticket, which makes offline retries safe. If a ticket expires, `POST /photos/:id/upload-url` issues a new one.

## Endpoints

Capabilities are checked per role inside each service (matrix in [security.md](security.md#role-matrix-defaults)); additionally every project-scoped route checks row-level access, and inaccessible rows return 404.

### `/approvals`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/approvals` |  |
| POST | `/approvals/:id/cancel` |  |
| POST | `/approvals/:id/decision` | `approvalDecisionSchema` |

### `/auth`

| Method | Path | Validation schema |
|---|---|---|
| POST | `/auth/invite/accept` |  |
| POST | `/auth/login` | `loginSchema` |
| POST | `/auth/logout` |  |
| POST | `/auth/magic-link` | `magicLinkRequestSchema` |
| POST | `/auth/magic-link/verify` | `magicLinkVerifySchema` |
| GET | `/auth/me` |  |
| POST | `/auth/mfa/confirm` | `mfaConfirmSchema` |
| POST | `/auth/mfa/disable` | `mfaConfirmSchema` |
| POST | `/auth/mfa/setup` |  |
| POST | `/auth/mfa/verify` | `mfaVerifySchema` |
| POST | `/auth/oauth/:provider` |  |
| POST | `/auth/password/change` | `changePasswordSchema` |
| POST | `/auth/password/forgot` | `forgotPasswordSchema` |
| POST | `/auth/password/reset` | `resetPasswordSchema` |
| GET | `/auth/providers` |  |
| POST | `/auth/refresh` | `refreshSchema` |
| POST | `/auth/register` | `registerSchema` |
| GET | `/auth/sessions` |  |
| DELETE | `/auth/sessions/:id` |  |

### `/change-orders`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/change-orders/:id` |  |
| PATCH | `/change-orders/:id` | `updateChangeOrderSchema` |
| POST | `/change-orders/:id/transition` | `changeOrderTransitionSchema` |

### `/checklist-items`

| Method | Path | Validation schema |
|---|---|---|
| PATCH | `/checklist-items/:id` | `checklistToggleSchema` |
| DELETE | `/checklist-items/:id` |  |

### `/clients`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/clients` |  |
| POST | `/clients` | `clientSchema` |
| GET | `/clients/:id` |  |
| PATCH | `/clients/:id` | `updateClientSchema` |

### `/dashboard`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/dashboard` |  |

### `/designs`

| Method | Path | Validation schema |
|---|---|---|
| PATCH | `/designs/:id` |  |
| POST | `/designs/:id/models` | `designModelSchema` |
| POST | `/designs/:id/sync` |  |

### `/documents`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/documents` |  |
| POST | `/documents` | `documentCreateSchema` |
| GET | `/documents/:id` |  |
| PATCH | `/documents/:id` | `documentUpdateSchema` |
| DELETE | `/documents/:id` |  |
| POST | `/documents/:id/versions` | `documentVersionSchema` |
| POST | `/documents/:id/versions/:versionId/complete` |  |

### `/health`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/health` |  |
| GET | `/health/ready` |  |

### `/inbox`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/inbox` |  |

### `/inspection-templates`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/inspection-templates` |  |
| POST | `/inspection-templates` | `inspectionTemplateSchema` |
| PUT | `/inspection-templates/:id` | `inspectionTemplateSchema` |

### `/inspections`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/inspections/:id` |  |
| PATCH | `/inspections/:id` | `updateInspectionSchema` |

### `/integrations`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/integrations` |  |

### `/materials`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/materials` |  |
| POST | `/materials` | `materialSchema` |
| PUT | `/materials/:id` | `materialSchema` |

### `/measurements`

| Method | Path | Validation schema |
|---|---|---|
| PATCH | `/measurements/:id` | `updateMeasurementSchema` |
| DELETE | `/measurements/:id` |  |

### `/notifications`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/notifications` |  |
| GET | `/notifications/preferences` |  |
| PUT | `/notifications/preferences` | `notificationPreferenceSchema` |
| POST | `/notifications/read` |  |

### `/organizations`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/organizations/current` |  |
| PATCH | `/organizations/current` | `updateOrganizationSchema` |

### `/photos`

| Method | Path | Validation schema |
|---|---|---|
| PATCH | `/photos/:id` | `photoUpdateSchema` |
| DELETE | `/photos/:id` |  |
| POST | `/photos/:id/complete` |  |
| POST | `/photos/:id/upload-url` |  |

### `/projects`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/projects` |  |
| POST | `/projects` | `createProjectSchema` |
| GET | `/projects/:projectId` |  |
| PATCH | `/projects/:projectId` | `updateProjectSchema` |
| GET | `/projects/:projectId/activity` |  |
| POST | `/projects/:projectId/ai/ask` | `aiAskSchema` |
| POST | `/projects/:projectId/approvals` | `approvalRequestSchema` |
| POST | `/projects/:projectId/archive` |  |
| GET | `/projects/:projectId/baselines` |  |
| POST | `/projects/:projectId/baselines` |  |
| GET | `/projects/:projectId/budget` |  |
| PATCH | `/projects/:projectId/budget` | `updateBudgetSchema` |
| POST | `/projects/:projectId/budget/items` | `budgetItemSchema` |
| PUT | `/projects/:projectId/budget/items/:id` | `budgetItemSchema` |
| DELETE | `/projects/:projectId/budget/items/:id` |  |
| GET | `/projects/:projectId/change-orders` |  |
| POST | `/projects/:projectId/change-orders` | `changeOrderSchema` |
| GET | `/projects/:projectId/dashboard` |  |
| POST | `/projects/:projectId/dependencies` | `dependencySchema` |
| DELETE | `/projects/:projectId/dependencies/:id` |  |
| GET | `/projects/:projectId/designs` |  |
| POST | `/projects/:projectId/designs` | `designProjectSchema` |
| GET | `/projects/:projectId/expenses` |  |
| POST | `/projects/:projectId/expenses` | `expenseSchema` |
| DELETE | `/projects/:projectId/expenses/:id` |  |
| GET | `/projects/:projectId/inspections` |  |
| POST | `/projects/:projectId/inspections` | `inspectionSchema` |
| GET | `/projects/:projectId/labor` |  |
| POST | `/projects/:projectId/labor` | `laborEntrySchema` |
| DELETE | `/projects/:projectId/labor/:id` |  |
| GET | `/projects/:projectId/materials` |  |
| POST | `/projects/:projectId/materials` | `materialUsageSchema` |
| PUT | `/projects/:projectId/materials/:id` | `materialUsageSchema` |
| GET | `/projects/:projectId/measurements` |  |
| POST | `/projects/:projectId/measurements` | `measurementSchema` |
| GET | `/projects/:projectId/measurements/export` |  |
| POST | `/projects/:projectId/members` | `addProjectMemberSchema` |
| DELETE | `/projects/:projectId/members/:userId` |  |
| GET | `/projects/:projectId/messages` |  |
| POST | `/projects/:projectId/messages` | `messageSchema` |
| GET | `/projects/:projectId/payments` |  |
| POST | `/projects/:projectId/payments` | `paymentSchema` |
| PATCH | `/projects/:projectId/payments/:id` | `updatePaymentSchema` |
| GET | `/projects/:projectId/photos` |  |
| POST | `/projects/:projectId/photos` | `photoCreateSchema` |
| GET | `/projects/:projectId/property` |  |
| GET | `/projects/:projectId/schedule` |  |
| POST | `/projects/:projectId/schedule/shift` | `scheduleShiftSchema` |
| PATCH | `/projects/:projectId/stages/:stageId` | `updateStageSchema` |
| POST | `/projects/:projectId/tasks` | `createTaskSchema` |
| POST | `/projects/:projectId/unarchive` |  |
| GET | `/projects/:projectId/weather` |  |

### `/properties`

| Method | Path | Validation schema |
|---|---|---|
| POST | `/properties` | `propertySchema` |
| GET | `/properties/:id` |  |
| PATCH | `/properties/:id` | `updatePropertySchema` |

### `/push-tokens`

| Method | Path | Validation schema |
|---|---|---|
| POST | `/push-tokens` | `pushTokenSchema` |
| DELETE | `/push-tokens/:token` |  |

### `/realtime`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/realtime` |  |

### `/reports`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/reports/portfolio` |  |

### `/roles`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/roles` |  |
| PUT | `/roles/:role/permissions` |  |

### `/schedule`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/schedule/calendar` |  |

### `/search`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/search` |  |

### `/stage-templates`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/stage-templates` |  |
| POST | `/stage-templates` | `stageTemplateSchema` |
| PUT | `/stage-templates/:id` | `stageTemplateSchema` |
| DELETE | `/stage-templates/:id` |  |

### `/storage`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/storage/local/*` |  |
| PUT | `/storage/local/*` |  |

### `/sync`

| Method | Path | Validation schema |
|---|---|---|
| POST | `/sync/pull` | `syncPullSchema` |
| POST | `/sync/push` | `syncPushSchema` |

### `/tasks`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/tasks` |  |
| GET | `/tasks/:id` |  |
| PATCH | `/tasks/:id` | `updateTaskSchema` |
| DELETE | `/tasks/:id` |  |
| POST | `/tasks/:id/checklist` |  |
| POST | `/tasks/:id/complete` | `completeTaskSchema` |
| POST | `/tasks/:id/notes` | `taskNoteSchema` |

### `/teams`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/teams` |  |
| POST | `/teams` | `teamSchema` |
| PUT | `/teams/:id` | `teamSchema` |

### `/users`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/users` |  |
| PATCH | `/users/:id` | `updateUserSchema` |
| POST | `/users/invite` | `inviteUserSchema` |

### `/vendors`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/vendors` |  |
| POST | `/vendors` | `vendorSchema` |
| PUT | `/vendors/:id` | `vendorSchema` |

### `/views`

| Method | Path | Validation schema |
|---|---|---|
| GET | `/views` |  |
| POST | `/views` |  |
| DELETE | `/views/:id` |  |

### `/weather-alerts`

| Method | Path | Validation schema |
|---|---|---|
| POST | `/weather-alerts/:id/acknowledge` |  |
