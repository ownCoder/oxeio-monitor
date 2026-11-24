#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/workspace-tools-20260929
grep -q '24 passed' "$release/api-validation.log"
grep -q '293 passed' "$release/web-validation.log"
grep -q 'WORKSPACE_BACKUP_UPGRADE_PASSED' "$release/upgrade-drill.log"
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = 75e2270
git diff --quiet && git diff --cached --quiet
docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
docker tag oxeio-api oxeio-api:before-workspace-tools-20260929
docker tag oxeio-web oxeio-web:before-workspace-tools-20260929
while IFS= read -r file; do
 file="${file%$'\r'}"
 test -n "$file" || continue
 mkdir -p "$(dirname "oxeio-monitor/$file")"
 cp "$release/source/oxeio-monitor/$file" "oxeio-monitor/$file"
 git add "oxeio-monitor/$file"
done < "$release/workspace-files.txt"
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'feat: scoped workspace search notification inbox and deadline reminders'
export APP_BUILD="$(git rev-list --count HEAD)" APP_COMMIT="$(git rev-parse --short HEAD)" APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > "$release/build.log" 2>&1
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
