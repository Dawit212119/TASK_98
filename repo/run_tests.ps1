param(
  [switch]$ApiOnly
)

$total = 0
$passed = 0
$failed = 0

function Run-Suite {
  param(
    [string]$Name,
    [string]$Command
  )

  $script:total++
  Write-Host ""
  Write-Host "=== Running $Name ==="

  bash -lc $Command
  if ($LASTEXITCODE -eq 0) {
    $script:passed++
    Write-Host "[PASS] $Name"
  } else {
    $script:failed++
    Write-Host "[FAIL] $Name"
  }
}

Write-Host "Test runner started"
Write-Host "- API tests require a running API + migrated DB"
Write-Host "- Override API URL with API_BASE_URL if needed"
Write-Host "- Performance gate checks p95 latency on /health (<300ms by default)"

if (-not $ApiOnly) {
  Run-Suite -Name "Unit tests" -Command "npm run test:unit"
}
Run-Suite -Name "API tests" -Command "npm run test:api"
Run-Suite -Name "Performance check" -Command "npm run test:perf"

Write-Host ""
Write-Host "=== Final Summary ==="
Write-Host "total=$total"
Write-Host "passed=$passed"
Write-Host "failed=$failed"

if ($failed -gt 0) {
  exit 1
}

exit 0
