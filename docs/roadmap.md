# Roadmap and known limitations

## Status

The product scope in the brief is implemented end to end and covered by tests. That includes the lifecycle, dashboards, scheduling, field work, money, documents, client portal, offline sync, auth, realtime, reports, AI and the 3D abstraction.

**Verified:**
- 102 unit and integration tests, run against real Postgres.
- 8 Playwright E2E specs, run against the real API and database.
- Typecheck and lint for all workspaces.
- The bundled API and worker run from a production-only dependency tree.

**Not verified in this environment:**
- Native iOS/Android builds and the Maestro flows. These need a simulator or device with an EAS dev or preview build.
- Docker image builds. There was no Docker daemon; CI builds both targets.
- Real third-party providers: S3, Expo push, Resend, OAuth, AI and design vendors. Each has an adapter and a dev implementation, but production keys were not exercised.

## Known limitations

| Area | Limitation | Suggested next step |
|---|---|---|
| Native modules | MMKV, maps, push, biometrics and background behaviour need a dev build; Expo Go falls back where it can (in-memory KV, no push) | Ship an EAS development build to the team |
| Uploads | Uploads run while the app is open; iOS may suspend long uploads in the background | Use background `URLSession` uploads (`expo-file-system` upload tasks with the background session type) |
| Sync filters | A few pull filters (labor, internal messages) use the default role matrix, not per-org overrides | Route them through `hasPermission` |
| MFA policy | Two-step verification is per user; there is no org-wide enforcement | Add an org setting and enforce it at login |
| Device encryption | The on-device SQLite is not encrypted beyond OS protections | SQLCipher build of expo-sqlite, or MDM-enforced device encryption |
| Key rotation | No script to re-encrypt MFA secrets for a new `DATA_ENCRYPTION_KEY` | Add a migration-style rotation command |
| Reports | Generated synchronously in the API | Move large exports to the worker and email a link |
| Search | Postgres `ILIKE` across key fields | Full-text (`tsvector`) or an external index once data grows |
| Schedule UI | A Gantt-style view with dependencies and the critical path; no drag-to-reschedule yet | Drag handles that call the existing schedule endpoints (the delay-impact preview already exists) |
| Accessibility | Labels, roles, contrast-checked tokens, 44 pt targets, dynamic type; not yet audited with VoiceOver/TalkBack on devices | Manual screen-reader pass on devices |
| Observability | Structured logs and health checks only | Sentry (API + app) and metrics |

## Next features

1. QuickBooks / Xero sync for invoices and payments (the `integrations` table is ready).
2. Online card/ACH payments in the client portal (Stripe).
3. Supplier ordering for materials from purchase orders.
4. Crew timesheets with geofenced clock-in prompts (still no continuous tracking).
5. Customer-facing progress timeline with a shareable link.
6. Design-vendor integrations implementing `PoolDesignProvider` (Pool Studio, Structure Studios and others).
