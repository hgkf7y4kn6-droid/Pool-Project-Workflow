# Deployment and operations

## Environments

| | development | staging | production |
|---|---|---|---|
| Backend | local (`npm run api:dev`) or `docker compose --profile stack` | containers from `main` | containers, promoted manually |
| Database | docker Postgres `pool_dev`, demo seed | managed Postgres; seed optional | managed Postgres with backups and PITR |
| Storage | `local` (files under `.storage`) | S3-compatible bucket | S3-compatible bucket |
| Mobile | dev client / Expo Go, `EXPO_PUBLIC_API_URL` → your machine | EAS channel `staging` | EAS channel `production`, app stores |
| Deploy | — | automatic on push to `main` | `Deploy` workflow → `production` |

`APP_ENV` selects behaviour. The API validates its configuration at boot and refuses to start with unsafe settings: local file storage in `staging`/`production`, an enabled provider without its key, and so on (`services/api/src/config/env.ts`).

## Infrastructure

The API is stateless; run two or more instances behind a load balancer. The pieces it needs:

| Component | Recommendation |
|---|---|
| API | Container platform (ECS/Fargate, Cloud Run, Fly, Render, Kubernetes). 0.5 vCPU / 512 MB to start. Health: `GET /health` (liveness), `GET /health/ready` (readiness, checks the DB). WebSockets must be allowed through the load balancer. |
| Worker | Same image family (`--target worker`), 1+ instances. BullMQ job schedulers are idempotent, so extra workers are safe. |
| PostgreSQL | **Supabase** (one project per environment). See [Supabase](#supabase) below. Any Postgres 16+ works too. |
| Redis 7 | Managed. Used by BullMQ and the realtime pub/sub bus. Without Redis, jobs run inline and realtime is per instance, which is fine for a single instance only. |
| Object storage | **Supabase Storage** (`STORAGE_DRIVER=supabase`), a private bucket. S3 / R2 / MinIO remain available with `STORAGE_DRIVER=s3`. |
| Email / push | Resend (`RESEND_API_KEY`), Expo push (`EXPO_ACCESS_TOKEN`) |

## Supabase

Pool PM uses Supabase for **Postgres** and **Storage**.
- Authentication, permissions, realtime and sync stay in our API. The offline login, the role matrix, client redaction and the sync protocol all depend on them.
- The app never talks to Supabase directly and holds no Supabase keys. Devices only receive short-lived signed URLs for files.

### Create one project per environment

1. Create a project per environment, for example `pool-pm-staging` and `pool-pm-prod`, in a region close to your API hosting. Use a strong database password.
2. Collect these values from the project:

| Value | Where in the dashboard | Variable |
|---|---|---|
| Session pooler connection string, port 5432 (IPv4) | **Connect** | `DATABASE_URL` and `MIGRATION_DATABASE_URL` |
| CA certificate | **Database → Settings → SSL Configuration** | `DATABASE_SSL_CA` (PEM or base64), with `DATABASE_SSL=verify-full` |
| Project URL and a **secret** API key (`sb_secret_…`) | **Settings → API Keys** | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` |

3. Run the one-time setup from a trusted machine. It applies migrations and creates the private bucket:

   ```bash
   MIGRATION_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
   DATABASE_SSL=verify-full DATABASE_SSL_CA="$(base64 -w0 prod-ca-2021.crt)" \
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
   npm run supabase:setup
   ```

4. Configure the API and worker:

   ```bash
   DATABASE_URL=<session pooler string>
   DATABASE_SSL=verify-full
   DATABASE_SSL_CA=<base64 CA>
   DATABASE_POOL_MAX=10
   STORAGE_DRIVER=supabase
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   ```

### Why these settings

- **Session pooler, not transaction pooler.** The API and worker are long-lived servers. Session mode behaves like a direct connection and supports everything we use. The sync triggers' advisory locks are transaction-scoped, so transaction mode (port 6543) also works, but it gives no benefit for a server and adds caveats. Keep `DATABASE_POOL_MAX × instances` below the pool size of your Supabase plan.
- **`verify-full` TLS.** The API refuses to start in staging or production with TLS disabled to a remote database. Don't put `sslmode` in the URL: TLS is configured explicitly from `DATABASE_SSL`.
- **The public Data API can't see our tables.** Migration `0002_supabase_lockdown` enables row-level security on every table and revokes all access from Supabase's `anon` and `authenticated` roles, including for future tables. A database test fails if any table lacks RLS. You can also turn the Data API off entirely under **Integrations → Data API**, since Pool PM doesn't use it. Supabase's Security Advisor should then show no "RLS disabled" findings.
- **Storage.** The bucket is private. Devices upload with single-use signed upload URLs, which Supabase fixes at 2 hours, and download with signed URLs (`SIGNED_URL_TTL_SECONDS`). Files are keyed `org/<id>/…`.
- **Secret key.** It is for the API and worker only. Treat it like the database password, and rotate it in **Settings → API Keys** if it leaks.
- **Backups.** Use Supabase daily backups; enable PITR on production. `npm run db:reset` refuses to run against a remote database.

## Release pipeline

`.github/workflows/deploy.yml`:

1. **images**: builds `api` and `worker` from the root `Dockerfile` and pushes them to GHCR as `ghcr.io/<owner>/pool-{api,worker}:<sha>`.
2. **migrate**: runs `node dist/migrate.js` from the new API image against the target `DATABASE_URL` (a GitHub Environment secret).
3. **rollout**: calls your platform's deploy hook (`DEPLOY_HOOK_URL`) with the two image tags, then polls `API_URL/health/ready`.
4. **mobile**: `eas update --channel <env>` for JS-only changes (default), or `eas build` when native code or dependencies changed (dispatch input `mobile: build`).

Set up a GitHub Environment per target (`development`, `staging`, `production`) with secrets `MIGRATION_DATABASE_URL`, `DATABASE_SSL_CA`, `DEPLOY_HOOK_URL`, `EXPO_TOKEN` and the variable `API_URL`. Add required reviewers on `production`.

### Migrations

- Edit `packages/database/src/schema.ts`, then run `npm run db:generate` and commit the SQL. CI fails if they are out of sync.
- Migrations run **before** the new code rolls out, so each one must be compatible with the previous release. Use expand → migrate data → contract across two releases for renames and drops.
- They are forward-only. Roll back by deploying a fix forward; restore from PITR only for data loss.
- Custom SQL (triggers, functions) goes in a hand-written migration file, as `0001_sync_triggers.sql` does. Every synced table needs the `change_seq` trigger.

### Mobile releases

- `apps/mobile/eas.json` has profiles `development`, `staging` and `production`, each with its own channel and `EXPO_PUBLIC_API_URL`. Replace the example URLs with yours, and set `EAS_PROJECT_ID`.
- The OTA update channel matches the build profile, so production builds only receive production updates.
- Store submission: `eas submit --profile production`. Fill in `submit.production` (App Store Connect / Play credentials).
- Native configuration (permissions, plugins, bundle IDs) is in `app.json` / `app.config.ts`. Bump the native version when it changes; OTA cannot ship native changes.
- The web/admin build is `npm run export:web -w @pool/mobile`, a static site. Host it on any CDN. It needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers for the SQLite web worker (see `e2e/serve-web.mjs`).

## Configuration and secrets

Every server setting is an environment variable (see `.env.example` and the README). Keep secrets in the platform's secret store, never in the repo or the app bundle. Generate per environment:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # DATA_ENCRYPTION_KEY (exactly 32 bytes)
```

Rotating `JWT_SECRET` invalidates outstanding access tokens only. Refresh tokens are opaque and stored hashed in the database, so apps transparently get new access tokens and nobody is signed out. To force everyone out, revoke the `sessions` rows. Rotating `DATA_ENCRYPTION_KEY` requires re-encrypting MFA secrets first.

## Observability

- **Logs**: pino JSON to stdout with a request id on every line (also returned in error bodies as `requestId`). Ship them to your log platform. Auth headers are never logged.
- **Health**: `/health` and `/health/ready` for load balancer and orchestrator probes.
- **Alerts worth having**:
  - 5xx rate
  - p95 latency of `/sync/*`
  - `refresh token reuse detected` warnings
  - BullMQ failed jobs
  - DB connections and CPU
  - the `sync_operations` rejected rate
- **Errors**: add Sentry (or similar) through `@sentry/node` in `services/api/src/server.ts` and `sentry-expo` in the app. The hooks are the Fastify error handler and the React error boundary.

## Backups and data

- Postgres: daily snapshots plus PITR. Test restores quarterly.
- Object storage: enable versioning and a lifecycle rule for deleted objects.
- Tenant removal: `deleteOrganization()` in `packages/database` deletes an organization and all its rows in dependency order. Remove its storage prefix `org/<id>/` separately.

## Scaling notes

- Every synced table has a `change_seq` index. The pull's high-water-mark lock is held only for a single `SELECT`. For very large tenants, composite `(project_id, change_seq)` indexes are the next step.
- Photos and documents never pass through the API (signed URLs). Thumbnails run in the worker.
- Reports (PDF/Excel) are generated on request. Move them to the worker if they grow large.
