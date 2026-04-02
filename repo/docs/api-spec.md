# CareReserve API Specification

> **Interactive docs:** run the server and open `http://localhost:3001/api/v1/docs` (Docker) or `http://localhost:3000/api/v1/docs` (local) for the live Swagger UI.
> This document describes the domain model, auth model, and key endpoint groups. It is not a full OpenAPI spec — the Swagger UI is the authoritative source for request/response schemas.

---

## §1 Overview

CareReserve is a clinical-operations REST API built with NestJS (TypeScript).  
All routes are prefixed with the value of `API_PREFIX` (default: `api/v1`).

| Base URL pattern | Example |
|---|---|
| `/{API_PREFIX}/{resource}` | `/api/v1/auth/login` |

Authentication uses **Bearer JWT** tokens. Every protected route requires:

```
Authorization: Bearer <access_token>
```

---

## §2 Authentication (`/auth`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Self-register a patient account |
| POST | `/auth/login` | Obtain a JWT access token |
| POST | `/auth/logout` | Invalidate the current session |
| GET  | `/auth/me` | Current user profile, roles, and permissions (JWT) |
| POST | `/auth/password-reset/verify-security-answer` | Verify security answer and receive a reset token |
| POST | `/auth/password-reset/confirm` | Complete password reset and invalidate sessions |
| GET  | `/auth/security-questions` | List available security questions |

> **Not implemented:** token refresh (`/auth/refresh`). Clients obtain a new token by logging in again after expiry.

**Token lifespan** is controlled by the `JWT_EXPIRY_SECONDS` environment variable (default 3600 s).

---

## §3 Access Control (`/access`) — ops_admin only

RBAC is managed through these admin endpoints. All require the `ops_admin` role.

### §3.1 Roles & Permissions

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET  | `/access/roles` | `access.roles.read` | List all roles |
| POST | `/access/roles` | `access.roles.write` | Create a role with permission IDs |
| POST | `/access/provision-user` | `access.user_roles.write` | Create a new staff/provider/merchant user |
| PUT  | `/access/users/:user_id/roles` | `access.user_roles.write` | Replace all roles for a user |

### §3.2 Data Scopes (Clinic Access)

Data scopes model which clinic(s) a staff or merchant user may access. Staff can only act on reservations (including support tickets) whose reservation data-scope overlaps with their own assigned scopes.

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/access/scopes` | `access.scopes.read` | List all data scopes |
| GET | `/access/users/:user_id/scopes` | `access.scopes.read` | Get scopes assigned to a user |
| PUT | `/access/users/:user_id/scopes` | `access.scopes.write` | Replace all scope assignments for a user |

**Request body for PUT `/access/users/:user_id/scopes`:**
```json
{ "scope_ids": ["<uuid>", "<uuid>"] }
```

### §3.3 Audit Logs

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/access/audit-logs` | `access.audit.read` | Query immutable audit log entries |
| GET | `/access/audit-logs/verify-integrity` | `access.audit.read` | Verify SHA-256 hash-chain integrity |

---

## §4 Reservations (`/reservations`)

Reservations are the central entity. All reservation list operations are scope-filtered: patients see only their own, staff and merchants see only reservations tagged with their assigned clinic scopes, providers see reservations where they are assigned, ops_admin sees all.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/reservations` | Create a reservation |
| GET  | `/reservations` | List reservations (scope-filtered) |
| GET  | `/reservations/:id` | Get a single reservation |
| POST | `/reservations/:id/confirm` | Confirm a pending reservation |
| POST | `/reservations/:id/cancel` | Cancel a reservation |
| POST | `/reservations/:id/reschedule` | Reschedule a reservation |
| POST | `/reservations/:id/complete` | Mark a reservation as completed |

---

## §5 Support Tickets (`/support/tickets`)

Support tickets are linked to a reservation. Scope enforcement mirrors reservations: staff can only escalate, resolve, or close tickets whose reservation falls within their assigned data scopes.

| Method | Path | Who can call | Description |
|--------|------|-------------|-------------|
| POST | `/support/tickets` | Any authenticated user | Open a ticket for a reservation you own |
| GET  | `/support/tickets` | All (scope-filtered) | List tickets visible to the caller |
| POST | `/support/tickets/:id/escalate` | Owner or staff/ops_admin (in-scope) | Escalate an OPEN ticket |
| POST | `/support/tickets/:id/resolve` | staff/ops_admin (in-scope) | Resolve an OPEN or ESCALATED ticket |
| POST | `/support/tickets/:id/close` | staff/ops_admin (in-scope) | Close a RESOLVED ticket |

**Ticket status machine:**
```
OPEN → ESCALATED → RESOLVED → CLOSED
```

**Scope enforcement for staff:** `PUT /access/users/:user_id/scopes` must be called before a staff member can act on any ticket. A staff user with no assigned scopes receives `403 Forbidden`.

---

## §6 Messages (`/reservations/:reservation_id/messages`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/reservations/:id/messages` | Send a message on a reservation |
| GET  | `/reservations/:id/messages` | List messages |
| POST | `/reservations/:id/messages/read` | Mark messages as read |

