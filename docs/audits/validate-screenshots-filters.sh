#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/screenshots-filters-20260930
mkdir -p "$release/source"
git -C /opt/oxeio archive HEAD oxeio-monitor | tar -xf - -C "$release/source"
tar -xf "$release/screenshots-filter-source.tar" -C "$release/source/oxeio-monitor"
source="$release/source/oxeio-monitor"
docker run -d --name oxeio-screenshots-test-db --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=screenshots_test -e POSTGRES_PASSWORD=disposable-tests-only -e POSTGRES_DB=screenshots_test postgres:16-alpine > /dev/null
trap 'docker rm -f oxeio-screenshots-test-db >/dev/null 2>&1 || true' EXIT
until docker exec oxeio-screenshots-test-db pg_isready -U screenshots_test >/dev/null; do sleep 1; done
docker run --rm --network container:oxeio-screenshots-test-db -e DATABASE_URL=postgresql://screenshots_test:disposable-tests-only@127.0.0.1:5432/screenshots_test -e STORAGE_ROOT=/tmp/oxeio-screenshots-test-storage -v "$source/server/src:/app/src:ro" -v "$source/server/test:/app/test:ro" -v "$source/server/prisma:/app/prisma:ro" oxeio-office-api-validation sh -c 'npx prisma generate && npm run typecheck && npx eslint src/screenshots/dto.ts src/screenshots/gallery.filters.ts src/screenshots/screenshots.service.ts test/screenshots-filters.e2e.spec.ts && npm run build && npx vitest run test/screenshots-filters.e2e.spec.ts test/screenshots-latest.e2e.spec.ts' > "$release/api-validation.log" 2>&1
docker run --rm -v "$source/web/src:/app/src:ro" oxeio-office-web-validation sh -c 'npx eslint src/pages/GalleryPage.tsx src/api/screenshots.ts && npm run build && npm test' > "$release/web-validation.log" 2>&1
printf 'SCREENSHOTS_FILTERS_VALIDATION_PASSED\n'
