#!/usr/bin/env bash
#
# oXeio — VPS প্রথমবার দাঁড় করানো (ADR-026)
#
# চালানো (VPS-এ root হিসেবে):
#     bash deploy/vps-setup.sh hub.oxeio.com
#
# ⭐ যা করে: Docker · ফায়ারওয়াল · গোপন মান তৈরি · DNS যাচাই · স্ট্যাক তোলা।
# ⭐ **বারবার চালানো নিরাপদ** — যা আগে হয়ে গেছে তাতে হাত দেয় না, আর
#    `.env` একবার তৈরি হলে সেটা আর ছোঁয় না (গোপন মান বদলে যেত)।
#
# ⚠️ এই স্ক্রিপ্ট কোনো গোপন মান ছাপে না, একটা ছাড়া: প্রথমবার তৈরি হওয়া
#    owner পাসওয়ার্ড — সেটা একবারই দেখা যায়।

set -euo pipefail

PUBLIC_HOST="${1:-}"
REPO="${OXEIO_REPO:-https://github.com/ownCoder/oxeio-monitor.git}"
DIR="${OXEIO_DIR:-/opt/oxeio}"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }
say() { printf '\033[36m── %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '   \033[33m⚠️  %s\033[0m\n' "$*"; }

[ -n "$PUBLIC_HOST" ] || die "ডোমেইন দিন:  bash deploy/vps-setup.sh hub.oxeio.com"
[ "$(id -u)" -eq 0 ] || die "root হিসেবে চালান (sudo -i)"

# ── ১· Docker ────────────────────────────────────────────────────────────
say "১· Docker"
if command -v docker >/dev/null 2>&1; then
  ok "আগে থেকেই আছে — $(docker --version | cut -d, -f1)"
else
  curl -fsSL https://get.docker.com | sh
  ok "বসানো হলো"
fi
docker compose version >/dev/null 2>&1 || die "docker compose প্লাগইন নেই"

# ── ২· ফায়ারওয়াল ────────────────────────────────────────────────────────
say "২· ফায়ারওয়াল"
if command -v ufw >/dev/null 2>&1; then
  # ⚠️⚠️ SSH আগে — উল্টো করলে `ufw enable` চলার মুহূর্তে নিজের সংযোগটাই
  #    কেটে যায়, আর তখন VPS-এ ঢোকার আর কোনো পথ থাকে না (কনসোল ছাড়া)।
  ufw allow 22/tcp  >/dev/null
  ufw allow 80/tcp  >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  ok "২২ · ৮০ · ৪৪৩ খোলা"
  # ⚠️ ৫৪৩২ ও ৩০০০ ইচ্ছাকৃতভাবে বন্ধ — compose ওগুলো 127.0.0.1-এ বাঁধে,
  #    বাইরে থেকে নাগাল পাওয়ার কোনো কারণ নেই।
else
  warn "ufw নেই — প্রোভাইডারের ফায়ারওয়ালে ২২/৮০/৪৪৩ খুলে নিন"
fi

# ── ৩· কোড ───────────────────────────────────────────────────────────────
say "৩· কোড"

# ⚠️⚠️ `GIT_TERMINAL_PROMPT=0` — এটা না থাকলে **স্ক্রিপ্টটা ঝুলে যায়**।
#
#    রিপো private, তাই HTTPS দিয়ে clone করতে গেলে git চুপচাপ
#    `Username for 'https://github.com':` লিখে বসে থাকে — আর স্ক্রিপ্টের
#    ভেতরে সেটা দেখতে অদ্ভুত লাগে, মনে হয় কিছু একটা আটকে গেছে।
#    ⭐ ১৩ আগস্ট ঠিক এটাই ঘটেছে মালিকের প্রথম চেষ্টায়।
#
#    এখন ঝোলার বদলে সাথে সাথেই ব্যর্থ হয়, আর নিচে কী করতে হবে লেখা থাকে।
export GIT_TERMINAL_PROMPT=0

clone_help() {
  cat <<EOF

রিপোটা **private**, তাই বেনামে clone করা যায় না। deploy key বসান —
শুধু-পড়ার অনুমতি, শুধু এই রিপোর জন্য:

  ১· চাবি বানান ও দেখুন:
       ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "oxeio-vps" <<< y
       ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
       cat ~/.ssh/id_ed25519.pub

  ২· GitHub → রিপো → Settings → Deploy keys → Add deploy key
     (⚠️ "Allow write access" টিক দেবেন না)

  ৩· তারপর SSH ঠিকানা দিয়ে আবার:
       OXEIO_REPO=git@github.com:ownCoder/oxeio-monitor.git \
         bash $DIR/deploy/vps-setup.sh $PUBLIC_HOST
EOF
}

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only || die "pull ব্যর্থ — নেট বা অনুমতি দেখুন"
  ok "হালনাগাদ"
else
  if ! git clone --depth 1 "$REPO" "$DIR" 2>&1; then
    clone_help
    die "clone করা গেল না ($REPO)"
  fi
  ok "ক্লোন হলো → $DIR"
fi
cd "$DIR"

# ── ৪· DNS — **তোলার আগেই** ──────────────────────────────────────────────
#
# ⚠️⚠️ এই ধাপটা সবচেয়ে জরুরি, আর এটাই সবচেয়ে বেশি বাদ পড়ে।
#
#    DNS না ছড়ানো অবস্থায় স্ট্যাক তুললে Caddy Let's Encrypt-এর কাছে সার্ট
#    চাইবে, যাচাই ব্যর্থ হবে, আর বারবার চেষ্টা করতে থাকবে। ⚠️ LE-র ব্যর্থ
#    চেষ্টারও সীমা আছে (ঘণ্টায় ৫টা) — সীমা পেরোলে ডোমেইনটা **এক ঘণ্টা
#    আটকে যায়**, আর তখন DNS ঠিক করেও সাথে সাথে সার্ট পাওয়া যায় না।
say "৪· DNS যাচাই"
resolved="$(getent hosts "$PUBLIC_HOST" 2>/dev/null | awk '{print $1}' | head -1 || true)"
myip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"

[ -n "$resolved" ] || die "$PUBLIC_HOST কোথাও দেখাচ্ছে না। DNS ছড়াতে সময় লাগে (TTL ৭২০০ = ২ ঘণ্টা পর্যন্ত)। একটু পরে আবার চালান।"
ok "$PUBLIC_HOST → $resolved"

if [ -n "$myip" ] && [ "$resolved" != "$myip" ]; then
  die "DNS দেখাচ্ছে $resolved, কিন্তু এই সার্ভারের IP $myip — A রেকর্ডটা মিলিয়ে নিন।"
fi
[ -n "$myip" ] && ok "এই সার্ভারের IP-র সাথে মিলেছে"

# ── ৫· .env ──────────────────────────────────────────────────────────────
say "৫· .env"
OWNER_PW=""
if [ -f .env ]; then
  ok ".env আগে থেকেই আছে — ছোঁয়া হয়নি"
else
  cp .env.example .env

  # ⭐ গোপন মান এখানেই তৈরি — হাতে বসানোর সুযোগই থাকে না, তাই দুর্বল
  #    পাসওয়ার্ড বা কপি-পেস্ট করা পুরোনো মান ঢোকার পথ বন্ধ।
  gen() { openssl rand -base64 "$1" | tr -d '\n=+/' | cut -c1-"$2"; }
  PG_PW="$(gen 48 32)"
  JWT="$(gen 64 48)"
  SHOT="$(gen 48 32)"
  BACKUP="$(gen 48 32)"
  OWNER_PW="$(gen 24 16)"

  set_env() {
    # ⚠️ `|` ডিলিমিটার — base64-এ `/` থাকতে পারে, `sed s/…/…/` ভেঙে যেত
    sed -i "s|^$1=.*|$1=$2|" .env
  }
  set_env POSTGRES_PASSWORD "$PG_PW"
  set_env JWT_SECRET "$JWT"
  set_env SCREENSHOT_URL_SECRET "$SHOT"
  set_env BACKUP_PASSPHRASE "$BACKUP"
  set_env SEED_OWNER_PASSWORD "$OWNER_PW"
  set_env CORS_ORIGIN "https://$PUBLIC_HOST"

  # ⚠️ DATABASE_URL-এ পাসওয়ার্ডটা আবার বসাতে হয় — নইলে .env.example-এর
  #    নমুনা পাসওয়ার্ড থেকে যেত আর api ডাটাবেসে ঢুকতেই পারত না।
  pg_user="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)"
  pg_db="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-)"
  set_env DATABASE_URL "postgresql://$pg_user:$PG_PW@postgres:5432/$pg_db?schema=public"

  {
    echo ""
    echo "# ── VPS (vps-setup.sh বসিয়েছে) ──"
    echo "PUBLIC_HOST=$PUBLIC_HOST"
    echo "COMPOSE_FILE=docker-compose.yml:docker-compose.vps.yml"
  } >> .env

  chmod 600 .env
  ok "তৈরি — সব গোপন মান নতুন করে বানানো"
fi

# ── ৬· স্ট্যাক ───────────────────────────────────────────────────────────
say "৬· স্কিমা ও seed"
docker compose --profile setup run --rm migrate
ok "মাইগ্রেশন ও seed হয়ে গেছে"

say "৭· স্ট্যাক তোলা"
docker compose up -d
ok "উঠছে — Caddy এখন Let's Encrypt থেকে সার্ট নেবে"

# ── ৮· ফল ────────────────────────────────────────────────────────────────
printf '\n\033[32m✅ হয়ে গেছে\033[0m\n\n'
echo "   ড্যাশবোর্ড : https://$PUBLIC_HOST"
if [ -n "$OWNER_PW" ]; then
  owner_email="$(grep -E '^SEED_OWNER_EMAIL=' .env | cut -d= -f2-)"
  printf '\n   \033[33m⚠️  owner লগইন — এটা একবারই দেখানো হচ্ছে:\033[0m\n'
  echo "      $owner_email"
  echo "      $OWNER_PW"
  echo "   (প্রথম লগইনেই বদলাতে বলবে — সেটা ঠিক আচরণ)"
fi
printf '\n   সার্ট এলো কি না দেখতে:  docker compose logs -f web\n'
printf '   অবস্থা দেখতে        :  docker compose ps\n\n'
printf '   \033[33m⚠️ সার্ট আসতে ১০–৬০ সেকেন্ড লাগে। তার আগে ব্রাউজারে ভুল দেখাবে।\033[0m\n\n'
