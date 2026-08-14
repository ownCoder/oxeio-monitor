#!/usr/bin/env bash
#
# oXeio — VPS শক্ত করা (roadmap R6)
#
# চালানো (VPS-এ root হিসেবে):
#     bash /opt/oxeio/oxeio-monitor/deploy/vps-harden.sh
#
# ⚠️ পাথে `oxeio-monitor/` অংশটা বাদ দেবেন না — রিপোর রুটে এই স্ক্রিপ্টটা
#    নেই, ওটা এক ধাপ ভেতরে।
#
# ⭐ যা করে: fail2ban (SSH — ২২ **ও ২২২২**) · শুধু-নিরাপত্তার স্বয়ংক্রিয়
#    আপডেট · আর শেষে **সত্যিই চালু আছে কি না** মিলিয়ে দেখা।
# ⭐ **বারবার চালানো নিরাপদ** — একই ফাইল একই বিষয়বস্তু দিয়ে লেখে, আর কিছু
#    না বদলালে সার্ভিস restart-ও করে না (restart-এর মুহূর্তে জেল ফাঁকা থাকে)।
#
# ⚠️⚠️ এই স্ক্রিপ্ট sshd-তে **হাত দেয় না** — পোর্ট বদলায় না, পাসওয়ার্ড-লগইন
#    বন্ধ করে না, ফায়ারওয়ালের নিয়ম মোছে না। ইচ্ছাকৃতভাবে: "শক্ত করা"-র
#    নামে নিজের দরজা বন্ধ করে ফেলাটা এই প্রকল্পে একবার প্রায় ঘটেছে
#    (README § ১২.৪ — ২২ পোর্ট বন্ধ, ফেরার পথ কেবল ওয়েব কনসোল)।
#
# ⚠️ এই স্ক্রিপ্ট কোনো গোপন মান ছাপে না।

set -euo pipefail

# ⭐ পোর্টগুলো চলক — sshd-র দরজা বদলালে স্ক্রিপ্ট এডিট না করেই দেওয়া যায়:
#     OXEIO_SSH_PORTS=22,2222,2022 bash deploy/vps-harden.sh
SSH_PORTS="${OXEIO_SSH_PORTS:-22,2222}"

# ⭐ নিজের স্থির IP থাকলে এখানে দিলে সে কখনো ব্যান খাবে না।
#    ⚠️ ডায়নামিক IP-তে এটা দেওয়ার মানে নেই — কাল অন্য কারো IP হবে।
IGNORE_EXTRA="${OXEIO_IGNOREIP:-}"

# ⚠️ ১ ঘণ্টা, চিরকাল নয় — কারণ নিচে জেল-ফাইলে লেখা আছে।
BANTIME="${OXEIO_BANTIME:-1h}"

# ⭐ কেন `jail.d/*.local`, সরাসরি `/etc/fail2ban/jail.local` নয়:
#    fail2ban ফাইলগুলো এই ক্রমে পড়ে — jail.conf → jail.d/*.conf →
#    jail.local → **jail.d/*.local**। অর্থাৎ এই ফাইলটাই শেষ কথা, তাই
#    ডিস্ট্রোর ডিফল্ট বা কারো হাতে লেখা jail.local-কে এটা ছাপিয়ে যায় —
#    অথচ সেই ফাইলগুলোর একটাও আমরা মুছি না।
JAIL_FILE=/etc/fail2ban/jail.d/oxeio-sshd.local

