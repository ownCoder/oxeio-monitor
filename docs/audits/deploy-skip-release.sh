#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/skip-review-20260927
cd /opt/oxeio
[ "$(git rev-parse --short HEAD)" = 5dd3783 ]
git diff --quiet
git diff --cached --quiet
[ -s "$release/backup.sha256" ]
sha256sum --check "$release/backup.sha256"
export APP_BUILD="$(git rev-list --count HEAD)"
export APP_COMMIT="$(git rev-parse --short HEAD)"
export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$(docker image inspect oxeio-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^APP_COMMIT=')" = "APP_COMMIT=$APP_COMMIT" ]
cd oxeio-monitor
printf 'services:\n  migrate:\n    image: oxeio-skip-validation\n' > "$release/migrate-image.yml"
docker compose -f docker-compose.yml -f docker-compose.vps.yml -f "$release/migrate-image.yml" run --rm --no-deps migrate npx prisma migrate deploy
docker compose -f docker-compose.yml -f docker-compose.vps.yml -f "$release/migrate-image.yml" run --rm --no-deps migrate npx prisma migrate status
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps --no-build api web
for i in $(seq 1 25); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/v1/health > "$release/health.json"; then
    if grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"; then break; fi
  fi
  sleep 2
done
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/health.json"
[ "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-container-before.txt")" ]
git rev-parse HEAD > /opt/oxeio/.git/oxeio-deployed-commit
docker tag oxeio-api oxeio-api:skip-review-5dd3783
docker tag oxeio-web oxeio-web:skip-review-5dd3783
cat "$release/health.json"
printf '\nDEPLOYMENT_COMPLETE\n'
