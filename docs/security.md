# Security model

Authorization is enforced on the server. The app uses the same rules only to hide controls the server would refuse.

## Authentication

| Mechanism | Implementation |
|---|---|
| Passwords | scrypt (N=2^15, r=8, p=1, 64-byte key, random salt), encoded as `scrypt$N$r$p$salt$hash` so parameters can be raised. `needsRehash` upgrades old hashes on login. Comparison uses `timingSafeEqual`. |
| Access tokens | JWT HS256 signed with `JWT_SECRET`, 15 min (`ACCESS_TOKEN_TTL_SECONDS`). Carries user, org and role. |
| Refresh tokens | Opaque random tokens, stored only as SHA-256 hashes in `sessions`, valid 30 days (`REFRESH_TOKEN_TTL_DAYS`). **Rotated on every use**; replaying a previous token revokes the whole session (reuse detection). Sessions can be listed and revoked (`/auth/sessions`). |
| Lockout | 8 failed logins lock the account for 15 minutes. Auth routes have a stricter rate limit (`AUTH_RATE_LIMIT_MAX`, default 20/min). |
| MFA | TOTP (RFC 6238). The seed is encrypted at rest with AES-256-GCM using `DATA_ENCRYPTION_KEY`. A password login with MFA returns a 5-minute single-use MFA ticket instead of tokens. |
| Single-use tokens | Password reset (30 min), magic link (15 min), invite (7 days). Stored hashed and consumed atomically. "Forgot password" answers the same whether or not the email exists. |
| OAuth | Google / Apple ID tokens are verified against the provider JWKS (`jose`), with audience restricted to `GOOGLE_OAUTH_CLIENT_IDS` / `APPLE_OAUTH_CLIENT_IDS`. |
| On device | Tokens are kept in the iOS Keychain / Android Keystore (`expo-secure-store`). Optional biometric unlock (`expo-local-authentication`) gates the app after it returns from the background. On web (the admin UI) tokens live in `sessionStorage` and are cleared when the tab closes. |

The API client refreshes in a single flight: concurrent 401s wait for one refresh, so rotation never races itself.

## Authorization

There are two layers, both enforced in `services/api/src/services/access.ts`:

1. **Capability (RBAC)**: may this role do X at all? A code-defined matrix in `packages/core/src/permissions.ts`, plus per-organization overrides (`role_permission_overrides`, edited from **Roles & permissions**, cached for a short time).
2. **Row level**: which projects and tasks does this user see?
   - **Admin**: every project in the organization.
   - **Staff, field and subcontractors**: projects they manage, are members of, crew for, or have a task on.
   - **Subcontractors**: within those projects, only tasks assigned to them.
   - **Clients**: projects whose client record is linked to their user.

   Inaccessible rows return **404, not 403**, so IDs cannot be probed. Every query is scoped by `organization_id` (tenant isolation).

### Role matrix (defaults)

