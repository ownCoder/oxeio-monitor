# oXeio Monitoring System — Technical Specification
### Phase 0 deliverable · v1

> এই ডকুমেন্টে সিস্টেমের ভেতরের ডিজাইন — ডেটাবেস, API, এজেন্টের লজিক, সার্ভার সেটআপ।
> বিজনেস-লেভেল প্ল্যানের জন্য দেখুন `oXeio-Monitoring-Plan.md`

---

## ১. Locked Configuration

```yaml
organization: oXeio
staff_count: 15
platform: Windows (সব PC)

policy:
  shift: null                               # ❌ কোনো শিফট উইন্ডো নেই
  tracking_window: "24h"                    # ⭐ যেকোনো সময় active = গোনা হবে
  monthly_target_hours: 208                 # ⭐ একমাত্র মাপকাঠি
  weekly_off_day: friday                    # শুধু pace-এর কর্মদিবস গুনতে (§ ২.১-খ)
                                            # ⚠️ ব্লক নয় — শুক্রবারে কাজ করলে পুরোপুরি গোনা হবে
  expected_workdays_per_month: auto         # ক্যালেন্ডার থেকে গোনা হয় (~26), হার্ডকোড নয়
  daily_pace_hours: 8                       # 208 ÷ 26 — নির্দেশক, নিয়ম নয়
  lunch_window: null                        # ❌ ট্র্যাক হয় না
  late_tracking: false                      # ❌ আসার নির্দিষ্ট সময়ই নেই
  blocked_days: []                          # শুক্রবারেও কাজ করলে গোনা হবে
  timezone: "Asia/Dhaka"                    # = GMT+6 (UTC+06:00), কোনো DST নেই

screenshot:
  interval_slot_minutes: 5        # প্রতি ৫ মিনিটের স্লট
  per_slot: 1                     # স্লটে ১টা, সময় র‍্যান্ডম
  capture_all_monitors: true
  format: webp
  quality: 70
  max_width: 1920                 # বড় মনিটর হলে রিসাইজ
  skip_when: [idle, locked]                 # শুধু ACTIVE হলেই ছবি
  capture_window: { start: "07:00", end: "23:00" }   # ✅ অনুমোদিত
  # সময় গণনা ২৪ ঘণ্টা চলে, কিন্তু ছবি শুধু এই সময়টুকুতে।
  # রাত ১১টার পর active থাকলে ঘণ্টা গোনা হবে, ছবি উঠবে না।
  blur: false

idle:
  threshold_seconds: 60           # ১ মিনিট
  poll_seconds: 1
  retro_subtract: true            # idle-এ যাওয়ার ৬০ সেকেন্ডও বাদ

app_tracking:
  enabled: true
  min_duration_seconds: 5         # ৫ সেকেন্ডের কম হলে ধরবে না
  capture_window_title: true
  capture_browser_domain: true    # শুধু ডোমেইন, ফুল URL নয়
  keylogging: false               # কখনোই না

retention:
  screenshots_days: 90
  app_usage_days: 365
  time_data_days: forever
  audit_log_days: 365

server:
  location: office_pc
  specs: { ram: 24GB, disk: 1TB NVMe, os: Windows }

dashboard_users:
  - { role: owner,   count: 1 }   # আপনি — সব অ্যাক্সেস
  - { role: manager, count: 1 }   # ম্যানেজার — সব দেখা, আর স্টাফ · ছুটি ·
                                  # ক্যাটাগরি চালানো (১৫ আগস্ট থেকে; § ৪.৩)।
                                  # বেতন, পে-রোল ও work policy owner-এরই
```

### স্টোরেজ প্রক্ষেপণ
| | |
|---|---|
> ⚠️ **আগের হিসাবে দুটো ভুল ছিল**, দুটোই ২০২৬-০৮-১০-এ ঠিক করা:
> ছবি **প্রতি মনিটরে একটা** ওঠে, প্রতি স্টাফে একটা নয় (G47) — আর ফাইলের আকার
> অনুমান করা হয়েছিল ১৫০ KB, **মেপে পাওয়া গেছে ~৭২ KB** (১৯২০×১০৮০, WebP q70)।

| | সাধারণ (৮ঘ · ১ মনিটর) | সাধারণ (৮ঘ · ২ মনিটর) | ভারী (১২ঘ · ২ মনিটর) |
|---|---|---|---|
| স্ক্রিনশট/জন/দিন | ৯৬ | **১৯২** | **২৮৮** |
| মোট/দিন (১৫ জন) | ~১,৪৪০ | ~২,৮৮০ | ~৪,৩২০ |
| সাইজ/দিন (@৭২ KB *মাপা*) | ~১০৪ MB | ~২০৭ MB | ~৩১১ MB |
| সাইজ/মাস (২৬ দিন) | ~২.৭ GB | ~৫.৪ GB | ~৮.১ GB |
| **৯০ দিনে সর্বোচ্চ** | **~৮ GB** | **~১৬ GB** | **~২৪ GB** |
| DB (টাইম + অ্যাপ ডেটা) | ~২০০ MB/বছর | ~২০০ MB/বছর | ~৩০০ MB/বছর |

দুটো ভুল একে অপরকে অনেকটা কাটাকাটি করে দিয়েছে — মনিটরপ্রতি ছবি হিসাব বাড়ায়,
আর মাপা আকার অনুমানের অর্ধেক। তাই মোট সংখ্যা আগের ১৭ GB-র কাছাকাছিই থাকল।

> **1 TB NVMe-তে সবচেয়ে খারাপ ক্ষেত্রেও ~২.৪%।** তবে **মনিটর সংখ্যা এখন হিসাবের অংশ** —
> তিন-মনিটরের ওয়ার্কস্টেশন থাকলে সেটা ধরে নিতে হবে।

---

## ২. Database Schema (PostgreSQL)

