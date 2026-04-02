# CareReserve API Skeleton

NestJS modular monolith scaffold for CareReserve with PostgreSQL + TypeORM migrations.

## 1) First run (one command)

For a fresh machine or empty Docker volume:

```bash
docker compose up --build
```

`JWT_SECRET` and `IDENTITY_DOC_ENCRYPTION_KEY` must be strong, non-default secrets (minimum 32 chars, high entropy). Startup validation rejects weak/default values such as `change-me`.

The app container waits for PostgreSQL, runs migrations automatically, then starts the API.

### Public registration (patient-only)

`POST /api/v1/auth/register` is the **only** self-service account creation path. The body must use `role: "patient"`. Any other role is rejected with **`422`** and code **`AUTH_REGISTRATION_ROLE_NOT_ALLOWED`**.

Requirements: password policy, an **`Idempotency-Key`** header (missing key → **`400`** **`IDEMPOTENCY_KEY_REQUIRED`**; same key + different body → **`409`** **`IDEMPOTENCY_KEY_CONFLICT`**). Reusing the **same** key with the **same** body replays the **first** **`201` response body** from the server (idempotency cache). If that first response was from an older build, you might not see `access_token` until you use a **new** Idempotency-Key (e.g. fresh UUID in Swagger for each new signup attempt). Successful registration returns **`access_token`**, **`expires_in`**, and **`session_id`** in the JSON response body alongside `user_id` / `username` / `role`.

Security Q&A is **optional**: omit **both** `security_question_id` and `security_answer` for quick local/Swagger registration, or set **both** using ids from **`GET /api/v1/auth/security-questions`**. Only one of the pair → **`422`** **`AUTH_SECURITY_PAIR_INCOMPLETE`**.

### Bootstrap ops admin and provisioning other roles

There is **no** public API to create `ops_admin`, `staff`, `provider`, `merchant`, or `analytics_viewer`. After first boot, use the **seeded dev ops admin** from migrations (override via env in `.env` / compose if you change defaults):

| Item | Typical value |
|------|----------------|
| Username | `dev_ops_admin` (or `BOOTSTRAP_OPS_USERNAME`) |
| Password | `DevOpsAdmin123!` (or `BOOTSTRAP_OPS_PASSWORD`) |

Seeded passwords are **development defaults** only; set real secrets via environment for non-local deployments.

Log in with `POST /api/v1/auth/login`, then provision users with **`POST /api/v1/access/provision-user`** (requires `access.user_roles.write`, **`Idempotency-Key`**, and JWT for an ops-backed account). Example:

```bash
curl -X POST "http://localhost:3001/api/v1/access/provision-user" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Idempotency-Key: provision-user-001" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "staff_demo",
    "password": "Password123!",
    "role": "staff",
    "security_question_id": "<question-id>",
    "security_answer": "blue"
  }'
```

Use **`GET /api/v1/access/roles`** (with appropriate permissions) to inspect available role names. Non–ops callers receive **`403`** **`FORBIDDEN`** on provision endpoints.

### Authorization and audit (security matrix)

| Area | Route guard | Object-level / data rule | Audit event (successful access) |
|------|-------------|---------------------------|----------------------------------|
| **Access / RBAC** | `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions` | Permission codes in DB (`access.roles.read`, `access.user_roles.write`, `access.audit.read`, …) | `access.roles.read` lists role catalog; `access.audit_logs.read` logs query filters + result total (no row payload) |
| **Analytics (reporting)** | `JwtAuthGuard` + `PermissionsGuard` on **`/analytics/*`**, including **`POST /analytics/events`** | Permission **`analytics.api.use`** (`ops_admin`, `analytics_viewer` via migration). **CSV exports:** caller may read metadata/download only if `requested_by` is self **or** caller is `ops_admin` | `analytics.export.metadata.read`, `analytics.export.download`, `analytics.experiment.assignment.read`, plus existing create/export writes |
| **Workflow / reservations / trust / files / sync** | `JwtAuthGuard` on controllers | **Service-layer** role checks, reservation scope, file ownership, etc. (pattern: never trust ID alone without domain check) | Mixed (domain-specific `workflow.*`, `support.*`, …) |