# ⚠️ ৫২ নম্বর — ডিস্ট্রোর `50unattended-upgrades`-এর **পরে** পড়া হবে, তাই
#    আমাদের মানগুলোই টিকে থাকে। ডিস্ট্রোর ফাইলটা ছোঁয়া হয় না, নইলে
#    পরের প্যাকেজ-আপগ্রেডে dpkg "conffile বদলে গেছে" বলে প্রশ্ন করত —
#    আর স্বয়ংক্রিয় আপগ্রেডের মাঝপথে প্রশ্ন মানে সেটা চিরকাল আটকে থাকা।
APT_FILE=/etc/apt/apt.conf.d/52oxeio-unattended-upgrades
APT_PERIODIC=/etc/apt/apt.conf.d/20auto-upgrades

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }
say() { printf '\n\033[36m── %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '   \033[33m⚠️  %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || die "root হিসেবে চালান (sudo -i)"
command -v apt-get >/dev/null 2>&1 || die "apt-get নেই — এই স্ক্রিপ্টটা Debian/Ubuntu-র জন্য লেখা"

# ⚠️ এটা না থাকলে apt মাঝপথে "কোন সংস্করণ রাখব?" বলে **ঝুলে যায়**, আর
#    স্ক্রিপ্টের ভেতরে সেই প্রশ্নটা দেখতে পাওয়াই যায় না।
#    (vps-setup.sh-এ git-এর সাথে ঠিক এই ভুলটাই একবার হয়েছিল।)
export DEBIAN_FRONTEND=noninteractive

TMPDIR_OX="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_OX"' EXIT

# ⭐ ফাইল বদলেছে কি না **আগে** দেখে তারপর লেখা — এতেই "বারবার চালানো
#    নিরাপদ" কথাটা সত্যি হয়। না দেখলে প্রতিবার mtime বদলাত, প্রতিবার
#    সার্ভিস restart হতো, আর restart-এর কয়েক সেকেন্ড জেল ফাঁকা থাকত।
CHANGED_JAIL=0
install_if_changed() {  # $1 = নতুন বিষয়বস্তুর temp ফাইল, $2 = গন্তব্য
  if [ -f "$2" ] && cmp -s "$1" "$2"; then
    return 1
  fi
  install -m 0644 "$1" "$2"
  return 0
}

# ── ১· প্যাকেজ ───────────────────────────────────────────────────────────
say "১· প্যাকেজ"

need=()
for p in fail2ban unattended-upgrades; do
  dpkg -s "$p" >/dev/null 2>&1 || need+=("$p")
done

if [ "${#need[@]}" -gt 0 ]; then
  apt-get update -qq >/dev/null 2>&1 \
    || warn "apt-get update ব্যর্থ — ক্যাশে থাকা তালিকা দিয়ে চেষ্টা চলছে"
  if ! apt-get install -y -qq "${need[@]}" >"$TMPDIR_OX/apt.log" 2>&1; then
    sed 's/^/     /' "$TMPDIR_OX/apt.log" >&2 || true
    die "বসানো গেল না: ${need[*]} — উপরের বার্তা দেখুন"
  fi
  ok "বসানো হলো — ${need[*]}"
else
  ok "fail2ban ও unattended-upgrades আগে থেকেই আছে"
fi

# ⚠️ fail2ban-এর systemd backend পাইথনের `systemd` মডিউল ছাড়া চলে না, আর
#    ওটা কেবল Recommends — `--no-install-recommends` দিয়ে বসানো হোস্টে
#    থাকে না। না থাকলে জেল **চালুই হয় না**, অথচ প্যাকেজ ঠিকই বসে থাকে।
#    তাই আগে বসানোর চেষ্টা, তারপর নিচে সত্যিই আছে কি না দেখে backend বাছা।
if ! python3 -c 'import systemd.journal' >/dev/null 2>&1; then
  apt-get install -y -qq python3-systemd >/dev/null 2>&1 || true
fi

# ── ২· লগ কোথায় — backend বাছা ───────────────────────────────────────────
say "২· sshd-র লগ কোথায়"

# ⚠️⚠️ এই ধাপটা বাদ দিলে জেলটা "enabled" দেখাত অথচ **কিছুই পড়ত না**।
#    দুটো বাস্তবতা আছে, আর কোনটা সত্যি সেটা হোস্টভেদে বদলায়:
#      · rsyslog আছে  → /var/log/auth.log-এ sshd-র ব্যর্থ লগইন লেখা হয়
#      · rsyslog নেই   → লগ শুধু journald-এ (Debian 12+ এ ডিফল্টই তাই)
#    ⭐ journald সব সময়ই থাকে, তাই সেটাই প্রথম পছন্দ — কিন্তু কেবল তখনই
#    যখন পাইথনের systemd মডিউলটা সত্যিই আছে, নইলে জেল দাঁড়াবে না।
F2B_LOGPATH=""
if python3 -c 'import systemd.journal' >/dev/null 2>&1; then
  F2B_BACKEND="systemd"
  ok "journald (backend = systemd)"
elif [ -s /var/log/auth.log ]; then
  F2B_BACKEND="auto"
  F2B_LOGPATH="/var/log/auth.log"
  ok "/var/log/auth.log (backend = auto)"
else
  # ⚠️ দুটোর একটাও নিশ্চিত করা গেল না। এটা "লগ নেই" নয়, "জানি না" —
  #    তাই systemd ধরে এগোনো হয়, আর § ৬-এর যাচাই সত্যিটা বলে দেবে।
  F2B_BACKEND="systemd"
  warn "auth.log নেই, python3-systemd-ও পাওয়া গেল না — systemd ধরে এগোনো হচ্ছে"
  warn "§ ৬-এর যাচাইয়ে জেল না দাঁড়ালে এখানেই কারণ"
fi

# ── ৩· জেল ───────────────────────────────────────────────────────────────
say "৩· SSH জেল"

IGNOREIP="127.0.0.1/8 ::1"
# ⚠️ `[ … ] && …` নয়, `if` — খালি IGNORE_EXTRA-তে `&&` মিথ্যা ফেরত দিত, আর
#    `set -e`-র নিচে সেটাই স্ক্রিপ্ট থামিয়ে দিত।
if [ -n "$IGNORE_EXTRA" ]; then
  IGNOREIP="$IGNOREIP $IGNORE_EXTRA"
fi

mkdir -p "$(dirname "$JAIL_FILE")"

# ⚠️⚠️ নিচের ফাইলে বাংলা কেবল `#` কমেন্ট লাইনে — **কোনো মানে (value) নয়**।
#    এই নিয়মটা বাধ্যতামূলক, কারণ jail ফাইলটা পড়ে fail2ban, পাইথনের
#    configparser দিয়ে, আর encoding না দিলে সেটা locale-নির্ভর। তিনটে
#    সম্ভাবনা হাতে যাচাই করা হয়েছে:
#      · utf-8   → ঠিক পড়ে
#      · latin-1 → বাংলা অক্ষরগুলো আবোল-তাবোল হয়, তবু `port`/`backend`
#                  ঠিকই আসে — কারণ ওগুলোর লাইন খাঁটি ASCII
#      · ascii   → UnicodeDecodeError, অর্থাৎ **জোরে** ব্যর্থ
#    ⭐ অর্থাৎ "নীরবে ভুল কনফিগ" বলে কোনো পথ নেই, আর জোরে ব্যর্থ হলে § ৪-এর
#    `fail2ban-client -t` সেটা restart-এর **আগেই** ধরে ফেলে।
#    ⚠️ কিন্তু বাংলা যদি কোনো মানে ঢোকে (যেমন কমেন্টে নয়, `action`-এ),
#    তখন latin-1 শাখাটা নীরবে ভুল মান দিত — তাই ঢোকাবেন না।

{
  cat <<EOF
# ⚠️ এই ফাইলটা deploy/vps-harden.sh লেখে — হাতে বদলালে পরের বার চালানোয়
#    বদলটা মুছে যাবে। স্থায়ী বদল দরকার হলে স্ক্রিপ্টটাই বদলান।

[DEFAULT]
# ⚠️⚠️ ব্যান **স্থায়ী নয়**, ইচ্ছাকৃতভাবে। \`bantime = -1\` লিখলে নিজের
#    ভুল টাইপ করা IP-ও চিরকালের জন্য আটকে যেত — আর তখন ফেরার একমাত্র পথ
#    প্রোভাইডারের ওয়েব কনসোল, যেটা ঠিক সেই মুহূর্তেই খুঁজতে হয় যখন হাতে
#    সময় নেই (README § ১২.৪খ)। এক ঘণ্টা ব্রুট-ফোর্স থামানোর জন্য যথেষ্ট,
#    আর নিজের ভুলের শাস্তি হিসেবে সহনীয়।
bantime  = $BANTIME
findtime = 10m
maxretry = 5
ignoreip = $IGNOREIP

[sshd]
enabled  = true

# ⚠️⚠️ **এই একটা লাইনই এই ফাইলের মূল কারণ।**
#    fail2ban-এর ডিফল্ট sshd জেলে লেখা থাকে \`port = ssh\`, আর \`ssh\`
#    /etc/services অনুযায়ী **কেবল ২২**। এই সার্ভারে sshd ২২২২-এও শোনে
#    (README § ১২.৪গ — ISP ২২ আটকায় বলে বিকল্প দরজা)। ডিফল্টে ছেড়ে দিলে
#    হার্ডেনিংটা **নীরবে অর্ধেক** হতো: ২২-এ ব্রুট-ফোর্স থামত, আর ২২২২-এ
#    যত খুশি চেষ্টা চলত — অথচ \`fail2ban-client status sshd\` দিব্যি
#    "সক্রিয়" দেখাত। ভুল আশ্বাস কোনো আশ্বাস না থাকার চেয়ে খারাপ।
port     = $SSH_PORTS

backend  = $F2B_BACKEND
EOF
  if [ -n "$F2B_LOGPATH" ]; then
    printf 'logpath  = %s\n' "$F2B_LOGPATH"
  fi
} > "$TMPDIR_OX/jail"

if install_if_changed "$TMPDIR_OX/jail" "$JAIL_FILE"; then
  CHANGED_JAIL=1
  ok "লেখা হলো → $JAIL_FILE  (পোর্ট $SSH_PORTS)"
else
  ok "আগের মতোই আছে → $JAIL_FILE  (পোর্ট $SSH_PORTS)"
fi

# ── ৩ক· ⚠️⚠️ Docker যেটা এই জেলের নাগালের বাইরে রাখে ─────────────────────
#
#    fail2ban ব্যান বসায় iptables-এর **INPUT** চেইনে (ufw-ও ওখানেই কাজ
#    করে)। হোস্টে চলা sshd-র প্যাকেট INPUT দিয়েই যায় — তাই SSH জেল
#    সত্যিই কাজ করে, আর § ৬ক-এ সেটা চলতি নিয়ম পড়ে মিলিয়ে দেখা হয়।
#
#    ⚠️ কিন্তু Docker-এর **প্রকাশিত পোর্টে** (এখানে ৮০ ও ৪৪৩ — Caddy)
#    প্যাকেট DNAT হয়ে কনটেইনারে যায়, অর্থাৎ INPUT নয়, **FORWARD/DOCKER**
#    চেইন দিয়ে। ফলে সেখানে fail2ban-এর ব্যান (এমনকি `ufw deny`-ও)
#    প্যাকেটটা কখনো দেখেই না — এটা "Docker ufw-কে ফাঁকি দেয়" নামে
#    পরিচিত সমস্যা, আর এর ফল **নীরব**: জেল "সক্রিয়" দেখায়, ব্যানের
#    সংখ্যাও বাড়ে, তবু আক্রমণকারী দিব্যি ঢুকতে থাকে।
#
#    ⭐ তাই এই স্ক্রিপ্ট ইচ্ছাকৃতভাবে **শুধু SSH জেল** বসায়, আর যা পারে
#    না সেটা দাবিও করে না। লগইন রুটের rate limit তাই ওয়েব-স্তরে —
#    Caddy-তে — বসাতে হবে; সেটাই R6-র বাকি অর্ধেক।
#    (DOCKER-USER চেইনে নিয়ম বসিয়ে ঠেকানো যায়, কিন্তু তখন ব্যানের
#    দায়িত্ব দুই জায়গায় ভাগ হয়ে যেত — সেটা আলাদা সিদ্ধান্ত, আলাদা ADR।)

# ── ৪· চালু করা ──────────────────────────────────────────────────────────
say "৪· fail2ban চালু"

# ⭐ restart-এর আগে কনফিগ পরীক্ষা — ভুল কনফিগে fail2ban **উঠতেই পারে না**,
#    আর তখন আগের যে জেলটা চলছিল সেটাও চলে যেত। আগে দেখে নিলে খারাপ কনফিগে
#    আমরা কিছুই ভাঙি না।
if f2b_test="$(fail2ban-client -t 2>&1)"; then
  ok "কনফিগ পরীক্ষা পাশ"
else
  case "$f2b_test" in
    *"no such option"*|*"Usage:"*|*"unrecognized"*)
      # ⚠️ এই fail2ban-এ `-t` নেই — এটা "কনফিগ খারাপ" নয়, "যাচাই করা গেল
      #    না"। দুটোকে এক করে ফেললে ভালো কনফিগেও স্ক্রিপ্ট থেমে যেত।
      warn "এই সংস্করণে 'fail2ban-client -t' নেই — কনফিগ যাচাই করা গেল না"
      ;;
    *)
      printf '%s\n' "$f2b_test" | sed 's/^/     /' >&2
      # ⚠️ বার্তাটা যেন বাড়িয়ে না বলে: জেল-ফাইলটা এই মুহূর্তে **লেখা হয়ে
      #    গেছে** ($JAIL_FILE)। যা হয়নি তা হলো restart — অর্থাৎ চলতি
      #    fail2ban আগের কনফিগেই আছে, আর sshd-তে হাত পড়েনি।
      die "fail2ban কনফিগে ভুল — উপরের বার্তা দেখুন। restart করা হয়নি, চলতি fail2ban ও SSH অপরিবর্তিত। ঠিক করে আবার চালান, বা $JAIL_FILE মুছে দিন।"
      ;;
  esac