```sql
-- ══════════════ Reference / config ══════════════

-- ⚠️ shifts টেবিল নেই — ইচ্ছাকৃত। কোনো শিফট উইন্ডো, লাঞ্চ উইন্ডো বা
--    আসার নির্দিষ্ট সময় নেই। তার বদলে সহজ একটা পলিসি টেবিল:

CREATE TABLE work_policies (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,          -- 'Standard'
  monthly_target_hours  NUMERIC(6,2) NOT NULL DEFAULT 208,  -- ⭐ একমাত্র টার্গেট
  expected_workdays     INT  NOT NULL DEFAULT 26,  -- fallback; আসল হিসাব § ২.১-খ
  weekly_off_day        SMALLINT,               -- ISO দিন (শুক্র = 5) · NULL হলে
                                                -- প্রতিটি ক্যালেন্ডার দিনই কর্মদিবস
  -- 'HH:MM' টেক্সট হিসেবে, TIME নয় — এটা টাইমজোন-নিরপেক্ষ, আর এজেন্টের কাছে
  -- /agent/config-এ স্ট্রিং হিসেবেই যায়, তাই রূপান্তরের ভুলের সুযোগ থাকে না
  screenshot_from       TEXT,                   -- '07:00' — NULL হলে ২৪ ঘণ্টা
  screenshot_to         TEXT,                   -- '23:00'
  idle_threshold_sec    INT  NOT NULL DEFAULT 60,
  slot_minutes          INT  NOT NULL DEFAULT 5,
  timezone              TEXT NOT NULL DEFAULT 'Asia/Dhaka',  -- GMT+6, DST নেই
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);
-- employees.shift_id → employees.policy_id REFERENCES work_policies(id)

-- মাসিক rollup — এটাই এখন প্রধান রিপোর্টিং টেবিল
CREATE TABLE monthly_summary (
  employee_id       INT  NOT NULL REFERENCES employees(id),
  year_month        CHAR(7) NOT NULL,           -- '2026-08'
  worked_sec        INT  NOT NULL DEFAULT 0,    -- ⭐ মাসের মোট প্রকৃত কাজ (raw)
  adjustment_sec    INT  NOT NULL DEFAULT 0,    -- ⭐ owner-এর সংশোধনের যোগফল (§ ২.১-ঙ)
  credited_sec      INT  NOT NULL DEFAULT 0,    -- ⭐ worked + adjustment
  target_sec        INT  NOT NULL DEFAULT 748800,  -- 208 ঘণ্টা
  expected_sec      INT  NOT NULL DEFAULT 0,    -- আজ পর্যন্ত যত হওয়ার কথা
  pace_sec          INT  NOT NULL DEFAULT 0,    -- worked − expected (±)
  expected_workdays INT  NOT NULL,              -- ⭐ ওই মাসের মোট কর্মদিবস (§ ২.১-খ)
  workdays_elapsed  INT  NOT NULL DEFAULT 0,    -- ⭐ আজ পর্যন্ত কত কর্মদিবস গেছে
  days_with_work    INT  NOT NULL DEFAULT 0,
  avg_daily_sec     INT  NOT NULL DEFAULT 0,
  overtime_sec      INT  NOT NULL DEFAULT 0,
  shortfall_sec     INT  NOT NULL DEFAULT 0,
  target_met        BOOLEAN NOT NULL DEFAULT FALSE,
  target_met_at     TIMESTAMPTZ,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, year_month)
);

CREATE TABLE employees (
  id                SERIAL PRIMARY KEY,
  emp_code          TEXT UNIQUE NOT NULL,   -- OX-001
  full_name         TEXT NOT NULL,
  email             TEXT UNIQUE,
  designation       TEXT,
  department        TEXT,
  policy_id         INT REFERENCES work_policies(id),
  joined_on         DATE,
  left_on           DATE,                   -- proration ও অফবোর্ডিংয়ের জন্য
  status            TEXT NOT NULL DEFAULT 'active',  -- active | inactive
  policy_signed_at  TIMESTAMPTZ,            -- monitoring policy কবে সই হলো
  policy_doc_path   TEXT,                   -- সই করা কপি (storage-এ relative path)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ড্যাশবোর্ডে লগইন করার ইউজার (আপনি + ম্যানেজার)
CREATE TABLE users (
  id                SERIAL PRIMARY KEY,
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,          -- argon2id
  full_name         TEXT NOT NULL,
  role              TEXT NOT NULL,          -- owner | manager
  totp_secret       TEXT,                   -- ঐচ্ছিক 2FA
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_pw    BOOLEAN NOT NULL DEFAULT TRUE,  -- প্রথম লগইনে পাসওয়ার্ড বদলাতেই হবে
  pw_changed_at     TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id                SERIAL PRIMARY KEY,
  hostname          TEXT NOT NULL,
  windows_username  TEXT NOT NULL,
  employee_id       INT REFERENCES employees(id),
  machine_guid      TEXT UNIQUE NOT NULL,   -- হার্ডওয়্যার-ভিত্তিক স্থায়ী আইডি
  os_version        TEXT,
  agent_version     TEXT,
  token_hash        TEXT NOT NULL,          -- device token-এর sha256
  monitors          INT DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  last_seen_at      TIMESTAMPTZ,
  enrolled_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON devices(hostname, windows_username);

-- ⭐ enrollment code কোথাও জমা ছিল না — যোগ হলো (G34)
CREATE TABLE enrollment_codes (
  id                SERIAL PRIMARY KEY,
  code_hash         TEXT NOT NULL UNIQUE,   -- কোড কখনো plaintext-এ জমা হয় না
  employee_id       INT  NOT NULL REFERENCES employees(id),
  created_by        INT  NOT NULL REFERENCES users(id),
  expires_at        TIMESTAMPTZ NOT NULL,   -- তৈরির ২৪ ঘণ্টা পর
  used_at           TIMESTAMPTZ,            -- একবার ব্যবহারের পর আর চলবে না
  used_by_device_id INT REFERENCES devices(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════ Core tracking ══════════════

-- PC-তে লগইন থেকে লগআউট পর্যন্ত একটা সেশন
CREATE TABLE work_sessions (
  id                BIGSERIAL PRIMARY KEY,
  employee_id       INT  NOT NULL REFERENCES employees(id),
  device_id         INT  NOT NULL REFERENCES devices(id),
  work_date         DATE NOT NULL,          -- Asia/Dhaka অনুযায়ী
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,
  end_reason        TEXT,                   -- logoff | shutdown | timeout | day_rollover
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON work_sessions(employee_id, work_date);
-- ⚠️ shift_end বাদ — শিফটই নেই। বদলে day_rollover: মধ্যরাতে সেশন ভাগ হয় (§ ২.১-ক)

-- ⭐ মূল টাইম ট্র্যাকিং টেবিল — প্রতিটা active/idle/break খণ্ড
CREATE TABLE activity_segments (
  id                BIGSERIAL PRIMARY KEY,
  session_id        BIGINT NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,
  employee_id       INT  NOT NULL REFERENCES employees(id),
  device_id         INT  NOT NULL REFERENCES devices(id),  -- ⭐ overlap ধরার জন্য (G32)
  client_uuid       UUID NOT NULL UNIQUE,   -- ⭐ এজেন্টের দেওয়া আইডি → dedupe (G29)
  work_date         DATE NOT NULL,          -- started_at-এর Asia/Dhaka তারিখ
  state             TEXT NOT NULL,          -- active | idle | locked  (এই তিনটিই)
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ NOT NULL,
  duration_sec      INT  NOT NULL,          -- monotonic clock থেকে, ঘড়ি বদলালেও অটুট
  input_score       SMALLINT,               -- 0-100, ওই খণ্ডে কতটা অ্যাক্টিভ ছিল
  counts_as_work    BOOLEAN NOT NULL DEFAULT FALSE  -- = (state = 'active'); ingest-এ সেট হয়
);
CREATE INDEX ON activity_segments(employee_id, work_date, state);
CREATE INDEX ON activity_segments(started_at);
-- ⚠️ কোনো সেগমেন্ট দুই work_date জুড়ে থাকতে পারবে না — মধ্যরাতে ভাগ হয় (§ ২.১-ক)

CREATE TABLE screenshots (
  id                BIGSERIAL PRIMARY KEY,
  employee_id       INT  NOT NULL REFERENCES employees(id),
  device_id         INT  NOT NULL REFERENCES devices(id),
  client_uuid       UUID NOT NULL UNIQUE,   -- আপলোড রিট্রাই হলেও একটাই রেকর্ড (G29)
  work_date         DATE NOT NULL,
  slot_start        TIMESTAMPTZ NOT NULL,   -- ৫ মিনিটের স্লটের শুরু
  captured_at       TIMESTAMPTZ NOT NULL,   -- আসল র‍্যান্ডম সময়
  monitor_index     SMALLINT NOT NULL DEFAULT 0,
  file_path         TEXT NOT NULL,          -- storage-এ relative path
  thumb_path        TEXT,
  width             INT, height INT,
  size_bytes        INT,
  active_app        TEXT,                   -- ছবি তোলার সময় কোন অ্যাপ
  active_title      TEXT,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ             -- retention job এখানে মার্ক করে
);
CREATE UNIQUE INDEX ON screenshots(device_id, slot_start, monitor_index);
CREATE INDEX ON screenshots(employee_id, work_date);

CREATE TABLE app_usage (
  id                BIGSERIAL PRIMARY KEY,
  employee_id       INT  NOT NULL REFERENCES employees(id),
  device_id         INT  NOT NULL REFERENCES devices(id),
  client_uuid       UUID NOT NULL UNIQUE,   -- dedupe (G29)
  work_date         DATE NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ NOT NULL,
  duration_sec      INT  NOT NULL,
  process_name      TEXT NOT NULL,          -- chrome.exe
  app_name          TEXT,                   -- Google Chrome
  window_title      TEXT,
  domain            TEXT,                   -- ব্রাউজার হলে: facebook.com
  category_id       INT,
  is_browser        BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ON app_usage(employee_id, work_date);
CREATE INDEX ON app_usage(domain);

-- Productive / Neutral / Unproductive শ্রেণিবিভাগ
CREATE TABLE app_categories (
  id                SERIAL PRIMARY KEY,
  match_type        TEXT NOT NULL,          -- process | domain | title_regex
  pattern           TEXT NOT NULL,          -- 'code.exe' | 'facebook.com'
  display_name      TEXT NOT NULL,
  category          TEXT NOT NULL,          -- productive | neutral | unproductive
  priority          INT NOT NULL DEFAULT 100
);

-- ══════════════ Events ও audit ══════════════

CREATE TABLE events (
  id                BIGSERIAL PRIMARY KEY,
  device_id         INT REFERENCES devices(id),
  employee_id       INT REFERENCES employees(id),
  client_uuid       UUID NOT NULL UNIQUE,   -- dedupe (G29)
  type              TEXT NOT NULL,
  -- agent_start | agent_stop | logon | logoff | lock | unlock | sleep | resume
  -- agent_crash | clock_drift | screenshot_skipped | day_rollover | segment_split
  occurred_at       TIMESTAMPTZ NOT NULL,
  meta              JSONB,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON events(employee_id, occurred_at);

-- ⚠️ time_claims টেবিল নেই — ইচ্ছাকৃত।
--    স্টাফের চাওয়ার (claim) কোনো ব্যবস্থা নেই। active = গোনা হয়, ব্যস।
--    কিন্তু নিচেরটা আলাদা জিনিস — স্টাফ কিছু চায় না, শুধু owner ঠিক করতে পারে ↓

-- ⭐ সিস্টেমের নিজের দোষে হারানো ঘণ্টা ফেরানোর একমাত্র পথ (G35)
CREATE TABLE time_adjustments (
  id                BIGSERIAL PRIMARY KEY,
  employee_id       INT  NOT NULL REFERENCES employees(id),
  work_date         DATE NOT NULL,
  delta_sec         INT  NOT NULL,          -- + = ঘণ্টা ফেরত · − = কেটে নেওয়া
  cause             TEXT NOT NULL,
  -- agent_down | server_down | agent_crash | pc_replaced | data_loss | other
  reason            TEXT NOT NULL,          -- ⭐ বাধ্যতামূলক, খালি রাখা যাবে না
  evidence_alert_id BIGINT REFERENCES alerts(id),   -- কোন অ্যালার্টের ভিত্তিতে
  beyond_evidence   BOOLEAN NOT NULL DEFAULT FALSE, -- মাপা downtime-এর চেয়ে বেশি দেওয়া হয়েছে?
  created_by        INT  NOT NULL REFERENCES users(id),   -- শুধু owner
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,            -- ডিলিট নয় — শুধু revoke, রেকর্ড থেকে যায়
  revoked_by        INT REFERENCES users(id),
  revoke_reason     TEXT
);
CREATE INDEX ON time_adjustments(employee_id, work_date) WHERE revoked_at IS NULL;

-- কোন অ্যাডমিন কার স্ক্রিনশট কখন দেখল — এটাও রেকর্ড থাকবে
CREATE TABLE audit_log (
  id                BIGSERIAL PRIMARY KEY,
  user_id           INT REFERENCES users(id),
  action            TEXT NOT NULL,
  -- login | login_failed | logout | change_password | reset_password
  -- create_portal_account | view_screenshot | export_report | change_setting
  -- create_enrollment_code | revoke_device | upload_policy_doc
  -- time_adjustment | time_adjustment_revoke
  target_type       TEXT, target_id TEXT,
  ip_address        INET,
  meta              JSONB,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key               TEXT PRIMARY KEY,
  value             JSONB NOT NULL,
  updated_by        INT REFERENCES users(id),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════ ক্যালেন্ডার (ঐচ্ছিক, শুধু তথ্যের জন্য) ══════════════

CREATE TABLE holidays (
  id                SERIAL PRIMARY KEY,
  holiday_date      DATE NOT NULL UNIQUE,
  name              TEXT NOT NULL,          -- 'স্বাধীনতা দিবস'
  type              TEXT NOT NULL DEFAULT 'public'
);
-- শুধু হিটম্যাপে দিনটা চিহ্নিত করার জন্য। ছুটির দিনে কেউ কাজ করলে
-- সেই ঘণ্টাও পুরোপুরি গোনা হবে — কোনো ব্লক নেই।

-- ⚠️ leave_types / leave_requests / leave_balances এখনো নেই — ইচ্ছাকৃত।
--    কোনো ছুটির **আবেদন বা অনুমোদনের** ব্যবস্থা নেই: owner নিজে লেখেন।
--
-- ⚠️⚠️ এখানে আগে লেখা ছিল "কেউ ছুটিতে থাকলে সেদিন কোনো ঘণ্টা যোগ হবে না —
--    মাসিক হিসাবেই সেটা ফুটে উঠবে।" **কথাটা এখন আর সত্যি নয়, আর তখনও ওটাই
--    ছিল সমস্যা:** ঘণ্টা যোগ হতো না বটে, কিন্তু ওই দিনের **টার্গেট থেকেই
--    যেত** — অর্থাৎ ছুটি "ফুটে উঠত" আট ঘণ্টার ঘাটতি হিসেবে, আর সংখ্যাটা
--    ওই মানুষের নামে এমন ব্যর্থতার দাবি করত যা ঘটেইনি। R2 সেটাই সারায়।

-- ══════════════ R2 · ছুটির খাতা ══════════════

CREATE TABLE leaves (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER NOT NULL REFERENCES employees(id),
  leave_date        DATE NOT NULL,          -- ঢাকার কর্মদিবস, UTC-মধ্যরাত
  type              TEXT NOT NULL DEFAULT 'casual',  -- casual · sick · annual
  note              TEXT,
  created_at        TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL,          -- ⚠️ ইমেইল, user_id নয়
  UNIQUE (employee_id, leave_date)
);
-- ⭐ এক দিন = এক সারি, রেঞ্জ নয়। রেঞ্জ রাখলে "১০–১৪ তারিখ" থেকে একটা দিন
--    বাদ দিতে গেলে সারিটা ভাঙতে হতো, আর গোনার সময় ওভারল্যাপ মেলাতে হতো।
--
-- ⭐⭐ **ছুটি সবেতন** — এটাই R2-র সংজ্ঞায়ক সিদ্ধান্ত:
--       target_sec = (d − ছুটি) × দৈনিক      ← ছুটি টার্গেট কমায়
--       বেতন       = মূল বেতন × d ÷ D        ← ছুটি এটা ছোঁয় না
--    ⚠️⚠️ এই বিচ্ছেদ ভাঙলে নীরবে বেতন কাটা যেত: সংখ্যাগুলো দেখতে ঠিক
--    ততটাই যুক্তিসঙ্গত থাকত, শুধু ছুটি নেওয়া মানুষটা কম টাকা পেতেন।
--
-- ⚠️ 'unpaid' ইচ্ছাকৃতভাবে নেই — নামটা রাখলে খাতায় লেখা থাকত অথচ বেতন
--    কাটত না, অর্থাৎ খাতাটা এমন কিছু দাবি করত যা সে জানে না।
--
-- ⚠️ ছুটির দিনগুলো holidays টেবিলে ঢালা হয় **না**: holidays দিয়ে D গোনা
--    হয় (একজনের ছুটি গোটা দলের বেতনের হর বদলে দিত), আর রিপোর্টের
--    approximateHolidayDates() ওই একই সেট পড়ে — ব্যক্তিগত ছুটি পাদটীকায়
--    "সরকারি ছুটি" হয়ে সবার চোখে পড়ত।

-- ══════════════ R1 · মাস বন্ধ করা ══════════════

CREATE TABLE month_closure (
  year_month        TEXT PRIMARY KEY,       -- '2026-08'
  closed_at         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  closed_by         TEXT NOT NULL,
  note              TEXT
);
-- ⭐ সারিটার **থাকা**-ই একমাত্র তথ্য: থাকলে refreshMonth() ওই মাস ছোঁয় না
--    আর ওই তারিখের সময়-সংশোধন প্রত্যাখ্যাত হয়। খুলতে হলে সারিটা মোছা হয়,
--    আর তখনো audit-এ month_closed + month_reopened দুটোই থেকে যায়।

-- ══════════════ অ্যালার্ট ও এজেন্ট ভার্সন ══════════════
-- ⭐ প্রথম ডিজাইনে বাদ পড়েছিল

CREATE TABLE alerts (
  id                BIGSERIAL PRIMARY KEY,
  type              TEXT NOT NULL,
  -- agent_down | agent_killed | disk_warning | disk_critical | backup_failed
  -- clock_drift | no_activity_today
  severity          TEXT NOT NULL,          -- info | warning | critical
  employee_id       INT REFERENCES employees(id),
  device_id         INT REFERENCES devices(id),
  title             TEXT NOT NULL,
  detail            TEXT,
  meta              JSONB,
  channels_sent     TEXT[],                 -- {email,telegram}
  acknowledged_by   INT REFERENCES users(id),
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON alerts(created_at DESC) WHERE acknowledged_at IS NULL;

CREATE TABLE agent_versions (
  version           TEXT PRIMARY KEY,       -- '1.2.0'
  msi_path          TEXT NOT NULL,
  sha256            TEXT NOT NULL,
  release_notes     TEXT,
  rollout_stage     TEXT NOT NULL DEFAULT 'canary', -- canary | partial | all | halted
  is_mandatory      BOOLEAN NOT NULL DEFAULT FALSE,
  released_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- clock drift ট্র্যাকিং (ডিভাইস টেবিলে যোগ)
ALTER TABLE devices ADD COLUMN last_drift_sec INT DEFAULT 0;
ALTER TABLE devices ADD COLUMN max_drift_sec  INT DEFAULT 0;

-- স্টাফের নিজস্ব লগইন (self-service)
ALTER TABLE users ADD COLUMN employee_id INT REFERENCES employees(id);
-- role: owner | manager | employee   ← 'employee' যোগ হলো

-- ══════════════ Rollup (রিপোর্ট দ্রুত করার জন্য) ══════════════
-- রাতে ও প্রতি ১৫ মিনিটে রিফ্রেশ হবে

CREATE TABLE daily_summary (
  employee_id       INT  NOT NULL REFERENCES employees(id),
  work_date         DATE NOT NULL,
  first_activity_at TIMESTAMPTZ,
  last_activity_at  TIMESTAMPTZ,
  active_sec        INT NOT NULL DEFAULT 0,
  idle_sec          INT NOT NULL DEFAULT 0,  -- লাঞ্চ/চা/বিরতি সব এখানেই, আলাদা নয়
  worked_sec        INT NOT NULL DEFAULT 0,  -- ⭐ প্রকৃত ACTIVE (UNION) — কখনো এডিট হয় না
  adjustment_sec    INT NOT NULL DEFAULT 0,  -- ⭐ owner-এর সংশোধন (±), § ২.১-ঙ
  credited_sec      INT NOT NULL DEFAULT 0,  -- ⭐ worked + adjustment → টার্গেটে এটাই যায়
  earliest_hour     SMALLINT,                -- দিনের প্রথম active ঘণ্টা (0–23)
  latest_hour       SMALLINT,                -- দিনের শেষ active ঘণ্টা
  productive_sec    INT NOT NULL DEFAULT 0,
  unproductive_sec  INT NOT NULL DEFAULT 0,
  productivity_pct  NUMERIC(5,2),
  screenshot_count  INT NOT NULL DEFAULT 0,
  day_type          TEXT,                    -- worked | no_activity | holiday
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, work_date)
);
-- ⚠️ target_sec / shortfall / overtime / late_minutes / attendance এখানে নেই —
--    দৈনিক কোনো টার্গেট নেই। সব টার্গেট-হিসাব monthly_summary-তে।
```

