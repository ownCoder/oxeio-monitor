#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/workspace-tools-20260929
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = 04974bb
git diff --quiet && git diff --cached --quiet
cp "$release/Layout.tsx" oxeio-monitor/web/src/components/Layout.tsx
docker run --rm -v "$PWD/oxeio-monitor/web/src:/app/src:ro" oxeio-office-web-validation sh -c 'npx eslint src/components/Layout.tsx && npm run build && npm test' > "$release/final-web-validation.log" 2>&1
grep -q '293 passed' "$release/final-web-validation.log"
git add oxeio-monitor/web/src/components/Layout.tsx
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'ui: keep inbox refresh listener dependencies explicit'
export APP_BUILD="$(git rev-list --count HEAD)" APP_COMMIT="$(git rev-parse --short HEAD)" APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > "$release/final-build.log" 2>&1
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build api web
for i in $(seq 1 30); do
 curl -fsS --max-time 3 https://hub.oxeio.com/api/v1/health > "$release/health.json" || true
 if grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"; then break; fi
 sleep 2
done
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"
test "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")"
git rev-parse HEAD > /opt/oxeio/.git/oxeio-deployed-commit
git bundle create "$release/source.bundle" HEAD
cat "$release/version.txt" "$release/health.json"
