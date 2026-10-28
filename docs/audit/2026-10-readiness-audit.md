# Commercial readiness audit — baseline and findings (2026-10-28)

Scope: repository at commit `c9124d2` (v0.0.7), audited from source plus a local Postgres 16 test environment. Nothing in staging or production was touched, and no production credentials were seen.

## 0. How to read this

Every finding carries a verification label.

- **VERIFIED**: reproduced by a test I ran in this session.
- **CODE-READ**: confirmed from source or config only, not exercised.
- **PROBABLE**: a plausible risk that needs more evidence.
- **NOT ASSESSED**: I had no access or did not do the work.

### Baseline (VERIFIED, local)

| Check | Result |
|---|---|
| `npm ci` | OK |
| `turbo run typecheck lint` | 14/14 tasks pass |
| `turbo run test` (real Postgres 16) | 12/12 tasks pass. API: 63 passed, 4 skipped (the CrewAI contract test, which needs the Python service). Core 69, sync 12, config 9, validation 5, api-client 4, ui 6, database 3, mobile 1 |
| `npm run build` for API and worker bundles | OK |
| `npm audit --omit=dev` | 33 vulnerabilities: 6 high, 14 moderate, 13 low. Details in F-12 |
| Playwright E2E, native builds, Docker images | **NOT RUN.** Nothing was built in this environment |
| Deployed staging/production, Render, Supabase, Cloudflare, backups/PITR | **NOT ASSESSED.** No access |

### Stack and integrations found in the repo

- **Frontend**: Expo / React Native, with a web export served statically on Render.
- **API**: Fastify, Drizzle and Postgres (Supabase in staging and production), Redis/BullMQ.
- **Python service**: CrewAI, optional.
- **Integration adapters** (each behind an interface):
  - Supabase Storage (S3 and local also exist)
  - Expo push
  - Resend mail
  - Open-Meteo weather
  - Google/Apple OAuth
  - Anthropic AI
  - an HTTP 3D-design provider
- **Not present in the repo**:
  - Cal. No reference anywhere; it needs confirming where it is configured.
  - Any payment processor, webhooks, subscription or billing, estimating or proposals, e-signature vendor, and accounting or CRM integrations.
- **Tenant isolation**: all queries are scoped by `organization_id` plus a project-level access predicate (`services/api/src/services/access.ts`).

## 1. Executive readiness scorecard

Scores are bounded by what was verified. Confidence is stated per row.

| # | Pillar | Score | Confidence | Evidence coverage | Main weaknesses | Next action |
|---|---|:-:|---|---|---|---|
| 1 | Architecture and maintainability | 7 | Medium | Docs and about 25% of API code read. Typecheck, lint and 170 tests pass | Dead-code and bundle analysis not done. `services/sync.ts` authorization sat after data access (F-01) | Run knip or depcheck. Add an architecture rule: authorize before read |
| 2 | Security and privacy | 5 | Medium | Auth, access, sync, documents and CO code read. Cross-tenant sweep run | F-01, F-03, F-04, F-05, F-06, F-12 | Ship fixes F-01 to F-03, decide on F-04, add `npm audit` to CI |
| 3 | Pool workflows and reliability | 5 | Low-Med | Code and docs only. Schedule engine unit tests pass | No estimating, proposal or contract module. Duplicate payments on concurrent approval (F-02). No inspection-required gating verified | Confirm intended scope. Hand-trace the scheduling engine. Walk the field workflow |
| 4 | UX/UI and accessibility | 5 | Low | Static only. 39 of 96 `.tsx` files carry accessibility attributes. E2E selects by role. No viewport, screen-reader or contrast run | Documented as not audited on device (`docs/roadmap.md`) | Run Playwright at six viewports with axe. Do a manual VoiceOver and TalkBack pass |
| 5 | Performance and scalability | 4 | Low | No measurement | No metrics, no Sentry. ILIKE search. Synchronous report generation | Capture baselines (LCP/INP, p95 API). Run EXPLAIN on the top 10 queries |
| 6 | Integrations and financial integrity | 5 | Medium | CO and payment code read. Race reproduced | F-02, F-07. Money is integer cents (good). No payment processor to audit | Add idempotency and a unique index on payments |
| 7 | Testing and release safety | 6 | Medium | CI config read, suite run | `render.yaml` deploys from a feature branch (F-08). No dependency scan in CI. E2E and RLS test results not re-run here | Fix F-08, add an audit job, run E2E in CI |
| 8 | SaaS readiness | 4 | Medium | Code and docs | No billing or entitlements, no email verification, no data export or account closure, no org-wide MFA, global-unique email | Product decisions needed (see backlog) |
| 9 | Pool safety and compliance | 6 | Low-Med | Docs: the design states it never certifies compliance and caps readiness at 40 when a mandatory gate is blocked | Not exercised end to end. Jurisdiction configurability unconfirmed | Verify with a seeded blocked-permit scenario |

