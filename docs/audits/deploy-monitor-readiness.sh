#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/system-improvements-20260928
grep -q '46 passed' /tmp/system-readiness-tests.log
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = c1f949a
git diff --quiet && git diff --cached --quiet
docker tag oxeio-api oxeio-api:before-monitor-readiness-20260928
docker tag oxeio-web oxeio-web:before-monitor-readiness-20260928
cp "$release/source.bundle" "$release/source-421.bundle"
tar -xf "$release/monitor-readiness-source.tar"
git add oxeio-monitor/server/src/health/readiness.controller.ts oxeio-monitor/server/src/health/health.module.ts oxeio-monitor/server/test/readiness.spec.ts
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'feat: expose minimal DB and backup readiness probes for external monitoring'
export APP_BUILD="$(git rev-list --count HEAD)" APP_COMMIT="$(git rev-parse --short HEAD)" APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/system-readiness-release-build.log 2>&1
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build api web
for i in $(seq 1 25); do
 curl -fsS --max-time 3 https://hub.oxeio.com/api/v1/health > "$release/health.json" || true
 if grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"; then break; fi
 sleep 2
done
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"
curl -fsS https://hub.oxeio.com/api/v1/health/ready
curl -fsS https://hub.oxeio.com/api/v1/health/backup
test "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")"
git rev-parse HEAD > /opt/oxeio/.git/oxeio-deployed-commit
git bundle create "$release/source.bundle" HEAD
cat "$release/version.txt" "$release/health.json"
printf '\nMONITOR_READINESS_DEPLOYED\n'
