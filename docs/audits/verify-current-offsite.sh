#!/bin/bash
set -euo pipefail
umask 077
release=/opt/oxeio-releases/system-improvements-20260928
mkdir -p "$release/offsite"
# Reuse existing provider configuration; do not print keys or send Telegram messages.
cfgscript=$(mktemp /tmp/oxeio-offsite-config.XXXXXX)
passfile=$(mktemp /tmp/oxeio-offsite-key.XXXXXX)
trap 'rm -f "$cfgscript" "$passfile"' EXIT
python3 - "$cfgscript" <<'PY'
import sys
s=open('/opt/oxeio/oxeio-monitor/deploy/offsite-backup.sh').read()
prefix=s.split('# ── ১·')[0]
prefix=prefix.replace("set -euo pipefail", "set -euo pipefail")
open(sys.argv[1],'w').write(prefix)
PY
source "$cfgscript"
notify(){ :; }
test -n "$REMOTE"
filename=$(rclone lsf "$REMOTE" --files-only --log-level ERROR | grep -E '^oxeio-[0-9-]+[.]dump[.]enc$' | sort | tail -1)
test -n "$filename"
printf 'Existing latest offsite backup: %s\n' "$filename"
backup="$BACKUP_DIR/$filename"
# copy preserves older remote backups; this operation never prunes or sync-deletes.
rclone copyto "$REMOTE/$filename" "$release/offsite/$filename" --log-level ERROR
rclone copyto "$REMOTE/$filename.sha256" "$release/offsite/$filename.sha256" --log-level ERROR
test "$(sha256sum "$backup" | cut -d' ' -f1)" = "$(sha256sum "$release/offsite/$filename" | cut -d' ' -f1)"
docker exec oxeio-api printenv BACKUP_PASSPHRASE > "$passfile"
bash /tmp/verify-current-restore.sh "$release/offsite/$filename" "$passfile" "$release/restore-offsite-backup.json"
printf 'OFFSITE_COPY_DOWNLOAD_HASH_AND_RESTORE_VERIFIED\n'
