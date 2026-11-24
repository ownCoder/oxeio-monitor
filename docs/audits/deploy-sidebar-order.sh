#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/sidebar-order-20260929
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = d73ec16
git diff --quiet && git diff --cached --quiet
docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
docker tag oxeio-api:latest oxeio-api:before-sidebar-order-20260929
docker tag oxeio-web:latest oxeio-web:before-sidebar-order-20260929
cp "$release/Layout.tsx" oxeio-monitor/web/src/components/Layout.tsx
cd oxeio-monitor
docker run --rm -v "$PWD/web/src/components/Layout.tsx:/app/src/components/Layout.tsx:ro" oxeio-office-web-validation sh -c 'npx eslint src/components/Layout.tsx && npm run typecheck' > "$release/validation.log" 2>&1
cd ..
git add oxeio-monitor/web/src/components/Layout.tsx
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'ui: move Office and Production to the bottom of navigation'
export APP_BUILD="$(git rev-list --count HEAD)" APP_COMMIT="$(git rev-parse --short HEAD)" APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > "$release/build.log" 2>&1
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build api web
for i in $(seq 1 30); do
 curl -fsS --max-time 3 https://hub.oxeio.com/api/v1/health > "$release/health.json" || true
 if grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"; then break; fi
 sleep 2
done
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"
test "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")"
git rev-parse HEAD > /opt/oxeio/.git/oxeio-deployed-commit
cat "$release/version.txt" "$release/health.json"
