/**
 * p95 latency gate for one or more HTTP GET endpoints.
 *
 * Env:
 *   API_BASE_URL          — default http://localhost:3001/api/v1
 *   PERF_TARGET_PATH      — single path (default /health) if PERF_TARGET_PATHS unset
 *   PERF_TARGET_PATHS     — comma-separated paths, e.g. "/health,/auth/security-questions"
 *   PERF_AUTH_TOKEN       — optional Bearer token for protected routes (same token for all paths)
 *   PERF_REQUESTS, PERF_WARMUP_REQUESTS, PERF_P95_MS, PERF_REQUEST_TIMEOUT_MS
 */
const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
const singlePath = process.env.PERF_TARGET_PATH || '/health';
const multiPathsRaw = process.env.PERF_TARGET_PATHS;
const requests = Number.parseInt(process.env.PERF_REQUESTS || '60', 10);
const warmupRequests = Number.parseInt(process.env.PERF_WARMUP_REQUESTS || '5', 10);
const p95ThresholdMs = Number.parseFloat(process.env.PERF_P95_MS || '300');
const timeoutMs = Number.parseInt(process.env.PERF_REQUEST_TIMEOUT_MS || '5000', 10);
const authToken = process.env.PERF_AUTH_TOKEN;

function resolvePaths() {
  if (multiPathsRaw && multiPathsRaw.trim().length > 0) {
    return multiPathsRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (p.startsWith('/') ? p : `/${p}`));
  }
  return [singlePath.startsWith('/') ? singlePath : `/${singlePath}`];
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const idx = Math.ceil(sortedValues.length * fraction) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, idx))];
}

async function timedRequest(url) {
  const start = process.hrtime.bigint();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { ok: response.ok, status: response.status, elapsedMs };
  } finally {
    clearTimeout(timeout);
  }
}

async function runForPath(targetPath) {
  const url = `${baseUrl.replace(/\/$/, '')}${targetPath.startsWith('/') ? targetPath : `/${targetPath}`}`;
  const timings = [];
  let failures = 0;

  for (let i = 0; i < warmupRequests; i += 1) {
    await timedRequest(url);
  }

  for (let i = 0; i < requests; i += 1) {
    const result = await timedRequest(url);
    if (!result.ok) {
      failures += 1;
      console.error(`[perf] non-2xx response: url=${url} status=${result.status}`);
      continue;
    }
    timings.push(result.elapsedMs);
  }

  if (timings.length === 0) {
    console.error(`[perf] no successful requests collected for ${url}`);
    return { ok: false, url, p95: 0, failures };
  }

  timings.sort((a, b) => a - b);
  const p50 = percentile(timings, 0.5);
  const p95 = percentile(timings, 0.95);
  const p99 = percentile(timings, 0.99);
  const max = timings[timings.length - 1];
  const min = timings[0];
  const avg = timings.reduce((sum, v) => sum + v, 0) / timings.length;

  console.log('[perf] Latency summary');
  console.log(`[perf] url=${url}`);
  console.log(`[perf] successful_requests=${timings.length} failed_requests=${failures}`);
  console.log(
    `[perf] min=${min.toFixed(2)}ms p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms max=${max.toFixed(2)}ms avg=${avg.toFixed(2)}ms`
  );
  console.log(`[perf] threshold_p95=${p95ThresholdMs.toFixed(2)}ms`);

  if (failures > 0) {
    console.error(`[perf] FAIL: some requests failed for ${url}`);
    return { ok: false, url, p95, failures };
  }

  if (p95 >= p95ThresholdMs) {
    console.error(`[perf] FAIL: p95 ${p95.toFixed(2)}ms >= ${p95ThresholdMs.toFixed(2)}ms (${url})`);
    return { ok: false, url, p95, failures: 0 };
  }

  console.log(`[perf] PASS: p95 ${p95.toFixed(2)}ms < ${p95ThresholdMs.toFixed(2)}ms (${url})`);
  return { ok: true, url, p95, failures: 0 };
}

async function main() {
  const paths = resolvePaths();
  console.log(`[perf] paths=${paths.join(', ')} (set PERF_TARGET_PATHS to override)`);

  for (const p of paths) {
    const result = await runForPath(p);
    if (!result.ok) {
      process.exit(1);
    }
  }
}

function explainConnectionFailure(error) {
  const cause = error && error.cause;
  const code = cause && cause.code;
  if (code === 'ECONNREFUSED' || (typeof error.message === 'string' && error.message.includes('fetch failed'))) {
    const base = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
    console.error(`[perf] API not reachable at ${base} (connection refused or fetch failed).`);
    console.error('[perf] From the repo directory start the stack: docker compose up -d');
    console.error('[perf] Or skip live checks when using run_tests: SKIP_LIVE_TESTS=1 bash run_tests.sh');
    return;
  }
  console.error('[perf] unexpected error', error);
}

main().catch((error) => {
  explainConnectionFailure(error);
  process.exit(1);
});
