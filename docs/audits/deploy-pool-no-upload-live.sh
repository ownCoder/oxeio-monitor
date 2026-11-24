#!/bin/bash
set -euo pipefail
cd /opt/oxeio
[ "$(git rev-parse --short HEAD)" = 1ccec83 ]
git diff --quiet && git diff --cached --quiet
release=/opt/oxeio-releases/design-pool-no-upload-live-20260928
mkdir -p "$release"
docker tag oxeio-api oxeio-api:before-pool-no-upload-live-20260928
docker tag oxeio-web oxeio-web:before-pool-no-upload-live-20260928
docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
cp /tmp/AllTargetsPage-no-upload-live.tsx oxeio-monitor/web/src/pages/AllTargetsPage.tsx
cp /tmp/targets-no-upload-live.ts oxeio-monitor/web/src/api/targets.ts
git add oxeio-monitor/web/src/pages/AllTargetsPage.tsx oxeio-monitor/web/src/api/targets.ts
git -c core.whitespace=cr-at-eol diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m "ui: remove upload and live controls from Design Pool"
export APP_BUILD="$(git rev-list --count HEAD)"
export APP_COMMIT="$(git rev-parse --short HEAD)"
export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker build --target build -t oxeio-pool-no-upload-live-validation web > /tmp/pool-no-upload-live-validation.log 2>&1
docker run --rm oxeio-pool-no-upload-live-validation npx eslint src/pages/AllTargetsPage.tsx src/api/targets.ts >> /tmp/pool-no-upload-live-validation.log 2>&1
docker run --rm oxeio-pool-no-upload-live-validation npm test >> /tmp/pool-no-upload-live-validation.log 2>&1
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/pool-no-upload-live-build.log 2>&1
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build api web
for i in $(seq 1 25); do
 curl -fsS --max-time 3 https://hub.oxeio.com/api/v1/health > "$release/health.json" || true
 if grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"; then break; fi
 sleep 2
done
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"
[ "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")" ]
git rev-parse HEAD > /opt/oxeio/.git/oxeio-deployed-commit
git bundle create "$release/source.bundle" HEAD
cat "$release/version.txt" "$release/health.json"
printf '\nPOOL_UI_DEPLOYED\n'