**Overall**: a well-structured codebase with strong foundations: server-side authz, 404-not-403, hashed tokens, refresh rotation, integer-cents money, and CI that gates typecheck, lint, tests and migrations. It is **not yet commercially ready** because of one confirmed cross-tenant data-exposure path (fixed in the working tree, F-01) and one confirmed duplicate-financial-record path (also fixed, F-02). A credential-endpoint rate-limit bypass remains partly open (F-03/F-04).

**Top three commercial blockers**
1. F-01: cross-tenant read via `/sync/push` (fixed, unreleased).
2. No billing, entitlements or tenant offboarding, if the product is sold as SaaS.
3. No estimate, proposal or contract workflow, if the brief expects one. It is absent from the repo.

**Top three security or reliability risks**
1. F-04: IP rate limiting is defeatable via `X-Forwarded-For` (`trustProxy: true`).
2. F-02: concurrent approvals duplicate payments (fixed, unreleased; DB constraint still recommended).
3. F-06: refresh-token reuse detection can log out a field worker whose response was lost.

**Safe for commercial use now**: nothing should be exposed to customers until F-01 and F-02 ship.

**Needs restriction or validation**: change-order approval, the payments ledger, sync, and public registration.

**Unverified areas**
- The deployed environment.
- Backups and PITR restore.
- Real third-party provider behavior.
- Cal (not found in the repo).
- Browser accessibility and responsiveness.
- Performance.
- The Playwright E2E suite and native builds.
- Scheduling-engine correctness beyond its unit tests.

## 2. Findings register

Priority: P0 critical blocker, P1 high, P2 medium, P3 enhancement.

### Confirmed defects (reproduced here)

**F-01 — P0 — Security — Cross-tenant row disclosure via sync conflicts. VERIFIED, FIXED in working tree.**
- **Evidence.** `mergeUpdate()` in `services/api/src/services/sync.ts` read the target row by id only, with no organization or project scope, and returned it as `serverRecord` in a `conflict` result. The authorization call (`loadTask`, `updateInspection`, and so on) ran after the merge. A freshly self-registered user in a brand-new organization posted `/sync/push` with `entityType: task`, a Whitfield task id and `baseVersion: 0`. The response contained the full task row, including `assigneeId`, `crewTeamId` and dates.
- **Affected.** `tasks`, `checklist_items`, `measurements`, `inspections` and `photos` update operations (photo rows include `storageKey`).
- **Impact.** Anyone who knows or leaks a UUID can read another company's rows. Registration is open, so the attacker needs no relationship with the victim. UUIDs are not guessable, which limits exploitability, but they are not secrets either.
- **Fix.** `mergeUpdate` now receives `ctx` and calls `authorizeRead` first: `loadTask` for tasks and checklist items, `loadProject` plus the read permission for the rest (clients are excluded).
- **Regression.** `services/api/test/audit-regressions.test.ts` fails on the old code and passes on the new.
- **Residual risks (not fixed).**
  - `existingVersion()` and the `sync_operations` lookup by op id are not org-scoped. They only reveal whether an id exists, and the op-id upsert can overwrite another tenant's log row (P2).
  - Add a test that every sync handler authorizes before reading.

**F-02 — P1 — Financial integrity — Concurrent change-order approval duplicates payments. VERIFIED, FIXED in working tree.**
- **Evidence.** `transitionChangeOrder` read the row outside the transaction and updated with `where id = …`, with no status guard. Six parallel approvals all returned 200 and created six `payments` rows for one $5,000 change order. The `payments` table has no unique key on `change_order_id`.
- **Impact.** Overbilled payment schedules, and duplicate approval and notification side effects. Offline retries and double-taps make this realistic.
- **Fix.** Compare-and-set on the validated status. A loser now gets 409 and runs none of the side effects.
- **Remaining recommendation, needs authorization (migration).**
  - A partial unique index: `unique (change_order_id) where status <> 'void' and change_order_id is not null`.
  - First check production for existing duplicates.
  - `createPayment` still accepts replays. Add a client-generated id or an idempotency key.

