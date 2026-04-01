const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
const targetPath = process.env.PERF_TARGET_PATH || '/health';
const requests = Number.parseInt(process.env.PERF_REQUESTS || '60', 10);
const warmupRequests = Number.parseInt(process.env.PERF_WARMUP_REQUESTS || '5', 10);
const p95ThresholdMs = Number.parseFloat(process.env.PERF_P95_MS || '300');
const timeoutMs = Number.parseInt(process.env.PERF_REQUEST_TIMEOUT_MS || '5000', 10);

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
  try {
    const response = await fetch(url, { signal: controller.signal });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { ok: response.ok, status: response.status, elapsedMs };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
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
      console.error(`[perf] non-2xx response: status=${result.status}`);
      continue;
    }
    timings.push(result.elapsedMs);
  }

  if (timings.length === 0) {
    console.error('[perf] no successful requests collected');
    process.exit(1);
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
    console.error('[perf] FAIL: some requests failed');
    process.exit(1);
  }

  if (p95 >= p95ThresholdMs) {
    console.error(`[perf] FAIL: p95 ${p95.toFixed(2)}ms >= ${p95ThresholdMs.toFixed(2)}ms`);
    process.exit(1);
  }

  console.log(`[perf] PASS: p95 ${p95.toFixed(2)}ms < ${p95ThresholdMs.toFixed(2)}ms`);
}

main().catch((error) => {
  console.error('[perf] unexpected error', error);
  process.exit(1);
});