fi

systemctl enable fail2ban >/dev/null 2>&1 || true

if [ "$CHANGED_JAIL" -eq 1 ]; then
  systemctl restart fail2ban || true
  ok "জেল বদলেছে — সার্ভিস restart করা হলো"
elif ! systemctl is-active --quiet fail2ban; then
  systemctl start fail2ban || true
  ok "সার্ভিস চলছিল না — চালু করা হলো"
else
  ok "সার্ভিস আগে থেকেই চলছে, কনফিগও অপরিবর্তিত — restart করা হয়নি"
fi

# ── ৫· স্বয়ংক্রিয় নিরাপত্তা আপডেট ────────────────────────────────────────
say "৫· স্বয়ংক্রিয় নিরাপত্তা আপডেট"

cat > "$TMPDIR_OX/apt-periodic" <<'CONF'
// ⚠️ এই ফাইলটা deploy/vps-harden.sh লেখে।
// ⭐ কেবল কনফিগ থাকলেই চলে না — নিচের দুটো মান ১ না হলে
//    unattended-upgrades বসানো থাকা সত্ত্বেও **কখনো চলে না**।
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF

cat > "$TMPDIR_OX/apt-uu" <<'CONF'
// ⚠️ এই ফাইলটা deploy/vps-harden.sh লেখে — হাতে বদলালে পরের বার মুছে যাবে।

