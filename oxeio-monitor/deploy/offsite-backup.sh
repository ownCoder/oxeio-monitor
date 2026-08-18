#!/usr/bin/env bash
#
# R5 · G39 — রাতের ব্যাকআপ **অফসাইটে** পাঠানো।
#
# ⭐ যা করে: `.data/backups`-এর নতুন ডাম্পগুলো `rclone` দিয়ে একটা দূরের
#    রিমোটে তোলে, পুরোনো কপি ছাঁটে, আর ফল টেলিগ্রামে জানায়।
#
# ⚠️⚠️ **কেন এটা দরকার, আর কেন K02 যথেষ্ট নয়:** রাতের ডাম্প আছে,
#    এনক্রিপটেড আছে, কিন্তু **সবই এক মেশিনে**। ওই ডিস্ক মরলে বা VPS
#    হারালে ব্যাকআপও সাথেই যায় — অর্থাৎ ব্যাকআপ থাকা আর ব্যাকআপ **কাজে
#    লাগা** এক নয়।
#
# ⭐⭐ **ফাইলগুলো আগে থেকেই এনক্রিপটেড** (`BACKUP_PASSPHRASE`, openssl enc)।
#    তাই Drive/S3 যেখানেই তুলুন, প্রোভাইডার কর্মীদের ঘণ্টা, বেতন বা
#    স্ক্রিনশটের কিছুই পড়তে পারে না — "ডেটা দেশের বাইরে যাবে না" নীতির
#    সাথে এটা সাংঘর্ষিক নয়।
#    ⚠️ কিন্তু এর মানে **পাসফ্রেজ হারালে ব্যাকআপও হারাল**। ওটা VPS-এর
#    বাইরে আলাদা করে রাখা মালিকের কাজ, আর সেটা এই স্ক্রিপ্টের বাইরে।
#
# ⚠️ **বারবার চালানো নিরাপদ** — `rclone copy` কেবল অনুপস্থিত ফাইল তোলে।
#
# চালানো:  bash deploy/offsite-backup.sh
# সেটআপ:   deploy/README.md § R5
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/oxeio/oxeio-monitor}"
BACKUP_DIR="${BACKUP_HOST_DIR:-$COMPOSE_DIR/.data/backups}"
REMOTE="${RCLONE_REMOTE:-}"
KEEP_WEEKS="${OFFSITE_KEEP_WEEKS:-8}"

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
say()  { printf '   %s✓%s %s\n' "$c_ok" "$c_off" "$1"; }
warn() { printf '   %s⚠%s %s\n' "$c_warn" "$c_off" "$1"; }
die()  { printf '\n%s❌ %s%s\n' "$c_err" "$1" "$c_off" >&2; notify "❌ Offsite backup failed — $1"; exit 1; }

# ── টেলিগ্রাম ────────────────────────────────────────────────────────────────
#
# ⚠️ টোকেন ও chat id পড়া হয় অ্যাপের নিজের `.env` থেকে — দ্বিতীয় জায়গায়
#    লিখলে একদিন একটা বদলে অন্যটা থেকে যেত, আর ব্যর্থতার খবরটাই হারাত।
# ⚠️ কনফিগ না থাকলে স্ক্রিপ্ট **থামে না**, শুধু চুপ থাকে: খবর না পাঠাতে
#    পারা কোনো কারণ নয় ব্যাকআপ না তোলার।
notify() {
  local text="$1" token chat
  [[ -f "$COMPOSE_DIR/.env" ]] || return 0
  token=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$COMPOSE_DIR/.env" | cut -d= -f2- || true)
  chat=$(grep -E '^TELEGRAM_CHAT_ID=' "$COMPOSE_DIR/.env" | cut -d= -f2- || true)
  [[ -n "$token" && -n "$chat" ]] || return 0
  curl -fsS -m 20 -X POST \
    "https://api.telegram.org/bot${token}/sendMessage" \
    -d "chat_id=${chat}" --data-urlencode "text=${text}" >/dev/null 2>&1 || true
}

printf '\n%s── R5 · অফসাইট ব্যাকআপ%s\n' "$c_dim" "$c_off"

