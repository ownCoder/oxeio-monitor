#!/bin/sh
set -eu
docker network create oxeio-skip-test-net >/dev/null
docker run -d --name oxeio-skip-test-db --network oxeio-skip-test-net -e POSTGRES_PASSWORD=skip-isolated-test -e POSTGRES_DB=skip_test postgres:16-alpine >/dev/null
for i in $(seq 1 30); do docker exec oxeio-skip-test-db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network oxeio-skip-test-net -e DATABASE_URL=postgresql://postgres:skip-isolated-test@oxeio-skip-test-db:5432/skip_test oxeio-skip-validation sh -c 'npx vitest run test/skip-review.e2e.spec.ts test/targets-rules.spec.ts' > /tmp/skip-tests.log 2>&1
