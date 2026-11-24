#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/remove-distribute-20260927
curl -fsS --retry 4 --retry-connrefused --retry-delay 2 https://hub.oxeio.com/api/v1/health > "$release/public-health.json"
grep -q '"commit":"b317bd9"' "$release/public-health.json"
curl -fsS https://hub.oxeio.com/ > "$release/public-index.html"
grep -q 'index-G1Uq8_G2.js' "$release/public-index.html"
curl -fsS https://hub.oxeio.com/assets/index-G1Uq8_G2.js > "$release/public-bundle.js"
! grep -q 'Distribute now' "$release/public-bundle.js"
grep -q 'Add to pool' "$release/public-bundle.js"
grep -q 'Distribution runs on its own at 8:00 every morning' "$release/public-bundle.js"
grep -q 'b317bd9' "$release/public-bundle.js"
[ "$(sha256sum "$release/public-bundle.js" | cut -d' ' -f1)" = "$(docker exec oxeio-web sha256sum /srv/assets/index-G1Uq8_G2.js | cut -d' ' -f1)" ]
cat "$release/public-health.json"
docker ps --format '{{.Names}} {{.Status}}'
printf '\nPAGE_CHANGE_VERIFIED\n'
