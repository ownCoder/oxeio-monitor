#!/bin/bash
set -euo pipefail
curl -fsS https://hub.oxeio.com/ | grep -oE '/assets/index-[^" ]+\.js'
curl -s -o /dev/null -w 'skip-allowance HTTP %{http_code}\n' https://hub.oxeio.com/api/v1/me/targets/skip-allowance
docker rm -f -v oxeio-skip-test-db
docker network rm oxeio-skip-test-net
docker ps --format '{{.Names}} {{.Status}}'
