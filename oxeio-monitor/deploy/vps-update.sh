#!/usr/bin/env bash
#
# oXeio — VPS-এ চলতি স্ট্যাক হালনাগাদ করা
#
# চালানো (VPS-এ root হিসেবে):
#     bash /opt/oxeio/oxeio-monitor/deploy/vps-update.sh
#
# ⭐ যা করে: git pull → দরকার হলে migration → রিবিল্ড → স্বাস্থ্য পরীক্ষা।
# ⭐ **বারবার চালানো নিরাপদ।** নতুন কিছু না থাকলে প্রায় কিছুই করে না।
#
# ⚠️⚠️ **seed চালানো হয় না — ইচ্ছাকৃতভাবে।** compose-এর `migrate` সার্ভিসটা
#    `migrate deploy && tsx prisma/seed.ts` — অর্থাৎ ওটা ডাকলে seed-ও চলে,
#    আর seed কর্মীদের **নাম, বেতন ও যোগদানের তারিখ upsert করে**।
#    হালনাগাদের সময় ওটা চললে ড্যাশবোর্ডে হাতে বসানো তথ্য ফাইলের পুরোনো
#    মান দিয়ে চাপা পড়ে যেত — নীরবে, আর সেটা সরাসরি বেতনের হিসাবে।
#    তাই এখানে শুধু `migrate deploy` ডাকা হয়, কমান্ডটা override করে।
#
# ⚠️ এই স্ক্রিপ্ট কোনো গোপন মান ছাপে না।

set -euo pipefail

