#!/usr/bin/env bash
# Everything that must pass before a commit. Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
npm test --silent
npm run typecheck --silent
npm run bundle -w @hub/backend --silent
npm run build -w @hub/web --silent
terraform fmt -check -recursive infra
echo "ALL CHECKS PASSED"