**Reservation create (`POST /reservations`):** Callers who have **`patient`** but are **not** **`staff`** or **`ops_admin`** may omit `patient_id` (defaults to self) or set `patient_id` equal to their user id only; another user’s id yields **`403`** **`RESERVATION_PATIENT_SELF_ONLY`**. **`staff`** and **`ops_admin`** may supply an explicit `patient_id` for any patient (including users who also have **`patient`** plus **`staff`** / **`ops_admin`**).

**Review appeals:** Only **negative** reviews may be appealed. A review is negative when **any** dimension has score **≤ 2** (1–5 scale). Otherwise **`422`** **`APPEAL_REQUIRES_NEGATIVE_REVIEW`**.

**Privileged trust reads (audit):** Successful **`GET /trust/credit-tiers/{user_id}`** by **`staff`** or **`ops_admin`** appends **`trust.credit_tier.read`**. Successful **`GET /trust/fraud-flags`** (**`ops_admin`**) appends **`trust.fraud_flags.read`** (filters + result counts in payload).

**Reproduce cross-user export denial (expect `403 FORBIDDEN`):**

1. User A (`analytics_viewer`): `POST /api/v1/analytics/exports/csv` with a valid body → note `export_id`.
2. User B (`analytics_viewer`, different account): `GET /api/v1/analytics/exports/{export_id}` → **`403`**, code **`FORBIDDEN`**, message contains “another user’s analytics export”.
3. `ops_admin`: `GET` the same `export_id` → **`200`** (break-glass); chain includes `analytics.export.metadata.read` with `access: ops_admin`.

### GET `/api/v1/reservations` (list) — role and scope

Aligned with **`docs/api-spec.md`** in this repository (role- and scope-constrained listing):

| Role | Behavior |
|------|----------|
| `patient` | Only reservations where `patient_id` is the caller. |
| `staff` | Full clinic list; optional query filters apply. |
| `ops_admin` | Same as staff (operational / admin listing with filters). |
| `provider` | Only reservations where `provider_id` is the caller. If the user is also a `patient`, rows where `patient_id` **or** `provider_id` is the caller. |
| `merchant` | **200** with **`items`** — same **clinic data-scope** filter as **`staff`** (`reservation_data_scopes`); merchants without assigned scopes get an empty list. |
| `analytics_viewer` | **403** unless the user also has `patient`, `staff`, `provider`, `ops_admin`, or **`merchant`** (listing is not the analytics reporting API for analytics-only accounts). |

Error code for forbidden list: `RESERVATION_LIST_FORBIDDEN`.

### POST `/api/v1/reservations/{reservation_id}/notes` (supplemental notes)

After a reservation exists, callers who are **in scope** for that reservation may append notes with **`POST /api/v1/reservations/{reservation_id}/notes`**. Requires **`Authorization: Bearer`** and **`Idempotency-Key`**. Body: `{ "note": "<non-empty string, max 1000 chars>" }`. Success **`201`** returns `note_id`, `reservation_id`, `author_id`, `note`, `created_at`, `version`. Missing idempotency key → **`400`** **`IDEMPOTENCY_KEY_REQUIRED`**. Unknown reservation → **`404`**; out-of-scope caller → **`403`**. See **`docs/api-spec.md`** §5.

### Structured logging

- **HTTP / infrastructure:** `GlobalExceptionFilter` logs **5xx** only via `[http] GlobalExceptionFilter` with `request_id`, method, path, status, code; non-`Error` payloads are passed through `redactForLog` (passwords, tokens, `security_answer`, etc. → `[REDACTED]`).
- **Bootstrap:** `main.ts` uses Nest `Logger` with an `[http] Bootstrap` context and `.catch` logs startup failures without echoing secrets.
- **Business domain:** Trust & rating uses `CategorizedLogger` with category **`business`** for lifecycle messages.
- Helpers live under `src/common/logging/` (`categorized-logger.ts`, `log-redact.util.ts`).

### Login lockout duration

Failed-login lockout length is **`AUTH_LOGIN_LOCK_MINUTES`** (default **15**). Waiting out a full lockout in `run_api_tests.sh` is intentionally **not** automated (CI time); the suite documents this and **`unit_tests/auth-lockout.policy.spec.ts`** covers lockout end-time calculation.

### Workflow approval modes (`/api/v1/workflows/*`)

Definitions set `approval_mode` to `ANY_ONE` or `ALL_REQUIRED`. Steps are rows in `workflow_steps` with integer `order`, `approver_role`, and optional `conditions` (JSON match against request `payload`).

