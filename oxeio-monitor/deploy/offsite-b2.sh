#!/usr/bin/env bash
#
# R5 · G39 — **Backblaze B2 রিমোট এক কমান্ডে বাঁধা**।
#
# ⭐ কেন এই স্ক্রিপ্ট: `rclone config` ইন্টারঅ্যাকটিভ — n, নাম, স্টোরেজের
#    নম্বর, account, key, hard_delete, q … ছ-সাতটা ধাপ, আর একটা ভুল চাপলে
#    আবার গোড়া থেকে। এখানে সবটা এক লাইনে, আর শেষে **সত্যিই কাজ করছে কি না**
#    মিলিয়েও দেখা হয়।
#
# ⚠️⚠️ **কী দুটো কখনো আর্গুমেন্টে দেবেন না** (`bash offsite-b2.sh KEYID KEY`) —
#    আর্গুমেন্ট `ps`-এ দেখা যায়, আর bash history-তে থেকে যায়। স্ক্রিপ্ট
#    নিজেই জিজ্ঞেস করবে, আর টাইপ করার সময় পর্দায় কিছু দেখাবে না।
#
# ⚠️ কী কখনো লগে, echo-তে বা টেলিগ্রামে যায় না — নিচে কোথাও `set -x` নেই,
#    আর `rclone config create`-এর আউটপুটও চাপা দেওয়া।
#
# চালানো (VPS-এ root হিসেবে):
#     bash /opt/oxeio/oxeio-monitor/deploy/offsite-b2.sh
#
# ⭐ বারবার চালানো নিরাপদ — রিমোট আগেই থাকলে শুধু যাচাই করে এগোয়।

set -euo pipefail

REMOTE_NAME="${B2_REMOTE_NAME:-b2}"
BUCKET="${B2_BUCKET:-oxeio-backups}"
ENV_FILE="${OFFSITE_ENV:-/etc/oxeio-offsite.env}"

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
say()  { printf '   %s✓%s %s\n' "$c_ok" "$c_off" "$1"; }
warn() { printf '   %s⚠%s %s\n' "$c_warn" "$c_off" "$1"; }
die()  { printf '\n%s❌ %s%s\n\n' "$c_err" "$1" "$c_off" >&2; exit 1; }

printf '\n%s── R5 · Backblaze B2 রিমোট%s\n' "$c_dim" "$c_off"

[ "$(id -u)" -eq 0 ] || die "root হিসেবে চালান (sudo -i)"
command -v rclone >/dev/null 2>&1 || die \
  'rclone নেই। বসান: curl https://rclone.org/install.sh | sudo bash'

# ── ১· রিমোট আছে কি না ──────────────────────────────────────────────────────
if rclone listremotes 2>/dev/null | grep -qx "${REMOTE_NAME}:"; then
  say "রিমোট '${REMOTE_NAME}' আগে থেকেই আছে — নতুন করে বাঁধা হচ্ছে না"
else
  printf '\n   Backblaze-এর Application Key দুটো লাগবে।\n'
  printf '   %s(backblaze.com → B2 → Application Keys → Add a New Application Key)%s\n\n' "$c_dim" "$c_off"

  # ⚠️ `read -s` — টাইপ করার সময় পর্দায় কিছু দেখায় না, তাই কাঁধের উপর
  #    দিয়ে কেউ পড়তে পারে না, আর স্ক্রিন-শেয়ারেও যায় না।
  read -rp '   keyID          : ' B2_ID
  read -rsp '   applicationKey : ' B2_KEY; echo

  [ -n "${B2_ID}" ] && [ -n "${B2_KEY}" ] || die 'দুটোই লাগবে — কিছু বসানো হয়নি'

  # ⚠️ আউটপুট চাপা: rclone সফল হলে গোটা কনফিগটা ছাপে, আর তাতে key-ও থাকে।
  rclone config create "$REMOTE_NAME" b2 \
      account="$B2_ID" key="$B2_KEY" hard_delete=false >/dev/null 2>&1 \
    || die 'rclone config create ব্যর্থ'

  unset B2_ID B2_KEY
  say "রিমোট '${REMOTE_NAME}' বাঁধা হলো"
fi

# ── ২· সত্যিই পৌঁছানো যায় কি না ─────────────────────────────────────────────
#
# ⚠️⚠️ এই ধাপটা বাদ দেওয়া যাবে না। ভুল key দিয়েও `config create` **সফল**
#    হয় — সে কেবল ফাইলে লিখে রাখে, যাচাই করে না। ওখানে থেমে গেলে সব ঠিক
#    মনে হতো, আর ভুলটা ধরা পড়ত শনিবার রাতে, টাইমার ব্যর্থ হওয়ার পর।
rclone lsd "${REMOTE_NAME}:" >/dev/null 2>&1 \
  || die "কী দুটো দিয়ে B2-তে পৌঁছানো যাচ্ছে না — Application Key আবার দেখুন (rclone config delete ${REMOTE_NAME} দিয়ে মুছে আবার চালান)"
say 'B2-তে পৌঁছানো যাচ্ছে'

# ── ৩· bucket ───────────────────────────────────────────────────────────────
if rclone lsd "${REMOTE_NAME}:${BUCKET}" >/dev/null 2>&1; then
  say "bucket '${BUCKET}' পাওয়া গেল"
else
  warn "bucket '${BUCKET}' নেই — বানানো হচ্ছে"
  rclone mkdir "${REMOTE_NAME}:${BUCKET}" \
    || die "bucket বানানো গেল না — key-টার কি ওই bucket-এ write আছে?"
  say "bucket '${BUCKET}' বানানো হলো"
fi

# ── ৪· টাইমার যেটা পড়ে ─────────────────────────────────────────────────────
#
# ⚠️ `oxeio-offsite.service`-এ `EnvironmentFile=-/etc/oxeio-offsite.env`,
#    তাই RCLONE_REMOTE এখানেই বসাতে হয় — অ্যাপের `.env`-এ নয়।
if grep -q '^RCLONE_REMOTE=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s|^RCLONE_REMOTE=.*|RCLONE_REMOTE=${REMOTE_NAME}:${BUCKET}|" "$ENV_FILE"
else
  printf 'RCLONE_REMOTE=%s:%s\n' "$REMOTE_NAME" "$BUCKET" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"
say "${ENV_FILE}: RCLONE_REMOTE=${REMOTE_NAME}:${BUCKET}"

# ── ৫· এখনই একবার তুলে দেখা ─────────────────────────────────────────────────
#
# ⭐ শনিবারের অপেক্ষা করা হয় না। "কনফিগ করেছি" আর "ব্যাকআপ সত্যিই অফসাইটে
#    আছে" এক কথা নয়, আর পার্থক্যটা টের পাওয়ার সবচেয়ে খারাপ সময় হলো
#    যেদিন সার্ভার হারিয়ে যায়।
printf '\n%s── প্রথম আপলোড%s\n' "$c_dim" "$c_off"
set -a; . "$ENV_FILE"; set +a
bash "$(dirname "$0")/offsite-backup.sh"

printf '\n%s── রিমোটে যা আছে%s\n' "$c_dim" "$c_off"
rclone ls "${REMOTE_NAME}:${BUCKET}" | tail -20
printf '\n   মোট: %s\n' "$(rclone size "${REMOTE_NAME}:${BUCKET}" 2>/dev/null | tr '\n' ' ')"

printf '\n%s✅ B2 অফসাইট ব্যাকআপ চালু%s — শনিবার ০৪:০০-এ নিজে থেকেই যাবে\n\n' "$c_ok" "$c_off"
