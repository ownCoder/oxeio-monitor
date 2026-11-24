#!/bin/bash
set -euo pipefail
cd /opt/oxeio
[ "$(git rev-parse --short HEAD)" = c37ec84 ]
git diff --quiet && git diff --cached --quiet
release=/opt/oxeio-releases/design-pool-audit-20260928
files=(
oxeio-monitor/server/src/targets/targets.controller.ts
oxeio-monitor/server/src/targets/targets.service.ts
oxeio-monitor/server/test/design-pool-audit.e2e.spec.ts
oxeio-monitor/web/src/api/targets.ts
oxeio-monitor/web/src/pages/AllTargetsPage.tsx
oxeio-monitor/web/src/pages/targets/export.ts
oxeio-monitor/web/test/targets-export.spec.ts
)
for f in "${files[@]}"; do mkdir -p "$(dirname "$f")"; cp "$release/$f" "$f"; done
git add -- "${files[@]}"
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m "fix: secure Design Pool actions and simplify filtering and export"
export APP_BUILD="$(git rev-list --count HEAD)"
export APP_COMMIT="$(git rev-parse --short HEAD)"
export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
docker tag oxeio-api oxeio-api:before-pool-audit-20260928
docker tag oxeio-web oxeio-web:before-pool-audit-20260928
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/pool-release-build.log 2>&1
printf 'POOL_RELEASE_BUILD_COMPLETE\n'