**F-03 — P1 — Security — Auth rate limits bypassed by varying the `Authorization` header. VERIFIED, FIXED in working tree.**
- **Evidence.** The global rate-limit `keyGenerator` (`services/api/src/app.ts`) keys on the last 24 characters of the `Authorization` header. The "strict" auth limit shared it. With a limit of 3, 12 login attempts with different junk bearer tokens never returned 429.
- **Impact.** Credential stuffing was unthrottled. The per-account lockout (8 failures) still applies, but it also lets anyone lock out any known account.
- **Fix.** Strict routes now key on `req.ip`.
- **Residual.** The global limiter still trusts the header on unauthenticated paths. Low impact.

### Open items needing a decision or more evidence

**F-04 — P1 — Security — `trustProxy: true` lets clients choose their IP. VERIFIED in test (fix not applied).**
- Rotating `X-Forwarded-For` evaded the IP-keyed auth limit (8 failed logins, limit 3, no 429).
- The docs name a direct Render URL as a fallback, so the origin is reachable around Cloudflare.
- It also affects `ip_address` in the sessions table and the audit log.
- **Needs** the real proxy topology, then `trustProxy` set to a hop count or CIDR list, for example Cloudflare ranges or `1` for Render alone.
- **Acceptance.** A spoofed `X-Forwarded-For` does not change `req.ip` against the staging origin.

**F-05 — P2 — Security — Realtime token in the query string. PROBABLE.** `GET /realtime?token=…` puts a 15-minute access token in the URL. Pino redacts only `req.headers.authorization`, and Fastify logs `req.url`. Confirm in staging logs, then add `req.url` redaction or move to a short-lived ws ticket.

**F-06 — P1 — Reliability — Refresh reuse detection can sign out field workers. PROBABLE (CODE-READ).**
- In `services/api/src/services/auth.ts#refresh`, presenting the previous refresh token revokes the whole session.
- If a rotation response is lost on a poor connection, which is the app's core use case, the retry kills the session.
- The select-then-update is also not atomic.
- **Fix.** A short grace window (about 30–60 s) where the previous token returns the same successor, plus an atomic compare-and-set.

**F-07 — P2 — Security — Other auth gaps. CODE-READ.**
- No email verification on `/auth/register`; registration is open.
- `changePassword` does not revoke other sessions (only reset does).
- No TOTP replay protection.
- Registration reveals whether an email exists.
- Emails are unique globally, so one person cannot belong to two companies.
- Access tokens stay valid for up to 15 minutes after logout, deactivation or a role change (by design; sensitive routes call `requireLiveSession`).

**F-08 — P1 — Release safety — `render.yaml` deploys the web app from branch `claude/youthful-hypatia-epd25w`. CODE-READ.** Production hosting follows a feature branch, not `main`. Confirm the actual Render setting, then pin it to `main`.

**F-09 — P2 — Data governance — Uploads. CODE-READ.**
- `ALLOWED_MIME` in `documents.ts` includes `application/octet-stream`, which defeats the allowlist.
- `byteSize` is client-declared and never checked against `LIMITS.documentBytes`.
- No malware scanning.
- **Fix.** Enforce size from the storage `HEAD` result, and drop `octet-stream`, or restrict it to the CAD extensions that need it.

**F-10 — P3 — Hygiene — `dump.rdb` is tracked in git (`.gitignore` lists it).** It contains BullMQ scheduler metadata only; I found no credentials, but a stray runtime artifact does not belong in history. Remove it with `git rm --cached`.

**F-11 — P2 — Web hardening — No CSP or HSTS for the static web host. CODE-READ.** `render.yaml` sets COOP, COEP, nosniff and referrer policy only. Cloudflare may add HSTS (unverified). Add a CSP; test it against the Expo web bundle and the COEP requirement first.

**F-12 — P1/P2 — Dependencies — `npm audit --omit=dev`: 6 high. VERIFIED (scan only).**
- Direct: `sharp` (libvips and libheif CVEs, on the thumbnail worker that processes user images) and `zod` (memory exhaustion on oversized constrained arrays, mitigated by the 2 MB and 5 MB body caps).
- Transitive: `undici`, `node-forge`, `postcss`, `image-size`, and `uuid` via `exceljs` and `xcode`.
- **Action.** Upgrade `sharp` and `zod` and run the full suite. `npm audit fix` may touch Expo-pinned packages, so review it before applying.
- `docs/security.md` says CI runs `npm audit`, but `.github/workflows/ci.yml` has no such step. Add one that fails on high or above.

