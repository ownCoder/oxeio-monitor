#!/usr/bin/env bash
set -euo pipefail

release=/opt/oxeio-releases/pc-locked-20261005
source="$release/source/oxeio-monitor"
test "$(git -C /opt/oxeio rev-parse HEAD)" = 2e401d0bd00e23d5916cde9a864eddc211a6d675
test -z "$(tar -tf "$release/source.tar" | grep -vE '^(server/src/dashboard/dashboard.math.ts|server/test/dashboard.math.spec.ts|web/src/api/dashboard.ts|web/src/components/StatusDot.tsx|web/src/pages/live/TeamBars.tsx|web/src/pages/LiveBoardPage.tsx|web/test/onTheClock.spec.ts)$' || true)"
git -C /opt/oxeio archive HEAD oxeio-monitor | tar -xf - -C "$release/source"
tar -xf "$release/source.tar" -C "$source"

docker run --rm --network none -v "$source/server/src:/app/src:ro" \
  -v "$source/server/test:/app/test:ro" -v "$source/server/prisma:/app/prisma:ro" \
  oxeio-office-api-validation \
  sh -c 'npx prisma generate && npm run typecheck && npx eslint src/dashboard/dashboard.math.ts test/dashboard.math.spec.ts && npm run build && npx vitest run --config vitest.nodb.config.ts test/dashboard.math.spec.ts' \
  > "$release/api-validation.log" 2>&1

docker run --rm --network none -v "$source/web/src:/app/src:ro" \
  -v "$source/web/test:/app/test:ro" oxeio-office-web-validation \
  sh -c 'npm run typecheck && npx eslint src/api/dashboard.ts src/components/StatusDot.tsx src/pages/live/TeamBars.tsx src/pages/LiveBoardPage.tsx test/onTheClock.spec.ts && npm run build && npm test' \
  > "$release/web-validation.log" 2>&1
printf 'PC_LOCKED_VALIDATION_PASSED\n'
