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
printf 'Configured destination: %s\n' "$REMOTE"

