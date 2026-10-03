#!/usr/bin/env bash
set -euo pipefail

release=/opt/oxeio-releases/daily-design-page-20261003
source="$release/source/oxeio-monitor"
test "$(git -C /opt/oxeio rev-parse HEAD)" = a1b8b242f19e56ffa2552fedc304666269619caf
test -z "$(tar -tf "$release/source.tar" | grep -vE '^(web/src/App.tsx|web/src/components/Layout.tsx|web/src/pages/AllTargetsPage.tsx|web/src/pages/DailyDesignPage.tsx|web/src/pages/targets/Insights.tsx)$' || true)"
git -C /opt/oxeio archive HEAD oxeio-monitor | tar -xf - -C "$release/source"
tar -xf "$release/source.tar" -C "$source"
docker run --rm -v "$source/web/src:/app/src:ro" oxeio-office-web-validation \
  sh -c 'npm run typecheck && npx eslint src/App.tsx src/components/Layout.tsx src/pages/AllTargetsPage.tsx src/pages/DailyDesignPage.tsx src/pages/targets/Insights.tsx && npm run build && npm test' \
  > "$release/web-validation.log" 2>&1
printf 'DAILY_DESIGN_PAGE_VALIDATION_PASSED\n'
