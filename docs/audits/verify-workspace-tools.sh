#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/workspace-tools-20260929
for i in $(seq 1 30); do
 if test "$(docker inspect oxeio-web --format '{{.State.Health.Status}}')" = healthy; then break; fi
 sleep 2
done
test "$(docker inspect oxeio-web --format '{{.State.Health.Status}}')" = healthy
test "$(docker inspect oxeio-api --format '{{.State.Health.Status}}')" = healthy
curl -fsS https://hub.oxeio.com/ > "$release/public.html"
asset=$(grep -oE '/assets/index-[[:alnum:]_-]+\.js' "$release/public.html" | head -n 1)
test -n "$asset"
curl -fsS "https://hub.oxeio.com$asset" > "$release/public-app.js"
public_hash=$(sha256sum "$release/public-app.js" | cut -d' ' -f1)
container_hash=$(docker exec oxeio-web sha256sum "/srv$asset" | cut -d' ' -f1)
test "$public_hash" = "$container_hash"
printf '%s %s\n' "$asset" "$public_hash" > "$release/public-bundle.txt"
for endpoint in search?q=sample inbox deadlines; do
 test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://hub.oxeio.com/api/v1/workspace/$endpoint")" = 401
done
cd /opt/oxeio/oxeio-monitor
while IFS= read -r file; do
 file="${file%$'\r'}"
 test -n "$file" || continue
 sha256sum "$file"
done < "$release/workspace-files.txt" > "$release/source-sha256.txt"
test "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")"
cat "$release/public-bundle.txt"
curl -fsS https://hub.oxeio.com/api/v1/health
printf '\nPUBLIC_BUNDLE_AND_AUTH_VERIFIED\n'