// ⚠️⚠️ `#clear` বাদ দেওয়া যাবে না। apt-এর কনফিগে তালিকা **যোগ হয়**,
//    প্রতিস্থাপিত হয় না — অর্থাৎ এটা ছাড়া নিচের তালিকাটা ডিস্ট্রোর
//    50unattended-upgrades-এর তালিকার সাথে জুড়ে বসত, আর কেউ সেখানে
//    `-updates` চালু করে রাখলে আমরা অজান্তেই **সব** আপডেট টেনে আনতাম।
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Origins-Pattern;

// ⭐ শুধু security — ইচ্ছাকৃতভাবে। এই হোস্টে ১৫ জনের কাজের হিসাব চলে;
//    রাত ৩টায় নিজে থেকে একটা ফিচার-আপগ্রেড এসে কিছু ভাঙার চেয়ে
//    নিরাপত্তা-প্যাচগুলো নীরবে বসে যাওয়াই বেশি দরকারি।
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

// ⚠️⚠️ রিবুট **কখনো নিজে থেকে নয়**। সার্ভার রিবুট মানে এজেন্টদের সব
//    আপলোড কয়েক মিনিট আটকে থাকা, আর সেটা যদি অফিস-সময়ে হয় তবে কেউ
//    বুঝতেই পারবে না কেন ছবি আসছে না। কার্নেল আপডেটের পর রিবুট
//    দরকার হলে সেটা মালিক বেছে নেওয়া সময়ে করবেন —
//    `cat /var/run/reboot-required` দেখলেই জানা যায়।
Unattended-Upgrade::Automatic-Reboot "false";

