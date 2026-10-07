# Pool PM — pool construction project management

A cross-platform app for pool builders. It covers the full job lifecycle, from lead and design through construction, inspections, change orders and payments to warranty. It is built for field crews with patchy signal and for the office team that runs the schedule and the books.

- **Mobile (iOS/Android) and web** from one Expo / React Native codebase (`apps/mobile`). The web export is the office/admin UI.
- **Offline-first**: every field action (checklists, photos, notes, hours, problems) works without signal. It syncs automatically and never silently drops edits.
- **Node/TypeScript API** (Fastify, PostgreSQL, Redis) with role-based access for 7 roles and a redacted **client portal**.

| | |
|---|---|
| Scheduling | Stage templates → tasks with FS/SS/FF dependencies and lag, working-day calendar, critical path, delay impact, resource conflicts. Weather warnings never auto-reschedule. |
| Field work | Task checklists with photo-required items, supervisor override with reason, problem reports, labor hours, camera workflow with GPS and auto-tagging to project/stage/task. |
| Money | Budget by category in integer cents, change orders with e-signature, payment schedule, materials and labor costs. |
| Documents | Versioned documents, offline copies, measurements (CAD-ready export), 3D design via a pluggable `PoolDesignProvider`. |
| Collaboration | Activity feed, messages, approvals, push notifications, realtime updates over WebSocket, search and saved views. |
| Reports | PDF / CSV / Excel exports. AI assistant that only sees what the user is allowed to see. |

## Repository layout

```
apps/mobile         Expo app (iOS, Android, web/admin)
services/api        Fastify REST + WebSocket API
services/worker     BullMQ worker (photo thumbnails, push delivery, weather and overdue scans, schedule recalculation)
packages/types      Domain enums + entity/DTO types
packages/validation zod schemas shared by app and API
packages/core       Pure domain logic: scheduling (CPM), permissions, budget, change orders, weather rules
packages/sync       Offline sync engine (queue, coalescing, backoff, 3-way merge)
packages/database   Drizzle schema, migrations, seed data
packages/api-client Typed fetch client with token refresh
packages/ui         Design tokens (palette, contrast-checked tones)
packages/config     Constants shared by app and API (upload limits, photo sizes, environments)
e2e                 Playwright E2E (web) + Maestro flows (native)
docs                Architecture, API, offline sync, security, testing, deployment, roadmap
```

See [docs/architecture.md](docs/architecture.md) for the design and the reasoning behind it.

## Quick start (local development)

Requirements: Node 22 (`.nvmrc`), npm 10, Docker (for Postgres/Redis/MinIO). For device builds you also need Xcode and/or Android Studio, or use Expo Go / EAS.

```bash
npm install
cp .env.example .env
docker compose up -d            # Postgres 16, Redis 7, MinIO
npm run db:migrate
npm run db:seed                 # demo company "Blue Lagoon Pools"

npm run api:dev                 # http://localhost:4000  (GET /health)
npm run worker:dev              # optional; without REDIS_URL jobs run inline in the API
npm run mobile                  # Expo dev server: press i / a / w
```

When you run the app on a physical phone, set `EXPO_PUBLIC_API_URL` in `.env` to your computer's LAN address (for example `http://192.168.1.20:4000`) and add the Expo web origin to `CORS_ORIGINS` if you use the browser.

### Demo accounts

All demo accounts use the password `PoolDemo2026!`.

| Role | Email | What to try |
|---|---|---|
| Admin | admin@bluelagoon.test | Settings, roles and permissions, team, integrations |
| Project manager | pm@bluelagoon.test | Company dashboard, schedule, budget, change orders, reports |
| Designer | designer@bluelagoon.test | Design / 3D, measurements, documents |
| Field supervisor | super@bluelagoon.test | Today's tasks, checklists, inspections, overriding a checklist |
| Field worker | worker@bluelagoon.test | Assigned tasks, photos, hours, problem reports (no financials) |
| Subcontractor | sub@deserttile.test | Only their tasks on the Whitfield project |
| Client | client@example.test | Client portal: progress, photos, approvals, signing change order #2 |

"Whitfield Backyard Oasis" is the showcase project. It has a mid-construction schedule, an open change order, inspections, photos and payments.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run typecheck` / `npm run lint` | All workspaces via Turborepo |
| `npm test` | Unit + integration tests. The API and database suites need Postgres at `TEST_DATABASE_URL`. |
| `npm run e2e` | Builds the web app and runs Playwright against a real API + fresh database |
| `npm run db:generate` | Generate a migration after editing `packages/database/src/schema.ts` |
| `npm run db:reset` | Drop, migrate and reseed the dev database |
| `docker compose --profile stack up -d --build` | Run the production API/worker images locally |

## Configuration

All server configuration is environment variables, validated at startup (`services/api/src/config/env.ts`). In staging and production the API refuses to start on unsafe settings, such as local file storage. `.env.example` lists every variable. The main ones are:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL. Redis enables BullMQ jobs and multi-instance realtime. |
| `JWT_SECRET`, `DATA_ENCRYPTION_KEY` | Token signing; AES-256-GCM key for secrets at rest such as MFA seeds. Generate with `openssl rand`. |
| `STORAGE_DRIVER`, `S3_*` | `local` for development, or `s3` for AWS S3, Cloudflare R2, MinIO and other S3-compatible stores |
| `WEATHER_PROVIDER` | `open-meteo` (no key needed) or `none` |
| `PUSH_PROVIDER`, `EXPO_ACCESS_TOKEN` | `expo` push, or `log` for development |
| `MAIL_PROVIDER`, `RESEND_API_KEY` | `resend`, or `console` for development |
| `GOOGLE_OAUTH_CLIENT_IDS`, `APPLE_OAUTH_CLIENT_IDS` | Enable social sign-in |
| `DESIGN_PROVIDER_HTTP_URL/TOKEN` | External 3D pool design service |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY` | AI assistant; `none` disables it |
| `EXPO_PUBLIC_API_URL` | The only value the app needs. Everything `EXPO_PUBLIC_*` ships in the bundle, so never put secrets there. |

## Production

The short version is below. [docs/deployment.md](docs/deployment.md) has the full guide.

1. Provision managed PostgreSQL 16, Redis 7 and an S3-compatible bucket. Set the secrets for each environment.
2. Build the images: `docker build --target api` and `--target worker` (CI does this and pushes to GHCR).
3. Run migrations once per release: `docker run --rm -e DATABASE_URL=… pool-api node dist/migrate.js`.
4. Roll out the API (stateless, horizontally scalable, `GET /health/ready` for probes) and one or more workers.
5. Ship the app with EAS: `eas build --profile production` for store builds and `eas update --channel production` for JS-only changes.

## Documentation

- [Architecture and decisions](docs/architecture.md)
- [API reference](docs/api.md)
- [Offline-first and sync](docs/offline-sync.md)
- [Security model](docs/security.md)
- [Testing](docs/testing.md)
- [Deployment and operations](docs/deployment.md)
- [Roadmap and known limitations](docs/roadmap.md)
