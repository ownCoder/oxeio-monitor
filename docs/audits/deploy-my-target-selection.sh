#!/bin/bash
set -euo pipefail
umask 077
release=/opt/oxeio-releases/my-target-selection-20260929
grep -q '285 passed' /tmp/my-target-selection-tests.log
cd /opt/oxeio
test "$(git rev-parse --short HEAD)" = 502ed0c
git diff --quiet && git diff --cached --quiet
docker tag oxeio-api oxeio-api:before-my-target-selection-20260929
docker tag oxeio-web oxeio-web:before-my-target-selection-20260929
docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
passfile=$(mktemp /tmp/oxeio-target-selection-key.XXXXXX)
trap 'rm -f "$passfile"' EXIT
docker exec oxeio-api printenv BACKUP_PASSPHRASE > "$passfile"
test -s "$passfile"
docker exec oxeio-api sh -c 'pg_dump "${DATABASE_URL%%\?*}" --format=custom' | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 -pass "file:$passfile" -out "$release/before-release.dump.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass "file:$passfile" -in "$release/before-release.dump.enc" | docker run --rm -i --network none postgres:16-alpine sh -c 'cat > /tmp/check.dump && pg_restore --list /tmp/check.dump' > "$release/backup-contents.txt"
test -s "$release/backup-contents.txt"
sha256sum "$release/before-release.dump.enc" > "$release/backup.sha256"
tar -xf /tmp/my-target-selection-source.tar
git add oxeio-monitor/web/src/pages/MyTargets.tsx oxeio-monitor/web/src/pages/targets/my-target-view.ts oxeio-monitor/web/test/my-target-view.spec.ts
git diff --cached --check
git -c user.name=Codex -c user.email=codex@local commit -m 'ui: retain selected personal design and order targets by job number'
export APP_BUILD="$(git rev-list --count HEAD)" APP_COMMIT="$(git rev-parse --short HEAD)" APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s %s\n' "$APP_BUILD" "$APP_COMMIT" > "$release/version.txt"
cd oxeio-monitor
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > /tmp/my-target-selection-release-build.log 2>&1
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
printf '\nMY_TARGET_SELECTION_DEPLOYED\n'
