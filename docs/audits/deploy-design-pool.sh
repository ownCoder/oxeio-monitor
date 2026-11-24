#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/design-pool-audit-20260928
cd /opt/oxeio
[ "$(git rev-parse --short HEAD)" = 352682c ]
git diff --quiet && git diff --cached --quiet
grep -q '138 passed' /tmp/pool-final-tests.log
grep -q '281 passed' /tmp/pool-web-final-tests.log
grep -q '8 passed' /tmp/pool-audit-final-tests.log
sha256sum --check "$release/backup.sha256"
export APP_BUILD="$(git rev-list --count HEAD)"
export APP_COMMIT="$(git rev-parse --short HEAD)"
[ "$(docker image inspect oxeio-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^APP_COMMIT=')" = "APP_COMMIT=$APP_COMMIT" ]
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build api web
for i in $(seq 1 25); do
 curl -fsS --max-time 3 http://127.0.0.1:3000/api/v1/health > "$release/health.json" || true
 if grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"; then break; fi
 sleep 2
done
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"
[ "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-container-before.txt")" ]
git rev-parse HEAD > /opt/oxeio/.git/oxeio-deployed-commit
docker tag oxeio-api oxeio-api:pool-audit-352682c
docker tag oxeio-web oxeio-web:pool-audit-352682c
git bundle create "$release/source.bundle" HEAD
cat "$release/health.json"
printf '\nPOOL_DEPLOYMENT_COMPLETE\n'
