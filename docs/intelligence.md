# Project intelligence (CrewAI)

Pool PM's intelligence layer turns project records into prioritized, evidence-backed recommendations, readiness assessments, briefings and communication drafts. It runs proactively on application events and on a schedule; nobody has to open a chat window for it to work.

## 1. Architecture assessment (before this change)

| Area | What exists | How intelligence uses it |
|---|---|---|
| App | Expo SDK 54 / expo-router, NativeWind, React Query for online data, SQLite + sync engine offline | New screens use the same `Screen`/`HeroCard`/`QuickAction`/`Reveal` vocabulary. Intelligence is online data (React Query), not synced. |
| API | Fastify, zod validation (`@pool/validation`), services with `requirePermission` + `loadProject` row-level checks, 404 for inaccessible rows | All intelligence endpoints follow the same pattern; agents never query the database. |
| Domain logic | `@pool/core`: CPM scheduling (`computeSchedule`, critical path, float), `findDependencyViolations`, `findResourceConflicts`, weather rules, checklists, change-order rules, stage templates | The rules engine is a pure module in `@pool/core` built on these functions. LLMs never recompute schedules. |
| Data | Postgres via Drizzle. Projects, stages, tasks, dependencies, checklists, inspections, approvals, change orders, materials and usage, vendors, documents, photos, messages, notifications, activity log | Reused as the authoritative source. Only intelligence bookkeeping and a few delivery-tracking columns on `material_usage` are new. |
| Events | `recordActivity` writes the activity log inside each write transaction | Every recorded action schedules a debounced re-evaluation of that project. |
| Jobs | BullMQ worker with retries and repeat schedulers; inline queue when there's no Redis | New jobs `intelligence.evaluate`, `intelligence.daily_scan`, `intelligence.weekly_review`, `intelligence.escalate`. |
| Notifications | `notifications` table with a per-user dedupe key, push delivery job | Alerts reuse it with type `intelligence_alert`; the dedupe key makes notification idempotent. |
| AI | `AiProvider` (Anthropic) behind an adapter; `/projects/:id/ai/ask` builds a permission-filtered text context | Kept. Agent work goes through a new `AgentProvider` adapter whose primary implementation is the CrewAI service. |
| Tests | Vitest unit (core), API integration against Postgres, Playwright web E2E, Maestro | Same layout: core unit tests, API integration tests, pytest for the Python service. |

Gaps it had to fill: no permit entity at first (permits were a stage plus documents; the `permits` table now covers this), no material required-by or delivery confirmation dates, no recommendation or audit records for automation, and no scheduled evaluation beyond the weather and overdue scans.

## 2. Design principles

1. **Deterministic first.**
   - Every finding, severity, readiness score and due date comes from explicit, configurable rules in `@pool/core/intelligence` over verified records.
   - LLM agents only interpret, prioritize and write language on top of those findings. They never decide severity or readiness.
2. **Agents are read-only by construction.**
   - CrewAI agents get no tools. They receive a redacted snapshot the API built for an authorized user and return structured output.
   - The API validates that output, and only humans (through normal authorization) change records.
3. **Evidence or nothing.**
   - Each recommendation stores its evidence (record type, id, label, observed value).
   - Agent output that cites a record outside the snapshot is rejected, and so is output that contradicts the deterministic findings.
4. **Missing data is not a negative finding.**
   - Readiness factors are `ready`, `at_risk`, `blocked` or `unknown`. Unknown is reported as missing data, never as a failure.
5. **Humans approve consequences.**
   - Communication drafts stay drafts until an authorized user approves them.
   - Proposed actions (e.g. "create a follow-up task") run only on approval, as the approving user, through the existing services.
6. **Smallest architecture.**
   - The only new deployable is the optional Python CrewAI service. Without it, everything except LLM narratives keeps working.

## 3. Agents

