#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/office-workflows-20260929
grep -q '293 passed' /tmp/office-final-web-tests.log
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = 36474c4
git diff --quiet && git diff --cached --quiet
for file in web/src/pages/office/OfficePage.tsx web/src/pages/office/office-view.ts web/test/office-view.spec.ts; do
 cp "$release/source/oxeio-monitor/$file" "oxeio-monitor/$file"
 git add "oxeio-monitor/$file"
done
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'ui: reset checks when loading a revised submission checklist'
export APP_BUILD="$(git rev-list --count HEAD)" APP_COMMIT="$(git rev-parse --short HEAD)" APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/office-checklist-release-build.log 2>&1
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
printf '\nOFFICE_FINAL_DEPLOYED\n'