// ⭐ পুরোনো কার্নেল ছাঁটাই — নইলে /boot ভরে যায়, আর তখন **পরের
//    আপডেটগুলোই ব্যর্থ হতে থাকে**, নীরবে।
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
CONF

if install_if_changed "$TMPDIR_OX/apt-periodic" "$APT_PERIODIC"; then
  ok "লেখা হলো → $APT_PERIODIC"
else
  ok "আগের মতোই আছে → $APT_PERIODIC"
fi

if install_if_changed "$TMPDIR_OX/apt-uu" "$APT_FILE"; then
  ok "লেখা হলো → $APT_FILE  (শুধু security)"
else
  ok "আগের মতোই আছে → $APT_FILE  (শুধু security)"
fi

# ⚠️ Docker নিজে এই তালিকার বাইরে — docker-ce আসে Docker-এর নিজস্ব
#    রিপো থেকে, যেটা Allowed-Origins-এ নেই। অর্থাৎ স্ট্যাক চালানো
#    কনটেইনার-ইঞ্জিনটা রাতারাতি নিজে থেকে বদলাবে না। ইচ্ছাকৃত।
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

# ── ৬· যাচাই ─────────────────────────────────────────────────────────────
#
# ⭐ "চালানো হয়েছে" আর "চালু আছে" এক নয় — vps-setup.sh-এ ফায়ারওয়াল নিয়ে
#    এই শিক্ষাটা আগেই লেখা আছে (১৩ আগস্ট: স্ক্রিপ্ট warn ছেপেছিল, কেউ
#    পড়েনি, আর VPS-এ কোনো ফায়ারওয়ালই চলছিল না)। তাই নিচে কনফিগ ফাইল নয়,
#    **চলতি অবস্থা** পড়া হয়।
say '৬· যাচাই — "চালানো হয়েছে" আর "চালু আছে" এক নয়'

