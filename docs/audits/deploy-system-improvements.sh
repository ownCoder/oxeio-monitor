#!/bin/bash
set -euo pipefail
umask 077
release=/opt/oxeio-releases/system-improvements-20260928
cd "$release/source"
tar -xf "$release/insights-source.tar"
docker build --target build -t oxeio-system-web-validation oxeio-monitor/web > /tmp/system-web-final-build.log 2>&1
docker run --rm oxeio-system-web-validation sh -c 'npx eslint src/pages/AllTargetsPage.tsx src/pages/targets/Insights.tsx src/pages/targets/SavedViews.tsx src/api/targetInsights.ts test/saved-views.spec.ts && npm test' > /tmp/system-web-final-tests.log 2>&1
grep -q '282 passed' /tmp/system-web-final-tests.log
grep -q '261 passed' /tmp/system-backend-tests.log
test "$(cat /tmp/system-backend-lint.log | wc -c)" = 0
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = 45a0086
git diff --quiet && git diff --cached --quiet
docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
docker tag oxeio-api oxeio-api:before-system-improvements-20260928
docker tag oxeio-web oxeio-web:before-system-improvements-20260928
passfile=$(mktemp /tmp/oxeio-release-key.XXXXXX)
trap 'rm -f "$passfile"' EXIT
docker exec oxeio-api printenv BACKUP_PASSPHRASE > "$passfile"
test -s "$passfile"
docker exec oxeio-api sh -c 'pg_dump "${DATABASE_URL%%\?*}" --format=custom' | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 -pass "file:$passfile" -out "$release/before-system-improvements.dump.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass "file:$passfile" -in "$release/before-system-improvements.dump.enc" | docker run --rm -i --network none postgres:16-alpine sh -c 'cat > /tmp/check.dump && pg_restore --list /tmp/check.dump' > "$release/backup-contents.txt"
test -s "$release/backup-contents.txt"
sha256sum "$release/before-system-improvements.dump.enc" > "$release/backup.sha256"
tar -xf "$release/insights-source.tar"
files=(oxeio-monitor/server/src/targets/target-insights.controller.ts oxeio-monitor/server/src/targets/targets.module.ts oxeio-monitor/server/test/target-insights.e2e.spec.ts oxeio-monitor/web/src/api/targetInsights.ts oxeio-monitor/web/src/pages/targets/Insights.tsx oxeio-monitor/web/src/pages/targets/SavedViews.tsx oxeio-monitor/web/src/pages/AllTargetsPage.tsx oxeio-monitor/web/test/saved-views.spec.ts)
git add -- "${files[@]}"
git -c core.whitespace=cr-at-eol diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'feat: add recorded skip insights, design history and saved pool views'
export APP_BUILD="$(git rev-list --count HEAD)" APP_COMMIT="$(git rev-parse --short HEAD)" APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/system-release-build.log 2>&1
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build api web
for i in $(seq 1 25); do
 curl -fsS --max-time 3 https://hub.oxeio.com/api/v1/health > "$release/health.json" || true
 if grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"; then break; fi
 sleep 2
done
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"
test "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")"
git rev-parse HEAD > /opt/oxeio/.git/oxeio-deployed-commit
git bundle create "$release/source.bundle" HEAD
cat "$release/version.txt" "$release/health.json"
printf '\nSYSTEM_IMPROVEMENTS_DEPLOYED\n'
