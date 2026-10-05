#!/usr/bin/env bash
set -euo pipefail

release=/opt/oxeio-releases/pc-locked-20261005
repo=/opt/oxeio
app="$repo/oxeio-monitor"
test "$(git -C "$repo" rev-parse HEAD)" = 2e401d0bd00e23d5916cde9a864eddc211a6d675
test "$(cat "$repo/.git/oxeio-deployed-commit")" = cad69e415f9bb67d695b70b884489cc3efb8f101
test -z "$(git -C "$repo" diff --cached --name-only)"
test -z "$(git -C "$repo" diff --name-only)"
grep -q 'Tests  50 passed (50)' "$release/api-validation.log"
grep -q 'Tests  296 passed (296)' "$release/web-validation.log"

docker inspect oxeio-postgres --format '{{.Id}}' > "$release/postgres-before.txt"
docker image tag oxeio-api:latest oxeio-api:before-pc-locked-20261005
docker image tag oxeio-web:latest oxeio-web:before-pc-locked-20261005

cat > "$release/source-files.txt" <<'FILES'
server/src/dashboard/dashboard.math.ts
server/test/dashboard.math.spec.ts
web/src/api/dashboard.ts
web/src/components/StatusDot.tsx
web/src/pages/LiveBoardPage.tsx
web/src/pages/live/TeamBars.tsx
web/test/onTheClock.spec.ts
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
  -m 'Show locked PCs separately from idle staff' > "$release/app-commit.log"
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
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' 'https://hub.oxeio.com/api/v1/live')" = 401
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
printf 'PC_LOCKED_DEPLOYED %s %s\n' "$APP_BUILD" "$(cat "$release/app-commit.txt")"
cat "$release/public-bundle.txt"
