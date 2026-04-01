#!/usr/bin/env bash
# On Windows, Docker BuildKit often fails with "invalid file request Dockerfile" (and ~31B transferred)
# when the repo is under OneDrive; the classic builder avoids that.
#
# You may see: "configured to build using Bake, but buildkit isn't enabled" — Compose still builds with
# the classic builder; safe to ignore. Progress lines may interleave with npm logs in Git Bash.
set -euo pipefail
cd "$(dirname "$0")"
export DOCKER_BUILDKIT=0
exec docker compose build "$@"
