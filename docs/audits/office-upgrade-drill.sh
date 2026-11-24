#!/bin/bash
set -euo pipefail
umask 077
release=/opt/oxeio-releases/office-workflows-20260929
test "$(git -C /opt/oxeio rev-parse --short HEAD)" = 1aaa78d
docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
passfile=$(mktemp /tmp/oxeio-office-key.XXXXXX)
trap 'rm -f "$passfile"; docker rm -f oxeio-office-upgrade-db >/dev/null 2>&1 || true' EXIT
docker exec oxeio-api printenv BACKUP_PASSPHRASE > "$passfile"
test -s "$passfile"
docker exec oxeio-api sh -c 'pg_dump "${DATABASE_URL%%\?*}" --format=custom' | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 -pass "file:$passfile" -out "$release/before-release.dump.enc"
sha256sum "$release/before-release.dump.enc" > "$release/backup.sha256"
docker run -d --name oxeio-office-upgrade-db --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=upgrade_validation -e POSTGRES_PASSWORD=disposable-upgrade-only -e POSTGRES_DB=upgrade_validation postgres:16-alpine >/dev/null
until docker exec oxeio-office-upgrade-db pg_isready -U upgrade_validation >/dev/null; do sleep 1; done
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass "file:$passfile" -in "$release/before-release.dump.enc" | docker exec -i oxeio-office-upgrade-db pg_restore -U upgrade_validation -d upgrade_validation --no-owner --no-acl --exit-on-error
counts="SELECT json_build_object('employees',(SELECT count(*) FROM employees),'targets',(SELECT count(*) FROM design_targets),'monthly_rows',(SELECT count(*) FROM monthly_summary),'salary_periods',(SELECT count(*) FROM salary_periods),'closures',(SELECT count(*) FROM month_closures))"
docker exec oxeio-office-upgrade-db psql -U upgrade_validation -d upgrade_validation -Atc "$counts" > "$release/upgrade-counts-before.json"
docker run --rm --network container:oxeio-office-upgrade-db -e DATABASE_URL=postgresql://upgrade_validation:disposable-upgrade-only@127.0.0.1:5432/upgrade_validation oxeio-office-api-validation npx prisma migrate deploy > "$release/upgrade-migrations.log" 2>&1
docker exec oxeio-office-upgrade-db psql -U upgrade_validation -d upgrade_validation -Atc "$counts" > "$release/upgrade-counts-after.json"
cmp "$release/upgrade-counts-before.json" "$release/upgrade-counts-after.json"
docker exec oxeio-office-upgrade-db psql -U upgrade_validation -d upgrade_validation -Atc 'SELECT count(*) FROM office_entries' > "$release/upgrade-office-count.txt"
test "$(cat "$release/upgrade-office-count.txt")" = 0
printf 'ISOLATED_RETAINED_BACKUP_UPGRADE_PASSED\n'
