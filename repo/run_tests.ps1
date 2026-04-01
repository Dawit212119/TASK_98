param(
  [switch]$ApiOnly
)

Set-Location $PSScriptRoot

if ($env:RUN_TESTS_SKIP_NPM_CI -ne "1") {
  if (-not (Test-Path "node_modules/jest/bin/jest.js") -or -not (Test-Path "node_modules/ts-jest/package.json")) {
    Write-Host "Unit tests require devDependencies — running npm ci..."
    npm ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
}

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

  # Git Bash -lc often starts in $HOME; force repo root so npm/jest see node_modules.
  $repo = $PSScriptRoot -replace '\\', '/'
  if ($repo -match '^([A-Za-z]):') {
    $drive = $Matches[1].ToLower()
    $rest = $repo.Substring(2)
    $repo = "/$drive$rest"
  }
  bash -lc "cd '$repo' && $Command"
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
