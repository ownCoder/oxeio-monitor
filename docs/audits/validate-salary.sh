#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/salary-20260930
mkdir -p "$release/source"
git -C /opt/oxeio archive HEAD oxeio-monitor | tar -xf - -C "$release/source"
tar -xf "$release/salary-source.tar" -C "$release/source/oxeio-monitor"
source="$release/source/oxeio-monitor"
docker run -d --name oxeio-salary-test-db --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=salary_test -e POSTGRES_PASSWORD=disposable-tests-only \
  -e POSTGRES_DB=salary_test postgres:16-alpine > /dev/null
trap 'docker rm -f oxeio-salary-test-db >/dev/null 2>&1 || true' EXIT
until docker exec oxeio-salary-test-db pg_isready -U salary_test >/dev/null; do sleep 1; done
docker run --rm --network container:oxeio-salary-test-db \
  -e DATABASE_URL=postgresql://salary_test:disposable-tests-only@127.0.0.1:5432/salary_test \
  -e STORAGE_ROOT=/tmp/oxeio-salary-test-storage \
  -v "$source/server/src:/app/src:ro" -v "$source/server/test:/app/test:ro" \
  -v "$source/server/prisma:/app/prisma:ro" oxeio-office-api-validation sh -c \
  'npx prisma generate && npx prisma migrate deploy && npm run typecheck && npx eslint src/payroll/payroll.controller.ts src/payroll/payroll.module.ts src/payroll/salary.dto.ts src/payroll/salary.service.ts src/audit/audit.service.ts test/salary-payments.e2e.spec.ts && npm run build && npx vitest run test/salary-payments.e2e.spec.ts test/proration.e2e.spec.ts' \
  > "$release/api-validation.log" 2>&1
docker run --rm -v "$source/web/src:/app/src:ro" oxeio-office-web-validation sh -c \
  'npx eslint src/api/salary.ts src/pages/SalaryPage.tsx src/App.tsx src/components/Layout.tsx src/pages/settings/AuditTab.tsx && npm run build && npm test' \
  > "$release/web-validation.log" 2>&1
printf 'SALARY_VALIDATION_PASSED\n'