**টেবিল সংখ্যা: ১৯** (`enrollment_codes` — G34 · `time_adjustments` — G35)।

---

## ২.১ গণনার নিয়ম *(শিফট বাদ দেওয়ার পর যে চারটি নিয়ম ছাড়া হিসাব ভুল হবে)*

### ক · মধ্যরাতে ভাগ করা — `G30`

সময়ের বাঁধন তুলে দেওয়ায় রাত ১১টার পর কাজ এখন স্বাভাবিক ঘটনা, তাই সেগমেন্ট মধ্যরাত পার হবেই।

```
এজেন্ট, প্রতিদিন ঠিক ০০:০০ (Asia/Dhaka):
  খোলা সেগমেন্ট ক্লোজ  →  সাথে সাথেই একই state-এ নতুন সেগমেন্ট খোলা
  খোলা work_session ক্লোজ (end_reason = 'day_rollover')  →  নতুন সেশন
  → স্টাফের কাছে কিছুই বদলায় না, শুধু রেকর্ড দুই তারিখে ভাগ হয়

সার্ভারের রক্ষাকবচ (এজেন্ট পুরোনো ভার্সন হলে):
  started_at ও ended_at ভিন্ন work_date-এ পড়লে সার্ভার নিজেই ভাগ করে সেভ করে
  + একটা `segment_split` ইভেন্ট লগ করে

work_date  =  started_at-এর Asia/Dhaka তারিখ (সব টেবিলে একই নিয়ম)
```

> **ফলাফল:** দিন-ক্লোজ জব আর ২৩:৩০-এ চালানো যাবে না — ওই সময় অনেকে কাজ করছে।
> নতুন সময় **০০:১৫, আগের দিনের জন্য** (§ ৬.৪ দেখুন)।

### খ · কর্মদিবস ও গতি (pace) — `G31`

`workdays_elapsed`-এর কোনো সংজ্ঞা ছিল না, অথচ প্রতিটি কার্ডের "এগিয়ে/পিছিয়ে" এর উপর দাঁড়িয়ে।

```
কর্মদিবস = মাসের সেসব দিন যেগুলো —
             (১) সাপ্তাহিক ছুটি নয়   (work_policies.weekly_off_day, ডিফল্ট শুক্র = 5)
       এবং   (২) holidays টেবিলে নেই

month_workdays     = ওই মাসের মোট কর্মদিবস (D)      → monthly_summary.month_workdays
expected_workdays  = **তার নিজের** কর্মদিবস (d)     → monthly_summary.expected_workdays
                     = D ∩ [joined_on … left_on]
leave_workdays     = তার অনুমোদিত ছুটির কর্মদিবস    → monthly_summary.leave_workdays

target_sec   = (d − ছুটি) × দৈনিক টার্গেট
workdays_elapsed = elapsedWorkdays() — নিচের চারটে সীমা মেনে
expected_sec = target_sec × workdays_elapsed / (d − ছুটি)
pace_sec     = credited_sec − expected_sec      -- ধনাত্মক = এগিয়ে (§ ২.১-ঙ)
```

> ⚠️⚠️ **এই ব্লকের তিনটে লাইন ২০২৬-০৮-১৪/১৫-তে বদলেছে, আর পুরোনো
> লাইনগুলো কেবল সেকেলে ছিল না — ওগুলোই ছিল মাঠে ধরা পড়া তিনটে বাগের
> হুবহু বর্ণনা।** যা লেখা ছিল, আর কেন ভুল ছিল:
>
> | আগে লেখা ছিল | কেন ভুল | এখন |
> |---|---|---|
> | `expected_workdays = ওই মাসের মোট কর্মদিবস` | G37 · ADR-025 — ১৫ তারিখে যোগ দেওয়া কর্মীর টার্গেটও পুরো মাসের হতো | d = **তার নিজের** কর্মদিবস; D আলাদা কলামে (পে-রোলের `d ÷ D` লাগে) |
> | `workdays_elapsed = ১ তারিখ থেকে আজ পর্যন্ত (**আজ ধরে**)` | ⚠️⚠️ এটাই ছিল tray ও Monthly পাতার **~৮৯ ঘণ্টার** ফারাকের উৎস। "আজ ধরে" মানে ভোর ৬টায় tray "৮ ঘণ্টা পিছিয়ে" দেখাত আর সন্ধ্যায় নিজে থেকেই ঠিক হয়ে যেত — একই মানুষ দিনে দুবার দুই রায় পেতেন, কেবল ঘড়ির কাঁটার কারণে। আর ট্র্যাকিং বসার আগের না-দেখা দিনগুলোও তাঁর ঘাটতি হয়ে যেত | `elapsedWindow()` — শুরু max(পর্বের শুরু, `joined_on`, **তার নিজের** ট্র্যাকিং-শুরু), শেষ min(**গতকাল**, পর্বের শেষ, `left_on`) |
> | `টার্গেট ২০৮ ঘণ্টাই থাকে — কর্মদিবস ২৪ হোক বা ২৭, বদলায় না` | ⚠️ সরাসরি ADR-025-এর বিরোধী। টার্গেট **d × ৮ঘ**, অর্থাৎ মাসভেদে ১৯২–২১৬ঘ | `target_sec = (d − ছুটি) × dailyTargetSec` |
>
> ⭐ **একটাই বাস্তবায়ন:** `server/src/summary/summary.math.ts` →
> `elapsedWindow()` / `elapsedWorkdays()` / `proratedExpectedSec()`, আর
> `summary.service` · `progress.service` (tray) · `dashboard.service`
> (Live Board) · `reports.service` চারটেই **ওই ফাংশনগুলোই ডাকে**। সূত্র
> দু'জায়গায় লেখা নয় — নইলে পরের বার একটা বদলে অন্যটা থেকে যেত (G88)।

- ⭐ **দৈনিক টার্গেটের হর পলিসির ধ্রুবক** (`work_policies.expected_workdays`,
  ডিফল্ট ২৬), ওই মাসের ক্যালেন্ডার কর্মদিবস **নয়**। ⚠️ ক্যালেন্ডার ধরলে
  ছুটি বাড়লে দৈনিক টার্গেট **বাড়ত** — অর্থাৎ ছুটি দিয়ে কর্মীর কোনো লাভই
  হতো না, আর ২৭ কর্মদিবসের আগস্টে tray বলত ৮.০০ঘ, রিপোর্ট বলত ৭.৭০ঘ।
- ⭐ **R2 — ছুটি লব ও হর দুটোতেই বাদ যায়**, তাই "প্রতি কাজের দিনে প্রত্যাশা"
  অপরিবর্তিত থাকে। ⚠️ কিন্তু d ও D **ছোঁয়া হয় না** — ছুটি সবেতন।
- `weekly_off_day = NULL` দিলে প্রতিটি ক্যালেন্ডার দিনই কর্মদিবস
- ⚠️ ছুটির দিনে কেউ কাজ করলে **ঘণ্টা পুরোপুরি গোনা হবে**, কিন্তু expected বাড়বে না — সে এগিয়ে যাবে। এটাই কাম্য।

### গ · একজনের একাধিক ডিভাইস — `G32`

`worked_sec` = ACTIVE সেগমেন্টের **যোগফল** ধরলে ডেস্কটপ ও ল্যাপটপ একসাথে চললে সময় দুইবার গুনত।

```
worked_sec = ACTIVE সেগমেন্টগুলোর UNION-এর দৈর্ঘ্য   (যোগফল নয়)

merge(employee_id, work_date):
    segs = ACTIVE segments ORDER BY started_at
    merged = []
    for s in segs:
        if merged ও s.started_at <= merged.last.ended_at:
            merged.last.ended_at = max(merged.last.ended_at, s.ended_at)
        else:
            merged.push(s)
    return Σ (ended_at − started_at) over merged
```

- একই merge `app_usage`-এও প্রযোজ্য
- দিনে overlap ১৫ মিনিট ছাড়ালে `device_overlap` অ্যালার্ট — সাধারণত এর মানে এক PC দুজন ব্যবহার করছে অথবা কোনো ভুলে-ফেলে-রাখা মেশিন চালু আছে

### ঘ · ডুপ্লিকেট ঠেকানো — `G29`

আগের ডিজাইনে "client UUID দিয়ে idempotent insert" লেখা ছিল, কিন্তু **কলামটাই কোথাও ছিল না**।

```
এজেন্ট  : প্রতিটি রেকর্ড তৈরির সময়ই একটা client_uuid (UUIDv4) বসায়,
          সেটা লোকাল outbox.db-তেও জমা থাকে — রিট্রাইয়ে একই UUID যায়
সার্ভার : INSERT ... ON CONFLICT (client_uuid) DO NOTHING
রেসপন্স : { accepted: 42, duplicates: 3 }
এজেন্ট  : দুটোকেই "সফল" ধরে queue থেকে মুছে ফেলে
```

স্ক্রিনশটে দুই স্তরের সুরক্ষা: `client_uuid` **এবং** `(device_id, slot_start, monitor_index)` ইউনিক।

### ঙ · সিস্টেমের দোষে হারানো ঘণ্টা ফেরানো — `G35`

[ADR-011d](05-Options-Decisions.md) স্টাফের claim ব্যবস্থা বাদ দিয়েছে — সেটা বহাল। কিন্তু এজেন্ট ক্র্যাশ করলে, সার্ভার ডাউন থাকলে বা PC বদলাতে হলে স্টাফ **নির্দোষ হয়েও** ঘণ্টা হারায়, আর ঠিক করার কোনো পথ ছিল না। পে-রোল বিরোধের সবচেয়ে বড় ঝুঁকি এখানেই।

```
worked_sec      = প্রকৃত ACTIVE (UNION)      ← এই সংখ্যা কখনো বদলায় না
adjustment_sec  = Σ time_adjustments.delta_sec  (revoked বাদে)
credited_sec    = worked_sec + adjustment_sec   ← ২০৮ ঘণ্টার সাথে এটাই মেলানো হয়
```

**যে ছয়টা নিয়ম এটাকে approval workflow হওয়া থেকে ঠেকায়:**

