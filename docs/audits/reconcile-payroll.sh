#!/bin/bash
set -euo pipefail
umask 077
release=/opt/oxeio-releases/system-improvements-20260928
passfile=$(mktemp /tmp/oxeio-payroll-key.XXXXXX)
cleanup() { rm -f "$passfile"; docker rm -f -v oxeio-payroll-review-db >/dev/null 2>&1 || true; docker network rm oxeio-payroll-review-net >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker exec oxeio-api printenv BACKUP_PASSPHRASE > "$passfile"
test -s "$passfile"
docker network create --internal oxeio-payroll-review-net >/dev/null
docker run -d --name oxeio-payroll-review-db --network oxeio-payroll-review-net --tmpfs /var/lib/postgresql/data:rw,size=768m --memory 1g -e POSTGRES_PASSWORD=isolated-review -e POSTGRES_DB=payroll_review postgres:16-alpine >/dev/null
for i in $(seq 1 30); do docker exec oxeio-payroll-review-db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass "file:$passfile" -in /opt/oxeio/oxeio-monitor/.data/backups/oxeio-2026-09-28-0230.dump.enc | docker exec -i oxeio-payroll-review-db pg_restore -U postgres -d payroll_review --no-owner --no-acl --exit-on-error
mkdir -p "$release/private-review"
chmod 700 "$release/private-review"
docker run --rm --network oxeio-payroll-review-net -e NODE_ENV=test -e JWT_SECRET=isolated-payroll-review-placeholder-32-characters -e DATABASE_URL=postgresql://postgres:isolated-review@oxeio-payroll-review-db:5432/payroll_review -v "$release/private-review:/review" -v /tmp/reconcile-payroll.cjs:/app/reconcile-payroll.cjs:ro oxeio-system-server-validation node /app/reconcile-payroll.cjs > "$release/payroll-reconciliation-summary.json"
chmod 600 "$release/private-review/payroll-review-2026-09.json"
cat "$release/payroll-reconciliation-summary.json"
