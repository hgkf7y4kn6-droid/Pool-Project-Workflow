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
| Playwright E2E (web export + API + Postgres) | 12 passed, 3 skipped (the screenshot tours). Run in the addendum, section 9. Native builds and Docker images still **NOT RUN** |
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
| 4 | UX/UI and accessibility | 6 | Medium (web only) | axe-core 4.10 on 28 routes x 6 viewports (320-1920 px), keyboard walk, screenshots. No screen reader, no native | 70 switches without `aria-checked`, Gantt bars unlabeled for assistive tech, one static page title, 19% of targets under 44 px | Fix F-15 to F-20, then a VoiceOver/TalkBack pass. See section 9 |
| 5 | Performance and scalability | 5 | Medium-Low | Local measurements on a 1,006-project / 20k-task / 300k-activity copy, plus cold-load metrics. Not production hardware | 3.7 MB single JS bundle; `/dashboard` unbounded and 1.9 s p50 at 20 concurrent; no metrics, `SENTRY_DSN` declared but unused | Fix F-21, F-22. Re-measure on staging. See section 9 |
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
- The deployed environment (staging and production settings are known only from the repo).
- Supabase backups and PITR restore (only a local logical restore was run, section 9.4).
- Real third-party provider behavior.
- Cal (not found in the repo).
- Screen-reader, native and zoom/text-spacing accessibility; client, subcontractor and worker screens.
- Production-hardware performance and real-network load times.
- Native builds and Docker images.
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

## 9. Addendum: accessibility, responsive layout, performance, backups, and environment configuration

Run on 2026-10-28 against the web export of v0.0.8 (`e2e/.web`), the API on a local Postgres 16 with the demo seed, and headless Chromium. Results come from the `pm@bluelagoon.test` account only. Nothing was run against staging or production. New findings continue the numbering above; fixes were **not** made for any of them.

### 9.1 Accessibility and responsive layout (web, VERIFIED unless noted)

