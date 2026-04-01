#!/usr/bin/env bash
set -u

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

run_suite "Unit tests" "npm run test:unit"
run_suite "API tests" "npm run test:api"
run_suite "Performance check" "npm run test:perf"

echo ""
echo "=== Final Summary ==="
echo "total=$TOTAL"
echo "passed=$PASSED"
echo "failed=$FAILED"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi

exit 0