FAIL=0

if systemctl is-active --quiet fail2ban; then
  ok "fail2ban সার্ভিস চলছে"
else
  journalctl -u fail2ban -n 20 --no-pager 2>/dev/null | sed 's/^/     /' || true
  die "fail2ban চলছে না — উপরের লগ দেখুন (systemctl status fail2ban)"
fi

# ⚠️ restart-এর পরে fail2ban-এর সকেট তৈরি হতে কয়েক সেকেন্ড লাগে। সাথে সাথেই
#    `fail2ban-client` ডাকলে "Failed to access socket path" আসত, আর তখন আমরা
#    একটা **সুস্থ** জেলকেও "দাঁড়ায়নি" বলে ফেলতাম — আর সেই ভুল বার্তা পড়ে
#    কেউ কনফিগ ঘাঁটতে বসতেন। vps-update.sh-এ API-র স্বাস্থ্য পরীক্ষায় ঠিক
#    এই অপেক্ষাটাই আছে, একই কারণে।
for _ in $(seq 1 15); do
  if fail2ban-client ping >/dev/null 2>&1; then break; fi
  sleep 1
done

# ⭐ জেলটা সত্যিই দাঁড়িয়েছে কি না — সার্ভিস চলা আর জেল দাঁড়ানো আলাদা কথা।
#    backend ভুল হলে সার্ভিস দিব্যি চলে, শুধু জেলটাই থাকে না।
if jail_status="$(fail2ban-client status sshd 2>&1)"; then
  printf '%s\n' "$jail_status" | sed 's/^/     /'
  ok "sshd জেল দাঁড়িয়েছে"
else
  printf '%s\n' "$jail_status" | sed 's/^/     /' >&2
  die "sshd জেল দাঁড়ায়নি — উপরের বার্তা দেখুন (journalctl -u fail2ban -n 40)"
fi

# ── ৬ক· পোর্টগুলো সত্যিই পাহারায় আছে কি না ───────────────────────────────
#
# ⚠️⚠️ এটাই এই স্ক্রিপ্টের সবচেয়ে জরুরি যাচাই। কনফিগে `port = 22,2222`
#    লেখা থাকা আর ফায়ারওয়ালে সত্যিই দুটো পোর্ট পাহারায় থাকা এক কথা নয় —
#    আর দ্বিতীয়টা না হলে ব্যর্থতাটা সম্পূর্ণ নীরব।
# ⚠️⚠️ **দুটো ব্যাকএন্ড, দুটো সম্পূর্ণ আলাদা নাম ও ফরম্যাট** — আর প্রথম
#    আসল রানেই (Ubuntu 24.04, ১৫ আগস্ট) দেখা গেল এখানে ধরা পড়ে না:
#
#      iptables  → চেইনের নাম `f2b-sshd`,   পোর্ট `--dports 22,2222`
#      nftables  → চেইনের নাম `f2b-chain`,  সেট `addr-set-sshd`,
#                  পোর্ট `tcp dport { 22, 2222 }`
#
#    আধুনিক Ubuntu-তে fail2ban ডিফল্টে **nftables** বেছে নেয়, তাই শুধু
#    `f2b-sshd` খুঁজলে কিছুই মিলত না আর স্ক্রিপ্ট "যাচাই করা গেল না" বলে
#    থেমে যেত — অথচ জেল দিব্যি কাজ করছিল (ছ-টা IP ব্যানও হয়ে গিয়েছিল)।
rule_ports=""

if command -v iptables >/dev/null 2>&1; then
  f2b_rule="$(iptables -S INPUT 2>/dev/null | grep -F 'f2b-sshd' | head -1 || true)"
  if [ -n "$f2b_rule" ]; then
    rule_ports="$(printf '%s\n' "$f2b_rule" | sed -n 's/.*--dports \([0-9,]*\).*/\1/p' | head -1)"
  fi
fi

