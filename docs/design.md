# CareReserve Technical Design

## 1. Purpose and Scope

CareReserve is a single-service clinical operations backend for chronic-care reservations, follow-up plans, chat, reviews, notifications, and basic analytics in offline-capable environments.

### In scope

- Core modules: Auth + RBAC, Reservation lifecycle, Follow-up plans/tasks.
- Supporting modules: REST chat persistence, reviews/appeals, notifications.
- Offline support at backend level: sync push/pull APIs plus entity versioning (`updated_at`, `version`).
- Local file uploads (`/uploads`) + metadata in PostgreSQL.
- Refund policy as computed percentage/status only (no payment rails).
- Simplified approval workflows (`ALL_REQUIRED` / `ANY_ONE`).
- Basic analytics event logging, simple aggregation endpoints, CSV exports stored locally.
- Tamper-evident audit logs via hash chain.
- Declarative 7-year retention policy.

### Out of scope / explicitly simplified

- No full offline conflict-resolution engine.
- No WebSockets or push transport; communication is REST polling.
- No external object storage, payment processors, or merchant API integrations.
- No full BPM/workflow engine.
- No full analytics pipeline or ML fraud system.
- Performance target is implementation guidance (indexes/query shape), not a certified SLA test report.

## 2. Requirements Reconciliation

- Prompt requests "offline-first" behavior; `questions.md` constrains backend scope to sync APIs + version fields only.
- Prompt mentions 48 business-hour SLA; `questions.md` requires simplification to 48 clock hours.
- Prompt implies richer workflow and analytics behavior; `questions.md` constrains these to simplified approvals and basic event storage/aggregation.

When prompt and clarification conflict, this design follows `questions.md`.

## 3. Stack and Deployment Assumptions

`metadata.json` exists but is empty, so implementation assumptions are inferred from `prompt.md`:

- Backend: NestJS (modular monolith).
- ORM: TypeORM.
- Database: PostgreSQL.
- Deployment: single Docker service.
- External dependencies: none required for storage/payments/notifications/chat transport.

## 4. Actors and RBAC Model

| Actor | Typical role(s) | Core permissions |
|---|---|---|
| Patient | `patient` | Manage own account, create/manage own reservations, upload files, chat, submit reviews |
| Clinic staff | `staff` | Confirm/reschedule/cancel/complete reservations, manage follow-up plans/tasks |
| Provider | `provider` | Clinical actions on reservations and follow-up outcomes |
| Merchant (lab) | `merchant` | Submit exam tags/results for assigned reservations |
| Ops admin | `ops_admin` | RBAC admin, workflow config, appeals arbitration, privileged audits |
| Analytics consumer | `analytics_viewer` | Read analytics aggregates/exports |

RBAC primitives:

- `roles`, `permissions`, `role_permissions`, `user_roles`.
- Optional data-scope constraints (e.g., self-only, clinic-only, global).
- All privileged operations create audit records.

## 5. High-Level Architecture

Single NestJS application with feature modules:

- `AuthModule`, `AccessControlModule`
- `ReservationModule`
- `FollowUpModule`
- `CommunicationModule` (chat + notification records)
- `TrustRatingModule`
- `WorkflowModule` (simplified approvals)
- `AnalyticsModule`
- `SyncModule`
- `FileModule` (local disk adapter)
- `AuditModule`

Shared components:

- Global auth guard + permission guard.
- Idempotency interceptor for create/submit endpoints.
- Audit writer service (hash-chain linking).
- PostgreSQL repositories with TypeORM migrations.

## 6. Core Domains and Module Responsibilities

| Module | Responsibilities | Key API groups |
|---|---|---|
| Auth/Account | Register/login/session, lockout, security-question reset | Authentication/Account APIs |
| Access Control | Role/permission/data-scope assignment and checks | Access Control APIs |
| Reservations | Lifecycle transitions, cutoff rules, refund calculation, attachments | Reservation APIs |
| Follow-up | Tag ingestion, plan templates, scheduled tasks, outcomes/adherence | Follow-up Plan APIs |
| Communication | Reservation-scoped chat, read status, sensitive-word checks, rate limits, ticket escalation records | Communication APIs |
| Notifications | In-app notification records, read/unread | Notification APIs |
| Trust & Rating | Review window, dimensions, appeals window/arbitration, nightly credit tier batch, fraud flags | Trust & Rating APIs |
| Analytics | Event ingestion, simple aggregates, CSV export metadata/local files | Analytics APIs |
| Workflows | Resource allocation requests with `ALL_REQUIRED` / `ANY_ONE` approvals and SLA clock | Workflow/Approvals APIs |
| Sync | Push/pull changes with version metadata | Sync APIs |

## 7. Conceptual Data Model

All entities use UUID primary keys (`id`).

