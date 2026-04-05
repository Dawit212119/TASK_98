#!/usr/bin/env bash
set -u

API_BASE_URL="${API_BASE_URL:-http://localhost:3001/api/v1}"

# Git Bash on Windows often lacks `node` on PATH even when Node is installed.
resolve_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  if command -v nodejs >/dev/null 2>&1; then
    command -v nodejs
    return 0
  fi
  local win_paths=(
    "/c/Program Files/nodejs/node.exe"
    "/c/Program Files (x86)/nodejs/node.exe"
    "/cygdrive/c/Program Files/nodejs/node.exe"
    "/cygdrive/c/Program Files (x86)/nodejs/node.exe"
    "/mnt/c/Program Files/nodejs/node.exe"
    "/mnt/c/Program Files (x86)/nodejs/node.exe"
  )
  local p
  for p in "${win_paths[@]}"; do
    # Git Bash on Windows: .exe may not appear executable (-x); -f is reliable.
    if [[ -f "$p" ]]; then
      printf '%s' "$p"
      return 0
    fi
  done
  # Last resort: ask Windows where node.exe is (Git Bash + PowerShell users).
  if command -v cmd.exe >/dev/null 2>&1; then
    local line
    IFS= read -r line < <(cmd.exe //c "where node 2>nul" | tr -d '\r')
    if [[ -n "$line" ]] && [[ "$line" =~ ^([A-Za-z]):\\(.*)$ ]]; then
      local d rest unix
      d="$(echo "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
      rest="${BASH_REMATCH[2]//\\//}"
      unix="/$d/$rest"
      if [[ -f "$unix" ]]; then
        printf '%s' "$unix"
        return 0
      fi
      # If bash can't see the file (rare), still return the Windows path for Node to run via cmd — not ideal.
      if [[ -f "$line" ]]; then
        printf '%s' "$line"
        return 0
      fi
    fi
  fi
  return 1
}

NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(resolve_node_bin)" || true
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "[FAIL] node not found — API_tests parse JSON with Node.js."
  echo "       Install Node.js or set NODE_BIN to your node.exe, and ensure Git Bash sees it on PATH."
  exit 1
fi

TOTAL=0
PASSED=0
FAILED=0

log_pass() {
  TOTAL=$((TOTAL + 1))
  PASSED=$((PASSED + 1))
  echo "[PASS] $1"
}

log_fail() {
  TOTAL=$((TOTAL + 1))
  FAILED=$((FAILED + 1))
  echo "[FAIL] $1"
  echo "       status=$2"
  echo "       body=$3"
}

assert_case() {
  local name="$1"
  local status="$2"
  local expected_status="$3"
  local body="$4"
  local contains="$5"

  if [[ "$status" != "$expected_status" ]]; then
    log_fail "$name" "$status" "$body"
    return
  fi

  if [[ -n "$contains" ]] && [[ "$body" != *"$contains"* ]]; then
    log_fail "$name" "$status" "$body"
    return
  fi

  log_pass "$name"
}

to_curl_file_path() {
  local file_path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    # mingw curl on Windows expects native paths for multipart file handles.
    cygpath -am "$file_path"
    return 0
  fi

  printf '%s' "$file_path"
}

# Windows Node does not understand /tmp/... or /mnt/c/... (WSL/Git Bash); convert for fs APIs.
to_node_file_path() {
  local file_path="$1"
  if command -v wslpath >/dev/null 2>&1; then
    wslpath -w "$file_path"
    return 0
  fi
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -am "$file_path"
    return 0
  fi
  printf '%s' "$file_path"
}

echo "Running API tests against: $API_BASE_URL"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Use a repo-local temp dir so Node (Windows) and Bash (Git Bash) agree on filesystem paths.
TMP_DIR=""
if TMP_CAND="$(mktemp -d "$REPO_ROOT/.api-test-tmp.XXXXXX" 2>/dev/null)" && [[ -n "$TMP_CAND" && -d "$TMP_CAND" ]]; then
  TMP_DIR="$TMP_CAND"
else
  TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t apitests)"
fi
trap 'rm -rf "$TMP_DIR"' EXIT

# 1) Health (fail fast with a clear message if nothing is listening — avoids status=000 and cat of missing -o file)
# Prefer Node fetch: on Windows, npm-spawned Git Bash often lacks a working curl on PATH while Node works (same as perf-check.js).
BODY_FILE="$TMP_DIR/health.json"
: >"$BODY_FILE"
STATUS=""
if [[ -n "$NODE_BIN" ]] && [[ -f "$REPO_ROOT/scripts/http-get-one.mjs" ]]; then
  STATUS="$("$NODE_BIN" "$REPO_ROOT/scripts/http-get-one.mjs" "$API_BASE_URL/health" "$BODY_FILE" 2>/dev/null || true)"
fi
if [[ -z "$STATUS" ]] || [[ "$STATUS" == "0" ]]; then
  STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" --connect-timeout 3 --max-time 15 "$API_BASE_URL/health" 2>/dev/null || true)"
fi
BODY="$(cat "$BODY_FILE" 2>/dev/null || true)"
if [[ "$STATUS" != "200" ]]; then
  echo "ERROR: The API is not reachable or unhealthy at $API_BASE_URL"
  echo "Expected HTTP 200 on GET .../health, got: ${STATUS:-000}"
  if [[ -z "$BODY" ]]; then
    echo "No response body — is the server running? From the repo directory run:  docker compose up -d"
  else
    echo "Response body: $BODY"
  fi
  echo "Then wait until Postgres is healthy and the app has finished migrations. Override URL with API_BASE_URL if needed."
  exit 1
fi
assert_case "health endpoint" "$STATUS" "200" "$BODY" "\"status\":\"ok\""

# Fail fast when the process on API_BASE_URL is an old build (mass 404 on newer tests).
PREFLIGHT_CQ="$(curl -sS -o /dev/null -w "%{http_code}" -G "$API_BASE_URL/analytics/aggregations/content-quality" \
  --data-urlencode "from=2026-01-01T00:00:00.000Z" \
  --data-urlencode "to=2026-01-02T00:00:00.000Z" \
  --data-urlencode "subject_type=article")"
PREFLIGHT_ST="$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
  "$API_BASE_URL/support/tickets/00000000-0000-0000-0000-000000000000/escalate" \
  -H "Content-Type: application/json" \
  -d '{"reason":"preflight"}')"
# Unauthenticated: expect 401 if route exists; 404 means stale image (routes never registered).
PREFLIGHT_AUDIT_VERIFY="$(curl -sS -o /dev/null -w "%{http_code}" -G "$API_BASE_URL/access/audit-logs/verify-integrity" \
  --data-urlencode "limit=1" 2>/dev/null || printf '%s' '000')"
PREFLIGHT_SENSITIVE="$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$API_BASE_URL/sensitive-words" \
  -H "Content-Type: application/json" \
  -d '{"word":"preflight"}' 2>/dev/null || printf '%s' '000')"
if [[ "$PREFLIGHT_CQ" == "404" ]] || [[ "$PREFLIGHT_ST" == "404" ]] \
  || [[ "$PREFLIGHT_AUDIT_VERIFY" == "404" ]] || [[ "$PREFLIGHT_SENSITIVE" == "404" ]]; then
  echo "ERROR: API at $API_BASE_URL does not expose current routes (got 404 on preflight)."
  echo "Rebuild and restart so tests hit the latest image/code, e.g.: docker compose build --no-cache app && docker compose up -d"
  echo "If build fails with \"invalid file request Dockerfile\" (common on Windows + OneDrive): DOCKER_BUILDKIT=0 docker compose build --no-cache app   or   ./docker-build.sh --no-cache app"
  echo "Stale builds often miss: analytics/content-quality, support/tickets/*/escalate, access/audit-logs/verify-integrity, POST /sensitive-words."
  exit 1
fi

# 2) Security questions for dynamic registration
BODY_FILE="$TMP_DIR/security_questions.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" "$API_BASE_URL/auth/security-questions")"
BODY="$(cat "$BODY_FILE")"
assert_case "security questions endpoint" "$STATUS" "200" "$BODY" "question"
SECURITY_STATUS="$STATUS"
SECURITY_QUESTIONS_FILE="$BODY_FILE"

# 2b) Protected-route 401 checks
BODY_FILE="$TMP_DIR/unauth_reservations.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" "$API_BASE_URL/reservations")"
BODY="$(cat "$BODY_FILE")"
assert_case "unauth reservations list returns 401" "$STATUS" "401" "$BODY" "UNAUTHORIZED"

BODY_FILE="$TMP_DIR/unauth_sync_pull.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" "$API_BASE_URL/sync/pull?since_version=1&entity_types[]=reservation")"
BODY="$(cat "$BODY_FILE")"
assert_case "unauth sync pull returns 401" "$STATUS" "401" "$BODY" "UNAUTHORIZED"

if [[ "$SECURITY_STATUS" != "200" ]]; then
  echo "API tests summary: total=$TOTAL passed=$PASSED failed=$FAILED"
  exit 1
fi

# Pipe JSON on stdin so Windows node.exe can parse paths created by Git Bash (avoids /tmp → C:\tmp mismatch).
SECURITY_QUESTION_ID="$("$NODE_BIN" -e "const fs=require('fs');const arr=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(arr[0]?.id||'');" < "$SECURITY_QUESTIONS_FILE")"

if [[ -z "$SECURITY_QUESTION_ID" ]]; then
  TOTAL=$((TOTAL + 1))
  FAILED=$((FAILED + 1))
  echo "[FAIL] parse security_question_id"
  echo "API tests summary: total=$TOTAL passed=$PASSED failed=$FAILED"
  exit 1
