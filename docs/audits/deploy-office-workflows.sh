#!/bin/bash
set -euo pipefail
umask 077
release=/opt/oxeio-releases/office-workflows-20260929
grep -q '1254 passed' /tmp/office-final-nodb-tests.log
grep -q '292 passed' /tmp/office-final-web-tests.log
grep -q '7 passed' /tmp/office-final-api-tests.log
grep -q 'ISOLATED_RETAINED_BACKUP_UPGRADE_PASSED' /tmp/office-upgrade-drill.log
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = 1aaa78d
git diff --quiet && git diff --cached --quiet
test "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")"
docker tag oxeio-api oxeio-api:before-office-workflows-20260929
docker tag oxeio-web oxeio-web:before-office-workflows-20260929
tar -xf /tmp/office-final-source.tar
git add -A -- oxeio-monitor
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'feat: office briefs help checks learning assets and staff follow-up'
export APP_BUILD="$(git rev-list --count HEAD)" APP_COMMIT="$(git rev-parse --short HEAD)" APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/office-release-build.log 2>&1
docker compose -f docker-compose.yml -f docker-compose.vps.yml run --rm --no-deps api npx prisma migrate deploy > "$release/live-migrations.log" 2>&1
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
printf '\nOFFICE_WORKFLOWS_DEPLOYED\n'
