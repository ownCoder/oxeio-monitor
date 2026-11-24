#!/bin/bash
set -euo pipefail
cd /opt/oxeio
[ "$(git rev-parse HEAD)" = bc442197240a0ec7a01c46d1c8f07b659eb756d8 ]
git diff --quiet
git diff --cached --quiet
release=/opt/oxeio-releases/skip-review-20260927
files=(
oxeio-monitor/server/prisma/schema.prisma
oxeio-monitor/server/prisma/migrations/20260926010000_target_history/migration.sql
oxeio-monitor/server/prisma/migrations/20260927010000_skip_review_limit/migration.sql
oxeio-monitor/server/src/targets/targets.service.ts
oxeio-monitor/server/src/targets/targets.controller.ts
oxeio-monitor/server/src/targets/target-history.context.ts
oxeio-monitor/server/test/skip-review.e2e.spec.ts
oxeio-monitor/web/src/api/targets.ts
oxeio-monitor/web/src/pages/AllTargetsPage.tsx
oxeio-monitor/web/src/pages/MyTargets.tsx
oxeio-monitor/web/src/pages/ReviewPage.tsx
)
for f in "${files[@]}"; do mkdir -p "$(dirname "$f")"; cp "$release/$f" "$f"; done
git add -- "${files[@]}"
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m "feat: gate daily designer skips behind manager review"
export APP_BUILD="$(git rev-list --count HEAD)"
export APP_COMMIT="$(git rev-parse --short HEAD)"
export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker tag oxeio-api oxeio-api:before-skip-review-20260927
docker tag oxeio-web oxeio-web:before-skip-review-20260927
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/skip-release-build.log 2>&1
printf 'RELEASE_BUILD_COMPLETE\n'
