#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/workspace-tools-20260929
mkdir -p "$release/source"
git -C /opt/oxeio archive HEAD oxeio-monitor | tar -xf - -C "$release/source"
tar -xf "$release/workspace-source.tar" -C "$release/source/oxeio-monitor"
source="$release/source/oxeio-monitor"
docker run -d --name oxeio-workspace-test-db --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=workspace_test -e POSTGRES_PASSWORD=disposable-tests-only -e POSTGRES_DB=workspace_test postgres:16-alpine > /dev/null
trap 'docker rm -f oxeio-workspace-test-db >/dev/null 2>&1 || true' EXIT
until docker exec oxeio-workspace-test-db pg_isready -U workspace_test >/dev/null; do sleep 1; done
docker run --rm --network container:oxeio-workspace-test-db -e DATABASE_URL=postgresql://workspace_test:disposable-tests-only@127.0.0.1:5432/workspace_test -e TEST_DATABASE_URL=postgresql://workspace_test:disposable-tests-only@127.0.0.1:5432/oxeio_test -v "$source/server/src:/app/src:ro" -v "$source/server/test:/app/test:ro" -v "$source/server/prisma:/app/prisma:ro" oxeio-office-api-validation sh -c 'npx prisma generate && npm run typecheck && npx eslint src/workspace src/office/office.service.ts src/office/office.module.ts test/workspace.e2e.spec.ts && npx vitest run test/workspace.e2e.spec.ts test/office.e2e.spec.ts test/production.e2e.spec.ts' > "$release/api-validation.log" 2>&1
docker run --rm -v "$source/web/src:/app/src:ro" oxeio-office-web-validation sh -c 'npx eslint src/pages/WorkspacePage.tsx src/components/Layout.tsx src/pages/office/OfficePage.tsx && npm run build && npm test' > "$release/web-validation.log" 2>&1
printf 'WORKSPACE_VALIDATION_PASSED\n'
