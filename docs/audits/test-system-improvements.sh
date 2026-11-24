#!/bin/bash
set -euo pipefail
docker network create oxeio-system-test-net >/dev/null
trap 'docker rm -f -v oxeio-system-test-db >/dev/null 2>&1 || true; docker network rm oxeio-system-test-net >/dev/null 2>&1 || true' EXIT
docker run -d --name oxeio-system-test-db --network oxeio-system-test-net -e POSTGRES_PASSWORD=system-isolated-test -e POSTGRES_DB=system_test postgres:16-alpine -c fsync=off >/dev/null
for i in $(seq 1 30); do docker exec oxeio-system-test-db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network oxeio-system-test-net -e DATABASE_URL=postgresql://postgres:system-isolated-test@oxeio-system-test-db:5432/system_test oxeio-system-server-validation sh -c 'npx vitest run test/target-insights.e2e.spec.ts test/targets.e2e.spec.ts test/skip-review.e2e.spec.ts test/payroll.math.spec.ts test/proration.e2e.spec.ts test/deposits.e2e.spec.ts test/me.e2e.spec.ts test/reports.pdf.spec.ts test/reports.approximate-holidays.spec.ts test/leave.spec.ts' > /tmp/system-backend-tests.log 2>&1
printf 'SYSTEM_BACKEND_TESTS_PASSED\n'