1. **স্টাফের কিছু করার নেই** — কোনো আবেদন নেই, বাটন নেই, অপেক্ষা নেই। শুধু owner-এর একটা ব্যবস্থা
2. **শুধু owner** — ম্যানেজার দেখতে পাবে, বসাতে পারবে না
3. **`reason` বাধ্যতামূলক** — খালি রাখলে `422`
4. **কাঁচা ডেটায় হাত পড়ে না** — `activity_segments` কখনো এডিট বা ডিলিট হয় না, তাই টাইমলাইন ও স্ক্রিনশট সবসময় সত্য থাকে
5. **প্রমাণের সাথে মেলানো** — সার্ভার ওই দিনের heartbeat-গ্যাপ থেকে `max_claimable_sec` হিসাব করে দেয়। তার বেশি দিলে চলবে, কিন্তু `beyond_evidence = TRUE` বসে যাবে এবং রিপোর্টে আলাদা করে দেখা যাবে
6. **স্টাফ নিজেও দেখতে পাবে** — "My hours"-এ কারণসহ (`+২ঘ ১৫মি · ১২ আগস্ট এজেন্ট বন্ধ ছিল`)। লুকানো সংশোধন নেই

ডিলিট নেই — শুধু `revoke` (রেকর্ড থেকে যায়)। প্রতিটি এন্ট্রি ও revoke `audit_log`-এ যায়।

> **ADR:** [ADR-011e](05-Options-Decisions.md)

---

## ৩. Agent — State Machine ও লজিক

### ৩.১ টাইম ট্র্যাকিং state machine

```
     input < 60s    ┌─────────────┐    input ≥ 60s
   ┌───────────────▶│  ACTIVE ▶   │───────────────┐
   │                │ গণনা চলছে    │               │
   │                │ 📸 স্ক্রিনশট* │               ▼
   │                └──────┬──────┘        ┌─────────────┐
   │                       │               │   IDLE ⏸    │
   │  mouse/keyboard       │ Win+L         │ গণনা বন্ধ    │
   │  নড়ল (সাথে সাথে)      │               │ 📸 বন্ধ      │
   │                       ▼               └──────┬──────┘
   │                ┌─────────────┐               │
   └────────────────┤  LOCKED ⏸   │◀──────────────┘
      unlock        │ 📸 বন্ধ      │
                    └─────────────┘

   * স্ক্রিনশট শুধু ০৭:০০–২৩:০০ সময়ে। এর বাইরে ACTIVE থাকলে
     সময় ঠিকই গোনা হবে, কিন্তু ছবি উঠবে না।

⚠️ মাত্র তিনটি স্টেট — ACTIVE, IDLE, LOCKED। আর কিছু নেই।
   ❌ OFF_SHIFT নেই   — সময়ের কোনো বাঁধন নেই
   ❌ BREAK/LUNCH নেই — লাঞ্চে গেলে ১ মিনিট পর এমনিতেই IDLE
   ❌ MEETING নেই     — কোনো বাটন নেই, কোনো অনুমোদন নেই
```

### ৩.২ Idle detection (প্রতি ১ সেকেন্ডে)

> ⚠️ **এই অংশটা ২০২৬-০৮-১০-এ সংশোধিত।** আগের সংস্করণে
> `Environment.TickCount − lastInput` লেখা ছিল, যা তিনভাবে ভুল — নিচের কমেন্টে ব্যাখ্যা।
> বাস্তব বাস্তবায়ন: `oXeio.Core/Tracking/IdleMath.cs` (টেস্ট করা) +
> `oXeio.Agent/Platform/IdleProbe.cs`।

```csharp
// Windows API: GetLastInputInfo() — কি-বোর্ড বা মাউসের শেষ ইনপুট কখন
// ⚠️ সেশন-ভিত্তিক: Session 0 থেকে ডাকলে ভুল ফল, তাই এজেন্ট ইউজার সেশনেই চলে
[LibraryImport("user32.dll", SetLastError = true)]
[return: MarshalAs(UnmanagedType.Bool)]
static partial bool GetLastInputInfo(ref LASTINPUTINFO p);

const int IDLE_THRESHOLD = 60;   // সেকেন্ড

void Tick()  // প্রতি ১ সেকেন্ডে
{
    var lii = new LASTINPUTINFO { cbSize = 8 };   // ⚠️ ভুল হলে false + dwTime = 0
    if (!GetLastInputInfo(ref lii)) return;       // ⚠️ ব্যর্থ হলে নমুনাই বাদ,
                                                 //    কোনো ডিফল্ট বসানো যাবে না

    // ⚠️ Environment.TickCount(64) নয় — GetTickCount64 সরাসরি P/Invoke।
    //    dwTime চলে GetTickCount ঘড়িতে; ভবিষ্যতে .NET যদি TickCount64-কে
    //    unbiased ঘড়িতে বদলায়, এই বিয়োগ কোড না বদলেই নীরবে ভুল হবে।
    uint now32 = unchecked((uint)GetTickCount64());

    // ⚠️ unchecked — ৪৯.৭ দিনে ঘড়ি উল্টে গেলেও modular বিয়োগ ঠিক উত্তর দেয়
    uint delta = unchecked(now32 - lii.dwTime);

    // ⚠️ dwTime "not guaranteed to be incremental" (Microsoft)। মাত্র ৫ সেকেন্ড
    //    এগিয়ে থাকলে এই বিয়োগ ৪৯.৭ দিনের ভুয়া নিষ্ক্রিয়তা দিত — ওই স্টাফের
    //    সারাদিনের কাজ মুছে যেত। ৬৪-বিটে নিলেও ঠিক হয় না (G44)।
    if (delta > 0x8000_0000u) delta = 0;

    int idleSec = (int)(delta / 1000);

    // ⛔ কোনো shift/workday চেক নেই — যেকোনো সময়, যেকোনো দিন গোনা হয়
    // ⛔ কোনো break/meeting মোড নেই — স্টাফের কিছু চাপতে হয় না
    if (IsWorkstationLocked())        { Transition(LOCKED);  return; }

    if (idleSec >= IDLE_THRESHOLD)
    {
        if (state == ACTIVE)
        {
            // ⭐ retro-adjust: idle শুরু হয়েছিল ৬০ সেকেন্ড আগে,
            //    তাই active segment ওইখানেই শেষ ধরা হবে
            CloseSegment(ACTIVE, endedAt: now.AddSeconds(-IDLE_THRESHOLD));
            OpenSegment(IDLE,   startedAt: now.AddSeconds(-IDLE_THRESHOLD));
        }
    }
    else
    {
        if (state != ACTIVE)
        {
            CloseSegment(state, endedAt: now);
            OpenSegment(ACTIVE, startedAt: now);   // input পেলেই সাথে সাথে resume
        }
        activeSecondsToday++;
    }
}
```

**ফলাফল:** `worked_sec` = শুধু ACTIVE সেগমেন্টের যোগফল। কেউ ১০ মিনিট PC ছেড়ে গেলে ঠিক ১০ মিনিটই বাদ যাবে — এক সেকেন্ড বেশিও নয়, কমও নয়।

### ৩.২.১ মাসিক টার্গেট ও গতি (pace) হিসাব

> ⚠️⚠️ **এই ব্লকটাও ২০২৬-০৮-১৫-তে সংশোধিত।** আগে এখানে
> `const MONTH_TARGET = 208 * 3600` ছিল আর চারটে হিসাবই ওই ফ্ল্যাট সংখ্যার
> বিরুদ্ধে হতো — অর্থাৎ ১৫ তারিখে যোগ দেওয়া কর্মীও পুরো ২০৮ ঘণ্টার ঘাটতি
> নিয়ে শুরু করতেন (G37 · ADR-025)। আর শেষ লাইনে `pace_sec = worked_sec −
> expected_sec` লেখা ছিল, যেটা ঠিক উপরের লাইনটার (`credited_sec`) সাথেই
> **বিরোধী**: সার্ভারের দোষে ঘণ্টা হারানো স্টাফ owner-এর সংশোধনের পরেও
> সারা মাস "পিছিয়ে" দেখতেন, আর সংশোধনটার পুরো উদ্দেশ্যই ব্যর্থ হতো (§ ২.১-ঙ · G35)।

```csharp
// ⭐ টার্গেট **ফ্ল্যাট ২০৮ নয়** — প্রতি কর্মীর নিজের (§ ২.১-খ, ADR-025)
target_sec    = (d − leave_workdays) * daily_target_sec

// মাসের মোট — দিনের যেকোনো সময়ের, যেকোনো দিনের
worked_sec    = UNION(ACTIVE) over the month   // কাঁচা হিসাব, § ২.১-গ
credited_sec  = worked_sec + adjustment_sec    // owner-এর সংশোধন ধরে, § ২.১-ঙ
shortfall_sec = Math.Max(0, target_sec - credited_sec)
overtime_sec  = Math.Max(0, credited_sec - target_sec)
target_met    = credited_sec >= target_sec

// গতি — মাসের মাঝপথে কে কোথায় দাঁড়িয়ে
// ⚠️ workdays_elapsed ও d-এর সংজ্ঞা § ২.১-খ (হার্ডকোড ২৬ নয়)
expected_sec  = target_sec * (workdays_elapsed / (double)(d - leave_workdays))
pace_sec      = credited_sec - expected_sec    // ⚠️ credited, worked নয় (G35)
```

**Tray-তে সবসময় দেখা যাবে:**
```
🟢 oXeio · এই মাসে  ৬৩.৪ / ২০৮ ঘণ্টা   ✓ ৭.৪ঘ এগিয়ে
             আজ    ৫ঘ ৪২মি
🟢 oXeio · এই মাসে ২০৮.০ / ২০৮ ঘণ্টা   ✅ টার্গেট সম্পূর্ণ
```

**যা আর নেই:** দেরির ফ্ল্যাগ, আগে চলে যাওয়ার ফ্ল্যাগ, লাঞ্চের হিসাব,
শিফটের বাইরের ধারণা।

⚠️ **"দৈনিক টার্গেট নেই" কথাটা আর সত্যি নয়** — এখানে আগে ওটাও এই তালিকায়
ছিল। দৈনিক টার্গেট (`monthlyTargetHours ÷ policy.expected_workdays`, ডিফল্ট
২০৮ ÷ ২৬ = ৮ঘ) এখন **সংখ্যা হিসেবে ব্যবহৃত হয়**: কার্ডের progress ring
(E02), Live Board-এর "Met today's target" টাইল, tray-র আজকের বার, আর
রিপোর্টের প্রতিদিনের `targetSecOf()` — সবই ওটা দিয়ে চলে।

⭐ তবু **মাপকাঠিটা মাসিকই** — একদিন কম হলে কিছু হয় না, মাস শেষে
`target_sec` পূর্ণ হলেই হলো। দৈনিক সংখ্যাটা "আজ কেমন যাচ্ছে" বলে, "আজ
ব্যর্থ" বলে না। ⚠️ ছুটির দিনে ওটা ০, আর তখন খালি বার নয়, একটা বাক্য
দেখানো হয় (J04)।

### ৩.৩ Screenshot scheduler (৫ মিনিট স্লট, র‍্যান্ডম সময়)

```csharp
// প্রতিটা ৫-মিনিট স্লটে একবার, স্লটের ভেতরে র‍্যান্ডম সেকেন্ডে
void ScheduleNextSlot()
{
    DateTime slotStart = FloorTo5Min(DateTime.Now).AddMinutes(5);
    int      offsetSec = rng.Next(0, 300);          // 0–299 সেকেন্ড
    DateTime fireAt    = slotStart.AddSeconds(offsetSec);

    timer.RunAt(fireAt, () => {
        // শুধু ACTIVE + ০৭:০০–২৩:০০ ক্যাপচার উইন্ডো। কোনো শিফট চেক নেই।
        if (state == ACTIVE && IsWithinCaptureWindow(fireAt))
            CaptureAllMonitors(slotStart, fireAt);
        ScheduleNextSlot();
    });
}
```

উদাহরণ — একজনের সকালের স্ক্রিনশট:
```
[09:00–09:05] → 09:03:47      [09:15–09:20] → 09:19:55
[09:05–09:10] → 09:06:12      [09:20–09:25] → ⏭ স্কিপ (idle ছিল)
[09:10–09:15] → 09:12:31      [09:25–09:30] → 09:25:08
```

### ৩.৪ App / Website tracking

```csharp
// প্রতি ২ সেকেন্ডে foreground window চেক
var hwnd  = GetForegroundWindow();
var proc  = GetProcessName(hwnd);        // chrome.exe
var title = GetWindowText(hwnd);         // "Facebook - Google Chrome"

// ব্রাউজার হলে UI Automation দিয়ে address bar থেকে শুধু ডোমেইন
if (IsBrowser(proc))
    domain = ExtractDomain(GetBrowserUrl(hwnd));   // "facebook.com" — ফুল URL নয়

// অ্যাপ বদলালে আগেরটার segment ক্লোজ করে নতুন segment শুরু
// ৫ সেকেন্ডের কম হলে ধরা হবে না (alt-tab করার সময় নয়েজ কমাতে)
```