else
  TOTAL=$((TOTAL + 1))
  PASSED=$((PASSED + 1))
  echo "[PASS] parse security_question_id"
fi

SUFFIX="$(date +%s)-$RANDOM"
PATIENT1="apitest-patient-$SUFFIX"
PATIENT2="apitest-patient2-$SUFFIX"
PASSWORD="Password123!"
BOOTSTRAP_OPS_USERNAME="${BOOTSTRAP_OPS_USERNAME:-dev_ops_admin}"
BOOTSTRAP_OPS_PASSWORD="${BOOTSTRAP_OPS_PASSWORD:-DevOpsAdmin123!}"
PROVISIONED_STAFF="apitest-staff-$SUFFIX"
PROVISIONED_PROVIDER="apitest-provider-$SUFFIX"

# --- Area 1: Auth / patient-only public registration (+ idempotency) ---
BODY_FILE="$TMP_DIR/register_no_idem.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"apitest-noidem-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"patient\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"x\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register without Idempotency-Key rejected" "$STATUS" "400" "$BODY" "IDEMPOTENCY_KEY_REQUIRED"

BODY_FILE="$TMP_DIR/register_bad_question.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-bad-q" \
  -d "{\"username\":\"apitest-badq-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"patient\",\"security_question_id\":\"f47ac10b-58cc-4372-a567-0e02b2c3d479\",\"security_answer\":\"x\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register rejects unknown security_question_id" "$STATUS" "404" "$BODY" "AUTH_SECURITY_QUESTION_NOT_FOUND"

BODY_FILE="$TMP_DIR/register_no_security_optional.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-no-security" \
  -d "{\"username\":\"apitest-nosec-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"patient\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register patient without security Q and A rejected" "$STATUS" "400" "$BODY" "VALIDATION_ERROR"

BODY_FILE="$TMP_DIR/register_weak_password.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-weak-pw" \
  -d "{\"username\":\"apitest-weakpw-$SUFFIX\",\"password\":\"password\",\"role\":\"patient\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"x\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register rejects weak password" "$STATUS" "400" "$BODY" "VALIDATION_ERROR"

BODY_FILE="$TMP_DIR/register_security_pair_incomplete.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-partial-security" \
  -d "{\"username\":\"apitest-partialsec-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"patient\",\"security_question_id\":\"$SECURITY_QUESTION_ID\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register rejects security question without answer" "$STATUS" "400" "$BODY" "VALIDATION_ERROR"

BODY_FILE="$TMP_DIR/register_staff_public.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-staff-pub" \
  -d "{\"username\":\"apitest-pubstaff-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"staff\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"x\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "public register rejects staff role" "$STATUS" "422" "$BODY" "AUTH_REGISTRATION_ROLE_NOT_ALLOWED"

# 3) Register patient #1
BODY_FILE="$TMP_DIR/register_patient1.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-01" \
  -d "{\"username\":\"$PATIENT1\",\"password\":\"$PASSWORD\",\"role\":\"patient\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"blue\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register patient user" "$STATUS" "201" "$BODY" "user_id"