**F-13 — P2 — Observability — No error tracking or metrics (self-documented).** Only pino logs and `/health`. `/health/ready` covers the database, not Redis or storage.

**F-14 — P2 — Workflow — Inspection and permit gating. NOT ASSESSED.** `docs/intelligence.md` states that a blocked mandatory gate caps readiness. I did not verify that tasks cannot be completed past an open inspection.

### Passed negative tests (VERIFIED)

A user from a different organization received 404 on 15 project-scoped GETs and 5 writes. These covered the project, budget, payments, change orders, messages, expenses, stages, activity, task, documents, photos, intelligence, and PATCH/DELETE/POST on tasks, payments and change-order transition. Search and project list returned empty. The seeded suite also covers client and subcontractor redaction.

## 3. Workflow and UX audit (summary; field testing NOT DONE)

| Workflow | Observed from code/docs | Gaps / next check |
|---|---|---|
| Registration and onboarding | Creates the org, default stage and inspection templates, and an admin | No email verification, no guided setup, no sample project |
| Project creation | Zod-validated, client-generated UUIDs | Duplicate detection not found |
| Estimating, proposals, contracts | **Not implemented.** Budget by category and change orders exist | Decide scope: build, or integrate |
| Scheduling | CPM with FS/SS/FF and lag, working days, delay impact, resource conflicts (unit-tested) | No drag reschedule. Verify cascade and impossible-schedule handling end to end |
| Field work | Checklists, photos, labor, offline queue, three-way merge | F-06 can log users out. Offline upload suspension on iOS is documented |
| Change orders | Draft → submitted → client review → signed approval → scheduled | F-02 fixed. Add the DB unique index |
| Closeout and warranty | Mentioned in the rules engine | Not verified |
| Accessibility | Labels, 44 pt targets, tokens contrast-checked | No axe run, no screen-reader pass |

## 4. Remediation backlog

Effort: S under 1 day, M 1–3 days, L over 3 days. Cost is $0 unless noted; no paid-service change is proposed.

| ID | Pri | Category | Proposed fix | Effort | Risk | Acceptance / verification | Status |
|---|---|---|---|:-:|---|---|---|
| F-01 | P0 | Security | Authorize before merge in sync | S | Low | Stranger gets `rejected`, no record (test added) | **Fixed locally, unreleased** |
| F-02 | P1 | Integrity | Compare-and-set (done). Add partial unique index and a payment idempotency key | S + S | Low. The index needs a duplicate check and your approval | One payment per approved CO under 6 parallel requests (test added) | Code fixed. DB index **not started** |
| F-03 | P1 | Security | IP-keyed strict limit | S | Low | 429 after N attempts with rotating headers (test added) | **Fixed locally, unreleased** |
| F-04 | P1 | Security | Set `trustProxy` to the real hop count or CIDRs | S | Medium. Wrong value breaks all IP limits | Spoofed XFF ignored on the staging origin | **Blocked** on topology |
| F-06 | P1 | Reliability | Grace window for the previous refresh token, atomic rotation | M | Medium | Lost-response retry keeps the session; replay after the window revokes | Not started |
| F-08 | P1 | Release | Pin Render branch to `main` | S | Low | Render dashboard and Blueprint show `main` | **Blocked** on Render access |
| F-12 | P1 | Dependencies | Upgrade `sharp` and `zod`, add an audit CI job | S–M | Medium | `npm audit --omit=dev` shows no high in direct deps. Suite green | Not started |
| F-05 | P2 | Security | Redact `req.url` or use a ws ticket | S | Low | No token in logs | Not started |
| F-07 | P2 | Security | Email verification, revoke sessions on password change, org-wide MFA option | M–L | Medium | Per-item tests | Not started |
| F-09 | P2 | Security | Server-side size cap, tighten MIME | S | Low | Oversized or disallowed upload rejected at completion | Not started |
| F-11 | P2 | Security | CSP for the web host | M | Medium. Can break the Expo bundle | Scan clean, app loads | Not started |
| F-13 | P2 | Ops | Sentry (free tier) and a readiness check for Redis and storage. **Needs your approval for a new service** | M | Low | Test error appears in the dashboard | Not started |
| F-10 | P3 | Hygiene | `git rm --cached dump.rdb` | S | Low | File absent | Not started |
| Baselines | P2 | Performance/A11y | Playwright + axe at six viewports, Lighthouse, EXPLAIN on the top queries | M | None | Reports committed | Not started |