---

## §7 Notifications (`/notifications`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/notifications` | Create a notification |
| GET  | `/notifications` | List notifications for the caller |
| POST | `/notifications/:id/read` | Mark a notification as read |

---

## §8 Follow-Up Plans (`/follow-up`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/follow-up/plans` | Create a follow-up plan |
| GET  | `/follow-up/plans` | List plans |
| POST | `/follow-up/plans/:id/tasks` | Add a task to a plan |
| GET  | `/follow-up/plans/:id/tasks` | List tasks for a plan |
| POST | `/follow-up/plans/:id/tasks/:task_id/complete` | Complete a task |

---

## §9 Workflows (`/workflow`)

Approval workflows with SLA tracking for reservation actions that require sign-off.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/workflow/requests` | Submit a workflow approval request |
| GET  | `/workflow/requests` | List workflow requests |
| POST | `/workflow/requests/:id/approve` | Approve a request |
| POST | `/workflow/requests/:id/reject` | Reject a request |

---

## §10 Trust & Ratings (`/trust`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/trust/reviews` | Submit a review |
| GET  | `/trust/reviews` | List reviews |
| POST | `/trust/flags` | Flag a user for fraud review |
| POST | `/trust/appeals` | Submit a fraud flag appeal |

---

## §11 Analytics (`/analytics`)

All routes use JWT auth. Every route below also requires the **`analytics.api.use`** permission (granted to `ops_admin` and `analytics_viewer` via migrations).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/analytics/events` | Ingest an analytics event (`Idempotency-Key` required) |
| GET | `/analytics/aggregations/funnel` | Funnel-style aggregation |
| GET | `/analytics/aggregations/retention` | Retention / cohort-style aggregation |
| GET | `/analytics/aggregations/content-quality` | Content engagement metrics |
| POST | `/analytics/experiments` | Create an A/B experiment |
| GET | `/analytics/experiments/:experiment_id/assignment/:user_id` | Deterministic variant assignment |
| POST | `/analytics/exports/csv` | Create an async CSV export job |
| GET | `/analytics/exports/:export_id` | Export job metadata |
| GET | `/analytics/exports/:export_id/download` | Download completed export file |

---

## §12 File Uploads (`/files`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/files/upload` | Upload a file attachment |
| POST | `/files/identity-docs` | Upload an identity document (encrypted at rest) |
| GET  | `/files/identity-docs` | List identity documents for the caller |
| GET  | `/reservations/:id/attachments` | List attachments on a reservation |

---

## §13 Sync (`/sync`)

Offline-first push/pull for mobile clients.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync/push` | Push local changes (INSERT / UPDATE) |
| GET  | `/sync/pull` | Pull server changes since a cursor |

### Supported entity types for pull

| `entity_type` | Scope rule |
|---|---|
| `reservation` | Role + clinic-scope filtered (mirrors reservation list) |
| `notification` | User's own notifications only |
| `message` | Messages on reservations the user can access |
| `follow_up_task` | Tasks in plans the user owns (patient) or has scope access to (staff/ops_admin) |
| `workflow_request` | Requests submitted by the user; ops_admin sees all |
| `review` | Reviews where user is reviewer or target |

### Supported entity types for push

| `entity_type` | Allowed operations | Notes |
|---|---|---|
| `reservation` | `UPSERT` | Update `start_time`/`end_time` on CONFIRMED reservations; requires scope |
| `follow_up_task` | `UPSERT` | Mark status `DONE` or `DEFERRED`; patient for own plans, staff within scope |

> DELETE operations are not propagated via sync. Soft-deletes appear in the pull feed with `tombstone: true`.

---

## §14 Health (`/health`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe (JSON `status` / `timestamp`) |

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/health/error-sample` | `debug.health.view` | Debug-only sample error payload (not for probes) |

> **Not implemented:** `/health/ready`. Use `/health` for simple liveness; deeper readiness checks are not exposed as a separate route in this build.

---

## §15 Error Format

All errors follow a consistent envelope:

```json
{
  "error_code": "SUPPORT_TICKET_INVALID_STATE",
  "message": "Ticket cannot be escalated from current state",
  "details": {},
  "status": 422
}
```

Common error codes:

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Missing or expired JWT |
| `FORBIDDEN` | 403 | Insufficient role or out-of-scope resource |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Duplicate resource (e.g. username taken) |
| `SUPPORT_TICKET_INVALID_STATE` | 422 | State-machine violation on a ticket |
| `RESERVATION_SCOPE_REQUIRED` | 422 | Staff/merchant has no data scope assigned |
| `ACCESS_SCOPE_NOT_FOUND` | 422 | One or more scope IDs are invalid |

---

## §16 Idempotency

Mutating endpoints (POST/PUT that create or update state) accept an optional `Idempotency-Key` header (UUID v4). Replaying the same request within the deduplication window returns the cached response without re-executing the operation.

```
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

---

## §17 Rate Limiting

Default: **60 requests / 60 seconds** per IP. Exceeding the limit returns `429 Too Many Requests`.  
Configurable via `THROTTLE_TTL` and `THROTTLE_LIMIT` environment variables.