# ⚠️ `addr-set-sshd` ধরে খোঁজা, `f2b-chain` নয় — চেইনটা সব জেলের জন্য
#    একটাই, কিন্তু সেটটা জেল-নির্দিষ্ট। তাই অন্য কোনো জেল থাকলেও এটা
#    ঠিক sshd-র সারিটাই তোলে।
if [ -z "$rule_ports" ] && command -v nft >/dev/null 2>&1; then
  f2b_rule="$(nft list ruleset 2>/dev/null | grep -F 'addr-set-sshd' | grep -F 'dport' | head -1 || true)"
  if [ -n "$f2b_rule" ]; then
    # `tcp dport { 22, 2222 } …` → `22,2222`  (ফাঁকা জায়গা ফেলে দিয়ে)
    rule_ports="$(printf '%s\n' "$f2b_rule" \
      | sed -n 's/.*dport[[:space:]]*{\([^}]*\)}.*/\1/p' \
      | tr -d '[:space:]' | head -1)"
    # ⚠️ একটামাত্র পোর্ট হলে nft বন্ধনী ছাড়াই লেখে — `tcp dport 2222`
    if [ -z "$rule_ports" ]; then
      rule_ports="$(printf '%s\n' "$f2b_rule" \
        | sed -n 's/.*dport[[:space:]]*\([0-9]\{1,5\}\).*/\1/p' | head -1)"
    fi
  fi
fi

if [ -z "$rule_ports" ]; then
  # ⚠️ "যাচাই করা গেল না" — "কাজ করছে না" নয়। দুটোকে এক করে দেখানো
  #    এই প্রকল্পে নিষিদ্ধ; অনুপস্থিত পর্যবেক্ষণ ব্যর্থতা নয়।
  warn "চলতি ফায়ারওয়াল নিয়মে পোর্টের তালিকা পড়া গেল না — এর মানে জেল কাজ"
  warn "করছে না তা নয়, মানে যাচাই করা গেল না। হাতে দেখুন:"
  warn "    iptables -S INPUT | grep f2b-sshd"