**Step group:** For a running request, the “current step” is the set of all steps whose `order` equals `current_step_order` **and** whose `conditions` match the request payload. Steps are processed in **stable order by step row `id` (UUID string)** for `ALL_REQUIRED` slot matching.

- **`ANY_ONE`:** The group completes when there is at least one `APPROVE` record for this `step_order` from a user who is `ops_admin` **or** whose roles include **any** `approver_role` in the group. Duplicate `order` values are **not** allowed for `ANY_ONE` definitions (`422 WORKFLOW_DUPLICATE_STEP_ORDER`).

- **`ALL_REQUIRED`:** Every row in the step group is a separate required slot. The group completes only when each slot is satisfied by a **distinct** approver user: slot *S* is satisfied by an approval whose actor has `ops_admin` or role `S.approver_role`. The same user cannot satisfy two slots. Approvals are matched to slots in **sorted step `id`** order (deterministic greedy matching).

- **Duplicate approval:** A second `APPROVE` from the **same** user for the same `step_order` does not add a row; the API returns **200** with the current request state (no double-count).

- **Invalid follow-up:** Approving a request that is no longer `PENDING` returns **`422`** with `WORKFLOW_REQUEST_NOT_PENDING`.

### Workflow SLA is business-hour based

`deadline_at` for workflow requests is calculated in **business hours** (not wall-clock hours):

- Default SLA: `48` business hours.
- Default business calendar: Mon-Fri, `09:00`-`17:00`.
- Non-working hours and non-working days are skipped when accumulating SLA time.

Environment knobs:

| Env | Default | Meaning |
|-----|---------|---------|
| `BUSINESS_TZ` | `UTC` | IANA timezone used for business-hour calculations. |
| `BUSINESS_DAY_START_HOUR` | `9` | Workday start hour (`0`-`23`). |
| `BUSINESS_DAY_END_HOUR` | `17` | Workday end hour (`1`-`24`, must be greater than start). |
| `BUSINESS_WORK_DAYS` | `1,2,3,4,5` | ISO weekdays (`1=Mon ... 7=Sun`) considered business days. |
| `BUSINESS_HOLIDAYS` | _(empty)_ | Optional comma-separated `YYYY-MM-DD` dates (interpreted in `BUSINESS_TZ`) skipped as non-working days for SLA accumulation. |
| `WORKFLOW_SLA_USE_CLOCK_HOURS` | `false` | When `true` or `1`, workflow `deadline_at` uses **wall-clock** hours instead of business hours (local dev only; production should keep the default). |
| `WORKFLOW_REMINDER_LEAD_HOURS` | `2` | Wall-clock hours before `deadline_at` when the reminder job considers a request “approaching SLA” (deadline itself still follows business hours unless clock SLA is enabled). |

Coverage: `unit_tests/workflow-business-time.service.spec.ts` verifies in-hours start, after-hours start, weekend crossing, end-hour boundary, optional holidays, and clock-hour fallback mode.

### Audit retention policy (7 years)

Audit logs keep a tamper-evident hash chain for retained records. Retention support uses a **protected no-delete strategy**:

- Config: `AUDIT_RETENTION_YEARS` (default `7`).
- Candidates are records with `created_at < threshold` where threshold is `now - retention_years`.
- A retention marker run is stored in `audit_retention_runs` and an audit event `audit.retention.run` is appended.
- Guardrail: cleanup strategy does **not** delete records, and never deletes records newer than threshold.

Manual retention run:

```bash
npm run audit:retention
```

Optional actor attribution:

```bash
AUDIT_RETENTION_ACTOR_ID=<ops-user-uuid> npm run audit:retention
```

Coverage: `unit_tests/audit-retention.service.spec.ts` verifies boundary behavior around the 7-year cutoff and protected marker execution.

### Audit immutability and integrity verification

Audit logs are hardened as append-only records and include deterministic hash inputs:

- `audit_logs` has DB trigger guardrails that block `UPDATE` and `DELETE`.
- Each new row stores canonical `hash_input` and its `entry_hash` (SHA-256), chained with `previous_hash`.
- Integrity verification is available through a privileged endpoint.

Verify endpoint (requires `access.audit.read`, typically ops-admin):

