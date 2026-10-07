# Testing

| Layer | Tool | Where | Needs |
|---|---|---|---|
| Unit: domain logic | Vitest | `packages/core/test` (scheduling/CPM, permissions, budget, change orders, checklist rule, weather) | nothing |
| Unit: sync engine | Vitest | `packages/sync/test` (queue, coalescing, backoff, three-way merge, conflicts, access purge) against in-memory stores | nothing |
| Unit: shared libs | Vitest | `packages/validation`, `packages/api-client` (refresh single-flight, error mapping), `packages/ui` (WCAG contrast of every tone), `apps/mobile/test` (signature PNG encoder) | nothing |
| Database | Vitest | `packages/database/test`: migrations apply cleanly, the seed runs, and a tenant can be deleted and re-seeded | Postgres |
| API integration | Vitest + `fastify.inject` | `services/api/test`: auth (lockout, refresh rotation and reuse detection, MFA, magic links), access control per role, client redaction, workflows (project → schedule → tasks → change order → payment, inspections → corrective tasks), and sync push/pull/conflicts/idempotency | Postgres |
| End-to-end (web) | Playwright | `e2e/tests`: drives the real Expo web build against the real API and a fresh seeded database | Postgres, Chromium |
| End-to-end (native) | Maestro | `e2e/maestro/flows`: login, offline checklist + reconnect, camera photo | Simulator/emulator with a dev or preview build |

## Running

```bash
docker compose up -d postgres redis
npm test                                     # every workspace's unit + integration tests
npm test -- --filter=@pool/core              # one workspace
cd services/api && npx vitest run test/sync.test.ts   # one file
```

The API and database suites use `TEST_DATABASE_URL` (default `postgres://postgres@localhost:5432/pool_test`; docker compose creates `pool_test` through `infra/postgres-init.sql`).
- The API suite drops and recreates that schema, migrates and seeds once per run, and runs files serially.
- The database suite uses its own `pool_test_seed` database.

### Playwright

```bash
npm run e2e        # = build the web app into e2e/.web, then playwright test
```

`e2e/playwright.config.ts` starts two servers:
- the API (from source via tsx) on :4000, against `E2E_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/pool_e2e`)
- a static server with COOP/COEP headers on :8099, which expo-sqlite's web worker needs

`global-setup.ts` drops, creates, migrates and seeds the database before every run.

Locally, an API that is already listening on :4000 is reused. Stop your dev API first, or it will run the tests against `pool_dev`.

| Spec | Covers |
|---|---|
| `auth.spec.ts` | wrong-password message; PM sign-in and dashboard |
| `projects.spec.ts` | creating a project with a new client and property generates a 17-task schedule; a task assigned in the app reaches the worker's device and notifications |
| `field.spec.ts` | a checklist tick made **offline** is saved on device, completion is blocked by required items, and it syncs on reconnect; a camera photo uploads with project/stage/task context |
| `client.spec.ts` | the client sees only their project, signs change order #2 and the server records approval and signature |

To use a preinstalled Chromium instead of `npx playwright install`, set `PLAYWRIGHT_CHROMIUM_PATH`. Traces and screenshots for failures are kept in `e2e/test-results`.

### Maestro

```bash
eas build --profile development --platform ios    # or install a preview build
maestro test e2e/maestro
```

The flows use the seeded accounts. Point the build's `EXPO_PUBLIC_API_URL` at an API running the demo seed.

## CI

`.github/workflows/ci.yml` runs on every PR and on pushes to main:

1. `typecheck` and `lint` across all workspaces (Turborepo).
2. Unit and integration tests against Postgres 16 and Redis 7 service containers.
3. **Migration drift check**: `drizzle-kit generate` must produce nothing, so every schema change has a committed migration.
4. Bundling of the API and worker (tsup).
5. Playwright E2E. The report and traces are uploaded when it fails.
6. Docker builds of both image targets.

## Writing tests

- Put business rules in `packages/core` and test them there. They are pure functions with no I/O.
- API tests use `test/helpers.ts`: `createTestApp()`, `login(app, USERS.pm)`, and `api(app, token).get/post/...`. Seeded records are looked up through the API (for example `/projects?q=Whitfield`), so tests never hard-code generated UUIDs.
- The integration suite shares one seeded database. Create your own records rather than mutating shared seed data that other files assert on.
- E2E selectors use accessible roles and names (`getByRole("button", { name: "Create task" })`). Keep accessibility labels meaningful; they serve as both test hooks and screen-reader text.
