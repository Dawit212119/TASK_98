param(
  [switch]$ApiOnly
)

Set-Location $PSScriptRoot

if ($env:RUN_TESTS_SKIP_NPM_CI -ne "1") {
  if (-not (Test-Path "node_modules/jest/bin/jest.js") -or -not (Test-Path "node_modules/ts-jest/package.json")) {
    Write-Host "Unit tests require devDependencies - running npm ci..."
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

  # Run npm from repo root via cmd.exe so Windows PowerShell works without Git Bash path mapping (/c/...).
  $exitCode = 1
  Push-Location $PSScriptRoot
  try {
    cmd.exe /c $Command
    if ($null -ne $LASTEXITCODE) {
      $exitCode = $LASTEXITCODE
    }
  } finally {
    Pop-Location
  }
  if ($exitCode -eq 0) {
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
Write-Host '- Performance gate checks p95 latency on /health (default p95 under 300ms)'
Write-Host '- Without Docker: npm run test:unit, or skip live API: $env:SKIP_LIVE_TESTS = 1; .\run_tests.ps1'
Write-Host '- If the API is down, docker compose up -d is run automatically (disable: RUN_TESTS_AUTOSTART_DOCKER=0)'

function Test-ApiHealthOk {
  param([string]$BaseTrimmed)
  try {
    $r = Invoke-WebRequest -Uri "$BaseTrimmed/health" -UseBasicParsing -TimeoutSec 15
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Ensure-LiveApiReady {
  $base = if ($env:API_BASE_URL) { $env:API_BASE_URL.TrimEnd('/') } else { 'http://localhost:3001/api/v1' }
  if (Test-ApiHealthOk -BaseTrimmed $base) {
    return
  }
  $autostart = $env:RUN_TESTS_AUTOSTART_DOCKER
  if ($null -eq $autostart) { $autostart = '1' }
  $local = ($base -match 'localhost|127\.0\.0\.1')
  if ($autostart -ne '1' -or -not $local) {
    Write-Host ""
    Write-Host "ERROR: API is not reachable at $base/health"
    Write-Host "Run: docker compose up -d   or set SKIP_LIVE_TESTS=1"
    exit 1
  }
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    Write-Host "ERROR: docker not found; install Docker Desktop or start the API manually."
    exit 1
  }
  Write-Host ""
  Write-Host "=== API not reachable — starting Docker Compose ==="
  Push-Location $PSScriptRoot
  try {
    docker compose up -d
    if ($LASTEXITCODE -ne 0) {
      Write-Host "ERROR: docker compose up -d failed."
      exit 1
    }
  } finally {
    Pop-Location
  }
  Write-Host "Waiting for $base/health (up to ~4 minutes)..."
  $waited = 0
  $maxWait = 120
  while ($waited -lt $maxWait) {
    if (Test-ApiHealthOk -BaseTrimmed $base) {
      Write-Host "API is healthy."
      return
    }
    Start-Sleep -Seconds 2
    $waited++
    if (($waited % 10) -eq 0) {
      Write-Host "  ... still waiting ($($waited * 2)s)"
    }
  }
  Write-Host "ERROR: API still not healthy. Try: docker compose logs -f app"
  exit 1
}

if (-not $ApiOnly) {
  Run-Suite -Name "Unit tests" -Command "npm run test:unit"
}

if ($env:SKIP_LIVE_TESTS -eq "1") {
  Write-Host ""
  Write-Host "=== Skipping live API checks (SKIP_LIVE_TESTS=1) ==="
  Write-Host "[SKIP] API tests - remove SKIP_LIVE_TESTS and start the stack to run them"
  Write-Host "[SKIP] Performance check"
} else {
  Ensure-LiveApiReady
  Run-Suite -Name "API tests" -Command "npm run test:api"
  Run-Suite -Name "Performance check" -Command "npm run test:perf"
}

Write-Host ""
Write-Host "=== Final Summary ==="
Write-Host "total=$total"
Write-Host "passed=$passed"
Write-Host "failed=$failed"

if ($failed -gt 0) {
  exit 1
}

exit 0
