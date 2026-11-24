#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/design-pool-audit-20260928
cd "$release/oxeio-monitor"
docker build --target build -t oxeio-pool-validation server > /tmp/pool-build.log 2>&1
docker network create oxeio-pool-test-net >/dev/null
docker run -d --name oxeio-pool-test-db --network oxeio-pool-test-net -e POSTGRES_PASSWORD=pool-isolated-test -e POSTGRES_DB=pool_test postgres:16-alpine >/dev/null
for i in $(seq 1 30); do docker exec oxeio-pool-test-db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network oxeio-pool-test-net -e DATABASE_URL=postgresql://postgres:pool-isolated-test@oxeio-pool-test-db:5432/pool_test oxeio-pool-validation sh -c 'npx vitest run test/targets.e2e.spec.ts test/targets-rules.spec.ts test/skip-review.e2e.spec.ts test/design-pool-audit.e2e.spec.ts' > /tmp/pool-tests.log 2>&1
printf 'POOL_TESTS_PASSED\n'
