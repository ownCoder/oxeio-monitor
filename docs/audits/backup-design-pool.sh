#!/bin/bash
set -euo pipefail
umask 077
release=/opt/oxeio-releases/design-pool-audit-20260928
export SKIP_BACKUP_PASSPHRASE="$(docker exec oxeio-api printenv BACKUP_PASSPHRASE)"
[ -n "$SKIP_BACKUP_PASSPHRASE" ]
docker exec oxeio-api sh -c 'pg_dump "${DATABASE_URL%%\?*}" --format=custom' | openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:SKIP_BACKUP_PASSPHRASE -out "$release/before-pool-audit.dump.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:SKIP_BACKUP_PASSPHRASE -in "$release/before-pool-audit.dump.enc" | docker run --rm -i postgres:16-alpine sh -c 'cat > /tmp/check.dump && pg_restore --list /tmp/check.dump' > "$release/backup-contents.txt"
unset SKIP_BACKUP_PASSPHRASE
[ -s "$release/backup-contents.txt" ]
docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-container-before.txt"
sha256sum "$release/before-pool-audit.dump.enc" > "$release/backup.sha256"
printf 'ENCRYPTED_BACKUP_VERIFIED\n'