| Agent (`agent` key) | Deterministic rules it owns | LLM responsibility (CrewAI) |
|---|---|---|
| AI Project Superintendent (`superintendent`) | Project inactivity, intervention flag, consolidation and de-duplication | Daily/weekly briefing narrative; prioritized "today" list; Q&A |
| Schedule & Delay Prevention (`schedule`) | Overdue and blocked work, predecessor not finished, dependency violations, double-booked crews, unassigned upcoming work, unconfirmed dates, completion slip, weather-sensitive work | Explain impact, suggest recovery options without claiming reschedules |
| Construction Readiness & Quality (`readiness`) | Next-milestone readiness, permit gate, inspection gates, failed inspections, concealment checkpoints (photos/inspections before work is covered), required checklist items | Phase readiness narrative; flags anything safety-critical for qualified human verification |
| Homeowner Communication (`communication`) | Overdue homeowner decisions, change orders waiting on the client, client not updated in N days, schedule change not communicated | Drafts updates, notices and explanations from verified facts only |
| Procurement & Subcontractor (`procurement`) | Material not ordered within lead time, delivery unconfirmed, delivery after required date, subcontractor work unassigned, cross-project crew conflicts | Supplier and subcontractor follow-up drafts, sequencing suggestions |
| Closeout & Warranty (`closeout`) | Open punch tasks, final inspection, walkthrough approval, missing manuals and warranty documents, warranty follow-ups | Handover and orientation checklist narrative |

## 4. Readiness model

The **next milestone** is the first stage in sort order that is not completed or skipped. These factors are evaluated for it:

| Factor | Mandatory | Source |
|---|---|---|
| `prerequisites` | yes | Earlier stages complete or skipped; open tasks in earlier stages; FS predecessors of this stage's tasks |
| `permits` | yes, for stages configured as permit-gated (default: excavation onward) | `permits` records when the project has any that aren't withdrawn: each must be issued and unexpired, or finaled (a rejected or expired permit blocks until it's withdrawn or replaced). Without records: `permits` stage status or its "permit issued" checklist item. Documents in category `permit` only support the evidence |
| `inspections` | yes, for configured gates (default: `gunite` ← `pre_gunite`, `decking` ← `pre_deck`, `completion` ← `final`) | Latest inspection of the gate type must be `pass`; fail or partial with no later pass blocks |
| `materials` | no | `material_usage` for this stage's tasks: ordered, delivery confirmed, expected delivery before required date |
| `crew` | no | Assignee, crew or subcontractor on this stage's tasks; resource conflicts |
| `decisions` | no | Pending approvals due before the stage starts; change orders waiting on the client |
| `documentation` | no | Required-photo checklist items without a photo in earlier stages |
| `weather` | no | Open weather alerts for weather-sensitive work in the stage window |
| `schedule` | no | Days until the planned start, total float of the stage's tasks, unconfirmed dates |

**Factor states.** Each factor gets a state and an explanation. Weighted scores are ready 100, at risk 60, blocked 0; unknown factors are excluded and reported as missing data.

**Labels.**
- `blocked`: any mandatory factor is blocked. The score is capped at 40, so an average can never hide a blocker.
- `at_risk`: anything at risk, or a mandatory factor is unknown.
- `ready`: otherwise.

**Project readiness** is the next milestone's readiness combined with open critical and high recommendations. Both are listed with their contributions.

**Historical forecasts.** Stage durations are reported only when the organization has at least 5 completed instances of that stage, as a median and 80th percentile with the sample size. They are never presented as probabilities.

## 5. Severity rules

Severity comes from the rule, using thresholds that are configurable per organization (`organization.settings.intelligence`):

| Severity | Examples |
|---|---|
| critical | Work starting within `criticalWindowDays` (default 2) is blocked by a mandatory gate (permit, failed inspection); a critical-path task overdue more than `criticalOverdueDays` (default 3); a concealment checkpoint missing on work starting within the critical window |
| high | An issued permit has expired; milestone at risk: projected completion slipped more than `slipDaysHigh` (default 5); material not ordered inside its lead time; a homeowner decision overdue; a predecessor not finished for work starting within the lookahead |
| medium | An issued permit expires within `permitExpiryWarnDays` (default 21) of an unfinished project; unassigned upcoming work, unconfirmed delivery, crew double-booked, a weather risk, no client update within `clientUpdateDays` |
| low | Missing optional data, unconfirmed dates outside the lookahead, routine reminders |

**Escalation.**
- An open `high` older than `escalateAfterDays` (default 3) is escalated one level and notifies the project manager and admins.
- A `critical` notifies at once.

## 6. Data model (new)