PATIENT1_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.user_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/register_patient1_idem_replay.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-01" \
  -d "{\"username\":\"$PATIENT1\",\"password\":\"$PASSWORD\",\"role\":\"patient\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"blue\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register idempotent replay returns same outcome" "$STATUS" "201" "$BODY" "$PATIENT1_ID"

BODY_FILE="$TMP_DIR/register_idem_conflict.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-01" \
  -d "{\"username\":\"apitest-other-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"patient\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"blue\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "same Idempotency-Key with different body rejected" "$STATUS" "409" "$BODY" "IDEMPOTENCY_KEY_CONFLICT"

# 4) Public register must reject privileged role
BODY_FILE="$TMP_DIR/register_ops_public_reject.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-ops-reject" \
  -d "{\"username\":\"apitest-public-ops-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"ops_admin\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"red\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "public register rejects ops_admin" "$STATUS" "422" "$BODY" "AUTH_REGISTRATION_ROLE_NOT_ALLOWED"

# 5) Login patient #1
BODY_FILE="$TMP_DIR/login_patient1.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$PATIENT1\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login patient user" "$STATUS" "200" "$BODY" "access_token"

PATIENT1_LOGIN_BODY="$BODY_FILE"
PATIENT1_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

# 5b) Token refresh (rotates refresh_token; new access_token)
# Pass paths as argv (Windows node.exe often does not inherit LOGIN_PATH/REQ_OUT from Git Bash).
PATIENT1_REFRESH_REQ="$TMP_DIR/refresh_req_patient1.json"
LOGIN_NODE_PATH="$(to_node_file_path "$PATIENT1_LOGIN_BODY")"
REFRESH_NODE_PATH="$(to_node_file_path "$PATIENT1_REFRESH_REQ")"
"$NODE_BIN" -e "
const fs = require('fs');
const loginPath = process.argv[1];
const reqOut = process.argv[2];
const login = JSON.parse(fs.readFileSync(loginPath, 'utf8'));
if (!login.session_id || !login.refresh_token) {
  console.error('login response missing session_id or refresh_token');
  process.exit(1);
}
fs.writeFileSync(
  reqOut,
  JSON.stringify({ session_id: login.session_id, refresh_token: login.refresh_token })
);
" "$LOGIN_NODE_PATH" "$REFRESH_NODE_PATH"
BODY_FILE="$TMP_DIR/auth_refresh_patient1.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d @"$PATIENT1_REFRESH_REQ")"
BODY="$(cat "$BODY_FILE")"
assert_case "auth refresh returns new access_token" "$STATUS" "200" "$BODY" "access_token"

PATIENT1_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/provision_as_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/access/provision-user" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provision-$SUFFIX-as-patient" \
  -d "{\"username\":\"apitest-never-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"staff\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"nope\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "provision-user forbidden for non-ops caller" "$STATUS" "403" "$BODY" "FORBIDDEN"

# 5) Auth validation 4xx
BODY_FILE="$TMP_DIR/register_invalid.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-invalid" \
  -d "{\"username\":\"bad\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register validation error" "$STATUS" "400" "$BODY" "VALIDATION_ERROR"

# 6) Reservation happy path
BODY_FILE="$TMP_DIR/create_reservation.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-$SUFFIX-01" \
  -d "{\"start_time\":\"2026-04-10T10:00:00.000Z\",\"end_time\":\"2026-04-10T11:00:00.000Z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create reservation" "$STATUS" "201" "$BODY" "reservation_id"

RESERVATION_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.reservation_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/create_reservation_explicit_self_patient_id.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-$SUFFIX-explicit-self-patient" \
  -d "{\"patient_id\":\"$PATIENT1_ID\",\"start_time\":\"2026-04-11T10:00:00.000Z\",\"end_time\":\"2026-04-11T11:00:00.000Z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "patient create reservation with explicit self patient_id" "$STATUS" "201" "$BODY" "reservation_id"

# 7) Reservation not found 4xx
BODY_FILE="$TMP_DIR/reservation_not_found.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/reservations/00000000-0000-0000-0000-000000000999" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "reservation not found" "$STATUS" "404" "$BODY" "NOT_FOUND"

# 8) Register + login patient #2 for forbidden scope test
BODY_FILE="$TMP_DIR/register_patient2.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reg-$SUFFIX-02" \
  -d "{\"username\":\"$PATIENT2\",\"password\":\"$PASSWORD\",\"role\":\"patient\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"green\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register second patient" "$STATUS" "201" "$BODY" "user_id"
PATIENT2_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.user_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/login_patient2.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$PATIENT2\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login second patient" "$STATUS" "200" "$BODY" "access_token"
PATIENT2_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/patient2_create_with_foreign_patient_id.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations" \
  -H "Authorization: Bearer $PATIENT2_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-$SUFFIX-p2-impersonate-p1" \
  -d "{\"patient_id\":\"$PATIENT1_ID\",\"start_time\":\"2026-04-20T10:00:00.000Z\",\"end_time\":\"2026-04-20T11:00:00.000Z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "patient cannot create reservation for another patient" "$STATUS" "403" "$BODY" "RESERVATION_PATIENT_SELF_ONLY"

# 9) Forbidden access 4xx
BODY_FILE="$TMP_DIR/reservation_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/reservations/$RESERVATION_ID" \
  -H "Authorization: Bearer $PATIENT2_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "reservation forbidden for unrelated user" "$STATUS" "403" "$BODY" "FORBIDDEN"

# 9a) Post-creation supplemental note (in scope, idempotency, denial)
BODY_FILE="$TMP_DIR/reservation_note_no_idem.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$RESERVATION_ID/notes" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note":"Follow-up clarification from patient."}')"
BODY="$(cat "$BODY_FILE")"
assert_case "reservation note missing Idempotency-Key returns 400" "$STATUS" "400" "$BODY" "IDEMPOTENCY_KEY_REQUIRED"

BODY_FILE="$TMP_DIR/reservation_note_forbidden_other_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$RESERVATION_ID/notes" \
  -H "Authorization: Bearer $PATIENT2_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-note-$SUFFIX-forbidden" \
  -d '{"note":"Should not be allowed."}')"
BODY="$(cat "$BODY_FILE")"
assert_case "reservation note forbidden for unrelated user" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/reservation_note_ok_patient1.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$RESERVATION_ID/notes" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-note-$SUFFIX-patient1" \
  -d '{"note":"Post-creation supplemental note from owner."}')"
BODY="$(cat "$BODY_FILE")"
assert_case "reservation supplemental note in-scope returns 201" "$STATUS" "201" "$BODY" "note_id"

# 9b) List scope: patient sees own reservation only
BODY_FILE="$TMP_DIR/list_patient1.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/reservations" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=20" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "patient1 list includes own reservation" "$STATUS" "200" "$BODY" "$RESERVATION_ID"

BODY_FILE="$TMP_DIR/list_patient2.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/reservations" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=20" \
  -H "Authorization: Bearer $PATIENT2_TOKEN")"
BODY="$(cat "$BODY_FILE")"
if [[ "$STATUS" != "200" ]]; then
  log_fail "patient2 list reservations status" "$STATUS" "$BODY"
else
  if [[ "$BODY" == *"$RESERVATION_ID"* ]]; then
    log_fail "patient2 must not see other patient reservation in list" "$STATUS" "$BODY"
  else
    log_pass "patient2 list excludes other patients reservations"
  fi
fi

# 10) Login bootstrap ops admin and provision privileged user
BODY_FILE="$TMP_DIR/login_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$BOOTSTRAP_OPS_USERNAME\",\"password\":\"$BOOTSTRAP_OPS_PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login bootstrap ops admin" "$STATUS" "200" "$BODY" "access_token"
OPS_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/provision_no_idem.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/access/provision-user" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"apitest-noidemprov-$SUFFIX\",\"password\":\"$PASSWORD\",\"role\":\"staff\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "provision-user without Idempotency-Key rejected" "$STATUS" "400" "$BODY" "IDEMPOTENCY_KEY_REQUIRED"

BODY_FILE="$TMP_DIR/list_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/reservations" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=20" \
  -H "Authorization: Bearer $OPS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "ops_admin list reservations includes clinic rows" "$STATUS" "200" "$BODY" "$RESERVATION_ID"

MERCHANT_USER="apitest-merchant-$SUFFIX"
ANALYTICS_USER="apitest-analytics-$SUFFIX"

BODY_FILE="$TMP_DIR/provision_merchant.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/access/provision-user" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provision-$SUFFIX-merchant" \
  -d "{\"username\":\"$MERCHANT_USER\",\"password\":\"$PASSWORD\",\"role\":\"merchant\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"m1\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "provision merchant via access API" "$STATUS" "201" "$BODY" "user_id"

BODY_FILE="$TMP_DIR/login_merchant.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$MERCHANT_USER\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login merchant user" "$STATUS" "200" "$BODY" "access_token"
MERCHANT_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/list_merchant_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/reservations" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=20" \
  -H "Authorization: Bearer $MERCHANT_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "merchant list reservations succeeds (clinic scope-filtered)" "$STATUS" "200" "$BODY" "items"

BODY_FILE="$TMP_DIR/followup_ingest_merchant_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/tags/ingest" \
  -H "Authorization: Bearer $MERCHANT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-merchant-$SUFFIX-forbidden" \
  -d "{\"reservation_id\":\"$RESERVATION_ID\",\"tags\":[{\"key\":\"billing\",\"value\":\"synced\",\"source\":\"merchant\"}]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "merchant follow-up tag ingest forbidden (clinical roles only)" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/provision_analytics.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/access/provision-user" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provision-$SUFFIX-analytics" \
  -d "{\"username\":\"$ANALYTICS_USER\",\"password\":\"$PASSWORD\",\"role\":\"analytics_viewer\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"a1\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "provision analytics_viewer via access API" "$STATUS" "201" "$BODY" "user_id"

BODY_FILE="$TMP_DIR/login_analytics.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ANALYTICS_USER\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login analytics_viewer user" "$STATUS" "200" "$BODY" "access_token"
ANALYTICS_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/list_analytics_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/reservations" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=20" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics_viewer cannot list reservations" "$STATUS" "403" "$BODY" "RESERVATION_LIST_FORBIDDEN"

BODY_FILE="$TMP_DIR/provision_staff.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/access/provision-user" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provision-$SUFFIX-01" \
  -d "{\"username\":\"$PROVISIONED_STAFF\",\"password\":\"$PASSWORD\",\"role\":\"staff\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"orange\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "provision staff via access API" "$STATUS" "201" "$BODY" "user_id"
STAFF_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.user_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/login_provisioned_staff.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$PROVISIONED_STAFF\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login provisioned staff user" "$STATUS" "200" "$BODY" "access_token"
STAFF_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/staff_create_reservation_explicit_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-$SUFFIX-staff-for-patient1" \
  -d "{\"patient_id\":\"$PATIENT1_ID\",\"start_time\":\"2026-07-15T10:00:00.000Z\",\"end_time\":\"2026-07-15T11:00:00.000Z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "staff create reservation with explicit patient_id" "$STATUS" "201" "$BODY" "reservation_id"

BODY_FILE="$TMP_DIR/confirm_for_sync.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$RESERVATION_ID/confirm" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-confirm-sync-$SUFFIX" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "ops confirms patient reservation for sync tests" "$STATUS" "200" "$BODY" "CONFIRMED"

BODY_FILE="$TMP_DIR/list_staff.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/reservations" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=100" \
  -H "Authorization: Bearer $STAFF_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "staff list reservations succeeds" "$STATUS" "200" "$BODY" "items"

BODY_FILE="$TMP_DIR/provision_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/access/provision-user" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provision-$SUFFIX-provider" \
  -d "{\"username\":\"$PROVISIONED_PROVIDER\",\"password\":\"$PASSWORD\",\"role\":\"provider\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"purple\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "provision provider via access API" "$STATUS" "201" "$BODY" "user_id"
PROVIDER_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.user_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/login_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$PROVISIONED_PROVIDER\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login provisioned provider user" "$STATUS" "200" "$BODY" "access_token"
PROVIDER_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/provider_get_unassigned_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/reservations/$RESERVATION_ID" \
  -H "Authorization: Bearer $PROVIDER_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "provider cannot read non-assigned reservation" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/provider_confirm_unassigned_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$RESERVATION_ID/confirm" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Idempotency-Key: provider-confirm-$SUFFIX-unassigned")"
BODY="$(cat "$BODY_FILE")"
assert_case "provider cannot act on non-assigned reservation" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/sync_pull_patient_scope.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/sync/pull?since_version=1&entity_types[]=reservation&page=1&page_size=100" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "sync pull patient scope" "$STATUS" "200" "$BODY" "$RESERVATION_ID"

BODY_FILE="$TMP_DIR/sync_pull_provider_scope.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/sync/pull?since_version=1&entity_types[]=reservation&page=1&page_size=100" \
  -H "Authorization: Bearer $PROVIDER_TOKEN")"
BODY="$(cat "$BODY_FILE")"
if [[ "$STATUS" != "200" ]]; then
  log_fail "sync pull provider scope status" "$STATUS" "$BODY"
else
  if [[ "$BODY" == *"$RESERVATION_ID"* ]]; then
    log_fail "sync pull provider excludes non-assigned reservation" "$STATUS" "$BODY"
  else
    log_pass "sync pull provider excludes non-assigned reservation"
  fi
fi

BODY_FILE="$TMP_DIR/sync_pull_staff_scope.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/sync/pull?since_version=1&entity_types[]=reservation&page=1&page_size=100" \
  -H "Authorization: Bearer $STAFF_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "sync pull staff scope" "$STATUS" "200" "$BODY" "changes"

BODY_FILE="$TMP_DIR/sync_pull_ops_scope.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/sync/pull?since_version=1&entity_types[]=reservation&page=1&page_size=100" \
  -H "Authorization: Bearer $OPS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "sync pull ops scope" "$STATUS" "200" "$BODY" "changes"

# Provider-scoped reservation (needed before follow-up plan tests that reference PROVIDER_SCOPED_RESERVATION_ID)
BODY_FILE="$TMP_DIR/create_res_provider_scope.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-prov-scope-$SUFFIX" \
  -d "{\"provider_id\":\"$PROVIDER_ID\",\"start_time\":\"2026-05-01T10:00:00.000Z\",\"end_time\":\"2026-05-01T11:00:00.000Z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create reservation assigned to provisioned provider" "$STATUS" "201" "$BODY" "reservation_id"
PROVIDER_SCOPED_RESERVATION_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.reservation_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/confirm_provider_scoped.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$PROVIDER_SCOPED_RESERVATION_ID/confirm" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-prov-scope-confirm-$SUFFIX" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "provider confirms provider-scoped reservation" "$STATUS" "200" "$BODY" "CONFIRMED"

BODY_FILE="$TMP_DIR/list_provider_scoped.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/reservations" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=50" \
  -H "Authorization: Bearer $PROVIDER_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "provider list includes reservations where provider_id is caller" "$STATUS" "200" "$BODY" "$PROVIDER_SCOPED_RESERVATION_ID"

BODY_FILE="$TMP_DIR/followup_ingest_scope_denial.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/tags/ingest" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-scope-$SUFFIX-01" \
  -d "{\"reservation_id\":\"$RESERVATION_ID\",\"tags\":[{\"key\":\"risk\",\"value\":\"low\",\"source\":\"provider\"}]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up tag ingestion scope denial" "$STATUS" "403" "$BODY" "FORBIDDEN"

# 1a) Route authorization coverage (representative privileged routes)
BODY_FILE="$TMP_DIR/access_audit_logs_forbidden_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/access/audit-logs" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=5" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "access audit logs forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/access_audit_logs_allowed_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/access/audit-logs" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=5" \
  -H "Authorization: Bearer $OPS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "access audit logs allowed for ops" "$STATUS" "200" "$BODY" "items"

BODY_FILE="$TMP_DIR/trust_fraud_flags_forbidden_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/trust/fraud-flags" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=5" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "trust fraud flags forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/trust_fraud_flags_allowed_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/trust/fraud-flags" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=5" \
  -H "Authorization: Bearer $OPS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "trust fraud flags allowed for ops" "$STATUS" "200" "$BODY" "items"

BODY_FILE="$TMP_DIR/analytics_funnel_forbidden_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/analytics/aggregations/funnel" \
  --data-urlencode "from=2026-04-10T00:00:00.000Z" \
  --data-urlencode "to=2026-04-11T00:00:00.000Z" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics funnel forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/analytics_funnel_allowed_analytics.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/analytics/aggregations/funnel" \
  --data-urlencode "from=2026-04-10T00:00:00.000Z" \
  --data-urlencode "to=2026-04-11T00:00:00.000Z" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics funnel allowed for analytics viewer" "$STATUS" "200" "$BODY" "stages"

BODY_FILE="$TMP_DIR/audit_verify_forbidden_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/access/audit-logs/verify-integrity" \
  --data-urlencode "limit=100" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "audit integrity verify forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/audit_verify_allowed_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/access/audit-logs/verify-integrity" \
  --data-urlencode "limit=1000" \
  -H "Authorization: Bearer $OPS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "audit integrity verify allowed for ops" "$STATUS" "200" "$BODY" "checked_count"

# Unique words per run so repeated API tests against a persistent DB do not hit SENSITIVE_WORD_EXISTS (409).
SENSITIVE_WORD_TEXT="apitest-sensitive-$SUFFIX"
SENSITIVE_WORD_UPDATED_TEXT="apitest-sensitive-renamed-$SUFFIX"

BODY_FILE="$TMP_DIR/sensitive_word_create_forbidden_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/sensitive-words" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sensitive-word-$SUFFIX-patient-create" \
  -d "{\"word\":\"$SENSITIVE_WORD_TEXT\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "sensitive-word create forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/sensitive_word_create_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/sensitive-words" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sensitive-word-$SUFFIX-ops-create" \
  -d "{\"word\":\"$SENSITIVE_WORD_TEXT\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "sensitive-word create allowed for ops" "$STATUS" "201" "$BODY" "word_id"
SENSITIVE_WORD_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.word_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/sensitive_word_list_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/sensitive-words" \
  --data-urlencode "active=true" \
  -H "Authorization: Bearer $OPS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "sensitive-word list allowed for ops" "$STATUS" "200" "$BODY" "$SENSITIVE_WORD_TEXT"

BODY_FILE="$TMP_DIR/sensitive_word_update_forbidden_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/sensitive-words/$SENSITIVE_WORD_ID/update" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sensitive-word-$SUFFIX-patient-update" \
  -d "{\"word\":\"$SENSITIVE_WORD_UPDATED_TEXT\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "sensitive-word update forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/sensitive_word_update_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/sensitive-words/$SENSITIVE_WORD_ID/update" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sensitive-word-$SUFFIX-ops-update" \
  -d "{\"word\":\"$SENSITIVE_WORD_UPDATED_TEXT\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "sensitive-word update allowed for ops" "$STATUS" "200" "$BODY" "$SENSITIVE_WORD_UPDATED_TEXT"

BODY_FILE="$TMP_DIR/sensitive_word_toggle_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/sensitive-words/$SENSITIVE_WORD_ID/toggle" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sensitive-word-$SUFFIX-ops-toggle" \
  -d '{"active":"false"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "sensitive-word deactivate allowed for ops" "$STATUS" "200" "$BODY" '"active":false'

BODY_FILE="$TMP_DIR/followup_template_forbidden_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/plan-templates" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-template-$SUFFIX-patient-forbidden" \
  -d '{"name":"patient blocked","trigger_tags":[{"key":"risk"}],"task_rules":[{"task_name":"check-in","every_n_days":1}],"active":true}')"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up template forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/followup_template_allowed_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/plan-templates" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-template-$SUFFIX-provider-allow" \
  -d '{"name":"provider template","trigger_tags":[{"key":"risk"}],"task_rules":[{"task_name":"check-in","every_n_days":1}],"active":true}')"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up template allowed for provider" "$STATUS" "201" "$BODY" "template_id"
FOLLOWUP_TEMPLATE_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.template_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/followup_template_auto_ingest.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/plan-templates" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-template-$SUFFIX-auto-ingest" \
  -d '{"name":"auto by ingest e2e","trigger_tags":[{"key":"auto_by_ingest","value":"v1"}],"task_rules":[{"task_name":"ingest-task","every_n_days":14}],"active":true}')"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up auto-ingest template create" "$STATUS" "201" "$BODY" "template_id"

BODY_FILE="$TMP_DIR/followup_ingest_triggers_plan.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/tags/ingest" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-ingest-$SUFFIX-auto-plan" \
  -d "{\"reservation_id\":\"$PROVIDER_SCOPED_RESERVATION_ID\",\"tags\":[{\"key\":\"auto_by_ingest\",\"value\":\"v1\",\"source\":\"e2e\"}]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up ingest auto-creates plan when tags match template" "$STATUS" "201" "$BODY" '"auto_created_plan_ids":["'

BODY_FILE="$TMP_DIR/followup_plan_create_allowed_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/plans" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-plan-$SUFFIX-provider-allow" \
  -d "{\"patient_id\":\"$PATIENT1_ID\",\"reservation_id\":\"$PROVIDER_SCOPED_RESERVATION_ID\",\"template_id\":\"$FOLLOWUP_TEMPLATE_ID\",\"start_date\":\"2026-05-02\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up plan create in-scope by provider" "$STATUS" "201" "$BODY" "plan_id"
FOLLOWUP_PLAN_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.plan_id||'');" < "$BODY_FILE")"
FOLLOWUP_TASK_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.tasks?.[0]?.task_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/followup_plan_create_patient_mismatch.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/plans" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-plan-$SUFFIX-provider-mismatch" \
  -d "{\"patient_id\":\"$PATIENT2_ID\",\"reservation_id\":\"$PROVIDER_SCOPED_RESERVATION_ID\",\"template_id\":\"$FOLLOWUP_TEMPLATE_ID\",\"start_date\":\"2026-05-02\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up plan patient mismatch blocked" "$STATUS" "422" "$BODY" "FOLLOW_UP_PATIENT_MISMATCH"

BODY_FILE="$TMP_DIR/followup_plan_get_cross_user_denied.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/follow-up/plans/$FOLLOWUP_PLAN_ID" \
  -H "Authorization: Bearer $PATIENT2_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up plan get cross-user denied" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/followup_plan_get_in_scope_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/follow-up/plans/$FOLLOWUP_PLAN_ID" \
  -H "Authorization: Bearer $PROVIDER_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up plan get in-scope provider allowed" "$STATUS" "200" "$BODY" "$FOLLOWUP_PLAN_ID"

BODY_FILE="$TMP_DIR/followup_task_outcome_forbidden_patient.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/tasks/$FOLLOWUP_TASK_ID/outcomes" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-outcome-$SUFFIX-patient-forbidden" \
  -d '{"status":"DONE","adherence_score":91,"outcome_payload":{"note":"patient blocked"}}')"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up task outcome forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/followup_task_outcome_allowed_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/follow-up/tasks/$FOLLOWUP_TASK_ID/outcomes" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: followup-outcome-$SUFFIX-provider-allow" \
  -d '{"status":"DONE","adherence_score":91,"outcome_payload":{"note":"provider done"}}')"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up task outcome in-scope provider allowed" "$STATUS" "201" "$BODY" "outcome_id"

SECOND_PROVIDER_USER="apitest-provider2-$SUFFIX"
BODY_FILE="$TMP_DIR/provision_provider2.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/access/provision-user" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provision-$SUFFIX-provider-2" \
  -d "{\"username\":\"$SECOND_PROVIDER_USER\",\"password\":\"$PASSWORD\",\"role\":\"provider\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"teal\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "provision second provider for scope tests" "$STATUS" "201" "$BODY" "user_id"

BODY_FILE="$TMP_DIR/login_provider2.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$SECOND_PROVIDER_USER\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login second provider" "$STATUS" "200" "$BODY" "access_token"
PROVIDER2_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/followup_plan_get_out_of_scope_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/follow-up/plans/$FOLLOWUP_PLAN_ID" \
  -H "Authorization: Bearer $PROVIDER2_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up plan get out-of-scope provider denied" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/followup_adherence_in_scope_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/follow-up/adherence" \
  --data-urlencode "patient_id=$PATIENT1_ID" \
  -H "Authorization: Bearer $PROVIDER_TOKEN")"
BODY="$(cat "$BODY_FILE")"
if [[ "$STATUS" != "200" ]]; then
  log_fail "follow-up adherence in-scope provider status" "$STATUS" "$BODY"
else
  if [[ "$BODY" == *'"total_outcomes":1'* ]] || [[ "$BODY" == *'"total_outcomes":'* ]]; then
    log_pass "follow-up adherence in-scope provider accessible"
  else
    log_fail "follow-up adherence in-scope provider accessible" "$STATUS" "$BODY"
  fi
fi

BODY_FILE="$TMP_DIR/followup_adherence_out_of_scope_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/follow-up/adherence" \
  --data-urlencode "patient_id=$PATIENT1_ID" \
  -H "Authorization: Bearer $PROVIDER2_TOKEN")"
BODY="$(cat "$BODY_FILE")"
if [[ "$STATUS" != "200" ]]; then
  log_fail "follow-up adherence out-of-scope provider status" "$STATUS" "$BODY"
else
  if [[ "$BODY" == *'"total_outcomes":0'* ]]; then
    log_pass "follow-up adherence out-of-scope provider excludes data"
  else
    log_fail "follow-up adherence out-of-scope provider excludes data" "$STATUS" "$BODY"
  fi
fi

BODY_FILE="$TMP_DIR/followup_adherence_allowed_analytics_viewer.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/follow-up/adherence" \
  --data-urlencode "patient_id=$PATIENT1_ID" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
if [[ "$STATUS" != "200" ]]; then
  log_fail "follow-up adherence allowed for analytics_viewer" "$STATUS" "$BODY"
else
  if [[ "$BODY" == *'"total_outcomes":'* ]]; then
    log_pass "follow-up adherence allowed for analytics_viewer"
  else
    log_fail "follow-up adherence allowed for analytics_viewer" "$STATUS" "$BODY"
  fi
fi

BODY_FILE="$TMP_DIR/followup_adherence_forbidden_merchant.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/follow-up/adherence" \
  --data-urlencode "patient_id=$PATIENT1_ID" \
  -H "Authorization: Bearer $MERCHANT_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "follow-up adherence forbidden for unauthorized merchant" "$STATUS" "403" "$BODY" "FORBIDDEN"

# 10b) Review target_user_id object-level authorization
BODY_FILE="$TMP_DIR/create_review_reservation.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-review-$SUFFIX-01" \
  -d "{\"provider_id\":\"$PROVIDER_ID\",\"start_time\":\"2026-04-12T10:00:00.000Z\",\"end_time\":\"2026-04-12T11:00:00.000Z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create reservation for review tests" "$STATUS" "201" "$BODY" "reservation_id"
REVIEW_RESERVATION_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.reservation_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/confirm_review_reservation.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$REVIEW_RESERVATION_ID/confirm" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-review-$SUFFIX-02" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "confirm reservation for review tests" "$STATUS" "200" "$BODY" "CONFIRMED"

BODY_FILE="$TMP_DIR/complete_review_reservation.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$REVIEW_RESERVATION_ID/complete" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Idempotency-Key: reservation-review-$SUFFIX-03")"
BODY="$(cat "$BODY_FILE")"
assert_case "complete reservation for review tests" "$STATUS" "200" "$BODY" "COMPLETED"

BODY_FILE="$TMP_DIR/review_valid_counterparty.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$REVIEW_RESERVATION_ID/reviews" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: review-$SUFFIX-01" \
  -d "{\"target_user_id\":\"$PROVIDER_ID\",\"dimensions\":[{\"name\":\"professionalism\",\"score\":5}],\"comment\":\"great\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "review valid counterparty succeeds" "$STATUS" "201" "$BODY" "review_id"

BODY_FILE="$TMP_DIR/review_duplicate_direction.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$REVIEW_RESERVATION_ID/reviews" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: review-$SUFFIX-01b" \
  -d "{\"target_user_id\":\"$PROVIDER_ID\",\"dimensions\":[{\"name\":\"professionalism\",\"score\":5}],\"comment\":\"duplicate direction\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "review duplicate direction rejected" "$STATUS" "409" "$BODY" "REVIEW_ALREADY_EXISTS"
POSITIVE_REVIEW_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.review_id||'');" < "$TMP_DIR/review_valid_counterparty.json")"

BODY_FILE="$TMP_DIR/appeal_positive_review_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reviews/$POSITIVE_REVIEW_ID/appeals" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: appeal-$SUFFIX-positive-blocked" \
  -d '{"reason":"This review was too harsh on me"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "appeal rejected for non-negative review" "$STATUS" "422" "$BODY" "APPEAL_REQUIRES_NEGATIVE_REVIEW"

BODY_FILE="$TMP_DIR/create_reservation_appeal_negative.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-appeal-neg-$SUFFIX" \
  -d "{\"provider_id\":\"$PROVIDER_ID\",\"start_time\":\"2026-04-18T10:00:00.000Z\",\"end_time\":\"2026-04-18T11:00:00.000Z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create reservation for negative appeal test" "$STATUS" "201" "$BODY" "reservation_id"
APPEAL_NEG_RESERVATION_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.reservation_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/confirm_reservation_appeal_negative.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$APPEAL_NEG_RESERVATION_ID/confirm" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-appeal-neg-confirm-$SUFFIX" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "confirm reservation for negative appeal test" "$STATUS" "200" "$BODY" "CONFIRMED"

BODY_FILE="$TMP_DIR/complete_reservation_appeal_negative.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$APPEAL_NEG_RESERVATION_ID/complete" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Idempotency-Key: reservation-appeal-neg-complete-$SUFFIX")"
BODY="$(cat "$BODY_FILE")"
assert_case "complete reservation for negative appeal test" "$STATUS" "200" "$BODY" "COMPLETED"

BODY_FILE="$TMP_DIR/review_negative_for_appeal.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$APPEAL_NEG_RESERVATION_ID/reviews" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: review-$SUFFIX-negative-appeal" \
  -d "{\"target_user_id\":\"$PROVIDER_ID\",\"dimensions\":[{\"name\":\"professionalism\",\"score\":2}],\"comment\":\"below expectations\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "negative review for appeal path" "$STATUS" "201" "$BODY" "review_id"
NEGATIVE_REVIEW_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.review_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/appeal_negative_review_ok.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reviews/$NEGATIVE_REVIEW_ID/appeals" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: appeal-$SUFFIX-negative-ok" \
  -d '{"reason":"Scores do not reflect the visit"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "appeal allowed for negative review" "$STATUS" "201" "$BODY" "appeal_id"

BODY_FILE="$TMP_DIR/review_unrelated_target.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$REVIEW_RESERVATION_ID/reviews" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: review-$SUFFIX-02" \
  -d "{\"target_user_id\":\"$PATIENT2_ID\",\"dimensions\":[{\"name\":\"professionalism\",\"score\":4}],\"comment\":\"invalid target\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "review unrelated target is rejected" "$STATUS" "422" "$BODY" "REVIEW_TARGET_USER_INVALID"

BODY_FILE="$TMP_DIR/review_self_target.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$REVIEW_RESERVATION_ID/reviews" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: review-$SUFFIX-03" \
  -d "{\"target_user_id\":\"$PATIENT1_ID\",\"dimensions\":[{\"name\":\"professionalism\",\"score\":4}],\"comment\":\"self target\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "review self target is rejected" "$STATUS" "422" "$BODY" "REVIEW_SELF_NOT_ALLOWED"

# 10c) Attachment constraints and cross-user denial
printf 'not-allowed' > "$TMP_DIR/not_allowed.txt"
NOT_ALLOWED_FILE_FOR_CURL="$(to_curl_file_path "$TMP_DIR/not_allowed.txt")"
BODY_FILE="$TMP_DIR/upload_bad_type.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$RESERVATION_ID/attachments" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Idempotency-Key: attachment-$SUFFIX-badtype" \
  -F "file=@$NOT_ALLOWED_FILE_FOR_CURL;type=text/plain")"
BODY="$(cat "$BODY_FILE")"
assert_case "attachment type validation" "$STATUS" "422" "$BODY" "FILE_TYPE_NOT_ALLOWED"

for n in 1 2 3 4 5 6; do
  printf 'fake-png' > "$TMP_DIR/ok$n.png"
done

for n in 1 2 3 4 5; do
  BODY_FILE="$TMP_DIR/upload_ok_$n.json"
  OK_FILE_FOR_CURL="$(to_curl_file_path "$TMP_DIR/ok$n.png")"
  STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$RESERVATION_ID/attachments" \
    -H "Authorization: Bearer $PATIENT1_TOKEN" \
    -H "Idempotency-Key: attachment-$SUFFIX-ok-$n" \
    -F "file=@$OK_FILE_FOR_CURL;type=image/png")"
  BODY="$(cat "$BODY_FILE")"
  assert_case "attachment upload $n within limit" "$STATUS" "201" "$BODY" "file_id"
done

BODY_FILE="$TMP_DIR/upload_over_limit.json"
OK6_FILE_FOR_CURL="$(to_curl_file_path "$TMP_DIR/ok6.png")"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$RESERVATION_ID/attachments" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Idempotency-Key: attachment-$SUFFIX-over" \
  -F "file=@$OK6_FILE_FOR_CURL;type=image/png")"
BODY="$(cat "$BODY_FILE")"
assert_case "attachment count limit" "$STATUS" "422" "$BODY" "FILE_LIMIT_EXCEEDED"

FIRST_FILE_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.file_id||'');" < "$TMP_DIR/upload_ok_1.json")"

BODY_FILE="$TMP_DIR/attachment_cross_user_list.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/reservations/$RESERVATION_ID/attachments?page=1&page_size=10" \
  -H "Authorization: Bearer $PATIENT2_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "attachment list cross-user denied" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/attachment_cross_user_download.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/files/$FIRST_FILE_ID/download" \
  -H "Authorization: Bearer $PATIENT2_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "attachment download cross-user denied" "$STATUS" "403" "$BODY" "FORBIDDEN"

# 10c1) Attachment size boundary: exactly 10 MB OK, 10 MB + 1 byte rejected (fresh reservation — avoids 5-file cap)
BODY_FILE="$TMP_DIR/reservation_size_test.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: reservation-size-$SUFFIX" \
  -d "{\"provider_id\":\"$PROVIDER_ID\",\"start_time\":\"2026-07-01T10:00:00.000Z\",\"end_time\":\"2026-07-01T11:00:00.000Z\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create reservation for attachment size boundary" "$STATUS" "201" "$BODY" "reservation_id"
SIZE_TEST_RESERVATION_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.reservation_id||'');" < "$BODY_FILE")"

"$NODE_BIN" -e "const fs=require('fs'); const p=process.argv[1]; const n=Number(process.argv[2]); const b=Buffer.alloc(n,0x4e); b[0]=0x89;b[1]=0x50;b[2]=0x4e;b[3]=0x47; fs.writeFileSync(p,b);" "$(to_node_file_path "$TMP_DIR/exact_10mb.png")" $((10*1024*1024))
EXACT_10_FILE="$(to_curl_file_path "$TMP_DIR/exact_10mb.png")"
BODY_FILE="$TMP_DIR/upload_exact_10mb.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$SIZE_TEST_RESERVATION_ID/attachments" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Idempotency-Key: attachment-$SUFFIX-exact-10mb" \
  -F "file=@$EXACT_10_FILE;type=image/png")"
BODY="$(cat "$BODY_FILE")"
assert_case "attachment exactly 10 MB accepted" "$STATUS" "201" "$BODY" "file_id"

"$NODE_BIN" -e "const fs=require('fs'); const p=process.argv[1]; const n=Number(process.argv[2]); const b=Buffer.alloc(n,0x4e); b[0]=0x89;b[1]=0x50;b[2]=0x4e;b[3]=0x47; fs.writeFileSync(p,b);" "$(to_node_file_path "$TMP_DIR/over_10mb.png")" $((10*1024*1024+1))
OVER_10_FILE="$(to_curl_file_path "$TMP_DIR/over_10mb.png")"
BODY_FILE="$TMP_DIR/upload_over_10mb.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/reservations/$SIZE_TEST_RESERVATION_ID/attachments" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Idempotency-Key: attachment-$SUFFIX-over-10mb" \
  -F "file=@$OVER_10_FILE;type=image/png")"
BODY="$(cat "$BODY_FILE")"
assert_case "attachment over 10 MB rejected" "$STATUS" "422" "$BODY" "FILE_TOO_LARGE"

# 10d) Support-ticket escalation/resolve workflow
BODY_FILE="$TMP_DIR/support_ticket_create_1.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-01" \
  -d "{\"reservation_id\":\"$RESERVATION_ID\",\"category\":\"BILLING\",\"description\":\"need help\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create support ticket" "$STATUS" "201" "$BODY" "ticket_id"
SUPPORT_TICKET_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.ticket_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/support_ticket_escalate_forbidden_non_owner.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets/$SUPPORT_TICKET_ID/escalate" \
  -H "Authorization: Bearer $PATIENT2_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-02" \
  -d '{"reason":"please escalate"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "support ticket escalate forbidden for unrelated user" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/support_ticket_escalate_owner.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets/$SUPPORT_TICKET_ID/escalate" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-03" \
  -d '{"reason":"owner escalation"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "support ticket owner escalation" "$STATUS" "200" "$BODY" "ESCALATED"

BODY_FILE="$TMP_DIR/support_ticket_resolve_forbidden_owner.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets/$SUPPORT_TICKET_ID/resolve" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-04" \
  -d '{"resolution_note":"owner cannot resolve"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "support ticket owner resolve forbidden" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/support_ticket_resolve_staff.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets/$SUPPORT_TICKET_ID/resolve" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-05" \
  -d '{"resolution_note":"staff resolved"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "support ticket resolve by staff" "$STATUS" "200" "$BODY" "RESOLVED"

BODY_FILE="$TMP_DIR/support_ticket_escalate_invalid_state.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets/$SUPPORT_TICKET_ID/escalate" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-06" \
  -d '{"reason":"invalid state"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "support ticket invalid transition blocked" "$STATUS" "422" "$BODY" "SUPPORT_TICKET_INVALID_STATE"

BODY_FILE="$TMP_DIR/support_ticket_create_2.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-07" \
  -d "{\"reservation_id\":\"$RESERVATION_ID\",\"category\":\"ACCESS\",\"description\":\"second ticket\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create second support ticket" "$STATUS" "201" "$BODY" "ticket_id"
SUPPORT_TICKET_ID_2="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.ticket_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/support_ticket_resolve_direct_staff.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets/$SUPPORT_TICKET_ID_2/resolve" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-08" \
  -d '{"resolution_note":"direct open resolve"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "support ticket direct open resolve by staff" "$STATUS" "200" "$BODY" "RESOLVED"

BODY_FILE="$TMP_DIR/support_ticket_create_3.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-09" \
  -d "{\"reservation_id\":\"$RESERVATION_ID\",\"category\":\"GENERAL\",\"description\":\"third ticket\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create third support ticket" "$STATUS" "201" "$BODY" "ticket_id"
SUPPORT_TICKET_ID_3="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.ticket_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/support_ticket_escalate_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets/$SUPPORT_TICKET_ID_3/escalate" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-10" \
  -d '{"reason":"ops escalation"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "support ticket escalation by ops" "$STATUS" "200" "$BODY" "ESCALATED"

BODY_FILE="$TMP_DIR/support_ticket_resolve_ops.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/support/tickets/$SUPPORT_TICKET_ID_3/resolve" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: support-ticket-$SUFFIX-11" \
  -d '{"resolution_note":"ops resolved"}')"
BODY="$(cat "$BODY_FILE")"
assert_case "support ticket resolve by ops" "$STATUS" "200" "$BODY" "RESOLVED"

# 10e) Notification cross-user read denial
BODY_FILE="$TMP_DIR/create_notification_cross_user.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/notifications" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: notification-$SUFFIX-01" \
  -d "{\"user_id\":\"$PATIENT1_ID\",\"type\":\"SYSTEM\",\"title\":\"Scope test\",\"body\":\"hello\",\"payload\":{\"k\":\"v\"}}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create notification for cross-user denial test" "$STATUS" "201" "$BODY" "notification_id"
NOTIFICATION_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.notification_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/notification_cross_user_read.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/notifications/$NOTIFICATION_ID/read" \
  -H "Authorization: Bearer $PATIENT2_TOKEN" \
  -H "Idempotency-Key: notification-read-$SUFFIX-cross")"
BODY="$(cat "$BODY_FILE")"
assert_case "notification cross-user read denied" "$STATUS" "404" "$BODY" "NOT_FOUND"

# 10f) Login lockout behavior
LOCK_USER="apitest-lock-$SUFFIX"
BODY_FILE="$TMP_DIR/register_lock_user.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: lock-$SUFFIX-register" \
  -d "{\"username\":\"$LOCK_USER\",\"password\":\"$PASSWORD\",\"role\":\"patient\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"lock\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "register lockout test user" "$STATUS" "201" "$BODY" "user_id"

for i in 1 2 3 4 5; do
  BODY_FILE="$TMP_DIR/lock_bad_login_$i.json"
  STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$LOCK_USER\",\"password\":\"WrongPassword123!\"}")"
  BODY="$(cat "$BODY_FILE")"
  assert_case "lockout bad login attempt $i" "$STATUS" "401" "$BODY" "AUTH_INVALID_CREDENTIALS"
done

BODY_FILE="$TMP_DIR/lock_after_threshold.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$LOCK_USER\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "lockout returns remaining seconds after threshold" "$STATUS" "200" "$BODY" "lockout_remaining_seconds"

# Note: waiting a full 15 minutes to assert unlock in this script is impractical for CI.
# Configure optional AUTH_LOGIN_LOCK_MINUTES for local experiments; unit tests cover lockout-until math and policy.

# 10g) Privileged audit existence assertion
BODY_FILE="$TMP_DIR/audit_logs_check.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/access/audit-logs" \
  --data-urlencode "page=1" \
  --data-urlencode "page_size=100" \
  -H "Authorization: Bearer $OPS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
if [[ "$STATUS" != "200" ]]; then
  log_fail "audit logs endpoint for privileged assertions" "$STATUS" "$BODY"
else
  if [[ "$BODY" == *"notification.create"* ]] && [[ "$BODY" == *"access.user.provision"* ]]; then
    log_pass "privileged audit entries exist"
  else
    log_fail "privileged audit entries exist" "$STATUS" "$BODY"
  fi
fi

# 11) Workflow — definitions, ANY_ONE / ALL_REQUIRED (+ negative cases)
BODY_FILE="$TMP_DIR/workflow_def_any_dup.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/definitions" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-any-dup-$SUFFIX" \
  -d "{\"name\":\"API test ANY_ONE dup order\",\"approval_mode\":\"ANY_ONE\",\"steps\":[{\"order\":1,\"approver_role\":\"staff\",\"conditions\":{}},{\"order\":1,\"approver_role\":\"provider\",\"conditions\":{}}]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "ANY_ONE definition rejects duplicate step order" "$STATUS" "422" "$BODY" "WORKFLOW_DUPLICATE_STEP_ORDER"

BODY_FILE="$TMP_DIR/workflow_def_patient_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/definitions" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-patient-$SUFFIX" \
  -d '{"name":"nope","approval_mode":"ANY_ONE","steps":[{"order":1,"approver_role":"staff","conditions":{}}]}')"
BODY="$(cat "$BODY_FILE")"
assert_case "workflow definition create forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/workflow_def_any.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/definitions" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-any-$SUFFIX" \
  -d '{"name":"API test workflow ANY_ONE","approval_mode":"ANY_ONE","steps":[{"order":1,"approver_role":"staff","conditions":{}}]}')"
BODY="$(cat "$BODY_FILE")"
assert_case "create workflow definition ANY_ONE" "$STATUS" "201" "$BODY" "workflow_definition_id"
WORKFLOW_ANY_DEF_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.workflow_definition_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/workflow_submit_any.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-req-any-$SUFFIX" \
  -d "{\"workflow_definition_id\":\"$WORKFLOW_ANY_DEF_ID\",\"resource_type\":\"appointment_slot\",\"resource_ref\":\"ref-any-$SUFFIX\",\"payload\":{}}")"
BODY="$(cat "$BODY_FILE")"
assert_case "submit ANY_ONE workflow request" "$STATUS" "201" "$BODY" "request_id"
WORKFLOW_ANY_REQ_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.request_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/workflow_approve_any.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests/$WORKFLOW_ANY_REQ_ID/approve" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-approve-any-$SUFFIX" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "ANY_ONE completes after first approval" "$STATUS" "200" "$BODY" "\"status\":\"APPROVED\""

BODY_FILE="$TMP_DIR/workflow_approve_any_dup.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests/$WORKFLOW_ANY_REQ_ID/approve" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-approve-any-dup-$SUFFIX" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "ANY_ONE second approve rejected when not pending" "$STATUS" "422" "$BODY" "WORKFLOW_REQUEST_NOT_PENDING"

# ALL_REQUIRED — sequential gates (order 1 staff, then order 2 provider). Works on all API versions.
BODY_FILE="$TMP_DIR/workflow_def_all_seq.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/definitions" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-all-seq-$SUFFIX" \
  -d "{\"name\":\"API test ALL_REQUIRED sequential\",\"approval_mode\":\"ALL_REQUIRED\",\"steps\":[{\"order\":1,\"approver_role\":\"staff\",\"conditions\":{}},{\"order\":2,\"approver_role\":\"provider\",\"conditions\":{}}]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "create workflow definition ALL_REQUIRED sequential" "$STATUS" "201" "$BODY" "workflow_definition_id"
WORKFLOW_ALL_DEF_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.workflow_definition_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/workflow_submit_all.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-req-all-$SUFFIX" \
  -d "{\"workflow_definition_id\":\"$WORKFLOW_ALL_DEF_ID\",\"resource_type\":\"device\",\"resource_ref\":\"ref-all-$SUFFIX\",\"payload\":{}}")"
BODY="$(cat "$BODY_FILE")"
assert_case "submit ALL_REQUIRED workflow request" "$STATUS" "201" "$BODY" "request_id"
WORKFLOW_ALL_REQ_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.request_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/workflow_approve_all_staff.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests/$WORKFLOW_ALL_REQ_ID/approve" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-approve-all-staff-$SUFFIX" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "ALL_REQUIRED pending on step 2 after staff completes step 1" "$STATUS" "200" "$BODY" "\"status\":\"PENDING\""
assert_case "ALL_REQUIRED current_step_order advanced to 2" "$STATUS" "200" "$BODY" "\"current_step_order\":2"

BODY_FILE="$TMP_DIR/workflow_approve_all_staff_wrong_step.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests/$WORKFLOW_ALL_REQ_ID/approve" \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-approve-all-staff-wrong-$SUFFIX" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "ALL_REQUIRED staff cannot approve provider step" "$STATUS" "403" "$BODY" "FORBIDDEN"

BODY_FILE="$TMP_DIR/workflow_approve_all_provider.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests/$WORKFLOW_ALL_REQ_ID/approve" \
  -H "Authorization: Bearer $PROVIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-approve-all-prov-$SUFFIX" \
  -d '{}')"
BODY="$(cat "$BODY_FILE")"
assert_case "ALL_REQUIRED completes after provider approval" "$STATUS" "200" "$BODY" "\"status\":\"APPROVED\""

# ALL_REQUIRED — parallel slots (same order) requires current API (allows duplicate order only for ALL_REQUIRED).
BODY_FILE="$TMP_DIR/workflow_def_all_par.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/definitions" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: workflow-all-par-$SUFFIX" \
  -d "{\"name\":\"API test ALL_REQUIRED parallel\",\"approval_mode\":\"ALL_REQUIRED\",\"steps\":[{\"order\":1,\"approver_role\":\"staff\",\"conditions\":{}},{\"order\":1,\"approver_role\":\"provider\",\"conditions\":{}}]}")"
PAR_DEF_BODY="$(cat "$BODY_FILE")"
if [[ "$STATUS" == "201" ]] && [[ "$PAR_DEF_BODY" == *"workflow_definition_id"* ]]; then
  WORKFLOW_PAR_DEF_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.workflow_definition_id||'');" < "$BODY_FILE")"
  BODY_FILE="$TMP_DIR/workflow_submit_par.json"
  STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests" \
    -H "Authorization: Bearer $STAFF_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: workflow-req-par-$SUFFIX" \
    -d "{\"workflow_definition_id\":\"$WORKFLOW_PAR_DEF_ID\",\"resource_type\":\"device\",\"resource_ref\":\"ref-par-$SUFFIX\",\"payload\":{}}")"
  BODY="$(cat "$BODY_FILE")"
  assert_case "submit ALL_REQUIRED parallel workflow request" "$STATUS" "201" "$BODY" "request_id"
  WORKFLOW_PAR_REQ_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.request_id||'');" < "$BODY_FILE")"

  BODY_FILE="$TMP_DIR/workflow_par_staff.json"
  STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests/$WORKFLOW_PAR_REQ_ID/approve" \
    -H "Authorization: Bearer $STAFF_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: workflow-par-staff-$SUFFIX" \
    -d '{}')"
  BODY="$(cat "$BODY_FILE")"
  assert_case "ALL_REQUIRED parallel still pending after staff only" "$STATUS" "200" "$BODY" "\"status\":\"PENDING\""

  BODY_FILE="$TMP_DIR/workflow_par_staff_dup.json"
  STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests/$WORKFLOW_PAR_REQ_ID/approve" \
    -H "Authorization: Bearer $STAFF_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: workflow-par-staff-dup-$SUFFIX" \
    -d '{}')"
  BODY="$(cat "$BODY_FILE")"
  assert_case "ALL_REQUIRED parallel duplicate staff approve idempotent" "$STATUS" "200" "$BODY" "\"status\":\"PENDING\""

  BODY_FILE="$TMP_DIR/workflow_par_prov.json"
  STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/workflows/requests/$WORKFLOW_PAR_REQ_ID/approve" \
    -H "Authorization: Bearer $PROVIDER_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: workflow-par-prov-$SUFFIX" \
    -d '{}')"
  BODY="$(cat "$BODY_FILE")"
  assert_case "ALL_REQUIRED parallel completes after provider approval" "$STATUS" "200" "$BODY" "\"status\":\"APPROVED\""
else
  log_pass "ALL_REQUIRED parallel slots skipped (rebuild API: docker compose up --build — server returned $STATUS for parallel definition)"
fi

# 12) Analytics happy path + content quality metrics
BODY_FILE="$TMP_DIR/analytics_experiment.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/analytics/experiments" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: analytics-$SUFFIX-01" \
  -d '{"name":"api-test-exp","variants":["control","variant_a"],"active":true}')"
BODY="$(cat "$BODY_FILE")"
assert_case "create analytics experiment" "$STATUS" "201" "$BODY" "experiment_id"
ANALYTICS_EXPERIMENT_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.experiment_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/analytics_event_patient_forbidden.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/analytics/events" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: analytics-event-$SUFFIX-patient-blocked" \
  -d "{\"event_type\":\"impression\",\"subject_type\":\"article\",\"subject_id\":\"$RESERVATION_ID\",\"occurred_at\":\"2026-04-10T10:00:00.000Z\",\"metadata\":{\"source\":\"api-test\"}}")"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics ingest forbidden for patient" "$STATUS" "403" "$BODY" "FORBIDDEN"

for event_type in impression click read_completion share; do
  BODY_FILE="$TMP_DIR/analytics_event_$event_type.json"
  STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/analytics/events" \
    -H "Authorization: Bearer $ANALYTICS_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: analytics-event-$SUFFIX-$event_type" \
    -d "{\"event_type\":\"$event_type\",\"subject_type\":\"article\",\"subject_id\":\"$RESERVATION_ID\",\"occurred_at\":\"2026-04-10T10:00:00.000Z\",\"metadata\":{\"source\":\"api-test\"}}")"
  BODY="$(cat "$BODY_FILE")"
  assert_case "analytics_viewer ingest event $event_type" "$STATUS" "201" "$BODY" "event_id"
done

BODY_FILE="$TMP_DIR/analytics_event_ops_impression.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/analytics/events" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: analytics-event-$SUFFIX-ops-impression" \
  -d "{\"event_type\":\"impression\",\"subject_type\":\"article\",\"subject_id\":\"$RESERVATION_ID\",\"occurred_at\":\"2026-04-10T10:05:00.000Z\",\"metadata\":{\"source\":\"api-test-ops\"}}")"
BODY="$(cat "$BODY_FILE")"
assert_case "ops_admin ingest analytics event" "$STATUS" "201" "$BODY" "event_id"

BODY_FILE="$TMP_DIR/analytics_content_quality.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/analytics/aggregations/content-quality" \
  --data-urlencode "from=2026-04-10T00:00:00.000Z" \
  --data-urlencode "to=2026-04-11T00:00:00.000Z" \
  --data-urlencode "subject_type=article" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
if [[ "$STATUS" != "200" ]]; then
  log_fail "analytics content-quality aggregation status" "$STATUS" "$BODY"
else
  # share_count is not pinned to 1: aggregation is by subject_type + window and can include prior test runs' events.
  if [[ "$BODY" == *"completion_metric"* ]] && [[ "$BODY" == *"engagement_metric"* ]] && [[ "$BODY" == *"share_metric"* ]] && [[ "$BODY" =~ \"share_count\":[1-9][0-9]* ]]; then
    log_pass "analytics content-quality aggregation includes completion engagement share"
  else
    log_fail "analytics content-quality aggregation includes completion engagement share" "$STATUS" "$BODY"
  fi
fi

BODY_FILE="$TMP_DIR/analytics_assign_1.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/analytics/experiments/$ANALYTICS_EXPERIMENT_ID/assignment/$PATIENT1_ID" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics deterministic assignment first call" "$STATUS" "200" "$BODY" "variant"

BODY_FILE="$TMP_DIR/analytics_assign_2.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -G "$API_BASE_URL/analytics/experiments/$ANALYTICS_EXPERIMENT_ID/assignment/$PATIENT1_ID" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics deterministic assignment second call" "$STATUS" "200" "$BODY" "variant"
# Read JSON via stdin so paths work on Git Bash / MSYS (avoid embedding $TMP_DIR in -e string → wrong path on Windows).
VARIANT_A="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.variant||'');" < "$TMP_DIR/analytics_assign_1.json")"
VARIANT_B="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.variant||'');" < "$TMP_DIR/analytics_assign_2.json")"
if [[ "$VARIANT_A" == "$VARIANT_B" ]] && [[ -n "$VARIANT_A" ]]; then
  log_pass "analytics A/B assignment stable across repeated GETs"
else
  log_fail "analytics A/B assignment stable across repeated GETs" "0" "a=${VARIANT_A} b=${VARIANT_B}"
fi

BODY_FILE="$TMP_DIR/analytics_export_analytics.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/analytics/exports/csv" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: analytics-export-$SUFFIX-analytics" \
  -d "{\"report_type\":\"funnel\",\"filters\":{\"from\":\"2026-04-10T00:00:00.000Z\",\"to\":\"2026-04-11T00:00:00.000Z\"},\"columns\":[\"stage\",\"count\"]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics_viewer creates csv export" "$STATUS" "202" "$BODY" "export_id"
ANALYTICS_EXPORT_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.export_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/analytics_export_invalid_type.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/analytics/exports/csv" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: analytics-export-$SUFFIX-invalid" \
  -d '{"report_type":"unsupported_type","filters":{"from":"2026-04-10T00:00:00.000Z","to":"2026-04-11T00:00:00.000Z"},"columns":["metric","value"]}')"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics export rejects invalid report_type" "$STATUS" "400" "$BODY" "report_type"

BODY_FILE="$TMP_DIR/analytics_export_retention.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/analytics/exports/csv" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: analytics-export-$SUFFIX-retention" \
  -d '{"report_type":"retention","filters":{"cohort_start":"2026-04-10T00:00:00.000Z","cohort_end":"2026-04-11T00:00:00.000Z","bucket":"overall"},"columns":[]}')"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics retention export create" "$STATUS" "202" "$BODY" "export_id"
RETENTION_EXPORT_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.export_id||'');" < "$BODY_FILE")"

RETENTION_CSV_FILE="$TMP_DIR/retention_export.csv"
STATUS="$(curl -sS -o "$RETENTION_CSV_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/analytics/exports/$RETENTION_EXPORT_ID/download" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN")"
RETENTION_CSV_BODY="$(cat "$RETENTION_CSV_FILE")"
if [[ "$STATUS" != "200" ]]; then
  log_fail "analytics retention export download" "$STATUS" "$RETENTION_CSV_BODY"
else
  if [[ "$RETENTION_CSV_BODY" == *"cohort_start,cohort_end,bucket,cohort_size,retained_size,retention_rate_percent"* ]]; then
    log_pass "analytics retention export includes retention metrics columns"
  else
    log_fail "analytics retention export includes retention metrics columns" "$STATUS" "$RETENTION_CSV_BODY"
  fi
fi

BODY_FILE="$TMP_DIR/analytics_export_cross_user.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/analytics/exports/$ANALYTICS_EXPORT_ID" \
  -H "Authorization: Bearer $OPS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "ops_admin can read another user analytics export metadata" "$STATUS" "200" "$BODY" "export_id"

BODY_FILE="$TMP_DIR/analytics_export_ops_create.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/analytics/exports/csv" \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: analytics-export-$SUFFIX-ops" \
  -d "{\"report_type\":\"funnel\",\"filters\":{\"from\":\"2026-04-10T00:00:00.000Z\",\"to\":\"2026-04-11T00:00:00.000Z\"},\"columns\":[\"stage\",\"count\"]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "ops creates csv export for cross-user denial test" "$STATUS" "202" "$BODY" "export_id"
OPS_EXPORT_ID="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.export_id||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/analytics_export_analytics_denied.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/analytics/exports/$OPS_EXPORT_ID" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "analytics_viewer denied other user export metadata" "$STATUS" "403" "$BODY" "FORBIDDEN"

# 13) Sync — pull / push (+ cursor and conflict negatives)
BODY_FILE="$TMP_DIR/sync_pull_no_cursor.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/sync/pull?page=1&page_size=5&entity_types[]=reservation" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "sync pull without cursor rejected" "$STATUS" "422" "$BODY" "SYNC_CURSOR_REQUIRED"

BODY_FILE="$TMP_DIR/sync_pull_ok.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/sync/pull?since_version=1&entity_types[]=reservation&page=1&page_size=5" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "sync pull happy path" "$STATUS" "200" "$BODY" "changes"

BODY_FILE="$TMP_DIR/sync_pull_422.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/sync/pull?since_version=1&entity_types[]=unknown_entity&page=1&page_size=5" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "sync pull unknown entity" "$STATUS" "422" "$BODY" "SYNC_ENTITY_NOT_SUPPORTED"

BODY_FILE="$TMP_DIR/sync_push_conflict.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/sync/push" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sync-push-conflict-$SUFFIX" \
  -d "{\"client_id\":\"apitest-sync-$SUFFIX\",\"changes\":[{\"entity_type\":\"reservation\",\"entity_id\":\"$RESERVATION_ID\",\"operation\":\"UPSERT\",\"payload\":{\"start_time\":\"2026-04-10T14:00:00.000Z\",\"end_time\":\"2026-04-10T15:00:00.000Z\"},\"base_version\":1,\"updated_at\":\"2026-04-10T13:30:00.000Z\"}]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "sync push stale base_version returns conflict" "$STATUS" "200" "$BODY" "SYNC_VERSION_CONFLICT"

BODY_FILE="$TMP_DIR/sync_push_ok.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/sync/push" \
  -H "Authorization: Bearer $PATIENT1_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sync-push-ok-$SUFFIX" \
  -d "{\"client_id\":\"apitest-sync-$SUFFIX\",\"changes\":[{\"entity_type\":\"reservation\",\"entity_id\":\"$RESERVATION_ID\",\"operation\":\"UPSERT\",\"payload\":{\"start_time\":\"2026-04-10T14:00:00.000Z\",\"end_time\":\"2026-04-10T15:00:00.000Z\"},\"base_version\":2,\"updated_at\":\"2026-04-10T13:45:00.000Z\"}]}")"
BODY="$(cat "$BODY_FILE")"
assert_case "sync push UPSERT accepted when base_version matches" "$STATUS" "200" "$BODY" "\"accepted\""

# 14) Authentication reset invalidates existing sessions/tokens
RESET_PASSWORD="${PASSWORD}Reset1!"

BODY_FILE="$TMP_DIR/reset_verify_security_answer.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/password-reset/verify-security-answer" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: auth-reset-verify-$SUFFIX" \
  -d "{\"username\":\"$PATIENT1\",\"security_question_id\":\"$SECURITY_QUESTION_ID\",\"security_answer\":\"blue\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "password reset verify security answer" "$STATUS" "200" "$BODY" "reset_token"
RESET_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.reset_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/reset_confirm.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/password-reset/confirm" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: auth-reset-confirm-$SUFFIX" \
  -d "{\"reset_token\":\"$RESET_TOKEN\",\"new_password\":\"$RESET_PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "password reset confirm" "$STATUS" "204" "$BODY" ""

BODY_FILE="$TMP_DIR/reset_old_token_me.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/auth/me" \
  -H "Authorization: Bearer $PATIENT1_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "old token rejected after password reset" "$STATUS" "401" "$BODY" "UNAUTHORIZED"

BODY_FILE="$TMP_DIR/reset_login_old_password.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$PATIENT1\",\"password\":\"$PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "old password rejected after reset" "$STATUS" "401" "$BODY" "AUTH_INVALID_CREDENTIALS"

BODY_FILE="$TMP_DIR/reset_login_new_password.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X POST "$API_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$PATIENT1\",\"password\":\"$RESET_PASSWORD\"}")"
BODY="$(cat "$BODY_FILE")"
assert_case "login with new password succeeds" "$STATUS" "200" "$BODY" "access_token"
PATIENT1_RESET_TOKEN="$("$NODE_BIN" -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.access_token||'');" < "$BODY_FILE")"

BODY_FILE="$TMP_DIR/reset_new_token_me.json"
STATUS="$(curl -sS -o "$BODY_FILE" -w "%{http_code}" -X GET "$API_BASE_URL/auth/me" \
  -H "Authorization: Bearer $PATIENT1_RESET_TOKEN")"
BODY="$(cat "$BODY_FILE")"
assert_case "new token valid after password reset" "$STATUS" "200" "$BODY" "$PATIENT1_ID"

echo "API tests summary: total=$TOTAL passed=$PASSED failed=$FAILED"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi

exit 0
