#!/bin/bash
set -euo pipefail
umask 077
release=/opt/oxeio-releases/system-improvements-20260928
mkdir -p "$release"
passfile=$(mktemp /tmp/oxeio-restore-key.XXXXXX)
trap 'rm -f "$passfile"' EXIT
docker exec oxeio-api printenv BACKUP_PASSPHRASE > "$passfile"
test -s "$passfile"
bash /tmp/verify-current-restore.sh /opt/oxeio/oxeio-monitor/.data/backups/oxeio-2026-09-28-0230.dump.enc "$passfile" "$release/restore-latest-backup.json"