- **`intelligence_recommendations`**: one row per finding. It is unique per `(project_id, dedupe_key)` while open, and holds severity, confidence, observation, risk, action, responsible role, assignee, suggested due date, evidence, downstream impact, approval flag, proposed action, status, snooze and expiry.
- **`intelligence_recommendation_events`**: append-only history of every status change, with the actor or the automation policy.
- **`intelligence_evaluations`**: one row per evaluation run. It holds the trigger, the input hash (unchanged inputs skip work), the readiness result and counts.
- **`agent_runs`**: one row per LLM/CrewAI execution. It records kind, provider, model, idempotency key, status, latency, token usage, validated output and validation issues. No prompts and no chain of thought are stored.
- **`communication_drafts`**: AI or human drafts with audience, kind, body, the facts used, unsupported-claim flags, an approval trail and the posted message id.
- **`material_usage`** gains `required_by`, `expected_delivery_date`, `delivery_confirmed_at`, `lead_time_days` and `vendor_id`.
- **Enum additions:**
  - `notification_type`: `intelligence_alert`.
  - `activity_action`: `recommendation.updated` and `communication.approved`.

All new tables enable row-level security in their migration (see `docs/security.md`).

## 7. API

Each endpoint requires authentication. The capability and project-access checks for each one are in the table:

| Method | Path | Capability |
|---|---|---|
| GET | `/projects/:id/intelligence` (briefing, readiness, top recommendations) | `intelligence:read` |
| POST | `/projects/:id/intelligence/analyze` | `intelligence:manage` |
| GET | `/recommendations` (filters, cursor pagination) | `intelligence:read` |
| GET | `/recommendations/:id` (with history) | `intelligence:read` |
| POST | `/recommendations/:id/{acknowledge,assign,snooze,dismiss,resolve,reopen}` | `intelligence:manage` |
| POST | `/recommendations/:id/approve` (runs the proposed action) | `intelligence:approve` + the action's own capability |
| POST | `/projects/:id/intelligence/ask` | `ai:use` + `intelligence:read` |
| GET, POST | `/projects/:id/communications` | `intelligence:read` / `intelligence:manage` |
| PATCH | `/communications/:id` (edit) | `intelligence:manage` |
| POST | `/communications/:id/{approve,reject}` | `intelligence:approve` |
| GET | `/intelligence/portfolio` | `intelligence:read` (only accessible projects) |
| GET | `/intelligence/runs` | `intelligence:configure` |
| GET, PATCH | `/intelligence/settings` | `intelligence:read` / `intelligence:configure` |

Capabilities by role:
- `intelligence:read`: admin, project manager, field supervisor.
- `intelligence:manage`: admin, project manager, field supervisor.
- `intelligence:approve`: admin, project manager.
- `intelligence:configure`: admin.

Clients and subcontractors get none of these, and per-organization overrides can't grant them to external roles.

## 8. CrewAI service

`services/crew` is a small FastAPI app around CrewAI.

**Endpoints:**
- `POST /v1/briefing`, `POST /v1/ask` and `POST /v1/draft`, each authenticated with a bearer token (`CREW_SERVICE_TOKEN`).
- `GET /health`.

**Process:**
- Sequential: specialist tasks run only for categories that have findings ("full" depth), then the superintendent consolidates.
- "compact" depth runs only the superintendent, as one LLM call.
- `max_iter`, `max_execution_time` and `max_rpm` bound each agent. Delegation and tools are disabled.

**Output:** Pydantic models (`output_pydantic`). The API re-validates the output with zod and checks every cited id against the snapshot it sent.

**LLM:** the CrewAI-native Anthropic provider (`CREW_LLM_MODEL`, `ANTHROPIC_API_KEY`). Tests use a deterministic fake `BaseLLM`, so they make no network calls.

The API's `AgentProvider` has three implementations:

| Provider | When | Behaviour |
|---|---|---|
| `crewai` | Production | Calls the service |
| `anthropic` | No CrewAI service, but an Anthropic key | One validated call per request through the existing AI adapter |
| `none` | Default when nothing is configured | Rules, readiness, alerts and template-based drafts only |

## 9. Safety controls

- **Untrusted input.** Project text (notes, titles, descriptions) is wrapped in data delimiters, truncated, and never interpreted as instructions. Agents have no tools, so injected text can't trigger actions.
- **Allowlisted actions.** Agent-proposed actions must be on the allowlist (`create_task`, `request_approval`, `draft_message`) and are stored for approval. Anything else is rejected and recorded in `agent_runs.validation_issues`.
- **Idempotency.**
  - `agent_runs.idempotency_key` means a retry with the same input reuses the stored result.
  - The recommendation dedupe key means a re-evaluation updates rows instead of duplicating them.
  - The notification dedupe key prevents duplicate pushes.
  - Approval of a proposed action records the created entity id, so a second approval is a no-op.