# ── ০· পর্দায় বসানো কনফিগ (R5, ১৮ আগস্ট) ─────────────────────────────────
#
# ⭐⭐ B2-র কী এখন **ডাটাবেসে** বসে (Settings → Backup), তাই VPS-এ SSH করে
#    `rclone config` চালানোর দরকার নেই। ⚠️ পুরোনো পথও অটুট: `RCLONE_REMOTE`
#    আগে থেকে সেট থাকলে ডাটাবেস ছোঁয়াই হয় না।
#
# ⭐ কনফিগ ফাইল লেখা হয় না — rclone নিজেই `RCLONE_CONFIG_<নাম>_<ঘর>` চলক
#    পড়ে। ⚠️ ফলে key কখনো ডিস্কে বসে না, শুধু এই প্রসেসের পরিবেশে থাকে।
if [[ -z "${REMOTE}" ]] && command -v docker >/dev/null 2>&1; then
  # ⚠️ ডাটাবেসের নাম/ইউজার হোস্টের পরিবেশে থাকে না — compose-এর `.env`-এ
  #    থাকে, ঠিক যেমন টেলিগ্রামের টোকেন (`notify()` একই কাজ করে)।
  pg_user=$(grep -E '^POSTGRES_USER=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
  pg_db=$(grep -E '^POSTGRES_DB=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- || true)

  cfg=$(cd "$COMPOSE_DIR" 2>/dev/null && docker compose exec -T postgres psql -U "${pg_user:-oxeio}" -d "${pg_db:-oxeio}" -tAc "SELECT concat_ws('|', value->>'keyId', value->>'appKey', value->>'bucket') FROM settings WHERE key = 'ops.offsite'" 2>/dev/null | tr -d '[:space:]' || true)

  IFS='|' read -r db_id db_key db_bucket <<< "${cfg:-}"

  if [[ -n "${db_id:-}" && -n "${db_key:-}" && -n "${db_bucket:-}" ]]; then
    export RCLONE_CONFIG_B2_TYPE=b2
    export RCLONE_CONFIG_B2_ACCOUNT="$db_id"
    export RCLONE_CONFIG_B2_KEY="$db_key"
    export RCLONE_CONFIG_B2_HARD_DELETE=false
    REMOTE="b2:${db_bucket}"
    unset db_id db_key db_bucket cfg
    say 'কনফিগ পর্দা থেকে (Settings → Backup)'
  fi
fi

# ── ১· যা ছাড়া চলবে না ───────────────────────────────────────────────────────
command -v rclone >/dev/null 2>&1 || die \
  'rclone নেই। বসান: curl https://rclone.org/install.sh | sudo bash'

[[ -n "$REMOTE" ]] || die \
  'কোনো অফসাইট গন্তব্য বসানো নেই — ড্যাশবোর্ডে Settings → Backup-এ B2-র কী বসান (অথবা RCLONE_REMOTE দিন)'

[[ -d "$BACKUP_DIR" ]] || die "ব্যাকআপ ফোল্ডার নেই: $BACKUP_DIR"

# ⚠️⚠️ **ফোল্ডার আছে আর ফোল্ডারে ডাম্প আছে — দুটো আলাদা।** খালি ফোল্ডার
#    পেয়ে "সফল" বলে বেরিয়ে গেলে স্ক্রিপ্টটা রোজ সবুজ দেখাত, অথচ অফসাইটে
#    কিছুই যেত না। এটাই এই প্রকল্পের সবচেয়ে চেনা নীরব ব্যর্থতা (G129, G133)।
count=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump.enc' -type f | wc -l)
[[ "$count" -gt 0 ]] || die \
  "$BACKUP_DIR-এ একটাও ডাম্প নেই — রাতের ব্যাকআপ (K02) কি চলছে?"
say "$count টা ডাম্প পাওয়া গেল"

# ── ২· রিমোট সত্যিই পৌঁছানো যায় কি না ────────────────────────────────────────
#
# ⚠️ আগে যাচাই করা হয়, কারণ `rclone copy` ভুল রিমোটেও **সফল** দেখাতে পারে
#    (নতুন ফোল্ডার বানিয়ে ফেলে)। "পৌঁছেছি" আর "ঠিক জায়গায় পৌঁছেছি" এক নয়।
rclone lsd "$REMOTE" >/dev/null 2>&1 || rclone mkdir "$REMOTE" >/dev/null 2>&1 || die \
  "রিমোটে পৌঁছানো যাচ্ছে না: $REMOTE (rclone config দিয়ে যাচাই করুন)"
say "রিমোট পৌঁছানো যাচ্ছে — $REMOTE"

# ── ৩· তোলা ──────────────────────────────────────────────────────────────────
#
# ⭐ `copy`, `sync` **নয়** — এটাই এখানকার সবচেয়ে জরুরি সিদ্ধান্ত।
# ⚠️⚠️ `sync` রিমোটকে উৎসের হুবহু নকল বানায়, অর্থাৎ **সার্ভারের ডিস্ক মুছে
#    গেলে পরের রানেই অফসাইট কপিও মুছে যেত** — ঠিক সেই মুহূর্তে, যখন ওটাই
#    একমাত্র বাকি কপি। ছাঁটাই নিচে আলাদা করে, বয়স ধরে।
before=$(rclone size "$REMOTE" --json 2>/dev/null | grep -o '"count":[0-9]*' | cut -d: -f2 || echo 0)

rclone copy "$BACKUP_DIR" "$REMOTE" \
  --include '*.dump.enc' --include '*.sha256' --include 'README-restore.txt' \
  --transfers 2 --retries 3 --stats-one-line --stats 30s \
  || die 'rclone copy ব্যর্থ'

after=$(rclone size "$REMOTE" --json 2>/dev/null | grep -o '"count":[0-9]*' | cut -d: -f2 || echo 0)
say "রিমোটে ফাইল: $before → $after"

# ── ৪· পুরোনো কপি ছাঁটা ──────────────────────────────────────────────────────
#
# ⚠️ ছাঁটাই **রিমোটের বয়স ধরে**, স্থানীয় ফোল্ডারের সাথে মিলিয়ে নয় — উপরের
#    `sync`-এর ফাঁদটাই এখানে ফিরে আসত।
age_days=$(( KEEP_WEEKS * 7 ))
rclone delete "$REMOTE" --min-age "${age_days}d" --include '*.dump.enc*' 2>/dev/null || true
say "$KEEP_WEEKS সপ্তাহের পুরোনো কপি ছাঁটা হলো"

# ── ৫· খবর ───────────────────────────────────────────────────────────────────
newest=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump.enc' -type f -printf '%f\n' \
  | sort | tail -1)
size=$(du -sh "$BACKUP_DIR" | cut -f1)

notify "$(printf 'oXeio — offsite backup ok\n%s\nRemote: %s (%s files)\nLocal: %s' \
  "$newest" "$REMOTE" "$after" "$size")"

printf '\n%s✅ অফসাইট ব্যাকআপ শেষ%s — %s\n\n' "$c_ok" "$c_off" "$newest"