### Core entities

- `users`: identity/account fields, lockout counters, status.
- `security_questions`, `security_answers`: answer hashes, attempt limits.
- `roles`, `permissions`, `user_roles`, `role_permissions`, `data_scopes`.
- `reservations`: patient/staff/provider links, schedule window, status, refund fields.
- `reservation_state_transitions`: immutable transition log.
- `reservation_notes`, `reservation_files` (metadata + local path).
- `follow_up_tags`, `follow_up_plan_templates`, `follow_up_plans`, `follow_up_tasks`, `follow_up_outcomes`.
- `messages`, `message_reads`, `sensitive_word_dictionary`.
- `notifications`.
- `reviews`, `review_appeals`, `appeal_decisions`.
- `credit_tiers`, `fraud_flags`.
- `workflow_definitions`, `workflow_requests`, `workflow_steps`, `workflow_actions`.
- `analytics_events`, `analytics_exports`.
- `idempotency_keys`.
- `audit_logs` (hash-chained: `previous_hash`, `entry_hash`).

### Required common columns

- `created_at`, `updated_at` (UTC timestamps).
- `version` (integer optimistic version for sync).
- `deleted_at` (optional soft-delete where needed).

### Indexing guidance

- Reservations: `(status, start_time)`, `(patient_id, start_time)`, `(provider_id, start_time)`.
- RBAC: `(user_id)` in `user_roles`, `(role_id)` in `role_permissions`.
- Events: `(event_type, occurred_at)`, `(actor_id, occurred_at)`.
- Chat: `(reservation_id, created_at)`.
- Audit: `(entity_type, entity_id, created_at)` and `(created_at)`.

### Sensitive data handling

- Encrypt-at-rest for identity-document columns and security answer hashes.
- Mask sensitive identity fields in API read models.
- Do not expose local absolute file-system paths to non-admin users.

## 8. State Machines and Rules

### Reservation lifecycle

`Create -> Confirm -> (Reschedule action, Cancel, Complete)`

Rules:

- Reschedule allowed only when `now <= start_time - 2h`; status remains `CONFIRMED` while a reschedule transition record is appended.
- Cancel allowed from `Create` or `Confirm` states.
- `Complete` only from `Confirm`.
- Every transition writes immutable transition + audit entry.

### Refund policy (logical only)

| Time before start | Refund percent | Output |
|---|---:|---|
| `>= 24h` | 100 | `refund_status=FULL` |
| `>= 2h and < 24h` | 50 | `refund_status=PARTIAL` |
| `< 2h` | 0 | `refund_status=NONE` |

No payment settlement/integration is implemented.

## 9. Cross-Cutting Policies

- Session/lockout: 5 failed login attempts -> 15-minute lockout.
- Password reset by security question: hashed answers + attempt limits.
- Chat harassment controls: 20 messages/minute per user; configurable sensitive-word dictionary validation.
- Review window: reviews accepted within 14 days after reservation completion.
- Appeal window: appeals accepted within 7 days from review creation.
- Credit tier job: nightly batch over rolling 90-day activity.
- Deterministic A/B assignment: `variant = hash(user_id) mod N`.
- Idempotency required on create/submit endpoints (reservation create, workflow submit, file metadata create, review submit, etc.).

## 10. Security and Compliance Posture

- Least privilege enforced via RBAC + optional data scopes.
- Privileged actions always audited (actor, action, target, before/after summary).
- Tamper-evident logging via hash chain over ordered audit records.
- Declarative data retention: retain audit/compliance data for 7 years; no archival subsystem in current scope.
- Local-only operation supported without external SaaS dependencies.

## 11. Non-Functional Targets and Approach

- Target: p95 API latency < 300 ms for common single-node queries.
- Delivery approach (not a certified guarantee):
  - query by indexed columns,
  - avoid N+1 patterns,
  - use projection DTOs for list APIs,
  - bound pagination defaults,
  - batch writes for nightly jobs.
- Availability model: offline server operation in isolated network.

## 12. Phased Delivery Plan (Immediate Action Alignment)

### Phase 1 (must-have)

- Auth + RBAC (including lockout, security-question reset, privileged audit).
- Reservation lifecycle + cutoff/refund logic + attachments metadata.
- Follow-up plans/templates/tasks/outcomes.

### Phase 2 (supporting)

- REST chat (store/list/mark read, rate limits, sensitive-word checks).
- Reviews + appeals + arbitration outcomes.
- Notifications (stored records + read/unread APIs).

### Deferred/simplified by design

- Full offline engine (deferred; only sync push/pull + versioning now).
- Real-time transport and push delivery (deferred).
- External integrations (storage/payment/merchant APIs) deferred.
- Advanced analytics and ML fraud detection deferred.
- Full BPM-style dynamic workflow engine deferred.
