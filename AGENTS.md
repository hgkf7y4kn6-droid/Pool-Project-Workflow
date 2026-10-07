# Pool PM — notes for coding agents

Monorepo (npm workspaces + Turborepo). Read `README.md` and `docs/architecture.md` first.

- **Commands**: `npm run typecheck`, `npm run lint`, `npm test` (API/database suites need Postgres at `TEST_DATABASE_URL`), `npm run e2e`.
- **Where logic goes**:
  - Business rules go in `packages/core`: pure functions, unit-tested.
  - Request shapes go in `packages/validation`; use `patchOf()` for PATCH schemas.
  - Shared constants go in `packages/config`.
  - The API keeps HTTP in `routes/` and logic in `services/`. Every external system sits behind an adapter in `services/api/src/adapters`.
- **Authorization**:
  - Every service call checks `requirePermission` (capability) and `loadProject` / `projectAccessCondition` (row level).
  - Return 404 for inaccessible rows.
  - Clients and subcontractors must never receive internal fields; see `docs/security.md`.
- **Offline**:
  - Field writes in the app go through `apps/mobile/src/lib/mutations.ts`: a local upsert plus an enqueued sync op.
  - The matching server handler lives in `services/api/src/services/sync.ts` and must call the same service function as REST.
  - Never drop queued operations silently.
- **Database**:
  - Edit `packages/database/src/schema.ts`, then `npm run db:generate`, and commit the migration.
  - Synced tables need `version`, `change_seq` and `deleted_at`, plus the trigger from `0001_sync_triggers.sql`.
- **Money** is integer cents. **Dates** are `YYYY-MM-DD`. **IDs** are UUIDs, which clients may generate.
- **UI**:
  - Use the components in `apps/mobile/src/components/ui`.
  - Give interactive elements accessible labels. E2E tests select by role and name.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