```bash
curl -G "http://localhost:3001/api/v1/access/audit-logs/verify-integrity" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  --data-urlencode "from=2026-01-01T00:00:00.000Z" \
  --data-urlencode "to=2026-12-31T23:59:59.999Z" \
  --data-urlencode "limit=5000"
```

Response fields:

- `valid` boolean
- `first_invalid_record_id` nullable UUID
- `checked_count`
- effective `from` / `to`

Verification actions are audited as `access.audit_integrity.verify`.

### Support-ticket escalation workflow

Support tickets now follow state transitions:

- `OPEN -> ESCALATED -> RESOLVED -> CLOSED`
- Direct `OPEN -> RESOLVED` is allowed for `staff` / `ops_admin`.
- `RESOLVED -> CLOSED` is allowed for `staff` / `ops_admin` (terminal archive state).

Endpoints:

- `POST /api/v1/support/tickets/:ticket_id/escalate`
- `POST /api/v1/support/tickets/:ticket_id/resolve`
- `POST /api/v1/support/tickets/:ticket_id/close`

Authorization:

- Owner can request escalation.
- `staff` / `ops_admin` can escalate, resolve, and close (close only from `RESOLVED`).
- Unauthorized callers receive `403 FORBIDDEN`.

Each transition appends privileged audit logs (`support.ticket.escalate`, `support.ticket.resolve`, `support.ticket.close`).

### Sensitive-word dictionary management (ops admin)

The chat sensitive-word enforcement remains active, and dictionary operations are now configurable via ops-admin APIs:

- `POST /api/v1/sensitive-words` create
- `GET /api/v1/sensitive-words?active=true|false` list/filter
- `POST /api/v1/sensitive-words/:word_id/update` update word text
- `POST /api/v1/sensitive-words/:word_id/toggle` activate/deactivate

Examples:

```bash
curl -X POST "http://localhost:3001/api/v1/sensitive-words" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Idempotency-Key: sw-create-001" \
  -H "Content-Type: application/json" \
  -d '{"word":"fraudulent"}'
```

```bash
curl -X POST "http://localhost:3001/api/v1/sensitive-words/<word-id>/toggle" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Idempotency-Key: sw-toggle-001" \
  -H "Content-Type: application/json" \
  -d '{"active":"false"}'
```

Dictionary mutations are audited as `sensitive_word.create`, `sensitive_word.update`, and `sensitive_word.toggle`.

### Content-quality analytics

Analytics events support `share` as a first-class event type in addition to existing event types.

New aggregation endpoint:

- `GET /api/v1/analytics/aggregations/content-quality?from=<iso>&to=<iso>&subject_type=<optional>`

Response includes:

- `completion_metric` (count + rate)
- `engagement_metric` (count + rate)
- `share_metric` (count + rate)

CSV exports (`POST /api/v1/analytics/exports/csv`) accept `report_type: "content_quality"` with `filters.from` / `filters.to` (and optional `filters.subject_type`) to emit the same metrics as rows (`metric`,`value` by default).

## 2) Verify service

```bash
docker compose up --build
```

API base path: `http://localhost:3001/api/v1`

PostgreSQL host mapping is optional. By default compose may publish Postgres on a random free host port to avoid local collisions.

Health endpoint:

```bash
curl http://localhost:3001/api/v1/health
```

## Swagger UI (interactive API docs)

Swagger UI is available at:

- `http://localhost:3001/api/docs`

After startup, open that URL in the browser to explore routes, request/response schemas, and try endpoints directly.

Notes:

- The API global prefix remains env-driven via `API_PREFIX` (default `api/v1`).
- Swagger is configured with the API server prefix so Try-it-out requests target the same API routes.
- JWT-protected routes use Bearer auth in Swagger (`Authorization: Bearer <token>`).
- Swagger is a live, decorator-driven companion to `docs/api-spec.md`; the spec file remains the source artifact and is not replaced.

## 3) Migration commands (debugging / maintenance)

Migrations run automatically during container startup. Use these commands only for debugging or local maintenance:

Run migrations manually:

```bash
npm run migration:run
```

Generate a new migration:

```bash
npm run migration:generate -- src/database/migrations/NameYourMigration
```

Revert latest migration:

```bash
npm run migration:revert
```

## 4) Verify error response shape

Sample thrown error endpoint:

