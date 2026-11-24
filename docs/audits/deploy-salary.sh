#!/bin/bash
set -euo pipefail
release=/opt/oxeio-releases/salary-20260930
repo=/opt/oxeio
app="$repo/oxeio-monitor"
cd "$repo"
test "$(git rev-parse --short HEAD)" = c6b92ac
test "$(cat .git/oxeio-deployed-commit)" = d9f312e11d460ff12cc723227487fd86d3d44496
test -z "$(git diff --name-only)"
test -z "$(git diff --cached --name-only)"
test -s "$release/before-release.dump.enc"
cmp "$release/upgrade-counts-before.json" "$release/upgrade-counts-after.json"
docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
docker image tag oxeio-api:latest oxeio-api:before-salary-20260930
docker image tag oxeio-web:latest oxeio-web:before-salary-20260930
while IFS= read -r file; do
  file="${file%$'\r'}"
  test -n "$file" || continue
  install -D -m 644 "$release/source/oxeio-monitor/$file" "$app/$file"
  git add "oxeio-monitor/$file"
done < "$release/salary-source-files.txt"
git diff --cached --check
git diff --cached --name-only > "$release/staged-files.txt"
sed 's#^#oxeio-monitor/#' "$release/salary-source-files.txt" | tr -d '\r' | sort > "$release/expected-files.txt"
diff -u "$release/expected-files.txt" "$release/staged-files.txt"
git -c user.name=Codex -c user.email=codex@local commit -m 'Add owner salary payment tracking' > "$release/app-commit.log"
git rev-parse HEAD > "$release/app-commit.txt"
git bundle create "$release/source.bundle" HEAD

cd "$app"
export APP_BUILD="$(git -C "$repo" rev-list --count HEAD)"
export APP_COMMIT="$(git -C "$repo" rev-parse --short HEAD)"
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > "$release/build.log" 2>&1
database_url=$(docker exec oxeio-api printenv DATABASE_URL)
test -n "$database_url"
docker run --rm --network oxeio_default -e DATABASE_URL="$database_url" \
  -v "$app/server/prisma:/app/prisma:ro" oxeio-office-api-validation \
  npx prisma migrate deploy > "$release/migrate.log" 2>&1
unset database_url
test "$(docker exec oxeio-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM salary_payments"')" = 0
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --no-deps api web > "$release/up.log" 2>&1
for i in $(seq 1 60); do
  api=$(docker inspect oxeio-api --format '{{.State.Health.Status}}' 2>/dev/null || true)
  web=$(docker inspect oxeio-web --format '{{.State.Health.Status}}' 2>/dev/null || true)
  if [ "$api" = healthy ] && [ "$web" = healthy ]; then break; fi
  sleep 2
done
test "$(docker inspect oxeio-api --format '{{.State.Health.Status}}')" = healthy
test "$(docker inspect oxeio-web --format '{{.State.Health.Status}}')" = healthy
test "$(docker inspect oxeio-postgres --format '{{.Id}}')" = "$(cat "$release/postgres-before.txt")"
curl -fsS https://hub.oxeio.com/ > "$release/public.html"
asset=$(grep -oE '/assets/index-[[:alnum:]_-]+\.js' "$release/public.html" | head -n 1)
test -n "$asset"
curl -fsS "https://hub.oxeio.com$asset" > "$release/public-app.js"
public_hash=$(sha256sum "$release/public-app.js" | cut -d' ' -f1)
container_hash=$(docker exec oxeio-web sha256sum "/srv$asset" | cut -d' ' -f1)
test "$public_hash" = "$container_hash"
printf '%s %s\n' "$asset" "$public_hash" > "$release/public-bundle.txt"
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' 'https://hub.oxeio.com/api/v1/payroll/salary?month=2026-09')" = 401
curl -fsS https://hub.oxeio.com/api/v1/health > "$release/public-health.json"
grep -q "\"build\":\"$APP_BUILD\"" "$release/public-health.json"
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/public-health.json"
cd "$app"
while IFS= read -r file; do
  file="${file%$'\r'}"
  test -n "$file" || continue
  sha256sum "$file"
done < "$release/salary-source-files.txt" > "$release/source-sha256.txt"
printf '%s\n' "$(cat "$release/app-commit.txt")" > "$repo/.git/oxeio-deployed-commit"
printf 'SALARY_DEPLOYED %s %s\n' "$APP_BUILD" "$(cat "$release/app-commit.txt")"
cat "$release/public-bundle.txt"
