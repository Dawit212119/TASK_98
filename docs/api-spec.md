# CareReserve API Specification

## 1. Conventions

- Base path: `/api/v1`
- Content type: `application/json` (except multipart upload endpoints)
- Time format: ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`)
- Auth scheme: Bearer JWT access token (`Authorization: Bearer <token>`)
- Session model: successful login creates a persisted session record; logout invalidates session/token pair
- Idempotency header: `Idempotency-Key` required for create/submit endpoints
- Pagination: `page` (1-based), `page_size` (default 20, max 100)
- Sorting: `sort_by`, `sort_order` (`asc|desc`) where supported

### Error response shape

```json
{
  "error": {
    "code": "RESERVATION_INVALID_STATE",
    "message": "Reservation cannot be completed from current state",
    "details": {
      "reservation_id": "uuid"
    },
    "request_id": "uuid"
  }
}
```

### Standard status codes

- `200 OK`, `201 Created`, `204 No Content`
- `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`
- `409 Conflict` (idempotency/state conflict), `422 Unprocessable Entity`
- `429 Too Many Requests` (chat rate limit), `500 Internal Server Error`

## 2. Authorization Model

- Roles: `patient`, `staff`, `provider`, `merchant`, `ops_admin`, `analytics_viewer`
- Permissions are checked per endpoint/action; privileged operations generate audit entries.

## 3. Authentication and Account APIs

### POST `/auth/register`

- Purpose: Create local account with security-question setup.
- Authz: Public.
- Headers: `Idempotency-Key` required.
- Request:
  - `username` string (required, unique)
  - `password` string (required)
  - `role` enum (required)
  - `security_question_id` uuid (required)
  - `security_answer` string (required; stored hashed)
- Response `201`:
  - `user_id` uuid
  - `username` string
  - `role` string

### POST `/auth/login`

- Purpose: Authenticate and issue session tokens.
- Authz: Public.
- Request:
  - `username` string
  - `password` string
- Response `200`:
  - `access_token` string
  - `expires_in` number (seconds)
  - `session_id` uuid
  - `lockout_remaining_seconds` number (optional when locked)
- Rules: 5 failed attempts -> 15-minute lockout.

### POST `/auth/logout`

- Purpose: Invalidate current session.
- Authz: Any authenticated user.
- Response `204`.

### GET `/auth/me`

- Purpose: Return current account profile and role set.
- Authz: Any authenticated user.
- Response `200`: `user_id`, `username`, `roles[]`, `permissions[]`.

### POST `/auth/password-reset/verify-security-answer`

- Purpose: Verify security answer before password reset.
- Authz: Public.
- Headers: `Idempotency-Key` required.
- Request: `username`, `security_question_id`, `security_answer`.
- Response `200`: `reset_token` (short-lived).
- Rules: answer attempts are rate-limited and counted.

### POST `/auth/password-reset/confirm`

- Purpose: Set new password using reset token.
- Authz: Public.
- Headers: `Idempotency-Key` required.
- Request: `reset_token`, `new_password`.
- Response `204`.

## 4. Access Control APIs

### GET `/access/roles`

- Purpose: List roles.
- Authz: `ops_admin`.
- Response `200`: `items[]` with role metadata.

### POST `/access/roles`

- Purpose: Create role.
- Authz: `ops_admin`.
- Headers: `Idempotency-Key` required.
- Request: `name`, `description`, `permission_ids[]`.
- Response `201`: created role.

### PUT `/access/users/{user_id}/roles`

- Purpose: Replace user role assignments.
- Authz: `ops_admin`.
- Headers: `Idempotency-Key` required.
- Request: `role_ids[]`.
- Response `200`: updated assignment.

### GET `/access/audit-logs`

- Purpose: Query privileged operation audit records.
- Authz: `ops_admin`.
- Query: `actor_id`, `entity_type`, `from`, `to`, pagination.
- Response `200`: paginated hash-chained log entries.

## 5. Reservation APIs

### POST `/reservations`

- Purpose: Create reservation request.
- Authz: `patient` (self), `staff` (on behalf by scope).
- Headers: `Idempotency-Key` required.
- Request:
  - `patient_id` uuid (optional if caller is patient)
  - `provider_id` uuid (optional)
  - `start_time` datetime
  - `end_time` datetime
  - `notes` string (optional)
- Response `201`: reservation with `status=CREATED`, `version`.

### GET `/reservations`

- Purpose: List reservations.
- Authz: role- and scope-constrained.
- Query: `status`, `patient_id`, `provider_id`, `from`, `to`, pagination/sorting.
- Response `200`: paginated reservation summaries.

### GET `/reservations/{reservation_id}`

- Purpose: Get reservation details.
- Authz: scope-constrained.
- Response `200`: full reservation DTO + computed refund preview fields.

### POST `/reservations/{reservation_id}/confirm`

- Purpose: Transition `CREATED -> CONFIRMED`.
- Authz: `staff`, `provider`.
- Headers: `Idempotency-Key` required.
- Response `200`: updated reservation (`status=CONFIRMED`, incremented `version`).

### POST `/reservations/{reservation_id}/reschedule`

- Purpose: Update schedule from confirmed state.
- Authz: `staff`, `provider` (and patient if policy allows).
- Headers: `Idempotency-Key` required.
- Request: `new_start_time`, `new_end_time`, `reason`.
- Response `200`: updated reservation with `status=CONFIRMED` and incremented `version`.
- Rules: deny with `422` if within 2-hour cutoff.

### POST `/reservations/{reservation_id}/cancel`

- Purpose: Cancel reservation and compute logical refund outcome.
- Authz: `patient` (own), `staff`, `provider`.
- Headers: `Idempotency-Key` required.
- Request: `reason`.
- Response `200`:
  - `status=CANCELLED`
  - `refund_percentage` number (`0|50|100`)
  - `refund_status` enum (`NONE|PARTIAL|FULL`)
- Rules: cutoff matrix by time-to-start; no payment processing.

### POST `/reservations/{reservation_id}/complete`

- Purpose: Transition `CONFIRMED -> COMPLETED`.
- Authz: `staff`, `provider`.
- Headers: `Idempotency-Key` required.
- Response `200`: completed reservation.

## 6. File Attachment APIs

### POST `/reservations/{reservation_id}/attachments`

- Purpose: Upload reservation attachment.
- Authz: reservation participants by scope.
- Headers: `Idempotency-Key` required.
- Content type: `multipart/form-data`.
- Parts:
  - `file` (PDF/JPG/PNG)
  - `label` (optional)
- Response `201`: file metadata (`file_id`, `filename`, `mime_type`, `size_bytes`, `storage_key`, `version`).
- Rules: max 10 MB each; max 5 files per reservation; files stored on local disk (`/uploads`).

### GET `/reservations/{reservation_id}/attachments`

- Purpose: List attachment metadata.
- Authz: reservation participants by scope.
- Response `200`: `items[]` metadata (masked path for non-admin).

### GET `/files/{file_id}/download`

- Purpose: Download stored file content.
- Authz: scope-constrained.
- Response `200`: binary stream.

## 7. Follow-up Plan APIs

### POST `/follow-up/tags/ingest`

- Purpose: Ingest exam-result tags (e.g., A1C/blood pressure stage).
- Authz: `provider`, `staff`, `merchant`.
- Headers: `Idempotency-Key` required.
- Request: `reservation_id`, `tags[]` (`key`, `value`, `source`).
- Response `201`: stored tags.

### POST `/follow-up/plan-templates`

- Purpose: Create plan template with frequency rules.
- Authz: `provider`, `staff`.
- Headers: `Idempotency-Key` required.
- Request: `name`, `trigger_tags[]`, `task_rules[]` (`every_n_days` or `every_n_months`), `active`.
- Response `201`.

### POST `/follow-up/plans`

- Purpose: Instantiate patient follow-up plan.
- Authz: `provider`, `staff`.
- Headers: `Idempotency-Key` required.
- Request: `patient_id`, `template_id`, `start_date`.
- Response `201`: plan + generated upcoming tasks.

### GET `/follow-up/plans/{plan_id}`

- Purpose: Retrieve plan and task schedule.
- Authz: scope-constrained.
- Response `200`.

### POST `/follow-up/tasks/{task_id}/outcomes`

- Purpose: Record structured outcome and adherence.
- Authz: `provider`, `staff`.
- Headers: `Idempotency-Key` required.
- Request: `status` (`DONE|MISSED|DEFERRED`), `outcome_payload` object, `adherence_score` number.
- Response `201`.

### GET `/follow-up/adherence`

- Purpose: Basic adherence analytics.
- Authz: `provider`, `staff`, `analytics_viewer`, `ops_admin`.
- Query: patient/provider/date filters.
- Response `200`: aggregate adherence metrics.

## 8. Communication APIs (REST-only Chat)

### POST `/reservations/{reservation_id}/messages`

- Purpose: Persist chat message under reservation.
- Authz: reservation participants.
- Headers: `Idempotency-Key` required.
- Request: `content` string.
- Response `201`: message DTO.
- Rules: 20 messages/minute per sender; reject sensitive-word violations with `422`.

### GET `/reservations/{reservation_id}/messages`

- Purpose: List chat messages.
- Authz: reservation participants.
- Query: pagination, `since` timestamp optional.
- Response `200`: ordered message list.

### POST `/reservations/{reservation_id}/messages/read`

- Purpose: Mark messages read up to a message/timestamp.
- Authz: reservation participants.
- Headers: `Idempotency-Key` required.
- Request: `last_read_message_id` or `last_read_at`.
- Response `200`: read cursor.

### POST `/support/tickets`

- Purpose: Create customer-service escalation ticket linked to reservation/chat.
- Authz: authenticated users with reservation scope.
- Headers: `Idempotency-Key` required.
- Request: `reservation_id`, `category`, `description`, `message_id` (optional).
- Response `201`: ticket record (`ticket_id`, `status=OPEN`).

### GET `/support/tickets`

- Purpose: List support tickets.
- Authz: `ops_admin`, `staff` (scoped), owner.
- Query: `status`, `reservation_id`, pagination.
- Response `200`: paginated ticket summaries.

## 9. Notification APIs

### POST `/notifications`

- Purpose: Create in-app notification record.
- Authz: `ops_admin`, system roles.
- Headers: `Idempotency-Key` required.
- Request: `user_id`, `type`, `title`, `body`, `payload`.
- Response `201`.

### GET `/notifications`

- Purpose: List current user notifications.
- Authz: authenticated users.
- Query: `read` filter, pagination.
- Response `200`.

### POST `/notifications/{notification_id}/read`

- Purpose: Mark notification read.
- Authz: notification owner.
- Headers: `Idempotency-Key` required.
- Response `200`.

## 10. Trust, Reviews, Appeals APIs

### POST `/reservations/{reservation_id}/reviews`

- Purpose: Submit review after completion.
- Authz: reservation participants eligible to review counterpart.
- Headers: `Idempotency-Key` required.
- Request:
  - `target_user_id` uuid
  - `dimensions[]` (`name`, `score` 1-5)
  - `comment` string optional
- Response `201`.
- Rules: allowed only within 14 days after reservation `COMPLETED`.

### GET `/reservations/{reservation_id}/reviews`

- Purpose: List reviews for reservation.
- Authz: participants, `ops_admin`.
- Response `200`.

### POST `/reviews/{review_id}/appeals`

- Purpose: Open appeal on negative review.
- Authz: reviewed party.
- Headers: `Idempotency-Key` required.
- Request: `reason`, `evidence_files[]` optional.
- Response `201`.
- Rules: within 7 days of review creation.

### POST `/appeals/{appeal_id}/arbitrate`

- Purpose: Record arbitration outcome.
- Authz: `ops_admin`.
- Headers: `Idempotency-Key` required.
- Request: `outcome` (`UPHOLD|MODIFY|REMOVE`), `notes`.
- Response `200`.

### GET `/trust/credit-tiers/{user_id}`

- Purpose: Read latest credit tier.
- Authz: self, `ops_admin`, authorized staff.
- Response `200`: tier + factors snapshot.
- Rules: tier computed nightly from last 90 days.

### GET `/trust/fraud-flags`

- Purpose: List basic fraud flags (same-device/same-IP bursts).
- Authz: `ops_admin`.
- Query: `user_id`, `from`, `to`, pagination.
- Response `200`: flagged events with reason and severity.

## 11. Workflow/Approval APIs (Simplified)

### POST `/workflows/definitions`

- Purpose: Create simplified approval workflow definition.
- Authz: `ops_admin`.
- Headers: `Idempotency-Key` required.
- Request:
  - `name`
  - `approval_mode` (`ALL_REQUIRED|ANY_ONE`)
  - `steps[]` (`order`, `approver_role`, `conditions` optional)
  - `sla_hours` (default 48)
- Response `201`.
- Rules: SLA interpreted as 48 clock hours (simplified from business hours).

### POST `/workflows/requests`

- Purpose: Submit resource-allocation request.
- Authz: `staff`, `provider`, `ops_admin` by scope.
- Headers: `Idempotency-Key` required.
- Request: `workflow_definition_id`, `resource_type`, `resource_ref`, `payload`.
- Response `201`: request status `PENDING`.

### POST `/workflows/requests/{request_id}/approve`

- Purpose: Approve current step.
- Authz: assigned approver role.
- Headers: `Idempotency-Key` required.
- Request: `comment` optional.
- Response `200`: updated workflow state.

### POST `/workflows/requests/{request_id}/reject`

- Purpose: Reject workflow request.
- Authz: assigned approver role.
- Headers: `Idempotency-Key` required.
- Request: `reason`.
- Response `200`: request status `REJECTED`.

## 12. Analytics APIs

### POST `/analytics/events`

- Purpose: Store instrumentation event.
- Authz: authenticated users/services.
- Headers: `Idempotency-Key` required.
- Request:
  - `event_type` (`impression|click|read_completion|conversion`)
  - `subject_type`, `subject_id`
  - `occurred_at`
  - `metadata` object
- Response `201`.

### GET `/analytics/aggregations/funnel`

- Purpose: Return simple funnel aggregates.
- Authz: `analytics_viewer`, `ops_admin`.
- Query: date range, dimensions.
- Response `200`: stage counts and conversion rates.

### GET `/analytics/aggregations/retention`

- Purpose: Return retention aggregate.
- Authz: `analytics_viewer`, `ops_admin`.
- Query: cohort start/end, bucket.
- Response `200`.

### POST `/analytics/experiments`

- Purpose: Configure deterministic A/B experiment metadata.
- Authz: `ops_admin`, `analytics_viewer` (create optional by policy).
- Headers: `Idempotency-Key` required.
- Request: `name`, `variants[]`, `start_at`, `end_at`, `active`.
- Response `201`: experiment configuration.

### GET `/analytics/experiments/{experiment_id}/assignment/{user_id}`

- Purpose: Return deterministic variant assignment for user.
- Authz: `ops_admin`, `analytics_viewer`.
- Response `200`: `variant`, `algorithm=hash(user_id)%N`.

### POST `/analytics/exports/csv`

- Purpose: Generate CSV export file locally.
- Authz: `analytics_viewer`, `ops_admin`.
- Headers: `Idempotency-Key` required.
- Request: `report_type`, `filters`, `columns[]`.
- Response `202`: export job metadata (`export_id`, `status`).

### GET `/analytics/exports/{export_id}`

- Purpose: Fetch export metadata and download availability.
- Authz: `analytics_viewer`, `ops_admin`.
- Response `200`: `status`, `file_id`, `created_at`, `expires_at` optional.

## 13. Sync APIs (Offline Support Scope)

### POST `/sync/push`

- Purpose: Push client-side changes for supported entities.
- Authz: authenticated users.
- Headers: `Idempotency-Key` required.
- Request:
  - `client_id` string
  - `changes[]`: `entity_type`, `entity_id`, `operation`, `payload`, `base_version`, `updated_at`
- Response `200`:
  - `accepted[]`
  - `conflicts[]` (`entity_id`, `server_version`, `reason`)

### GET `/sync/pull`

- Purpose: Pull server-side changes since cursor.
- Authz: authenticated users.
- Query: `since_updated_at` or `since_version`, `entity_types[]`, pagination.
- Response `200`: `changes[]` with current `version`, `updated_at`, and tombstone markers when applicable.

## 14. Anti-Fraud and A/B Assignment Notes

- Fraud scope: basic flagging only (same-device/same-IP bursts), exposed via internal trust views.
- A/B assignment: deterministic by `hash(user_id)` and stored assignment; no full experiment management engine.

## 15. Explicit Non-Goals

- No WebSockets or server push transport.
- No external object storage (e.g., S3); local disk only.
- No payment gateway integration or real refund settlement.
- No full analytics pipeline/data warehouse.
- No full BPM/dynamic workflow runtime.
- No mobile push notification delivery service.
- No ML-based fraud detection.
