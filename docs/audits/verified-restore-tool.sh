#!/usr/bin/env bash
# Usage: bash verify-restore.sh encrypted.dump.enc passphrase-file evidence.json
# Only restores into a new network-isolated disposable container. No production URL is accepted.
set -euo pipefail
umask 077
if [ "$#" -ne 3 ]; then echo 'Usage: verify-restore.sh BACKUP PASSPHRASE_FILE EVIDENCE_JSON' >&2; exit 2; fi
backup=$(realpath -- "$1")
passfile=$(realpath -- "$2")
evidence=$(realpath -m -- "$3")
test -r "$backup" && test -r "$passfile" && test -r "$backup.sha256"
test "$evidence" != "$backup" && test "$evidence" != "$passfile" && test "$evidence" != "$backup.sha256"
if [ -e "$evidence" ]; then echo 'Choose a new evidence filename; existing evidence is preserved.' >&2; exit 2; fi
expected=$(awk 'NR==1 {print $1}' "$backup.sha256")
actual=$(sha256sum -- "$backup" | cut -d ' ' -f1)
if [[ ! "$expected" =~ ^[a-f0-9]{64}$ ]] || [ "$expected" != "$actual" ]; then echo 'Backup checksum mismatch.' >&2; exit 1; fi
container="oxeio-restore-drill-$(date +%s)-$$"
started=$(date -u +%FT%TZ)
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container" --label oxeio.purpose=restore-drill --network none --memory=1g --cpus=1 --tmpfs /var/lib/postgresql/data:rw,size=768m -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore_drill postgres:16-alpine >/dev/null
ready=false
for ((i=0; i<60; i++)); do
  if docker exec "$container" pg_isready -U postgres -d restore_drill >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then echo 'Isolated PostgreSQL did not start.' >&2; exit 1; fi
# pipefail catches wrong keys, truncated dumps and pg_restore failures. No plaintext file is written.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass "file:$passfile" -in "$backup" |
  docker exec -i "$container" pg_restore -U postgres -d restore_drill --exit-on-error --no-owner --no-acl
counts=$(docker exec "$container" psql -X -U postgres -d restore_drill -v ON_ERROR_STOP=1 -Atc "SELECT json_build_object('users',(SELECT count(*) FROM users),'employees',(SELECT count(*) FROM employees),'targets',(SELECT count(*) FROM design_targets),'migrations',(SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL),'invalidConstraints',(SELECT count(*) FROM pg_constraint WHERE NOT convalidated));")
python3 - "$evidence" "$actual" "$started" "$counts" <<'PY'
import datetime, json, sys
path, digest, started, raw = sys.argv[1:]
counts = json.loads(raw)
if counts['invalidConstraints'] or counts['migrations'] < 1:
    raise SystemExit('Restored schema integrity check failed.')
with open(path, 'x', encoding='utf-8') as file:
    json.dump(dict(outcome='verified', backupSha256=digest, startedAt=started,
                   finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   counts=counts, isolation='network-none disposable PostgreSQL 16; tmpfs data'), file, indent=2)
print('Restore verified. Evidence:', path)
PY