**Method.**
- axe-core 4.10.2 with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` rule sets.
- 28 routes (sign-in plus 27 signed-in screens) at 320x640, 390x844, 768x1024, 1024x768, 1440x900 and 1920x1080.
- A document-level horizontal-overflow check, an interactive-target size census, a keyboard Tab walk of the sign-in screen, and screenshots of four screens at 320 and 1440 px.
- The existing Playwright suite (12 passed, 3 skipped) ran as the functional baseline.

**What passed.**
- No document-level horizontal overflow on any route at any of the six viewports.
- On a phone the schedule's timeline scrolls inside its own container and has a Timeline/List toggle. This is a deliberate mobile alternative.
- axe reported no color-contrast violations. axe cannot evaluate every element, so this is not a conformance claim.
- Every route has an `h1`, and `lang="en"` is set.
- Sign-in tab order is logical (email, password, Sign in, forgot password, create company) and every stop has a visible focus ring.
- No console errors or page errors on any route.

**Findings.**

| ID | Pri | Finding and evidence | Fix | Acceptance |
|---|---|---|---|---|
| F-15 | P2 | **70 `role="switch"` nodes have no `aria-checked`** (axe: critical): 67 on `/roles`, 3 on a task screen. `roles.tsx` sets `accessibilityState={{ checked }}`, but the web build does not render it as `aria-checked`. Screen-reader users cannot tell which permissions are on. *Cause is inferred from the rendered DOM, not confirmed in react-native-web.* | Pass `aria-checked` (or the version-appropriate prop) on web for every switch, checkbox and radio. Check the other `accessibilityState` uses. | axe shows 0 `aria-required-attr` on both screens. A VoiceOver or NVDA pass announces "on/off" |
| F-16 | P2 | **Gantt bars carry `aria-label` on role-less `div`s** (15 nodes on `/projects/{p}/schedule`, axe `aria-prohibited-attr`). The labels are ignored by assistive tech, so the timeline's dates are visual-only. | Give the bars a role (for example `img`) or hide the timeline from AT and make the List view the accessible equivalent. Verify the List view carries the same data. | 0 `aria-prohibited-attr`. List view has task, start, end and status for every row |
| F-17 | P3 | **Sign-in password field uses `autoComplete="password"`**, an invalid token (axe `autocomplete-valid`, WCAG 1.3.5). | Use `current-password` (and `new-password` on register and reset). | axe clean on sign-in. Browser password managers fill it |
| F-18 | P3 | Smaller axe items: 2 `progressbar`s without a name (`/projects`), a `ul` with non-`li` children (project detail), and scrollable regions that are not keyboard-focusable (`/team`, the timeline). | Name the progressbars, fix the list markup, add `tabIndex=0` and a label to scroll containers. | axe clean on those routes |
| F-19 | P2 | **Every route has the same `<title>`, "Pool PM"** (WCAG 2.4.2). Whether route changes are announced to screen readers was not tested. | Set per-screen titles through the router. Move focus or announce on navigation. | Distinct titles. Manual screen-reader check |
| F-20 | P2 | **Target size.** 91 of 475 interactive elements (19%) measure under 44x44 px, and 7 are under 24x24, for example the `Biometric unlock` switch on `/settings` at 40x20. WCAG 2.5.8 (AA) sets 24 px with spacing exceptions. Whether the exceptions apply was not checked. `docs/roadmap.md` claims 44 pt targets. | Enlarge the hit area (`hitSlop` or padding), then re-run the census. | 0 targets under 24 px. A documented policy for 24-44 px |

**Not assessed.**
- VoiceOver, TalkBack and NVDA.
- Native iOS and Android layouts and Dynamic Type.
- 200% zoom and text-spacing overrides.
- Dialog focus trapping and form-error announcements.
- Client, subcontractor, worker and designer screens.
- Reduced-motion behavior: only 6 references exist in the source, which suggests partial support.
- Layout clipping inside nested scroll containers. The overflow check only sees the document.
- Desktop navigation: at 1440 px the app shows the phone-style floating tab bar over a centered column. This looks intentional and was not judged a defect.

### 9.2 Performance (measured, local; treat absolute numbers as relative)

**Web load.** Cold, cache-disabled load of the sign-in screen at 390x844.

| Condition | LCP | CLS | Login form usable |
|---|---|---|---|
| No throttling, localhost | 0.73 s | 0.069 | 0.71 s |
| 4x CPU slowdown, 1.6 Mbps, 150 ms RTT | 24.7 s | 0.001 | 24.8 s |

- **The throttled row is pessimistic.** The test server does not compress, so it moved 3.73 MB of JavaScript. Gzip at level 9 gives 0.90 MB, and Render or Cloudflare normally compress. Even at 0.9 MB on that network the transfer alone is several seconds, so the 2.5 s LCP target is **unlikely** to be met on a slow phone connection. Re-measure on staging.
- The signed-in routes were not measured for INP.

**F-22 — P2 — Single 3.73 MB JavaScript bundle (0.90 MB gzip), no code splitting.** The export produces one entry chunk and one worker chunk. It also loads a 390 KB icon font and four 97 KB font files. Fix: lazy-load heavy screens (reports, map, design, intelligence), subset the icon font, and keep the long-cache headers. Acceptance: the entry chunk is under about 1.5 MB raw, and LCP at or below 2.5 s on the throttled profile measured against staging.

**API.** One local API instance (pool of 10, intelligence off) on a copy of the demo database scaled to 1,006 projects, 20,071 tasks and 300,018 activity rows.

| Request | p50 / p95 (1 client) | Payload |
|---|---|---|
| `GET /projects` (50 per page) | 11 / 15 ms | 58 KB |
| `GET /tasks` | 33 / 48 ms | 53 KB |
| `GET /search?q=` | 42 / 51 ms | 3 KB |
| `GET /projects/:id/activity` | 4 / 5 ms | 19 KB |
| `POST /sync/pull` (first page) | 152 / 198 ms | 395 KB |
| `GET /dashboard`, admin | 215 / 314 ms | 253 KB |
| `GET /dashboard`, field worker | 108 / 132 ms | 230 KB |
| `GET /projects`, 20 concurrent | 47 / 144 ms | 58 KB |
| **`GET /dashboard`, 20 concurrent** | **1,908 / 2,214 ms** | 253 KB |

**F-21 — P2 — `/dashboard` is unbounded and the slowest hot path.** `activeProjects` returns every active project (1,002 items, 202 KB of the 253 KB). At 20 concurrent users the p50 is about 1.9 s, against a target of 1 s for common operations. Today's real tenants are probably small, so this is a growth risk. Fix: cap or paginate the list, return only fields the dashboard shows, and cache per user for a few seconds. Acceptance: payload under 50 KB at 1,000 projects and p95 under 1 s at 20 concurrent requests on the same data.

Other results:
- The project-activity query uses its project index (0.76 ms for a 300k-row table).
- Index coverage was **not** reviewed for every query.
- Search is `ILIKE` plus `tsvector` on documents. That was fast at this size.
- No page-level request counts or INP were collected.

### 9.3 Staging and production configuration (CODE-READ; the deployed environments were not inspected)

What the repo shows:
- **Startup validation.** The API refuses to start in staging or production with local file storage or an unencrypted remote database. It requires `EXPO_ACCESS_TOKEN` for Expo push in production and keys for any enabled provider. Secrets come from the platform. Only `EXPO_PUBLIC_API_URL` ships in the app. A regex scan of the last 60 commits found no key-shaped strings.
- **Container.** The Dockerfile is multi-stage, runs as the non-root `node` user, and installs production dependencies only. Images are tagged with the commit SHA.
- **Database.** Migration `0002_supabase_lockdown` enables row security on every table and revokes `anon` and `authenticated`, and a test enforces it for new tables. Migrations run as a separate step before rollout, with `verify-full` TLS.
- **Worker.** Recurring jobs are registered idempotently at startup, so losing Redis does not lose the schedules.

| ID | Pri | Finding | Fix | Status |
|---|---|---|---|---|
| F-23 | P1 | **`deploy.yml` is not gated on CI.** Push to `main` builds, migrates the staging database and rolls out. Nothing requires the `CI` workflow to pass first. | Trigger on `workflow_run` of a successful CI, or call CI as a reusable workflow. | Not started |
| F-24 | P2 | **A deploy can report green without deploying.** If `DEPLOY_HOOK_URL` is unset the rollout step only warns and exits 0, and the smoke test is skipped when `vars.API_URL` is empty. | Fail the job in staging and production when either is missing. | Not started |
| F-25 | P2 | **No pre-migration snapshot or rollback automation.** Migrations are forward-only (documented). The deploy applies them to the live database with no backup or restore point step. | Take or verify a Supabase backup before `migrate`. Document the PITR restore steps for a bad migration. | Not started |
| F-26 | P2 | **Production protection rules are unverified.** Production is manual dispatch, but whether the GitHub `production` environment requires reviewers cannot be seen from the repo. | Confirm required reviewers and a branch restriction. | Blocked: needs GitHub settings access |
| F-27 | P2 | **`SENTRY_DSN` is declared in `env.ts` but nothing uses it**, so the production configuration implies error tracking that does not exist (see F-13). | Wire it in, or remove the variable. Needs your approval for a new service. | Not started |
| F-28 | P3 | **`render.yaml` covers only the web app.** The API and worker services are not in the Blueprint, so their Render settings (plan, instance count, health check, env vars, autoscaling) cannot be reviewed from the repo. The CrewAI service is documented as a manual step. | Add them to the Blueprint or keep a reviewed settings export. | Not started |
| F-29 | P3 | `docker-compose.yml` binds Postgres, Redis and MinIO to all interfaces with default passwords. It is a development file. | Bind to `127.0.0.1`. | Not started |
| F-08 | P1 | Unchanged from section 2: the web service tracks the feature branch `claude/youthful-hypatia-epd25w`. | Pin to `main`. | Blocked: needs Render access |
| F-04 | P1 | Unchanged: with `trustProxy: true` the client picks its own IP. The staging topology is needed (Cloudflare then Render, direct `onrender.com` fallback). | Hop-count or CIDR trust. | Blocked: needs topology |

**Not verifiable here:**
- Actual environment-variable values.
- TLS versions and the Supabase CA setting.
- The Supabase bucket's privacy and versioning.
- Whether the Data API is disabled.
- Database role privileges.
- Cloudflare and Render settings.
- The Cal integration.

### 9.4 Backups and restore

**Drill run (local, VERIFIED).** Logical backup and restore of the scaled database (50 tables, about 320k rows).

- `pg_dump -Fc` took 1.7 s and produced 18 MB.
- `pg_restore` into an empty database took 3.9 s.
- **Result.** Row counts matched in all 50 tables. 50 of 50 tables kept row security, 17 of 17 sync triggers were present, and the `change_seq` sequence had the same value (622,058).
- **What this proves.** The schema, RLS and sync triggers survive a dump and restore.
- **What it does not prove.**
  - Supabase backups, PITR, retention, or the restore time of a real database.
  - Restore of the storage bucket (photos and documents).
  - Any production RTO or RPO.

| ID | Pri | Finding | Fix | Status |
|---|---|---|---|---|
| F-30 | P1 | **Restoring the database to an earlier point can silently strand offline devices (CODE-READ).** Sync pull returns `nextCursor = max(watermark, cursor)` (`services/api/src/services/sync.ts`). After a PITR restore the server's `change_seq` is lower than cursors already held by phones. Those devices pull nothing until the sequence passes their cursor, so changes made after the restore are never delivered. Their local copies also still contain rows the restored database lost. No restore epoch or forced resync exists. | Store an epoch, such as the database system identifier plus a restore counter, and return it with every pull. When a client's epoch differs, force a full resync and reconcile pending operations. Add a runbook step to bump the epoch after any restore. | Not started |
| F-31 | P2 | **File backups are undefined.** Photos and documents live in object storage, outside the database backups. `docs/deployment.md` says to enable versioning and a lifecycle rule but gives no evidence. A database restore can leave rows pointing at missing objects, or objects with no rows. | Confirm bucket versioning or an external copy, and add an orphan and missing-object check to the restore runbook. | Blocked: needs Supabase access |
| F-32 | P2 | **No scheduled restore test or measured RTO/RPO.** The docs say "test restores quarterly" and no result is recorded. | Run the drill on a Supabase scratch project, record timings in the runbook, and calendar it. | Not started |

### 9.5 Updated Go/No-Go effect

The Go/No-Go in section 7 stands: **Conditional Go (internal pilot only)**. The addendum adds three conditions to the "before external customers" list: F-23 (gate deploys on CI), F-30 (restore epoch for offline devices) and a Supabase restore drill that covers storage (F-31, F-32). The accessibility, bundle-size and dashboard findings (F-15 to F-22) belong to the "before expanding beyond a pilot" list.

### 9.6 Additions to the backlog

| ID | Pri | Category | Effort | Verification |
|---|---|---|:-:|---|
| F-23 | P1 | Release | S | A failing CI on `main` prevents the deploy workflow from starting |
| F-30 | P1 | Reliability / DR | M-L | Restore a snapshot older than a device's cursor. The device resyncs and shows no phantom rows |
| F-15, F-16 | P2 | Accessibility | S-M | axe 0 serious/critical on `/roles`, task and schedule. Manual screen-reader pass |
| F-19, F-20 | P2 | Accessibility | S-M | Distinct titles. 0 targets under 24 px |
| F-21 | P2 | Performance | S-M | See 9.2 |
| F-22 | P2 | Performance | M | See 9.2 |
| F-24, F-25, F-26, F-27, F-31, F-32 | P2 | Release / DR | S-M | As listed in 9.3 and 9.4 |
| F-17, F-18, F-28, F-29 | P3 | Accessibility / Config | S | As listed |

No code, configuration or data changes were made for section 9. All measurements used scratch databases that exist only in this session's container.
