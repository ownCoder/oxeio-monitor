#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/design-pool-audit-20260928
curl -fsS --retry 5 --retry-delay 2 --retry-connrefused https://hub.oxeio.com/api/v1/health > "$release/public-health.json"
grep -q '"commit":"352682c"' "$release/public-health.json"
curl -fsS https://hub.oxeio.com/ > "$release/public-index.html"
asset="$(grep -oE '/assets/index-[^" ]+\.js' "$release/public-index.html" | head -1)"
[ -n "$asset" ]
curl -fsS "https://hub.oxeio.com$asset" > "$release/public-bundle.js"
grep -q '352682c' "$release/public-bundle.js"
grep -q 'Reset all filters' "$release/public-bundle.js"
grep -q 'Export this page' "$release/public-bundle.js"
grep -q 'Last 7 days' "$release/public-bundle.js"
[ "$(sha256sum "$release/public-bundle.js" | cut -d' ' -f1)" = "$(docker exec oxeio-web sha256sum "/srv$asset" | cut -d' ' -f1)" ]
cat "$release/public-health.json"
printf '\n%s\n' "$asset"
docker ps --format '{{.Names}} {{.Status}}'
printf 'PUBLIC_RELEASE_VERIFIED\n'