DIR="${OXEIO_DIR:-/opt/oxeio}"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }
say() { printf '\n\033[36m── %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '   \033[33m⚠️  %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || die "root হিসেবে চালান (sudo -i)"
[ -d "$DIR/.git" ]   || die "$DIR-এ রিপো নেই — প্রথমবার হলে vps-setup.sh চালান"

# ⚠️⚠️ compose ফাইল রিপোর **রুটে নয়**, `oxeio-monitor/`-এর ভেতরে।
#    vps-setup.sh-এ এই ভুলটাই একবার হয়েছিল (09 § ৩শ · ফাঁদ ৫)।
COMPOSE_DIR="$DIR/oxeio-monitor"
[ -f "$COMPOSE_DIR/docker-compose.yml" ] || COMPOSE_DIR="$DIR"
[ -f "$COMPOSE_DIR/docker-compose.yml" ] || die "docker-compose.yml পাওয়া গেল না"

# ── ১· নতুন কোড ─────────────────────────────────────────────────────────────
say "১· নতুন কোড আনা"

cd "$DIR"
BEFORE="$(git rev-parse HEAD)"

# ⚠️ private রিপোতে git পাসওয়ার্ড চাইতে গিয়ে **ঝুলে যায়**, আর স্ক্রিপ্টটা
#    তখন কোনো বার্তা ছাড়াই আটকে থাকে (09 § ৩শ · ফাঁদ ৪)। এতে সে ঝুলবে না,
#    ব্যর্থ হবে — আর কারণটা বলা যাবে।
GIT_TERMINAL_PROMPT=0 git pull --ff-only \
  || die "git pull ব্যর্থ — deploy key ঠিক আছে কি না দেখুন (ssh -T git@github.com)"

AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  ok "নতুন কিছু নেই — কোড ইতিমধ্যেই সর্বশেষ"
else
  ok "$(git rev-list --count "$BEFORE..$AFTER")টি নতুন কমিট"
  git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/     /'
fi

# ── ২· migration ────────────────────────────────────────────────────────────
# ── ভার্সন ───────────────────────────────────────────────────────────────
# ⭐⭐ ভার্সনটা **git থেকে**, হাতে লেখা নয়।
#
#    `rev-list --count` প্রতি কমিটে ঠিক **এক** বাড়ে — তাই সংখ্যাটা সত্যিই
#    "প্রতিটা বদলে বাড়ে", আর কেউ বাড়াতে ভুলতে পারে না। ⚠️ হাতে বাড়ানো
#    সংখ্যা একদিন পিছিয়ে পড়ত, আর তখন পর্দা বলত নতুন কোড চলছে অথচ চলত
#    পুরোনোটা — ভুল ভার্সন না-থাকা ভার্সনের চেয়ে খারাপ।
#
# ⚠️ `export` — `docker compose` এগুলো `build.args`-এ পড়ে (docker-compose.yml)।
export APP_BUILD="$(git rev-list --count HEAD 2>/dev/null || echo dev)"
export APP_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ok "ভার্সন #$APP_BUILD · $APP_COMMIT"

say "২· ডাটাবেসের গড়ন"

cd "$COMPOSE_DIR"

# ⭐ শুধু তখনই চালানো হয় যখন `migrations/` সত্যিই বদলেছে। প্রতিবার চালানো
#    নিরাপদ হতো, কিন্তু প্রতিবার একটা কনটেইনার তৈরি হতো আর হালনাগাদ
#    অকারণে ধীর হতো।
#
# ⚠️⚠️ **`:/` উপসর্গটা বাধ্যতামূলক** — git-এর pathspec **CWD-সাপেক্ষ**, আর
#    ঠিক উপরে `cd "$COMPOSE_DIR"` হয়ে গেছে। উপসর্গ ছাড়া পথটা দাঁড়াত
#    `oxeio-monitor/oxeio-monitor/server/prisma/migrations` — যা কোথাও
#    নেই, তাই diff **সবসময় খালি**, আর স্ক্রিপ্ট সবসময় বলত "নতুন migration
#    নেই"। ⚠️ ব্যর্থতাটা ছিল সম্পূর্ণ নীরব ও সবুজ: ডিপ্লয় সফল দেখাত,
#    টেবিলটা বসত না, আর অ্যাপ প্রথম কোয়েরিতে গিয়ে ভাঙত।
#    ⭐ ধরা পড়েছে প্রথম আসল মাইগ্রেশনেই (R1, ১৫ আগস্ট) — এই স্ক্রিপ্ট
#    লেখার পর এর আগে কোনো মাইগ্রেশন যোগই হয়নি, তাই আগে কামড়ায়নি।
if [ "$BEFORE" != "$AFTER" ] \
   && ! git diff --quiet "$BEFORE" "$AFTER" -- :/oxeio-monitor/server/prisma/migrations; then
  warn "নতুন migration আছে — প্রয়োগ করা হচ্ছে"

  # ⚠️⚠️ কমান্ডটা **override** করা — নইলে compose-এর নিজের কমান্ড seed-ও
  #    চালাত, আর কর্মীদের নাম/বেতন/তারিখ ফাইলের মান দিয়ে চাপা পড়ত।
  docker compose --profile setup run --rm migrate \
    npx prisma migrate deploy \
    || die "migration ব্যর্থ — স্ট্যাক পুরোনো কোডেই চলছে, ডেটা অক্ষত"

  ok "migration প্রয়োগ হয়েছে"
else
  ok "নতুন migration নেই"
fi

# ⭐⭐ **দ্বিতীয় জাল — "স্কিপ করা হলো" আর "দরকার ছিল না" এক নয়।**
#
# ⚠️ উপরের শর্তটা একবার নীরবে ভুল হয়েছিল (pathspec, দেখুন উপরের নোট), আর
#    তখন ডিপ্লয় সবুজ দেখিয়ে টেবিল ছাড়াই এগিয়ে গিয়েছিল। তাই শর্তের উপর
#    ভরসা না করে **সরাসরি জিজ্ঞেস করা হয়** — কোনো migration বাকি আছে কি না।
#    `migrate status` বাকি থাকলে non-zero দেয়।
# ⚠️ এটা `die` নয়, `warn` — স্ট্যাক ইতিমধ্যে চলছে, আর এখানে থামলে
#    ব্যবহারকারী একটা অর্ধেক-হালনাগাদ অবস্থায় পড়তেন। কিন্তু বার্তাটা
#    জোরালো, কারণ পরের ধাপে অ্যাপ ভাঙতে পারে।
if ! docker compose --profile setup run --rm migrate \
     npx prisma migrate status >/dev/null 2>&1; then
  warn "⚠️ ডাটাবেসে এখনো কোনো migration বাকি আছে — অ্যাপ ভাঙতে পারে।"
  warn "   দেখুন:  docker compose --profile setup run --rm migrate npx prisma migrate status"
fi

# ── ৩· রিবিল্ড ──────────────────────────────────────────────────────────────
say "৩· ইমেজ তৈরি ও চালু"

# ⚠️ `--build` না দিলে পুরোনো ইমেজই চলত — কোড আসত, কিন্তু চলত না।
#    এটাই সবচেয়ে সহজে ঘটা ভুল: "pull করেছি তো, তবু বদলায়নি কেন?"
docker compose up -d --build

ok "কনটেইনার চালু"

# ── ৪· সত্যিই চলছে কি না ────────────────────────────────────────────────────
say "৪· স্বাস্থ্য পরীক্ষা"

# ⚠️ API উঠতে কয়েক সেকেন্ড লাগে। সাথে সাথেই পরীক্ষা করলে সুস্থ স্ট্যাককেও
#    "ভাঙা" বলা হতো, আর সেই ভুল বার্তা থেকে কেউ rollback করে বসতেন।
HEALTH=""
for _ in $(seq 1 20); do
  HEALTH="$(curl -fsS --max-time 3 http://127.0.0.1:3000/api/v1/health 2>/dev/null || true)"
  case "$HEALTH" in *'"status":"ok"'*) break ;; esac
  sleep 2
done

case "$HEALTH" in
  *'"status":"ok"'*)
    ok "API সাড়া দিচ্ছে — $HEALTH"
    ;;
  *)
    docker compose ps
    die "API ৪০ সেকেন্ডেও সাড়া দেয়নি। লগ দেখুন:  docker compose logs api --tail 60"
    ;;
esac

printf '\n\033[32m✅ হালনাগাদ শেষ\033[0m — %s\n\n' "$(git -C "$DIR" rev-parse --short HEAD)"