### ৩.৫ Offline queue

```
%ProgramData%\oXeio\
  ├─ outbox.db             (SQLite — segments, events, app_usage)
  ├─ queue\screenshots\    (আপলোড না হওয়া স্ক্রিনশট)
  ├─ logs\agent.log        (H08 — এজেন্টের নিজের লগ, আজকেরটা)
  ├─ logs\agent-YYYY-MM-DD.log (আগের দিনগুলো — ৭ দিন, সব মিলিয়ে ৫০ MB)
  ├─ logs\outbox-drops.log (যা চিরতরে ফেলে দেওয়া হলো তার একমাত্র সাক্ষী)
  └─ watchdog.log          (watchdog লেখে — এজেন্টের প্রসেস বেঁচে আছে কি না)
```
- ⚠️ **`config.json` বলে কিছু নেই** — কনফিগ ডিস্কে জমে না, প্রতিবার চালু হলে ও প্রতিটা বদলে সার্ভার থেকেই আসে (§ ৪.১)
- সার্ভার ডাউন থাকলে সব লোকালি জমা থাকবে (৭ দিন পর্যন্ত)
- সার্ভার ফিরলে ব্যাকগ্রাউন্ডে ধীরে ধীরে আপলোড (exponential backoff)
- ডুপ্লিকেট ঠেকাতে প্রতিটা রেকর্ডে client-generated UUID → সার্ভারে idempotent insert

### ৩.৬ প্রসেস মডেল

```
oXeio.Agent.exe       ← ইউজার সেশনে tray app (স্ক্রিনশট এখান থেকেই সম্ভব)
                        ⚠️ নিজের কোনো Scheduled Task নেই — watchdog-ই চালায়
oXeio.Watchdog.exe    ← লগঅনের Scheduled Task (H02); প্রতি ৩০ সেকেন্ডে চেক,
                        agent বন্ধ থাকলে আবার চালু + সার্ভারে অ্যালার্ট
```

> ⚠️ **watchdog কোনো Windows Service নয়** — `oXeio.Watchdog/Program.cs`-এ `ServiceBase`
> নেই। ওটা লগঅনের একটা Scheduled Task (`\oXeio\oXeio Watchdog`, `--install-task`
> একবার বসায়), আর ইউজার সেশনেই চলে: Session 0-তে পড়লে নিজেই থেমে যায়, কারণ ওখান
> থেকে চালানো এজেন্ট সাথে সাথেই মরত (`GetLastInputInfo` সেশন-ভিত্তিক, § ৩.২)।
>
> ⚠️ **টাস্ক ওই একটাই — এজেন্টের নিজের কোনো লগঅন টাস্ক নেই**, ইচ্ছাকৃতভাবে
> (`installer/Package.wxs`, `Deployment/WatchdogTask.xml`)। দুই জায়গা থেকে চালু
> হলে এক মেশিনে দুটো এজেন্ট চলত আর একই ঘণ্টা দুবার গোনা হতো।

---

## ৪. API Contract

Base: `https://oxeio-server.local/api/v1` · সব রেসপন্স JSON

### ৪.১ Agent endpoints — auth: `Authorization: Bearer <device_token>`

| Method | Endpoint | কাজ |
|---|---|---|
| POST | `/agent/enroll-login` | ⭐ **সাধারণ পথ** — স্টাফ নিজের ইমেইল-পাসওয়ার্ড দিয়ে নিজের PC যোগ করে। `{email, password, totp?, hostname, windowsUsername, machineGuid, …}` → `{deviceId, deviceToken, employee, configVersion, config}`, অথবা 2FA চালু থাকলে `{status: "needs_totp"}` (দুটোই **২০০**)। ⚠️ যাচাই `AuthService.login()`-এই — throttle · 2FA · audit তিনটেই ওখান থেকে আসে। owner/manager-এর অ্যাকাউন্টে **৪০৩** |
| POST | `/agent/enroll` | একবার-ব্যবহার্য কোড দিয়ে (**স্ক্রিপ্টেড রোলআউটের পথ**)। `{enrollmentCode, hostname, windowsUsername, machineGuid, osVersion?, agentVersion?, monitors?}` → একই উত্তর। `deviceToken` **এই একবারই** যায়, সার্ভারে শুধু sha256 |
| GET | `/agent/config` | কনফিগ সিঙ্ক (capture window, interval, idle threshold) → `{version, config}`। `version` = কনফিগের sha256-এর প্রথম ১৬ অক্ষর, আলাদা কাউন্টার নেই |
| POST | `/agent/heartbeat` | প্রতি **১৫ সেকেন্ডে** (সার্ভারের `heartbeatSec`, ছাদ-মেঝে ১৫ সে.–৫ মি.), **আর অবস্থা বদলালে সাথে সাথেই** (`HeartbeatUrgency`, দুটোর মধ্যে সর্বনিম্ন ব্যবধান ৩ সে.)। ⚠️ শেষটা যোগ হয়েছে ১৭ আগস্ট: কর্মী কাজ শুরু করার পরেও বোর্ডে ১০–১৫ সে. "Idle" থাকত, আর ক্ষতিটা ছিল বিশ্বাসের — মালিক পর্দায় দেখেন "Idle", পাশে গিয়ে দেখেন তিনি টাইপ করছেন। `{state, activeSecToday, queueDepth?, configVersion?, agentVersion?}` → `{commands, configVersion, progress}` (↓ দুটোই নিচে) |
| POST | `/agent/segments` | ব্যাচে activity segments (প্রতি ১ মিনিটে) |
| POST | `/agent/app-usage` | ব্যাচে app/website usage |
| POST | `/agent/events` | logon/logoff/lock/sleep ইত্যাদি |
| POST | `/agent/screenshots` | `multipart/form-data`: `meta` (JSON) + `file` (webp) |
| GET | `/agent/update` | ⭐ *নতুন* — `?current=1.2.0` → `{version, sha256, url, mandatory}` অথবা `204 No Content`। `agent_versions.rollout_stage` মেনে ধাপে ধাপে দেয় |
| GET | `/agent/update/download` | ⭐ *নতুন* — MSI স্ট্রিম (device token লাগবে) |

> ⚠️ **তারে সব ফিল্ডের নাম camelCase** — এজেন্টে `JsonNamingPolicy.CamelCase`, সার্ভারে
> class-validator DTO, দুই পাশে একই নিয়ম। সার্ভারে `whitelist + forbidNonWhitelisted`
> চালু, তাই `active_sec_today` পাঠালে সেটা চুপচাপ উপেক্ষা হয় না — **৪০০** হয়।

**সব ingest endpoint-এ বাধ্যতামূলক:**
- প্রতিটি রেকর্ডে `clientUuid` — না থাকলে `422`; ডুপ্লিকেট হলে `{accepted, duplicates, split}` (§ ২.১-ঘ)
- প্রতিটি রিকোয়েস্টে **`X-Client-Time`** হেডার (ISO-8601) — clock drift হিসাবের জন্য ([02-Workflow §2](02-Workflow.md))। হেডার হিসেবে রাখা হয়েছে যাতে GET-এও পাঠানো যায়
- ব্যাচের সর্বোচ্চ আকার **৫০০ রেকর্ড**; স্ক্রিনশট ফাইল সর্বোচ্চ **৫ MB**, শুধু `image/webp`
- ডিভাইসপ্রতি rate limit: ingest ৬০ req/মিনিট, screenshot ২০ req/মিনিট

**সার্ভার → এজেন্ট commands** (heartbeat-এর রেসপন্সে): `reload_config`, `capture_now`, `pause_tracking`, `update_agent`, `revoke`

⚠️ এর মধ্যে সার্ভার আজ **শুধু দুটো পাঠায়** — `reload_config` (এজেন্টের `configVersion`
সার্ভারেরটার সাথে না মিললে) আর `update_agent`। `capture_now`/`pause_tracking`-এর জন্য
একটা কমান্ড-কিউ টেবিল লাগবে, কারণ ড্যাশবোর্ডে চাপা বাটনটা পরের heartbeat পর্যন্ত
কোথাও জমা থাকতে হয়। আর `revoke` কমান্ড হয়েই আসে না — revoke করা ডিভাইস পরের
রিকোয়েস্টেই `DeviceAuthGuard`-এর কাছে **৪০৩** পায়, এজেন্ট সেটা দেখেই থামে।

**⭐ এজেন্ট কনফিগ সত্যিই আনে ও প্রয়োগ করে** — আগে `GET /agent/config` কেউ ডাকতই না,
আর heartbeat হ্যান্ডলার সার্ভারের `configVersion` অন্ধভাবে নিজের বলে বসিয়ে নিত। পরের
heartbeat-এ ভার্সন মিলে যেত, তাই সার্ভার আর কোনোদিন `reload_config` চাইত না — ফলে
ড্যাশবোর্ডের Settings-এ যা-ই বদলানো হোক, ১৫টা PC-র একটাও কিছু জানত না। এখন:

- **আনা হয়** — `reload_config` কমান্ড এলে **অথবা** ভার্সন না মিললে। দ্বিতীয় শর্তটা
  ছাড়া চলত না: সদ্য চালু হওয়া এজেন্টের `configVersion` `null`, আর তখন সার্ভারের
  চোখে "কিছু বদলায়নি" — শুধু কমান্ডের ভরসায় থাকলে রিবুটের পর সে চিরকাল ডিফল্ট
  কনফিগেই চলত
- **প্রয়োগ হয় TrackLoop-এ**, heartbeat থ্রেডে নয় — ট্র্যাকিংয়ের অবজেক্টগুলো ওই
  থ্রেডের, বাইরে থেকে ছুঁলে এক সেকেন্ডের হিসাব দুই কনফিগে ভাগ হয়ে ঘণ্টা হারাত
- **যা বদলায়নি তাতে হাত পড়ে না** (`ConfigChange`) — নইলে সার্ভারে কনফিগ save করলেই
  সবার চলতি সেগমেন্ট অকারণে কাটা পড়ত। চলতি স্লটও যেমন চলছিল তেমনই শেষ হয়
- কনফিগ আনতে ব্যর্থ হলে পুরোনোটাতেই চলে — কনফিগ না পাওয়া মানে ঘণ্টা গোনা থামা নয়

**heartbeat-এর `progress`** — ⭐ tray-র সংখ্যাগুলো সার্ভারই দেয়, কারণ এজেন্ট নিজে
মাসের হিসাব জানে না: রিবুট বা আপডেটের পর তার কাউন্টার শূন্য, আর স্টাফ তখন tray-তে
"০ঘ / ২০৮ঘ" দেখে ভাবত তার মাসের কাজ মুছে গেছে। ডিভাইসে কর্মী বসানো না থাকলে `null`।

| ফিল্ড | কী |
|---|---|
| `todayActiveSec` · `monthActiveSec` | ঢাকার আজ ও চলতি মাসে গোনা সেকেন্ড |
| `monthlyTargetHours` | ওই কর্মীর work policy থেকে — হার্ডকোড ২০৮ নয় |
| `paceSec` | `credited − expected`; ধনাত্মক = এগিয়ে (§ ২.১-খ · ২.১-ঙ)। ⭐ `worked` নয় **`credited`** — নইলে owner-এর সংশোধনের পরেও tray সারা মাস "পিছিয়ে" দেখাত আর ড্যাশবোর্ড দেখাত এগিয়ে |
| `dailyTargetSec` | ⭐ *নতুন* — মাসিক টার্গেট ÷ ওই মাসের কর্মদিবস। ⚠️ **ছুটির দিনে ০**, আর ০ (`আজ কিছু করার নেই`) `null`-এর (`সার্ভার বলেনি`) চেয়ে আলাদা। DB-তে দৈনিক টার্গেটের কলাম নেই, ইচ্ছাকৃতভাবে — এটা শুধু দেখানোর সংখ্যা |
| `week7ActiveSec` | ⭐ *নতুন* — গত ৭ দিনে (আজ ধরে) গোনা সেকেন্ড |
| `week7TargetSec` | ⭐ *নতুন* — ওই ৭ দিনের কর্মদিবস × দৈনিক টার্গেট। ⚠️ "চলতি সপ্তাহ" নয়, **রোলিং ৭ দিন** — এই সিস্টেমে সপ্তাহের কোনো সীমানাই নেই (§ ১: যেকোনো দিন গোনা হয়), "এই সপ্তাহ" বানাতে গেলে সপ্তাহ কবে শুরু সেই নতুন ধারণা আমদানি করতে হতো |