```bash
curl http://localhost:3001/api/v1/health/error-sample \
  -H "Authorization: Bearer $TOKEN_WITH_DEBUG_HEALTH_VIEW"
```

Response shape:

```json
{
  "error": {
    "code": "SAMPLE_ERROR",
    "message": "Sample error for testing",
    "details": {
      "sample": true
    },
    "request_id": "uuid"
  }
}
```

## 5) Sync API quick checks

Use an authenticated JWT in `TOKEN`.

Pull reservation + notification changes since a cursor:

```bash
curl "http://localhost:3001/api/v1/sync/pull?since_version=1&entity_types[]=reservation&entity_types[]=notification&page=1&page_size=20" \
  -H "Authorization: Bearer $TOKEN"
```

Push a reservation update (idempotency key required):

```bash
curl -X POST "http://localhost:3001/api/v1/sync/push" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: sync-push-demo-001" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "mobile-app-1",
    "changes": [
      {
        "entity_type": "reservation",
        "entity_id": "00000000-0000-0000-0000-000000000000",
        "operation": "UPSERT",
        "payload": {
          "start_time": "2026-04-01T10:00:00.000Z",
          "end_time": "2026-04-01T11:00:00.000Z"
        },
        "base_version": 3,
        "updated_at": "2026-04-01T09:55:00.000Z"
      }
    ]
  }'
```

## 6) Test suites and npm scripts

| Command | What it runs |
|---------|----------------|
| `npm run test:unit` | Jest in `unit_tests/` only (no API process). |
| `npm run test:api` | `API_tests/run_api_tests.sh` (needs live API + DB). |
| `npm run test:perf` | p95 latency gate (default target: `GET /api/v1/health`, threshold `<300ms`). |
| `npm run audit:retention` | Executes protected audit-retention marker job. |
| `npm test` / `./run_tests.sh` | Unit suite, API suite, then performance gate; prints an overall pass/fail summary. |
| `npm run test:api:ps` | PowerShell wrapper for API tests only (see `run_tests.ps1`). |

API tests use **unique usernames** and **unique `Idempotency-Key` values** per run (`SUFFIX` + random), so reruns do not collide. Override the seeded ops login for API runs with `BOOTSTRAP_OPS_USERNAME` / `BOOTSTRAP_OPS_PASSWORD` if needed.

### Coverage map (four product areas)

