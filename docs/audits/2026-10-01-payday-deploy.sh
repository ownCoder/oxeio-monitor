#!/usr/bin/env bash
set -euo pipefail

release=/opt/oxeio-releases/payday-20261001
repo=/opt/oxeio
app="$repo/oxeio-monitor"
cd "$repo"

test "$(git rev-parse HEAD)" = 022e23027aa377fd93332f1aaa79b9b7c0679659
test "$(cat .git/oxeio-deployed-commit)" = 3422cb7ea355b2903ac63ec3b87258da05bb349f
test -z "$(git diff --cached --name-only)"

cd "$app"
printf '%s\n' \
  '0e02e82a1985b8a9ba796b812e621509582573245381876b0727150e1bf05169  server/src/payroll/salary.service.ts' \
  '2c5129748e63fdc63ad73ac018b825c4e5edf3424d01bcb4e76d74cb59cda4c8  web/src/api/salary.ts' \
  '3b57a9ec64c95c8ba27a84dd3b4f52dc58ea05bdb25a0bc3df6d2510c2076c3c  web/src/pages/SalaryPage.tsx' \
  | sha256sum --check

docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
docker image tag oxeio-api:latest oxeio-api:before-payday-20261001
docker image tag oxeio-web:latest oxeio-web:before-payday-20261001

cat > "$release/source-files.txt" <<'FILES'
server/src/payroll/salary-payday.ts
server/src/payroll/salary.service.ts
server/test/salary-payday.spec.ts
web/src/api/salary.ts
web/src/pages/SalaryPage.tsx
FILES

while IFS= read -r file; do
  install -D -m 644 "$release/source/oxeio-monitor/$file" "$app/$file"
  git -C "$repo" add "oxeio-monitor/$file"
done < "$release/source-files.txt"

git -C "$repo" diff --cached --check
git -C "$repo" diff --cached --name-only > "$release/staged-files.txt"
sed 's#^#oxeio-monitor/#' "$release/source-files.txt" | sort > "$release/expected-files.txt"
diff -u "$release/expected-files.txt" "$release/staged-files.txt"

git -C "$repo" -c user.name=Codex -c user.email=codex@local commit \
  -m 'Show salary payday on the fifth of next month' > "$release/app-commit.log"
git -C "$repo" rev-parse HEAD > "$release/app-commit.txt"
git -C "$repo" bundle create "$release/source.bundle" HEAD

export APP_BUILD="$(git -C "$repo" rev-list --count HEAD)"
export APP_COMMIT="$(git -C "$repo" rev-parse --short HEAD)"
cd "$app"
docker compose -f docker-compose.yml -f docker-compose.vps.yml build api web > "$release/build.log" 2>&1
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

curl -fsS https://hub.oxeio.com/api/v1/health > "$release/public-health.json"
grep -q "\"build\":\"$APP_BUILD\"" "$release/public-health.json"
grep -q "\"commit\":\"$APP_COMMIT\"" "$release/public-health.json"
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' 'https://hub.oxeio.com/api/v1/payroll/salary?month=2026-09')" = 401
curl -fsS https://hub.oxeio.com/ > "$release/public.html"
asset=$(grep -oE '/assets/index-[[:alnum:]_-]+\.js' "$release/public.html" | head -n 1)
test -n "$asset"
curl -fsS "https://hub.oxeio.com$asset" > "$release/public-app.js"
public_hash=$(sha256sum "$release/public-app.js" | cut -d' ' -f1)
container_hash=$(docker exec oxeio-web sha256sum "/srv$asset" | cut -d' ' -f1)
test "$public_hash" = "$container_hash"
printf '%s %s\n' "$asset" "$public_hash" > "$release/public-bundle.txt"

while IFS= read -r file; do sha256sum "$file"; done < "$release/source-files.txt" > "$release/source-sha256.txt"
printf '%s\n' "$(cat "$release/app-commit.txt")" > "$repo/.git/oxeio-deployed-commit"
printf 'PAYDAY_DEPLOYED %s %s\n' "$APP_BUILD" "$(cat "$release/app-commit.txt")"
cat "$release/public-bundle.txt"