⚠️ প্রতিটা ফিল্ড এজেন্টের কাছে **ঐচ্ছিক** — সার্ভার না পাঠালে সে নিজের আন্দাজে ফেরত
যায় (সে `holidays` টেবিল চেনে না, তাই শুধু সাপ্তাহিক ছুটি বাদ দিয়ে গোনে আর জানালায়
"আনুমানিক" লিখে রাখে)। তাই পুরোনো সার্ভার বা পুরোনো এজেন্ট কোনোটাতেই ভাঙে না।

### ৪.২ Dashboard endpoints — auth: JWT cookie (httpOnly)

> ⚠️ **ক্যোয়ারি প্যারামিটারও camelCase** — `?employeeId=3`, `?groupBy=week`,
> `?targetType=`, `?pageSize=`। এখানে snake_case লেখা ছিল, কোডে কখনোই ছিল না।
> ⭐ ভুলটা নীরব নয়: গ্লোবাল ValidationPipe-এ `forbidNonWhitelisted` চালু, তাই
> `?employee_id=3` "উপেক্ষিত হয়ে সবার ডেটা" ফেরত দেয় না — **৪০০** দেয়।

| Method | Endpoint | কাজ |
|---|---|---|
| POST | `/auth/login` · `/auth/logout` · `/auth/me` | লগইন (argon2id + ঐচ্ছিক TOTP) |
| POST | `/auth/change-password` | ⭐ *নতুন* — নিজের পাসওয়ার্ড বদলানো। `must_change_pw = TRUE` হলে লগইনের পর অন্য কিছু করার আগে এটাই করতে হবে |
| POST | `/users/:id/reset-password` | ⭐ *নতুন* — **owner only**। একবার-দেখানো temp পাসওয়ার্ড ফেরত দেয়, `must_change_pw = TRUE` বসিয়ে দেয়। SMTP লাগে না, তাই Phase 1-এই সম্ভব |
| POST | `/employees/:id/portal-account` | ⭐ *নতুন* — **owner only**। স্টাফের self-view অ্যাকাউন্ট (`role = employee`) খোলে |
| POST | `/employees/:id/policy-signed` | ⭐ **owner only** — নীতিমালায় সইয়ের তারিখ বসানো (`DELETE` দিয়ে তুলে নেওয়া)। ⚠️ ভবিষ্যতের তারিখ নেওয়া হয় না; তারিখ না দিলে ঢাকার আজ |
| POST | `/employees/:id/policy-doc` | ⏳ **এখনো কোডে নেই** — সই করা কাগজের স্ক্যান আপলোড → `policy_doc_path`। তারিখটা উপরের রুট দিয়েই বসে |
| POST | `/devices/enrollment-code` | ⭐ *নতুন* — **owner only**। `{employeeId}` → `{code, expiresAt, employee}`; কোড একবারই দেখানো হয়, DB-তে শুধু hash। ⚠️ `inactive` কর্মীর নামে কোড দেওয়া যায় না |
| GET | `/employees/:id/downtime?date=` | ⭐ *নতুন* — ওই দিনে এজেন্ট কতক্ষণ চুপ ছিল → `{max_claimable_sec, gaps: [...]}`; সংশোধন বসানোর আগে এটাই প্রস্তাবিত পরিমাণ দেখায় |
| POST | `/employees/:id/time-adjustments` | ⭐ *নতুন* — **owner only**। `{work_date, delta_sec, cause, reason}` → `201`। `reason` খালি হলে `422`; `delta_sec > max_claimable_sec` হলে `beyond_evidence = TRUE` বসে |
| GET | `/employees/:id/time-adjustments?from=&to=` | সংশোধনের তালিকা। **স্টাফ নিজেরটা দেখতে পাবে** (role=employee) |
| POST | `/time-adjustments/:id/revoke` | ⭐ *নতুন* — **owner only**। ডিলিট নয়, `revoked_at` বসে |
| GET | `/me` | ⭐ **কর্মীর নিজের ডেটা** (J05) — নাম · আজ · মাস · pace · সইয়ের তারিখ · ছবি কতদিন থাকে। ⚠️⚠️ পথে **কোনো `:id` নেই**, আইডি আসে সেশন থেকে — তাই সহকর্মীর ডেটা চাওয়ার উপায়ই নেই |
| GET | `/me/days?from=&to=` | ⭐ নিজের দিনে-দিনে ঘণ্টা, ছুটি ও ফাঁকা দিনসহ। সর্বোচ্চ ৯২ দিন |
| GET | `/live` | এখন কে online/idle/offline — ড্যাশবোর্ডের হোম |
| GET | `/employees` · `/employees/:id` | স্টাফ লিস্ট ও প্রোফাইল |
| GET | `/employees/:id/timeline?date=` | ওই দিনের সেকেন্ড-বাই-সেকেন্ড টাইমলাইন |
| GET | `/screenshots?employeeId=&date=&page=` | স্ক্রিনশট গ্যালারি (audit_log-এ রেকর্ড হবে) |
| GET | `/screenshots/:id/file?token=` | signed URL, ৫ মিনিটে expire। ⚠️ এটা `@Public()` — ব্রাউজার `<img src>`-এ কাস্টম হেডার পাঠাতে পারে না, তাই যাচাইটা পুরোপুরি টোকেনের উপরে |
| GET | `/reports/attendance?from=&to=&format=json\|xlsx\|pdf` | অ্যাটেনডেন্স রিপোর্ট |
| GET | `/reports/summary?from=&to=&groupBy=week\|month&format=json\|xlsx\|pdf` | ⭐ *নতুন* — সাপ্তাহিক/মাসিক সারাংশ |
| GET | `/reports/productivity?from=&to=&limit=` | অ্যাপ/সাইট ভিত্তিক productivity। ⚠️ এখানে `format=pdf` **নেই** — DTO-তেই আটকানো, তাই পরিষ্কার ৪০০ আসে, চুপচাপ JSON নয় |
| GET | `/payroll?month=` | পে-রোল ঘণ্টার হিসাব। ⚠️ `/reports/`-এর নিচে **নয়**, আলাদা মডিউল — কারণ reports কন্ট্রোলার owner+manager, আর এটা **owner only**। এক ক্লাসে এনে ফেললে ম্যানেজারও বেতনের শিট পেতেন |
| GET·PATCH·POST | `/deposits` · `/deposits/policy` · `/deposits/:employeeId/settle` | ⭐ **owner only** (R21) — সিকিউরিটি মানি। ⚠️ ম্যানেজারও নয়: জামানত সরাসরি বেতনের অংশ। ⭐⭐ খাতা **লিখে রাখা** হয়, গোনা হয় না — অঙ্ক বদলালে পুরোনো কিস্তি নড়ে না। ⚠️ `settle` দ্বিতীয়বার ডাকলে **৪০৯**; সিদ্ধান্ত মালিকের, সিস্টেম কেবল নোটিশের দিন গুনে সারিতে লেখে ([ADR-028](05-Options-Decisions.md)) |
| GET | `/me/deposit` | ⭐ কর্মীর **নিজের** জমা — মোট ও মাস ধরে তালিকা। ⚠️ পথে `:id` নেই, কর্মী আসে সেশন থেকে (বাকি `/me/*`-এর মতোই) |
| POST | `/devices/:id/revoke` · `/devices/:id/restore` | ⭐ *নতুন* (restore) — H06। ডিভাইস বন্ধ করা ও ফেরানো, ডিলিট নয় |
| POST | `/employees/:id/deactivate` · `/employees/:id/reactivate` | ⭐ *নতুন* (reactivate) — ⚠️ `DELETE` ইচ্ছাকৃতভাবে নেই: সারি মুছলে ওই কর্মীর মাসের হিসাব, স্ক্রিনশট ও audit trail অনাথ হয়ে যেত |
| POST | `/work-policies/:id/deactivate` | ⭐ *নতুন* — পলিসিও মোছা যায় না, ওর দিকে employees আর পুরোনো মাসের হিসাব তাকিয়ে আছে |
| CRUD | `/work-policies` `/devices` | **owner only** |
| POST·PATCH | `/employees` · `/employees/:id` | ⭐ **owner + manager** *(১৫ আগস্ট)* — কর্মী যোগ ও এডিট রোজকার কাজ। ⚠️ role শিথিল **মেথডে, ক্লাসে নয়**: তাই একই কন্ট্রোলারের `deactivate` · `reactivate` · `portal-account` · `policy-signed` · `agent/turn-on` owner-only থেকেই যায়, **আর ভবিষ্যতে যোগ হওয়া নতুন রুটও**। ⚠️⚠️ `monthlySalary` পাঠালে ম্যানেজার **৪০৩** পান (`null`-ও) — `redact.ts` কেবল **উত্তর** ছাঁকে, **লেখা** আটকায় না; দুটো এক সাথে না করলে ম্যানেজার এমন ঘরে লিখতেন যা তিনি পড়তেও পারেন না |
| CRUD | `/categories` `/holidays` | ⭐ **owner + manager** *(১৫ আগস্ট)* — এখানে **ক্লাস-লেভেলে**, কারণ গোটা কন্ট্রোলারই ম্যানেজারের। ⚠️ ছুটির তারিখ টাকা নাড়ায় (`d ÷ D`) আর `recategorize` সবার পুরোনো রিপোর্টের সংখ্যা বদলায় — দুটোই `audit_log`-এ নাম ধরে লেখা, আর বন্ধ মাস (R1) কেউই ছুঁতে পারে না |
| GET·POST·DELETE | `/leaves?month=` · `/leaves` · `/leaves/:id` | ⭐ **owner only** (R2) — ছুটির খাতা। ⚠️ `?month=` **বাধ্যতামূলক**: খাতা বছরের পর বছর বাড়ে, আর "সব ছুটি" চাওয়ার মতো পর্দা নেই। ⭐ POST **রেঞ্জ ধরে** (`from`/`to`) — মানুষ "১০ থেকে ১৪" ছুটি নেয়, "১০" পাঁচবার নয়; আগে থেকেই খাতায় থাকা দিন বাদ পড়ে আর উত্তরে `skipped[]` হয়ে ফেরে, নইলে পর্দা "৫টা যোগ হয়েছে" বলত যখন আসলে ৩টা। ⚠️ manager নেই — ছুটির খাতা বেতনের ভিত্তি নাড়ায় (দিনটা সবেতন, টার্গেট কমে), আর ম্যানেজার বেতনের সংখ্যাই দেখেন না। ⚠️ ১৫ আগস্টের আগে যুক্তিটা ছিল *"গোটা Settings owner-এর"* — সেটা আর সত্যি নয় (ম্যানেজার Staff · Categories · Holidays পান), কিন্তু **সিদ্ধান্তটা বদলায়নি**, শুধু কারণটা এখন নিজের পায়ে দাঁড়িয়ে |
| GET·POST·DELETE | `/months` · `/months/:yearMonth/close` · `/months/:yearMonth` | ⭐ **owner only** (R1) — মাস বন্ধ/খোলা। ⚠️ ম্যানেজার নয় ইচ্ছাকৃতভাবে: বন্ধ করা মানে বেতনের ভিত্তি স্থির করা, আর ম্যানেজার বেতনের সংখ্যা দেখেনই না। ⚠️ খোলা = `DELETE` (নতুন কিছু তৈরি নয়, বন্ধের রেকর্ডটা তুলে নেওয়া) |
| GET | `/audit-log?userId=&action=&targetType=&targetId=&from=&to=&page=&pageSize=` | **owner only** |
| GET | `/agent-versions` | ⭐ **owner only** (H04) — কোন বিল্ড বেরিয়েছে, কোন ধাপে, কতগুলো PC ইতিমধ্যে ওই ভার্সনে |
| POST | `/agent-versions` | ⭐ **owner only** — নতুন বিল্ড বিলির জন্য নথিভুক্ত। ⚠️ `sha256` **ঐচ্ছিক** — সার্ভার নিজে ফাইল পড়ে হিসাব করে; দিলে মিলিয়ে দেখে |
| POST | `/agent-versions/:version/stage` | ⭐ **owner only** — `canary`/`partial`/`all`/**`halted`**। খারাপ বিল্ড থামানোর একমাত্র ব্রেক (rollback নেই, G69) |
| GET | `/ops/health` | **owner only** (K04) — ডিস্ক, ব্যাকআপের ইতিহাস, চুপ থাকা ডিভাইস। ⚠️ Docker healthcheck এটা **নয়**, সেটা পাবলিক `/health` |
| POST | `/ops/backup/run` | **owner only** (K02) — এখনই একটা ব্যাকআপ। উত্তরে কোনো ফাইল-পাথ যায় না |
| POST | `/ops/retention/run` | ⭐ **owner only** (K01) — এখনই ৯০ দিনের পুরোনো ছবি মোছা। রাত ২টার cron তো আছেই; এটা যাচাইয়ের পথ |

> ⚠️ **যেগুলো এখনো শুধু ডিজাইন, কোডে নেই:** `GET /employees/:id/downtime`
> (সংশোধনের আগে "কতটা দাবি করা যায়" দেখানো) · `POST /employees/:id/policy-doc`
> (সই করা কাগজের স্ক্যান আপলোড) আর `/settings`-এর CRUD — তাই উপরের CRUD
> সারি থেকে `/settings` তুলে দেওয়া হলো।
>
> ✅ **১২ আগস্ট বন্ধ হয়েছে:** `POST|GET /employees/:id/time-adjustments` ও
> `POST /time-adjustments/:id/revoke` (G35-এর পুরো পথ) ·
> `POST /employees/:id/policy-signed` (রোলআউটের শর্ত — তারিখটা এখন বসানো
> যায়) · `GET /me` ও `/me/days` (J05) · `POST /ops/retention/run` (K01) ·
> `POST /agent/enroll-login`। কোডে আজ কী আছে তার হালনাগাদ তালিকা
> [09-Build-Log § ৩ক](09-Build-Log.md)।

### ৪.৩ Role permission

*(⭐ ম্যানেজারের কলামটা **১৫ আগস্ট বদলেছে** — মালিকের সিদ্ধান্ত:
*"ami cai manager staff, holyday, catagory er access pabe"*।
পুরো গল্প [09 § ৩ঘ২](09-Build-Log.md), সিদ্ধান্তটা
[ADR-027](05-Options-Decisions.md)।)*

| ক্ষমতা | Owner (আপনি) | Manager |
|---|:---:|:---:|
| লাইভ ভিউ, টাইমলাইন, স্ক্রিনশট দেখা | ✅ | ✅ |
| রিপোর্ট ও এক্সপোর্ট | ✅ | ✅ |
| ⭐ **কর্মী যোগ ও এডিট** | ✅ | ✅ |
| ⭐ **ছুটির ক্যালেন্ডার** — দেখা ও বদলানো | ✅ | ✅ |
| ⭐ **ক্যাটাগরি রুল** — দেখা, বদলানো, recategorize | ✅ | ✅ |
| ⚠️ **বেতন** — দেখা *বা* বসানো | ✅ | ❌ *(পাঠালে ৪০৩)* |
| কর্মী নিষ্ক্রিয়/সক্রিয় করা, portal account, পাসওয়ার্ড রিসেট | ✅ | ❌ |
| Work policy (মাসিক টার্গেট, ছবির উইন্ডো, idle, retention) | ✅ | ❌ |
| **ঘণ্টা সংশোধন** (`time_adjustments`) বসানো / revoke | ✅ | ❌ *(দেখতে পাবে)* |
| ছুটির খাতা (`leaves`) · মাস বন্ধ করা · এজেন্ট আপডেট বিলি | ✅ | ❌ |
| ⭐ **সিকিউরিটি মানি** — জমা দেখা, নিয়ম বদলানো, ফেরত/বাজেয়াপ্ত | ✅ | ❌ |
| Device revoke / audit log / অ্যালার্ট | ✅ | ❌ |

⚠️⚠️ **বেতনের সারিটা দু-দিকেই বন্ধ, আর সেটাই আসল কথা।** `redact.ts`
ম্যানেজারের **উত্তর থেকে** বেতন ছেঁকে ফেলে (ADR-023), কিন্তু সেটা তাঁকে
বেতন **পাঠানো** থেকে আটকাত না — আর কর্মী এডিট খুলে দেওয়ার দিনই ওই ফাঁকটা
কাজে লাগত। তাই `EmployeesService.assertMaySetSalary()` আলাদা করে ৪০৩ দেয়,
`monthlySalary: null` পাঠালেও। ⭐ নীরবে ফিল্ডটা বাদ দেওয়া হয় **না** — বাদ
দিলে ম্যানেজার ভাবতেন বেতন বসে গেছে।

⚠️ **এক অধিকার = তিন জায়গা** (ওয়েবে): নেভ (`Layout`) · রুট (`App.tsx`) ·
পর্দা (`SettingsPage`)। ১৫ আগস্ট তিনটের দুটো খুলে তৃতীয়টা ভুলে যাওয়ায়
ম্যানেজার নেভে Settings দেখতেন আর চাপলে "Not found" পেতেন (G134)।

---

## ৫. Dashboard — স্ক্রিন লিস্ট

| স্ক্রিন | কী থাকবে |
|---|---|
| **Live Board** | দলের সারাংশ — KPI টাইল, দিনের ছন্দ ও অন্যান্য চার্ট, দলের টেবিল, খোলা অ্যালার্ট। ⚠️⚠️ **কার্ড এখানে নেই** *(১৭ আগস্ট)* — নিচের `Worklog` দেখুন |
| **Worklog** ⭐ | ১৫টা কার্ড — ছবি, নাম, স্ট্যাটাস (🟢 Working / 🟡 Idle / ⚪ Offline), আজকের worked time, লাস্ট স্ক্রিনশট থাম্বনেইল। Working / Not working ট্যাব। ⭐ Live Board থেকে **সরানো**: কার্ড ছিল বোর্ডের সবার নিচে, অথচ *"এখন কে কাজ করছে"* প্রশ্নটাই সবচেয়ে বেশিবার করা |
| **Employee Detail** | দিনের টাইমলাইন বার (active/idle/break রঙে), ঘণ্টাভিত্তিক অ্যাক্টিভিটি চার্ট, টপ অ্যাপ/সাইট, ওই দিনের সব স্ক্রিনশট |
| **Screenshot Gallery** | গ্রিড ভিউ, তারিখ + স্টাফ ফিল্টার, ক্লিকে ফুল সাইজ, কি-বোর্ড নেভিগেশন |
| **মাসিক অগ্রগতি** | হিটম্যাপ (স্টাফ × তারিখ) — রঙের গভীরতা = ওই দিনের ঘণ্টা; পাশে মোট vs ২০৮ |
| **Reports** | কাস্টম ডেট রেঞ্জ → Excel/PDF ডাউনলোড |
| **Settings** | **নয়টা ট্যাব** *(১৮ আগস্ট)* — Staff · Categories · Policies & holidays (মাসিক টার্গেট, সাপ্তাহিক ছুটি, ক্যাপচার উইন্ডো, ছুটির ক্যালেন্ডার) · Leave · Months (মাস বন্ধ) · Notifications (টেলিগ্রাম) · Backup (অফসাইট, R5) · Agent updates · Audit log। ⭐ ম্যানেজার **তিনটে** পান — Staff · Categories · **Holidays** *(১৫ আগস্ট, § ৪.৩)*; তাঁর কাছে work policy-র অংশটা দেখানোই হয় না, তাই ট্যাবের নামও তাঁর জন্য আলাদা। ⚠️⚠️ **Devices ট্যাব ইচ্ছাকৃতভাবে নেই** — মালিকের কথায় *"ami Devices ei option tai chai na"*; বন্ধ এজেন্ট ফেরানোর কাজটা Staff সারিতেই ("Turn agent on"), অর্থাৎ মেশিন নয়, **মানুষ ধরে সাজানো**। ⭐ তবে *"কোন PC-তে কোন বিল্ড"* প্রশ্নের উত্তরটা **Agent updates**-এ আছে (ভার্সন ধরে দল-করা, শুধু-দেখার তালিকা — [09 § ৩ভ১১](09-Build-Log.md)); পর্দাটা ফেরানো হয়নি, উত্তরটা প্রশ্নের জায়গায় বসানো হয়েছে |

---

## ৬. সার্ভার সেটআপ (Windows, 24 GB RAM, 1 TB NVMe)

### ৬.১ স্ট্যাক
```
Docker Desktop (WSL2 backend)
  ├─ postgres:16          — 4 GB RAM allocate
  ├─ oxeio-api  (Node 22) — 2 GB
  ├─ oxeio-web  (nginx)   — static React build
  └─ caddy                — HTTPS/TLS reverse proxy (auto self-signed cert)
```
WSL2-কে ৮ GB দিলেই যথেষ্ট (`.wslconfig`), বাকি ১৬ GB Windows-এর জন্য থাকবে।

> **বিকল্প:** Docker না চাইলে নেটিভও চলবে — PostgreSQL Windows installer + Node.js + **NSSM** দিয়ে Windows Service বানিয়ে। তবে আপডেট ও ব্যাকআপ Docker-এ অনেক সহজ।

### ৬.২ ফাইল লেআউট
```
/data/
  ├─ storage\screenshots\2026\08\09\emp-003\
  │     093147_m0.webp      (ফুল)
  │     093147_m0_t.webp    (থাম্বনেইল)
  ├─ backups\               (রাতের pg_dump)
  └─ logs\
```

### ৬.৩ নেটওয়ার্ক
- অফিসের LAN-এ সার্ভার PC-কে **static IP** দিন (যেমন `192.168.0.50`)
- এজেন্ট কানেক্ট করবে `https://192.168.0.50:8443` (অথবা লোকাল DNS নাম)
- **বাইরে থেকে দেখতে:** Tailscale ইনস্টল করুন (ফ্রি, ৫ মিনিটের কাজ) — পোর্ট ফরওয়ার্ড করে ইন্টারনেটে সার্ভার খুলবেন না
- সার্ভার PC-তে **UPS** রাখুন

### ৬.৪ শিডিউলড জব
| সময় | কাজ |
|---|---|
| প্রতি ১৫ মিনিট | `daily_summary` + `monthly_summary` রিফ্রেশ (আজকের দিন) |
| **রাত ০০:১৫** | **আগের দিন** ক্লোজ — ঘণ্টা চূড়ান্ত, খোলা পড়ে থাকা সেশন বন্ধ, pace পুনর্গণনা |
| রাত ২:০০ | ৯০ দিনের পুরোনো স্ক্রিনশট ডিলিট (DB + ফাইল) |
| রাত ২:৩০ | `pg_dump` → `/data/backups/` (৩০ দিন রাখবে) |
| রাত ৩:০০ | ব্যাকআপ + স্ক্রিনশট → এক্সটার্নাল HDD বা Google Drive-এ কপি |
| প্রতি ৫ মিনিট | কোনো এজেন্ট ১০ মিনিট ধরে চুপ? → অ্যালার্ট (G01)। ⭐ বিদায়ী ইভেন্ট (shutdown/logoff) দেখে "স্বাভাবিক বন্ধ" ছেঁকে ফেলা হয় — `isExpectedSilence()` |
| **সন্ধ্যা ১৮:৩০** | দৈনিক ডাইজেস্ট (F07) — **ইমেইল ও টেলিগ্রাম দুটোতেই** *(১৭ আগস্ট)*। ⚠️ SMTP কনফিগার করা নেই, তাই এতদিন এটা কেবল লগে পড়ে ছিল |
| **প্রতি ঘণ্টায়, ০৯:০০–১৯:০০** | ⭐⭐ টেলিগ্রামে স্ন্যাপশট — *"Working now: 8/12"*, তারপর idle ও offline-দের নাম (`digest/snapshot.job.ts`)। ⚠️⚠️ মালিক চেয়েছিলেন **কেউ ১০ মিনিটের বেশি idle হলেই খবর**; হিসাবে দাঁড়াত দিনে **৬০–১৮০টা বার্তা** (১২ জন × ৫–১৫টা স্বাভাবিক বিরতি), আর তখন কেউ আর কোনো বার্তাই পড়ত না — `THROTTLE_HOURS`-এর ডকে ওই পরিণতি আগেই লেখা ছিল। ⭐ সিদ্ধান্তটা ADR-029-এ |
| **শুক্র সন্ধ্যা** | সাপ্তাহিক টেলিগ্রাম সারাংশ (R3) ⚠️ মাঠে এখনো চলেনি |

---

## ৭. Security

| স্তর | ব্যবস্থা |
|---|---|
| Agent ↔ Server | HTTPS (TLS), প্রতি ডিভাইসে আলাদা ২৫৬-বিট token, সার্ভারে শুধু hash জমা |
| Enrollment | **দুটো পথ:** ⭐ স্টাফের নিজের ইমেইল-পাসওয়ার্ড (`/agent/enroll-login` — যাচাই লগইনের কোডেই, তাই throttle · 2FA · audit সবই প্রযোজ্য), অথবা এককালীন enrollment code (২৪ ঘণ্টায় expire, একবারই ব্যবহারযোগ্য) |
| Dashboard | argon2id (m=19 MiB · t=2 · p=1), httpOnly JWT cookie, ৩০ মিনিট idle logout, ঐচ্ছিক TOTP 2FA |

### ৭.১ Auth — বাস্তবায়নের বিস্তারিত *(Phase 1-এ তৈরি)*

| | |
|---|---|
| সেশন cookie | `oxeio_session` · httpOnly · SameSite=Strict · প্রোডাকশনে Secure · TTL ৩০ মিনিট |
| CSRF | `oxeio_csrf` cookie (**httpOnly নয়** — ফ্রন্টএন্ডকে পড়তে হয়) + `X-CSRF-Token` হেডার। double-submit, শুধু POST/PUT/PATCH/DELETE-এ |
| Sliding session | টোকেন ৫ মিনিটের বেশি পুরোনো হলে রিকোয়েস্টেই নতুন করে ইস্যু হয় — কাজ করতে থাকলে সেশন চলে, বসে থাকলে ৩০ মিনিটে শেষ (I09) |
| ব্রুট-ফোর্স (I11) | ইমেইল+IP প্রতি ৫ বার ভুল → ১৫ মিনিট লক (429)। ইন-মেমরি; সার্ভার রিস্টার্টে মুছে যায় |
| User enumeration | ইউজার নেই আর পাসওয়ার্ড ভুল — দুটোতেই একই বার্তা |
| গার্ডের ক্রম | **JWT → CSRF → mustChangePw → role**, চারটিই গ্লোবাল। নতুন কন্ট্রোলার ডিফল্টে সুরক্ষিত; খোলা রাখতে `@Public()` লিখতে হয় |
| `mustChangePw` | true থাকলে শুধু `/auth/me` · `/auth/logout` · `/auth/change-password` খোলা, বাকি সব 403 |
| 2FA (I06) | ঐচ্ছিক TOTP — `GET /auth/2fa` · `POST /auth/2fa/setup` `2fa/enable` `2fa/disable` `2fa/recovery-codes`। `totp_secret` বসানো থাকলে লগইন দুই ধাপ: প্রথম ধাপে **২০০, কিন্তু cookie নেই** (`{needsTotp: true}`) — ৪০১ নয়, কারণ এটা ব্যর্থতাই নয়, ধাপ ১; ৪০১ দিলে ওয়েবের গ্লোবাল "সেশন শেষ" হ্যান্ডলার চালু হতো। রিকভারি কোডও চলে (হ্যাশ করে জমা)। ⚠️ `mustChangePw` অবস্থায় 2FA বসানো যায় না — নইলে অস্থায়ী পাসওয়ার্ডটাই চিরকাল রয়ে যেত |
| স্ক্রিনশট অ্যাক্সেস | signed URL (৫ মিনিট), প্রতিটা ভিউ `audit_log`-এ রেকর্ড |
| ডেটাবেস | শুধু localhost-এ bind, আলাদা DB user, at-rest encryption (BitLocker) |
| Retention | ৯০ দিন পর অটো-ডিলিট — জমতেই দেবে না |
| যা করব না | কীলগিং, ক্লিপবোর্ড ক্যাপচার, ফাইল কনটেন্ট, ফুল URL, ওয়েবক্যাম, মাইক্রোফোন |

---

## ৮. প্রজেক্ট স্ট্রাকচার

```
oxeio-monitor/
├─ agent/                      # C# .NET 8
│  ├─ oXeio.Agent/             # tray app — ট্র্যাকিং, স্ক্রিনশট, আপলোড
│  ├─ oXeio.Watchdog/          # লগঅনের Scheduled Task — Windows Service নয় (§ ৩.৬)
│  ├─ oXeio.Core/              # shared: Win32 API, models, queue
│  └─ installer/               # WiX MSI
├─ server/                     # Node 22 + NestJS 11 + TypeScript
│  ├─ src/main.ts  app.module.ts                      ✅
│  ├─ src/prisma/  src/health/  src/audit/            ✅
│  ├─ src/auth/  src/users/                           ✅ ২২টি টেস্ট পাস
│  ├─ src/agent/                                      ✅ ২৭টি টেস্ট পাস
│  ├─ src/{employees,devices,screenshots,timeline,    ⏳ পরের ধাপ
│  │        monthly,adjustments,reports,alerts,admin,jobs}
│  ├─ prisma/schema.prisma  (১৯ মডেল, timestamptz)    ✅
│  ├─ prisma/seed.ts  migrations/                     ✅
│  └─ Dockerfile  tsconfig.build.json                 ✅
├─ web/                        # React 19 + Vite 7 + Tailwind 4
│  ├─ src/api/  src/auth/  src/components/            ✅ লগইন শেল
│  ├─ src/pages/{Login,ChangePassword,Home}           ✅
│  ├─ src/pages/{live,employee,gallery,monthly,       ⏳ Phase 3
│  │             reports,settings,my-data}
│  └─ vite.config.ts  # /api → :3000 proxy (SameSite=Strict-এর জন্য অপরিহার্য)
├─ docker-compose.yml
├─ docs/
│  ├─ deployment.md
│  ├─ agent-install.md
│  └─ monitoring-policy-template.md   # স্টাফদের সই করার জন্য
└─ README.md
```

> ⚠️ উপরের ✅/⏳ চিহ্ন আর টেস্ট-সংখ্যাগুলো Phase 1-এর ছবি — ওগুলো এখানে আর
> হালনাগাদ রাখা হয় না। কোডে আজ কোন মডিউল আছে, কী বাকি, আর কত টেস্ট চলছে:
> [09-Build-Log](09-Build-Log.md)।

---

## ৯. Build Order (৬–৭ সপ্তাহ)

| সপ্তাহ | কাজ | ডেলিভারেবল |
|---|---|---|
| **১** | DB migration, NestJS স্ক্যাফোল্ড, auth, agent ingest API, Docker Compose | সার্ভার চলছে, Postman দিয়ে টেস্টযোগ্য |
| **২** | Agent core — idle state machine, screenshot scheduler, offline queue, enroll | ১টা PC-তে ডেটা আসছে |
| **৩** | Dashboard — লগইন, Live Board, Employee timeline, Screenshot gallery | **MVP demo চালানোর মতো** |
| **৪** | App/website tracking + categorization + productivity | পূর্ণ ট্র্যাকিং |
| **৫** | মাসিক হিটম্যাপ, Excel/PDF রিপোর্ট, payroll ঘণ্টা শিট | রিপোর্টিং শেষ |
| **৬** | MSI ইনস্টলার, watchdog, auto-update, alerts, retention + backup job | প্রোডাকশন-রেডি |
| **৭** | ৩টা PC-তে পাইলট → স্টাফ ব্রিফিং → ১৫টা PC-তে রোলআউট | **লাইভ** |

---

## ১০. রোলআউটের আগে চেকলিস্ট

- [x] ~~Monitoring policy — সই~~ ✅ **হয়ে গেছে** *(১৩ আগস্ট)*
- [ ] সব স্টাফকে জানিয়ে একটা ব্রিফিং মিটিং
- [ ] **প্রতিটা স্টাফের portal account** খোলা — এজেন্ট বসানোর সময় ওই লগইনই লাগবে ([ADR-024](05-Options-Decisions.md))। ⭐ কার বাকি আছে দেখুন **Settings → Staff-এর "Setup" কলামে** — `Needs login` → `Ready to install` → `Running`
- [ ] MSI বানানো — `build.ps1` (ঠিকানা এখন **ডিফল্টেই বেক হয়**; অন্য ঠিকানা হলে `-ServerUrl "https://…"`)। ⚠️ বিল্ডের আউটপুটে `server : https://…` লাইনটা দেখে নিন — হলুদ সতর্কবাণী এলে ওই MSI ডাবল-ক্লিকে চলবে না
- [ ] **নিজে সই করা** সার্ট বানিয়ে MSI-তে সই (`make-code-cert.ps1` → `build.ps1 -SignWith`), আর `.cer` ১৫টা PC-তে (`trust-publisher.ps1`) — ✅ স্ক্রিপ্ট তিনটে **লেখা হয়ে গেছে** ([ADR-014](05-Options-Decisions.md) · [09 § ৩ব](09-Build-Log.md))। ⚠️ স্ক্রিপ্টটা **দুই** স্টোরে বসায়; Trusted Publishers একা যথেষ্ট নয়
- [ ] প্রতিটা স্টাফের **যোগদানের তারিখ** বসানো — ⚠️⚠️ G37-এর কোড ✅ তৈরি, কিন্তু `joined_on` ছাড়া সেটা **কখনো চালুই হবে না** (নিয়মটা চুপচাপ সবাইকে পুরো-মাস ধরে নেবে)
- [x] ~~**সাপ্তাহিক ছুটি যাচাই**~~ — ✅ **শুধু শুক্রবার** (O11, ১২ আগস্ট)। schema-তে migration লাগছে না
- [x] **VPS তৈরি** ([ADR-026](05-Options-Decisions.md)) — ⭐ `deploy/vps-setup.sh hub.oxeio.com` **এক কমান্ডেই** Docker · ফায়ারওয়াল · গোপন মান · DNS যাচাই · স্ট্যাক করে দেয়। ✅ চালু, `hub.oxeio.com`
- [x] ⚠️⚠️ ~~`certbot renew --reuse-key`~~ — **প্রশ্নটাই আর নেই** *(১৮ আগস্ট, মাঠে মেপে)*: certbot ব্যবহারই হচ্ছে না, TLS সামলায় **Caddy v2** (`/etc/letsencrypt` খালি, কোনো certbot টাইমার নেই), আর `SERVERPIN` `.env`-এ **বসানো হয়নি** — অর্থাৎ পিনিং বন্ধ, তাই ৯০ দিনে SPKI বদলালেও কেউ সংযোগ হারায় না। ⚠️⚠️ **কিন্তু ফাঁদটা ঘুমিয়ে আছে, মরেনি:** কেউ পরে `SERVERPIN` বসালে Caddy-ও নবায়নে নতুন কী বানায়, আর তখন হুবহু একই দুর্ঘটনা ঘটবে — পিনিং চালু করার দিন **আগে** সেটা মেলানো বাধ্যতামূলক
- [ ] ১৫টা PC-র এন্টিভাইরাসে agent exclusion যোগ
- [ ] স্টাফ যেন এজেন্ট আনইনস্টল করতে না পারে — non-admin Windows অ্যাকাউন্ট
- [x] ~~৩টা PC-তে ১ সপ্তাহ পাইলট, তারপর পুরো রোলআউট~~ — ✅ **১৩টা PC সক্রিয়** (১৮ আগস্ট); এজেন্টের ভার্সন কোথায় কী, দেখা যায় Settings → Agent updates-এ
- [ ] ১ মাস পর রিভিউ — ১ মিনিট idle threshold ঠিক আছে কি না *(ট্র্যাকিং শুরু ১২ আগস্ট → ১২ সেপ্টেম্বর)*

> ⚠️ **কোড দিয়ে সারানো যায় না, এমন যা বাকি** *(১৮ আগস্ট হালনাগাদ)*:
> policy টেমপ্লেটের ৩৬টা ফাঁকা ঘর ও আইনজীবী · ১৫টা PC-র এন্টিভাইরাস
> exclusion · non-admin Windows অ্যাকাউন্ট · **R4** — UptimeRobot-এ
> মালিকের নিজের অ্যাকাউন্ট ([10 § R4](10-Roadmap.md))।
>
> ✅ **যা আর বাকি নেই:** I01 সার্ট পিনিং **কোডে বসেছে**
> ([§ ৩ত](09-Build-Log.md)) · code signing **কিনতে হবে না** — নিজে সই
> করা হবে ([ADR-014](05-Options-Decisions.md)) · **টেলিগ্রাম ডেলিভারি
> চালু** (টোকেন ও chat id Settings → Notifications-এ, G08) · **স্টাফের
> `joined_on` বসানো** — ১২ জনেরই, একটাও ফাঁকা নেই *(১৫ আগস্ট)* ·
> ⭐ **G39 অফসাইট ব্যাকআপের গন্তব্য — Backblaze B2**, আর কনফিগটা এখন
> পর্দা থেকেই (Settings → Backup); মাঠে চালিয়ে ১৭টা ফাইল উঠেছে
> *(১৮ আগস্ট, [10 § R5](10-Roadmap.md))*।
