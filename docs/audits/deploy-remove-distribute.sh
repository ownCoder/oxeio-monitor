#!/bin/bash
set -euo pipefail
cd /opt/oxeio
[ "$(git rev-parse --short HEAD)" = 5dd3783 ]
git diff --quiet && git diff --cached --quiet
cp /tmp/TargetsPage-no-distribute.tsx oxeio-monitor/web/src/pages/TargetsPage.tsx
git add oxeio-monitor/web/src/pages/TargetsPage.tsx
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m "ui: remove Distribute now from Add design targets"
export APP_BUILD="$(git rev-list --count HEAD)"
export APP_COMMIT="$(git rev-parse --short HEAD)"
export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
release=/opt/oxeio-releases/remove-distribute-20260927
mkdir -p "$release"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
docker tag oxeio-api oxeio-api:before-remove-distribute
docker tag oxeio-web oxeio-web:before-remove-distribute
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/remove-distribute-build.log 2>&1
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build api web
for i in $(seq 1 25); do
 curl -fsS --max-time 3 http://127.0.0.1:3000/api/v1/health > "$release/health.json" || true
 if grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"; then break; fi
 sleep 2
done
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"
git rev-parse HEAD > /opt/oxeio/.git/oxeio-deployed-commit
cat "$release/health.json"