| Permission | Admin | PM | Designer | Supervisor | Worker | Sub | Client |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `org:manage` | ✓ |  |  |  |  |  |  |
| `user:read` | ✓ | ✓ |  | ✓ |  |  |  |
| `user:manage` | ✓ |  |  |  |  |  |  |
| `team:manage` | ✓ | ✓ |  |  |  |  |  |
| `project:create` | ✓ | ✓ |  |  |  |  |  |
| `project:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project:update` | ✓ | ✓ |  |  |  |  |  |
| `project:archive` | ✓ | ✓ |  |  |  |  |  |
| `stage:update` | ✓ | ✓ |  |  |  |  |  |
| `stage_template:manage` | ✓ |  |  |  |  |  |  |
| `task:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `task:create` | ✓ | ✓ |  | ✓ |  |  |  |
| `task:update` | ✓ | ✓ |  | ✓ |  |  |  |
| `task:update_assigned` | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |
| `task:assign` | ✓ | ✓ |  | ✓ |  |  |  |
| `task:delete` | ✓ | ✓ |  |  |  |  |  |
| `task:override_checklist` | ✓ | ✓ |  | ✓ |  |  |  |
| `schedule:update` | ✓ | ✓ |  | ✓ |  |  |  |
| `budget:read` | ✓ | ✓ |  |  |  |  |  |
| `budget:update` | ✓ | ✓ |  |  |  |  |  |
| `expense:create` | ✓ | ✓ |  | ✓ |  |  |  |
| `labor:read` | ✓ | ✓ |  | ✓ |  |  |  |
| `labor:create` | ✓ | ✓ |  | ✓ |  |  |  |
| `labor:create_own` | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |
| `material:read` | ✓ | ✓ |  | ✓ | ✓ |  |  |
| `material:manage` | ✓ | ✓ |  |  |  |  |  |
| `vendor:read` | ✓ | ✓ |  | ✓ | ✓ |  |  |
| `vendor:manage` | ✓ | ✓ |  |  |  |  |  |
| `change_order:read` | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `change_order:create` | ✓ | ✓ |  | ✓ |  |  |  |
| `change_order:submit` | ✓ | ✓ |  |  |  |  |  |
| `change_order:decide_internal` | ✓ | ✓ |  |  |  |  |  |
| `change_order:client_decide` | ✓ |  |  |  |  |  | ✓ |
| `change_order:schedule` | ✓ | ✓ |  |  |  |  |  |
| `photo:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `photo:create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `photo:delete` | ✓ | ✓ |  |  |  |  |  |
| `document:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `document:upload` | ✓ | ✓ | ✓ | ✓ |  |  |  |
| `document:delete` | ✓ | ✓ |  |  |  |  |  |
| `measurement:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `measurement:create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `inspection:read` | ✓ | ✓ |  | ✓ | ✓ |  |  |
| `inspection:create` | ✓ | ✓ |  | ✓ |  |  |  |
| `approval:read` | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `approval:request` | ✓ | ✓ | ✓ |  |  |  |  |
| `approval:decide` | ✓ |  |  |  |  |  | ✓ |
| `payment:read` | ✓ | ✓ |  |  |  |  | ✓ |
| `payment:manage` | ✓ | ✓ |  |  |  |  |  |
| `message:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `message:send` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `message:read_internal` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `client:read` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `client:manage` | ✓ | ✓ |  |  |  |  |  |
| `property:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `property:manage` | ✓ | ✓ |  |  |  |  |  |
| `report:read` | ✓ | ✓ |  |  |  |  |  |
| `design:read` | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `design:manage` | ✓ | ✓ | ✓ |  |  |  |  |
| `integration:manage` | ✓ |  |  |  |  |  |  |
| `activity:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `activity:read_internal` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `ai:use` | ✓ | ✓ | ✓ | ✓ |  |  |  |

## Client portal and external users

Clients and subcontractors are *external*. They never receive internal-only data, whether in REST responses, sync pulls, realtime events or AI output.

- **Projects**: estimated cost and crew are removed. The contract amount is shown only if the org enables `clientCanSeeContractAmount` (`redactProjectForClient`).
- **Change orders**: clients never see cost or labor impact, only the price. Drafts and internally submitted change orders stay hidden until they are sent to the client.
- **Photos, documents, messages, activity, stages**: clients get only records marked `visibility = client` / `clientVisible`. Subcontractors cannot publish client-visible photos.
- Budget, expenses, labor of other people, vendors and internal notes are never synced to external roles.

## Data protection

| Area | Control |
|---|---|
| Transport | HTTPS terminated at the load balancer; `helmet` headers; CORS restricted to `CORS_ORIGINS`; the API uses no cookies, so there is no CSRF surface. |
| Secrets at rest | MFA seeds are encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`). Passwords and all tokens are stored only as hashes. |
| Files | The bucket is private. Uploads and downloads use **signed URLs** (default 15 min, `SIGNED_URL_TTL_SECONDS`), and objects are keyed by `org/project/...`. MIME allowlist for documents; size limits from `@pool/config` (photos 50 MB, documents 500 MB). An upload is accepted only after the server confirms the object exists (`HEAD`). |
| Input | Every body and query string is validated by the shared zod schemas (`422 validation_failed` with per-field details). Request bodies are capped (2 MB JSON, 5 MB sync push). |
| Abuse | Rate limit per user token (or per IP when anonymous), default 300/min. |
| Audit | `activity_logs` records who did what, on which entity, when. Every table has `created_by`/`updated_by`, timestamps and soft delete. Sync operations are logged with their outcome. |
| Mobile bundle | Contains only `EXPO_PUBLIC_*` values (the API URL). No keys or secrets ship in the app. |
| Location | GPS is read only on explicit actions (photo capture, "Use GPS" on a property). There is no background or continuous tracking. |

## AI features

`services/api/src/services/ai.ts` builds the model's context **as the requesting user**:
- Only projects the user can access are included.
- Budget figures are included only with `budget:read`.
- Client-facing modes (client update) and external users get client-visible activity and change orders only, with no costs or internal notes.

The provider key stays on the server, and `AI_PROVIDER=none` disables the feature entirely. The assistant only drafts text; it cannot change data.

## Realtime

`GET /realtime?token=…` authenticates with the access token. Events are filtered per connection by organization, project access (re-checked when membership may have changed) and internal/external audience. The events are change hints only: clients re-fetch through the authorized REST and sync endpoints.

## Production checklist

- [ ] Generate unique `JWT_SECRET` (≥ 48 random bytes) and `DATA_ENCRYPTION_KEY` (32 bytes) per environment, and keep them in a secret manager.
- [ ] Use `STORAGE_DRIVER=s3` with a private bucket and a least-privilege IAM key (the API refuses `local` in staging and production).
- [ ] Use TLS everywhere, and restrict `CORS_ORIGINS` to the admin web origin(s).
- [ ] Have admins and project managers enable MFA (Settings → Security), and review the **Roles & permissions** overrides.
- [ ] Database: TLS, a non-superuser app role, backups and point-in-time recovery.
- [ ] Forward logs (pino JSON) to your log platform. Alert on `refresh token reuse detected` and on 5xx rates.
- [ ] Run `npm audit` and image scanning in CI.

## Known limitations

- Rotating `DATA_ENCRYPTION_KEY` needs a re-encryption script (not yet provided).
- Sync pull filters use the default role matrix for a few row filters (labor, internal messages). Per-org overrides affect REST and capability checks, but not every sync filter yet.
- There is no field-level encryption of the on-device SQLite database. It relies on OS storage protection, so enable device passcodes through MDM for company phones.
- Two-step verification is opt-in per user (Settings → Two-step verification); there is no org-wide "require MFA" policy yet.