else
  missing=""
  for p in ${SSH_PORTS//,/ }; do
    found=0
    for q in ${rule_ports//,/ }; do
      if [ "$p" = "$q" ]; then found=1; fi
    done
    if [ "$found" -eq 0 ]; then missing="$missing $p"; fi
  done
  if [ -n "$missing" ]; then
    warn "ফায়ারওয়ালে পাহারায় আছে: $rule_ports — কিন্তু নেই:$missing"
    FAIL=1
  else
    ok "ফায়ারওয়ালে সত্যিই পাহারায়: $rule_ports"
  fi
fi

# ── ৬খ· sshd আসলে কোন কোন পোর্টে শুনছে ───────────────────────────────────
#
# ⭐ জেলে কী লেখা আছে সেটা আমরা ঠিক করি; sshd কোথায় শোনে সেটা করি না।
#    দুটো না মিললে একটা দরজা অরক্ষিত থেকে যায় — তাই মিলিয়ে দেখা হয়।
ssh_listen=""
if command -v ss >/dev/null 2>&1; then
  ssh_listen="$(ss -H -ltnp 2>/dev/null | awk '/sshd/ { n = split($4, a, ":"); print a[n] }' \
                | sort -un | paste -sd, - || true)"
fi

if [ -z "$ssh_listen" ]; then
  # ⚠️ আবারও: জানা গেল না ≠ কিছু নেই।
  warn "sshd কোন পোর্টে শুনছে জানা গেল না (ss পাওয়া যায়নি?) — 'ss -ltnp | grep sshd'"
else
  ok "sshd শুনছে: $ssh_listen"
  uncovered=""
  for p in ${ssh_listen//,/ }; do
    found=0
    for q in ${SSH_PORTS//,/ }; do
      if [ "$p" = "$q" ]; then found=1; fi
    done
    if [ "$found" -eq 0 ]; then uncovered="$uncovered $p"; fi
  done
  if [ -n "$uncovered" ]; then
    warn "জেলের বাইরে থাকা SSH পোর্ট:$uncovered — ওখানে ব্রুট-ফোর্স আটকাবে না"
    warn "    যোগ করুন:  OXEIO_SSH_PORTS=$SSH_PORTS$(printf '%s' "$uncovered" | tr ' ' ',') bash $0"
    FAIL=1
  fi
  # ⚠️ উল্টো দিকটা ব্যর্থতা নয়: জেলে ২২২২ আছে অথচ sshd এখনো ওখানে শোনে
  #    না — এটা ক্ষতিকর নয়, বরং আগেভাগে প্রস্তুত থাকা (vps-setup.sh-এ
  #    ufw-তে ২২২২ আগেভাগে খুলে রাখার মতোই)।
fi

# ── ৬গ· স্বয়ংক্রিয় আপডেট সত্যিই চালু কি না ───────────────────────────────
uu_on="$(apt-config dump APT::Periodic::Unattended-Upgrade 2>/dev/null | head -1 || true)"
# ⭐ শুধু মানটা — গোটা লাইনে চাবিটাই দুবার আসত ('X = X "0";'), আর পড়তে গিয়ে
#    কোনটা চাওয়া হয়েছিল আর কোনটা পাওয়া গেল তা আলাদা করা যেত না।
uu_val="$(printf '%s' "$uu_on" | sed -n 's/.*"\([^"]*\)".*/\1/p')"
case "$uu_val" in
  1) ok "unattended-upgrade চালু (APT::Periodic::Unattended-Upgrade = 1)" ;;
  *) warn "APT::Periodic::Unattended-Upgrade = ${uu_val:-জানা যায়নি}, চাই 1 — আপডেট চলবে না"
     FAIL=1 ;;
esac

origins="$(apt-config dump Unattended-Upgrade::Allowed-Origins 2>/dev/null || true)"
if [ -z "$origins" ]; then
  warn "Allowed-Origins পড়া গেল না — 'apt-config dump Unattended-Upgrade' দেখুন"
else
  printf '%s\n' "$origins" | sed 's/^/     /'
  # ⚠️ `-updates` বা `-proposed` ঢুকে পড়লে এটা আর "শুধু security" নয়।
  if printf '%s' "$origins" | grep -qE '\-(updates|proposed|backports)'; then
    warn "security-র বাইরের origin ঢুকেছে — 50unattended-upgrades দেখুন"
    FAIL=1
  else
    ok "শুধু security origin"
  fi
fi

# ⭐ টাইমার — কনফিগ নিখুঁত হলেও টাইমার বন্ধ থাকলে **কোনোদিন কিছুই চলবে না**।
for t in apt-daily.timer apt-daily-upgrade.timer; do
  if systemctl is-active --quiet "$t"; then
    ok "$t চলছে"
  else
    warn "$t চলছে না — কনফিগ ঠিক থাকলেও আপডেট কখনো চলবে না"
    warn "    systemctl enable --now $t"
    FAIL=1
  fi
done

# ── ৭· ফল ────────────────────────────────────────────────────────────────
if [ "$FAIL" -eq 0 ]; then
  printf '\n\033[32m✅ শক্ত করা হয়ে গেছে\033[0m\n\n'
else
  printf '\n\033[33m⚠️  আংশিক — উপরের সতর্কবার্তাগুলো পড়ুন\033[0m\n\n'
fi

echo "   জেলের অবস্থা   :  fail2ban-client status sshd"
echo "   ব্যান তোলা      :  fail2ban-client set sshd unbanip <IP>"
echo "   আপডেট মহড়া     :  unattended-upgrade --dry-run -v"
printf '\n'
printf '   \033[33m⚠️ ৮০/৪৪৩ (Caddy) এই জেলের বাইরে — Docker-এর প্রকাশিত পোর্ট\033[0m\n'
printf '   \033[33m   DNAT হয়ে FORWARD/DOCKER চেইন দিয়ে যায়, INPUT দিয়ে নয়।\033[0m\n'
printf '   \033[32m   ✓ ওই দিকটা Caddy-তেই সামলানো — লগইনে ৩০/মিনিট প্রতি IP\033[0m\n'
printf '   \033[32m     (web/Caddyfile-এর rate_limit · G116)। এই জেল শুধু SSH-এর।\033[0m\n\n'

# ⚠️ FAIL হলেও exit 0 — ইচ্ছাকৃত। যা বসেছে তা বসেই আছে, আর অসম্পূর্ণ
#    যাচাইকে ব্যর্থতা বলে ধরলে কেউ স্ক্রিপ্টটা আবার চালাতে ভয় পেতেন।
#    যা জানা যায়নি তা উপরে স্পষ্ট লেখা আছে — সেটাই আসল ফল।
#    ⚠️ লাইনটা স্পষ্ট করে লেখা: শেষ printf-এর ফলাফল দিয়ে exit code ঠিক
#    হলে ভবিষ্যতে কেউ একটা লাইন যোগ করলেই নীরবে বদলে যেত।
exit 0