| Area | What is verified | Unit (`unit_tests/`) | API (`API_tests/run_api_tests.sh`) |
|------|------------------|------------------------|-------------------------------------|
| **1) Auth / patient-only registration** | Public register patient OK; non-patient roles rejected; idempotency required; replay vs conflict; bad security question. | — | Positive: register + login patient, idempotent replay. Negative: missing `Idempotency-Key`, invalid `security_question_id`, `staff`/`ops_admin` on public register, idempotency payload conflict. |
| **2) Reservation list RBAC** | Row scope by role; **analytics_viewer**-only forbidden; merchant clinic scope like staff; provider scope. | `reservation-list-scope.spec.ts` (query shape + 403 for `analytics_viewer`-only; merchant may list; `analytics_viewer`+`patient` allows patient scope). | Patient list self-only; cross-patient exclusion; **merchant** list **200** (scope-filtered); **analytics_viewer**-only list **403** `RESERVATION_LIST_FORBIDDEN`; staff clinic list; **ops_admin** list; **provider** list includes rows where `provider_id` is the caller. |
| **3) Workflow semantics** | ANY_ONE vs ALL_REQUIRED completion; duplicate approve idempotency. | `workflow-approval.util.spec.ts` | ANY_ONE define/submit/approve + not-pending **422**; ALL_REQUIRED sequential gates + provider final approve; optional parallel same-order block when server supports it; **negative:** ANY_ONE duplicate `order` **422**; patient cannot create definitions **403**. |
| **3b) Workflow SLA business-hours** | `deadline_at` uses business calendar window and skips off-hours/weekends. | `workflow-business-time.service.spec.ts` | Covered indirectly through workflow request creation behavior in running API. |
| **4) Sync** | Cursor required; pull scope; push version conflict vs accept; entity validation. | `sync.service.spec.ts` (cursor, conflict, unknown entity, tombstone, **403** on other user’s reservation, push **notification** not supported). | Pull happy path + unknown entity **422**; **missing cursor** **422**; push **SYNC_VERSION_CONFLICT** then successful UPSERT with matching `base_version`. |
| **5) Audit retention** | 7-year threshold identification and protected retention run markers. | `audit-retention.service.spec.ts` | Operational via `npm run audit:retention` against live environment. |
| **6) Support-ticket escalation** | State machine transitions + role/object authorization checks + invalid transition guards. | — | `support/tickets` create/escalate/resolve/close happy paths and forbidden checks in `API_tests/run_api_tests.sh`. |
| **7) Content-quality analytics** | `share` event ingestion (requires `analytics.api.use`) and completion/engagement/share aggregation output. | — | Patient **403** on `POST /analytics/events`; **`analytics_viewer`** / **`ops_admin`** ingest + `analytics/aggregations/content-quality` in `API_tests/run_api_tests.sh`. |
| **8) Analytics export isolation + A/B** | Cross-user export **403**; deterministic experiment assignment stable on repeat GET. | — | `API_tests/run_api_tests.sh` (export cross-user + repeated assignment). |
| **9) Attachments size boundary** | Exactly **10 MB** accepted; **10 MB + 1** byte → `FILE_TOO_LARGE`. | — | Dedicated reservation + Node-generated buffers in `API_tests/run_api_tests.sh`. |
| **10) Idempotency conflict** | Same `Idempotency-Key` + different body → **409** `IDEMPOTENCY_KEY_CONFLICT`. | `idempotency.interceptor.spec.ts` | API suite already covers register replay vs conflict elsewhere. |
| **11) Audit chain integrity** | Hash chain sequencing detectable when `previous_hash` breaks. | `audit.service.spec.ts`, `audit-chain.util.spec.ts` | — |
| **12) Review 14-day window** | Boundary at 14 days post-completion. | `review-window.util.spec.ts` | — |
| **13) Log redaction / auth fields** | No raw passwords/tokens in redacted log payloads. | `log-redact.util.spec.ts`, `auth-credential-redaction.spec.ts` | — |
| **14) Refund rules / SLA helpers** | Cancellation refund bands; workflow deadline vs clock. | `reservation-refund.util.spec.ts`, `workflow-sla-expiry.util.spec.ts`, `workflow-business-time.service.spec.ts` | — |

### Prerequisites for API tests

```bash
docker compose up -d --build
```

Optional:

```bash
export API_BASE_URL=http://localhost:3001/api/v1
```

### Run (Linux / macOS / Git Bash / WSL)

```bash
chmod +x run_tests.sh API_tests/run_api_tests.sh
./run_tests.sh
```

### Run (Windows PowerShell)

```powershell
./run_tests.ps1
```

## Verification

Run unit tests:

```bash
npm run test:unit
```

Run API tests (requires running app + DB):

```bash
npm run test:api
```

Full reviewer repro with Docker and health check:

```bash
export JWT_SECRET='LocalStrongJwtSecret_A1b2C3d4E5f6!@#$'
export IDENTITY_DOC_ENCRYPTION_KEY='LocalStrongIdentityKey_Z9y8X7w6V5u4!@#$'
docker compose up --build -d
curl http://localhost:3001/api/v1/health
npm run test:api
```

Security sanity check (ops-admin verifies audit integrity):

```bash
curl -G "http://localhost:3001/api/v1/access/audit-logs/verify-integrity" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  --data-urlencode "limit=1000"
```

### Verification output evidence (latest run)

Commands executed:

```bash
npm run build
npm run test:unit
docker compose up --build -d
curl http://localhost:3001/api/v1/health
npm run test:api
```

Observed outputs:

- `npm run build` completed successfully.
- `npm run test:unit` passed (`21` suites, `85` tests).
- `docker compose up --build -d` completed with `carereserve-api Started` and `carereserve-postgres Healthy`.
- Health check response included `{"status":"ok"}`.
- API suite result:

```text
API tests summary: total=172 passed=172 failed=0
```

Targeted proof checks:

- Invalid CSV export `report_type` returns `400 VALIDATION_ERROR` and allowed values (`funnel`, `retention`, `content_quality`).
- Retention export download returns `200` CSV containing:

```text
cohort_start,cohort_end,bucket,cohort_size,retained_size,retention_rate_percent
```

Final verification summary: **PASS** (build + unit + API suites green; health endpoint reachable; retention export and validation checks confirmed).
