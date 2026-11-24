#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/system-improvements-20260928
asset=$(curl -fsS https://hub.oxeio.com/ | grep -oE '/assets/index-[^" ]+\.js' | head -1)
test -n "$asset"
public_hash=$(curl -fsS "https://hub.oxeio.com$asset" | sha256sum | cut -d' ' -f1)
container_hash=$(docker exec oxeio-web cat "/srv$asset" | sha256sum | cut -d' ' -f1)
test "$public_hash" = "$container_hash"
printf 'Public bundle: %s\nSHA256: %s\n' "$asset" "$public_hash" > "$release/public-bundle.txt"
curl -fsS https://hub.oxeio.com/api/v1/health > "$release/health.json"
grep -q '"commit":"cc34a36"' "$release/health.json"
test "$(curl -s -o /dev/null -w '%{http_code}' -I https://hub.oxeio.com/api/v1/health/ready)" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' -I https://hub.oxeio.com/api/v1/health/backup)" = 200
test "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")"
docker inspect oxeio-api oxeio-web oxeio-postgres --format '{{.Name}} {{.State.Health.Status}}'
cat "$release/public-bundle.txt" "$release/health.json"
printf '\nFINAL_RELEASE_VERIFIED\n'
