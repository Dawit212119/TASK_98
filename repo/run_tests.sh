#!/usr/bin/env bash
set -u

# Always run from this script's directory (repo root). CI often invokes tests without a prior cd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Unit tests need devDependencies (jest, ts-jest). Docker image builds deps inside the container only;
# host-side test runners must install here. Without this, `npx jest` may fetch a standalone Jest that
# cannot resolve ts-jest from this package.
if [[ "${RUN_TESTS_SKIP_NPM_CI:-}" != "1" ]]; then
  if [[ ! -f node_modules/jest/bin/jest.js ]] || [[ ! -f node_modules/ts-jest/package.json ]]; then
    echo "Unit tests require devDependencies — running npm ci in $(pwd) ..."
    npm ci
  fi
fi

TOTAL=0
PASSED=0
FAILED=0

run_suite() {
  local suite_name="$1"
  local command="$2"

  TOTAL=$((TOTAL + 1))
  echo ""
  echo "=== Running $suite_name ==="

  if eval "$command"; then
    PASSED=$((PASSED + 1))
    echo "[PASS] $suite_name"
  else
    FAILED=$((FAILED + 1))
    echo "[FAIL] $suite_name"
  fi
}

echo "Test runner started"
echo "- API tests require a running API + migrated DB (e.g. docker compose up -d — nothing on port 3001 means the stack is not up)"
echo "- After changing server code, rebuild/restart the API (e.g. docker compose up --build) so tests hit the latest image"
echo "- On Windows under OneDrive, if docker compose build fails with invalid file request Dockerfile, run: ./docker-build.sh --no-cache app (or DOCKER_BUILDKIT=0 docker compose build ...)"
echo "- If you see 404 on /support/tickets/*/escalate, /access/audit-logs/verify-integrity, /sensitive-words, or missing analytics routes, the running container is stale — rebuild: docker compose up -d --build"
echo "- Override API URL with API_BASE_URL if needed"
echo "- Performance gate checks p95 latency on /health (<300ms by default)"
echo "- Without Docker: unit-only via npm run test:unit, or full runner with live checks skipped: SKIP_LIVE_TESTS=1 bash run_tests.sh"
echo "- If the API is down, this script runs docker compose up -d and waits for /health (disable: RUN_TESTS_AUTOSTART_DOCKER=0)"

run_suite "Unit tests" "npm run test:unit"

if [[ "${SKIP_LIVE_TESTS:-}" == "1" ]]; then
  echo ""
  echo "=== Skipping live API checks (SKIP_LIVE_TESTS=1) ==="
  echo "[SKIP] API tests — unset SKIP_LIVE_TESTS and start the stack to run them"
  echo "[SKIP] Performance check"
else
  LIVE_API_BASE="${API_BASE_URL:-http://localhost:3001/api/v1}"
  LIVE_API_BASE="${LIVE_API_BASE%/}"

  health_http_code() {
    curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 12 "${LIVE_API_BASE}/health" 2>/dev/null || printf '%s' '000'
  }

  api_health_ok() {
    [[ "$(health_http_code)" == "200" ]]
  }

  should_autostart_docker() {
    [[ "${RUN_TESTS_AUTOSTART_DOCKER:-1}" == "1" ]] || return 1
    case "$LIVE_API_BASE" in
      *localhost*|*127.0.0.1*) ;;
      *) return 1 ;;
    esac
    command -v docker >/dev/null 2>&1 || return 1
    docker compose version >/dev/null 2>&1 || return 1
    return 0
  }

  if ! api_health_ok; then
    if should_autostart_docker; then
      echo ""
      echo "=== API not reachable at $LIVE_API_BASE — starting Docker Compose ==="
      if ! docker compose up -d; then
        echo "ERROR: docker compose up -d failed. Start Docker Desktop (or the engine), then retry."
        exit 1
      fi
      echo "Waiting for GET $LIVE_API_BASE/health (up to ~4 minutes for image build/migrations on first run)..."
      waited=0
      max_wait=120
      while [[ "$waited" -lt "$max_wait" ]]; do
        if api_health_ok; then
          echo "API is healthy."
          break
        fi
        sleep 2
        waited=$((waited + 1))
        if [[ $((waited % 10)) -eq 0 ]]; then
          echo "  ... still waiting (${waited}s / $((max_wait * 2))s)"
        fi
      done
      if ! api_health_ok; then
        echo "ERROR: API still not healthy. Try: docker compose logs -f app"
        echo "First-time builds can take several minutes; run bash run_tests.sh again when the app container is up."
        exit 1
      fi
    else
      echo ""
      echo "ERROR: API is not reachable at $LIVE_API_BASE (health not HTTP 200)."
      echo "From this directory run: docker compose up -d"
      echo "Or set SKIP_LIVE_TESTS=1 to run unit tests only."
      exit 1
    fi
  fi

  run_suite "API tests" "npm run test:api"
  run_suite "Performance check" "npm run test:perf"
fi

echo ""
echo "=== Final Summary ==="
echo "total=$TOTAL"
echo "passed=$PASSED"
echo "failed=$FAILED"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi

exit 0