- **Limits.**
  - Per-route rate limits.
  - Per-organization concurrency of 2 agent runs.
  - Per-organization daily run cap: `intelligence.dailyAgentRunLimit`, default 200.
  - Request timeout of 90 s, with bounded retries for transient errors only.
- **Retention.**
  - Agent run outputs are kept for 90 days.
  - Resolved, dismissed or superseded recommendations are kept for 365 days, then pruned by the weekly job.

## 10. Rollout

1. Deploy the API. The migration adds tables and columns and is backwards compatible. Intelligence runs with the `none` provider until it's configured.
2. Optionally deploy `services/crew` and set `INTELLIGENCE_AGENT_PROVIDER=crewai`, `CREW_SERVICE_URL` and `CREW_SERVICE_TOKEN` on the API.
3. **Rollback.**
   - Set `INTELLIGENCE_ENABLED=false` to stop triggers and scans. The existing features don't depend on any intelligence table.
   - The migration is additive, so rolling back the API image is safe.

## 11. Implementation map

| Concern | Where |
|---|---|
| Shared vocabulary (agents, severities, statuses, settings, DTOs) | `packages/types/src/intelligence.ts` |
| Rules, readiness, consolidation, briefing, output validation | `packages/core/src/intelligence/` (`rules.ts`, `readiness.ts`, `evaluate.ts`, `validate.ts`, `context.ts`, `settings.ts`) |
| Tables and migration | `packages/database/src/schema.ts`, `migrations/0003_project_intelligence.sql` |
| Snapshot loader (authoritative records → engine input) | `services/api/src/services/intelligence/snapshot.ts` |
| Evaluation and lifecycle (dedupe, suppression, auto-resolve, notifications) | `services/api/src/services/intelligence/evaluator.ts` |
| Recommendation actions and approval-gated execution | `services/api/src/services/intelligence/recommendations.ts` |
| Communication drafts | `services/api/src/services/intelligence/drafts.ts` |
| Briefing, Q&A, portfolio, settings, runs, scans | `services/api/src/services/intelligence/service.ts`, `trigger.ts`, `scheduler.ts` |
| Agent contract, CrewAI client, Anthropic fallback | `services/api/src/adapters/agents/` |
| Agent orchestration (idempotency, limits, validation, cost) | `services/api/src/services/intelligence/agents.ts` |
| Routes | `services/api/src/routes/intelligence.ts` |
| CrewAI service | `services/crew/` |
| App | `apps/mobile/src/components/intelligence.tsx`, `src/features/intelligence.ts`; screens `projects/[id]/intelligence`, `projects/[id]/assistant`, `projects/[id]/communications`, `communications/[id]`, `alerts/`, `portfolio`, `intelligence-settings` |

**Event flow.**
1. A write calls `recordActivity` (or a material update).
2. That marks the project changed on the request context.
3. After the response, so after commit, an `intelligence.evaluate` job is enqueued with a debounce job id.
4. The job evaluates the rules and reconciles the recommendations.
5. Newly opened or worsened items at or above `notifyMinSeverity` notify the owner, the PM and (for critical) admins, through the existing notifications pipeline with a dedupe key.

## 12. Known limitations

- **Permits** are recorded per project in `permits` (staff-only, REST only for now: not yet in offline sync or the app). Projects without permit records fall back to the permits stage or its "permit issued" checklist item. A permit document only supports either, because it may be the application. Expiry is derived from `expiresOn`, not stored, and a project's permits are all treated as required by every permit-gated stage.
- **Homeowner selections** are modeled as approvals. **Subcontractor availability** is inferred only from double-booking: there's no availability calendar.
- **Weather risk** reuses the weather scan's alerts. Forecasts beyond about 10 days are reported as unknown.
- **Historical data** is used only for stage durations (median and 80th percentile, at least 5 samples). Delay probabilities are deliberately not produced until enough outcome history exists to calibrate them.
- **Vendor messages:** the app never emails suppliers or subcontractors. Approved vendor drafts are shared by the user.
- **Proposed actions:** the rules currently propose `draft_message` and `request_approval`. `create_task` is supported end to end for agents and future rules, but no rule emits it yet.
- **Concurrency:** the cap of two concurrent agent runs per organization is per API instance. The daily cap is global (it's enforced in the database).
- **Not yet verified against a real model.** The CrewAI service is covered by scripted-model tests and a live contract test with the API, but it hasn't run against a real Anthropic model in this environment: that needs an API key and network access. Deploy it and set the provider before relying on narratives.