Recommended enhancements (not defects), pending product direction:
- estimating and proposals
- billing and entitlements
- data export and account closure
- org-wide MFA
- webhooks and idempotency for any future payment provider
- a Cal integration, if intended

## 5. Verification checklist (executable)

| Area | Test | Pass condition |
|---|---|---|
| Org isolation | Register a second org and request the first org's IDs on every route (the sweep above) | Every response is 404 or a rejected result, and none contains the other org's data |
| Sync | Push an update for an id from another org with a stale `baseVersion` | `rejected`, no `serverRecord` |
| Duplicate financial | 6 parallel approvals of one CO | Exactly one 200 and one payment |
| Auth rate limit | 10 logins with varying Authorization headers and varying `X-Forwarded-For` | 429 after the limit (the header variant passes now, the XFF variant needs F-04) |
| Session | Rotate a refresh token, drop the response, retry | Session survives once F-06 ships |
| Uploads | Complete an upload larger than the cap, and upload `octet-stream` | Rejected (after F-09) |
| Backup | Restore the latest Supabase backup to a scratch project and run the seed-count query | Row counts match. Record the RTO and RPO |
| Deploy | Verify the Render branch, then deploy and roll back the previous image | Rollback completes within the documented time |
| Accessibility | axe at 320, 390, 768, 1024, 1440 and 1920 px, plus a keyboard-only walk and VoiceOver on login → project → task → photo | No serious or critical violations. Focus is always visible |
| Performance | Lighthouse (LCP ≤ 2.5 s, CLS ≤ 0.1). k6 against the project list and sync pull with seeded data | p95 under 1 s at the agreed load |
| Dependencies | `npm audit --omit=dev --audit-level=high` in CI | Exit 0 |

## 6. Commercial readiness package

| Document | State |
|---|---|
| Architecture, API, offline-sync, security model, testing, deployment, roadmap | **Exist** in `docs/` |
| Intelligence design and retention | **Exists** (`docs/intelligence.md`) |
| Data-flow diagrams | Missing |
| Incident response plan | Missing |
| Data retention and deletion policy (customer-facing) | Partial. Only agent-run retention is documented |
| Backup and DR runbook with measured RTO/RPO | Partial. Deployment doc says "daily backups, PITR on production", with no restore evidence |
| Privacy policy, terms, subprocessor list | Missing |
| Integration inventory | Partial (README env table) |
| Accessibility statement and VPAT | Missing, and not credible until the manual pass is done |
| Independent audit, SOC 2, PCI | **None.** Make no such claims |
| Vendor security questionnaire answers | Missing. Can be drafted from `docs/security.md` once F-01 to F-04 are closed |

## 7. Go/No-Go

**Conditional Go (internal pilot only). Not yet suitable for a broad customer base.**

- **Supports it:** green typecheck, lint and tests; negative tenant tests pass on 20 requests; strong auth and storage design; both confirmed critical defects have local fixes with failing-then-passing regression tests.
- **Before any external customers:**
  - Release F-01, F-02 and F-03. These are not shipped yet; see section 8.
  - Decide and fix F-04 and F-08.
  - Upgrade `sharp` and `zod` and add the audit job.
  - Run the F-02 duplicate check, then add the unique index.
  - Run a restore drill.
- **Before expanding beyond a pilot:**
  - F-06, the accessibility and performance baselines, monitoring, and the missing policy documents.
  - Product decisions on billing, estimating and tenant offboarding.
- **Unverified:** everything listed under "Unverified areas" above. This assessment does not cover them.

## 8. Changes made in this session (uncommitted working tree)

| File | Change |
|---|---|
| `services/api/src/services/sync.ts` | `mergeUpdate` takes `ctx` and authorizes via `authorizeRead` before touching the row (F-01) |
| `services/api/src/services/change-orders.ts` | Status compare-and-set on transition; 409 on a lost race (F-02) |
| `services/api/src/routes/auth.ts` | Strict auth limit keyed by `req.ip` (F-03) |
| `services/api/test/helpers.ts` | `createTestApp` accepts env overrides |
| `services/api/test/audit-regressions.test.ts` | Three regression tests, each confirmed to fail without its fix |
| `docs/audit/2026-10-readiness-audit.md` | This report |

Full API suite after the changes: 66 passed, 4 skipped (the CrewAI contract test). Typecheck and lint of `@pool/api` pass.

**Before pushing**, `CLAUDE.md` requires `npm run version:bump` for API changes. I did not run it, since you did not ask me to commit or push.

**Rollback** is a plain revert of the three source files. No migrations or data changes were made.
