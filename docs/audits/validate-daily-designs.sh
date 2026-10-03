#!/usr/bin/env bash
set -euo pipefail

release=/opt/oxeio-releases/daily-designs-20261003
source="$release/source/oxeio-monitor"
test "$(git -C /opt/oxeio rev-parse HEAD)" = 91336c9bc9882f386839819e2c1aa48cfed5b45c
git -C /opt/oxeio archive HEAD oxeio-monitor | tar -xf - -C "$release/source"
tar -xf "$release/source.tar" -C "$source"
test -z "$(tar -tf "$release/source.tar" | grep -vE '^(server/src/targets/target-insights.controller.ts|server/test/target-insights.e2e.spec.ts|web/src/api/targetInsights.ts|web/src/pages/AllTargetsPage.tsx|web/src/pages/targets/Insights.tsx)$' || true)"

docker run -d --name oxeio-daily-designs-test-db --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=daily_test -e POSTGRES_PASSWORD=disposable-tests-only \
  -e POSTGRES_DB=daily_test postgres:16-alpine > /dev/null
trap 'docker rm -f oxeio-daily-designs-test-db >/dev/null 2>&1 || true' EXIT
until docker exec oxeio-daily-designs-test-db pg_isready -U daily_test >/dev/null; do sleep 1; done

docker run --rm --network container:oxeio-daily-designs-test-db \
  -e DATABASE_URL=postgresql://daily_test:disposable-tests-only@127.0.0.1:5432/daily_test \
  -e STORAGE_ROOT=/tmp/oxeio-daily-designs-test-storage \
  -v "$source/server/src:/app/src:ro" -v "$source/server/test:/app/test:ro" \
  -v "$source/server/prisma:/app/prisma:ro" oxeio-office-api-validation \
  sh -c 'npx prisma generate && npm run typecheck && npx eslint src/targets/target-insights.controller.ts test/target-insights.e2e.spec.ts && npm run build && npx vitest run test/target-insights.e2e.spec.ts test/skip-review.e2e.spec.ts' \
  > "$release/api-validation.log" 2>&1

docker run --rm -v "$source/web/src:/app/src:ro" oxeio-office-web-validation \
  sh -c 'npm run typecheck && npx eslint src/api/targetInsights.ts src/pages/AllTargetsPage.tsx src/pages/targets/Insights.tsx && npm run build && npm test' \
  > "$release/web-validation.log" 2>&1
printf 'DAILY_DESIGNS_VALIDATION_PASSED\n'
