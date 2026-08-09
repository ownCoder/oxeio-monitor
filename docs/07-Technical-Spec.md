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
  - { role: manager, count: 1 }   # ম্যানেজার — দেখা যাবে, সেটিংস বদলানো যাবে না
```

### স্টোরেজ প্রক্ষেপণ
| | |
|---|---|
| | সাধারণ (দিনে ৮ঘ active) | ভারী (দিনে ১২ঘ active) |
|---|---|---|
| স্ক্রিনশট/জন/দিন | ৮ × ১২ = **৯৬** | ১২ × ১২ = **১৪৪** |
| মোট/দিন (১৫ জন) | ~১,৪৪০ | ~২,১৬০ |
| সাইজ/দিন (@১৫০ KB) | ~২১৫ MB | ~৩২৪ MB |
| সাইজ/মাস (২৬ দিন) | ~৫.৬ GB | ~৮.৪ GB |
| **৯০ দিনে সর্বোচ্চ** | **~১৭ GB** | **~২৫ GB** |
| DB (টাইম + অ্যাপ ডেটা) | ~২০০ MB/বছর | ~৩০০ MB/বছর |

> শিফট তুলে দেওয়ায় ক্যাপচার উইন্ডো এখন **১৬ ঘণ্টা (০৭:০০–২৩:০০)**, তাই কেউ বেশি সময় কাজ করলে
> ছবিও বেশি ওঠে — তাই দ্বিতীয় কলামটা যোগ করা হলো (G40)।
> **1 TB NVMe-তে সবচেয়ে খারাপ ক্ষেত্রেও ~২.৫%।** ডিস্ক নিয়ে চিন্তা নেই।

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

-- ⚠️ leave_types / leave_requests / leave_balances নেই — ইচ্ছাকৃত।
--    কোনো ছুটির আবেদন বা অনুমোদনের ব্যবস্থা নেই। কেউ ছুটিতে থাকলে
--    সেদিন কোনো ঘণ্টা যোগ হবে না — মাসিক হিসাবেই সেটা ফুটে উঠবে।

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

expected_workdays  = ওই মাসের মোট কর্মদিবস          → monthly_summary-তে জমা
workdays_elapsed   = ১ তারিখ থেকে আজ পর্যন্ত (আজ ধরে) কর্মদিবস

expected_sec = target_sec × workdays_elapsed / expected_workdays
pace_sec     = credited_sec − expected_sec      -- ধনাত্মক = এগিয়ে (§ ২.১-ঙ)
```

- **টার্গেট ২০৮ ঘণ্টাই থাকে** — মাসে কর্মদিবস ২৪ হোক বা ২৭, টার্গেট বদলায় না
- pace লাইন মাসের **শেষ কর্মদিবসে ঠিক ২০৮-এ** গিয়ে ঠেকে — তাই মাস শেষে ভুয়া "এগিয়ে" দেখাবে না
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
          সেটা লোকাল queue.db-তেও জমা থাকে — রিট্রাইয়ে একই UUID যায়
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

```csharp
// Windows API: GetLastInputInfo() — কি-বোর্ড বা মাউসের শেষ ইনপুট কখন
[DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);

const int IDLE_THRESHOLD = 60;   // সেকেন্ড

void Tick()  // প্রতি ১ সেকেন্ডে
{
    int idleSec = (Environment.TickCount - GetLastInputTick()) / 1000;

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

```csharp
const int MONTH_TARGET = 208 * 3600;   // ৭,৪৮,৮০০ সেকেন্ড

// মাসের মোট — দিনের যেকোনো সময়ের, যেকোনো দিনের
worked_sec    = UNION(ACTIVE) over the month   // কাঁচা হিসাব, § ২.১-গ
credited_sec  = worked_sec + adjustment_sec    // owner-এর সংশোধন ধরে, § ২.১-ঙ
shortfall_sec = Math.Max(0, MONTH_TARGET - credited_sec)
overtime_sec  = Math.Max(0, credited_sec - MONTH_TARGET)
target_met    = credited_sec >= MONTH_TARGET

// গতি — মাসের মাঝপথে কে কোথায় দাঁড়িয়ে
// ⚠️ workdays_elapsed ও expected_workdays-এর সংজ্ঞা § ২.১-খ (হার্ডকোড ২৬ নয়)
expected_sec  = MONTH_TARGET * (workdays_elapsed / (double)expected_workdays)
pace_sec      = worked_sec - expected_sec      // ধনাত্মক = এগিয়ে
```

**Tray-তে সবসময় দেখা যাবে:**
```
🟢 oXeio · এই মাসে  ৬৩.৪ / ২০৮ ঘণ্টা   ✓ ৭.৪ঘ এগিয়ে
             আজ    ৫ঘ ৪২মি
🟢 oXeio · এই মাসে ২০৮.০ / ২০৮ ঘণ্টা   ✅ টার্গেট সম্পূর্ণ
```

**যা আর নেই:** দৈনিক টার্গেট, দেরির ফ্ল্যাগ, আগে চলে যাওয়ার ফ্ল্যাগ, লাঞ্চের হিসাব, শিফটের বাইরের ধারণা। দৈনিক ৮ ঘণ্টা শুধু **নির্দেশক** হিসেবে দেখানো হয় (২০৮ ÷ ২৬), মাপকাঠি হিসেবে নয়।

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
  ├─ queue.db              (SQLite — segments, events, app_usage)
  ├─ queue\                (আপলোড না হওয়া স্ক্রিনশট)
  ├─ config.json           (সার্ভার থেকে সিঙ্ক হওয়া কনফিগ)
  └─ agent.log
```
- সার্ভার ডাউন থাকলে সব লোকালি জমা থাকবে (৭ দিন পর্যন্ত)
- সার্ভার ফিরলে ব্যাকগ্রাউন্ডে ধীরে ধীরে আপলোড (exponential backoff)
- ডুপ্লিকেট ঠেকাতে প্রতিটা রেকর্ডে client-generated UUID → সার্ভারে idempotent insert

### ৩.৬ প্রসেস মডেল

```
oXeioAgent.exe        ← ইউজার সেশনে tray app (স্ক্রিনশট এখান থেকেই সম্ভব)
                        Task Scheduler → "At log on" → auto start
oXeioWatchdog.exe     ← Windows Service (SYSTEM), প্রতি ৩০ সেকেন্ডে চেক
                        agent বন্ধ থাকলে আবার চালু + সার্ভারে অ্যালার্ট
```

---

## ৪. API Contract

Base: `https://oxeio-server.local/api/v1` · সব রেসপন্স JSON

### ৪.১ Agent endpoints — auth: `Authorization: Bearer <device_token>`

| Method | Endpoint | কাজ |
|---|---|---|
| POST | `/agent/enroll` | প্রথমবার ইনস্টলের সময়। `{enrollment_code, hostname, windows_username, machine_guid, os_version, agent_version, monitors}` → `{device_id, device_token, employee, config}` |
| GET | `/agent/config` | কনফিগ সিঙ্ক (capture window, interval, idle threshold) → `{version, config}` |
| POST | `/agent/heartbeat` | প্রতি ৩০ সেকেন্ডে। `{state, active_sec_today, queue_depth, config_version}` → `{commands: [], config_version}` |
| POST | `/agent/segments` | ব্যাচে activity segments (প্রতি ১ মিনিটে) |
| POST | `/agent/app-usage` | ব্যাচে app/website usage |
| POST | `/agent/events` | logon/logoff/lock/sleep ইত্যাদি |
| POST | `/agent/screenshots` | `multipart/form-data`: `meta` (JSON) + `file` (webp) |
| GET | `/agent/update` | ⭐ *নতুন* — `?current=1.2.0` → `{version, sha256, url, mandatory}` অথবা `204 No Content`। `agent_versions.rollout_stage` মেনে ধাপে ধাপে দেয় |
| GET | `/agent/update/download` | ⭐ *নতুন* — MSI স্ট্রিম (device token লাগবে) |

**সব ingest endpoint-এ বাধ্যতামূলক:**
- প্রতিটি রেকর্ডে `client_uuid` — না থাকলে `422`; ডুপ্লিকেট হলে `{accepted, duplicates, split}` (§ ২.১-ঘ)
- প্রতিটি রিকোয়েস্টে **`X-Client-Time`** হেডার (ISO-8601) — clock drift হিসাবের জন্য ([02-Workflow §2](02-Workflow.md))। হেডার হিসেবে রাখা হয়েছে যাতে GET-এও পাঠানো যায়
- ব্যাচের সর্বোচ্চ আকার **৫০০ রেকর্ড**; স্ক্রিনশট ফাইল সর্বোচ্চ **৫ MB**, শুধু `image/webp`
- ডিভাইসপ্রতি rate limit: ingest ৬০ req/মিনিট, screenshot ২০ req/মিনিট

**সার্ভার → এজেন্ট commands** (heartbeat-এর রেসপন্সে): `reload_config`, `capture_now`, `pause_tracking`, `update_agent`, `revoke`

### ৪.২ Dashboard endpoints — auth: JWT cookie (httpOnly)

| Method | Endpoint | কাজ |
|---|---|---|
| POST | `/auth/login` · `/auth/logout` · `/auth/me` | লগইন (argon2id + ঐচ্ছিক TOTP) |
| POST | `/auth/change-password` | ⭐ *নতুন* — নিজের পাসওয়ার্ড বদলানো। `must_change_pw = TRUE` হলে লগইনের পর অন্য কিছু করার আগে এটাই করতে হবে |
| POST | `/users/:id/reset-password` | ⭐ *নতুন* — **owner only**। একবার-দেখানো temp পাসওয়ার্ড ফেরত দেয়, `must_change_pw = TRUE` বসিয়ে দেয়। SMTP লাগে না, তাই Phase 1-এই সম্ভব |
| POST | `/employees/:id/portal-account` | ⭐ *নতুন* — **owner only**। স্টাফের self-view অ্যাকাউন্ট (`role = employee`) খোলে |
| POST | `/employees/:id/policy-doc` | ⭐ *নতুন* — সই করা monitoring policy আপলোড → `policy_signed_at`, `policy_doc_path` |
| POST | `/devices/enrollment-code` | ⭐ *নতুন* — **owner only**। `{employee_id}` → `{code, expires_at}`; কোড একবারই দেখানো হয়, DB-তে শুধু hash |
| GET | `/employees/:id/downtime?date=` | ⭐ *নতুন* — ওই দিনে এজেন্ট কতক্ষণ চুপ ছিল → `{max_claimable_sec, gaps: [...]}`; সংশোধন বসানোর আগে এটাই প্রস্তাবিত পরিমাণ দেখায় |
| POST | `/employees/:id/time-adjustments` | ⭐ *নতুন* — **owner only**। `{work_date, delta_sec, cause, reason}` → `201`। `reason` খালি হলে `422`; `delta_sec > max_claimable_sec` হলে `beyond_evidence = TRUE` বসে |
| GET | `/employees/:id/time-adjustments?from=&to=` | সংশোধনের তালিকা। **স্টাফ নিজেরটা দেখতে পাবে** (role=employee) |
| POST | `/time-adjustments/:id/revoke` | ⭐ *নতুন* — **owner only**। ডিলিট নয়, `revoked_at` বসে |
| GET | `/live` | এখন কে online/idle/offline — ড্যাশবোর্ডের হোম |
| GET | `/employees` · `/employees/:id` | স্টাফ লিস্ট ও প্রোফাইল |
| GET | `/employees/:id/timeline?date=` | ওই দিনের সেকেন্ড-বাই-সেকেন্ড টাইমলাইন |
| GET | `/screenshots?employee_id=&date=&page=` | স্ক্রিনশট গ্যালারি (audit_log-এ রেকর্ড হবে) |
| GET | `/screenshots/:id/file` | signed URL, ৫ মিনিটে expire |
| GET | `/reports/attendance?from=&to=&format=json\|xlsx\|pdf` | অ্যাটেনডেন্স রিপোর্ট |
| GET | `/reports/productivity?from=&to=` | অ্যাপ/সাইট ভিত্তিক productivity |
| GET | `/reports/payroll?month=` | পে-রোল ঘণ্টার হিসাব |
| CRUD | `/employees` `/work-policies` `/categories` `/settings` `/devices` `/holidays` | **owner only** |
| GET | `/audit-log` | **owner only** |

### ৪.৩ Role permission

| ক্ষমতা | Owner (আপনি) | Manager |
|---|:---:|:---:|
| লাইভ ভিউ, টাইমলাইন, স্ক্রিনশট দেখা | ✅ | ✅ |
| রিপোর্ট ও এক্সপোর্ট | ✅ | ✅ |
| স্টাফ যোগ/বাদ, work policy বদল | ✅ | ❌ |
| **ঘণ্টা সংশোধন** (`time_adjustments`) বসানো / revoke | ✅ | ❌ *(দেখতে পাবে)* |
| সেটিংস (interval, idle, retention) | ✅ | ❌ |
| Device revoke / audit log | ✅ | ❌ |

---

## ৫. Dashboard — স্ক্রিন লিস্ট

| স্ক্রিন | কী থাকবে |
|---|---|
| **Live Board** | ১৫টা কার্ড — ছবি, নাম, স্ট্যাটাস (🟢 Active / 🟡 Idle / ⚪ Offline), আজকের worked time, লাস্ট স্ক্রিনশট থাম্বনেইল |
| **Employee Detail** | দিনের টাইমলাইন বার (active/idle/break রঙে), ঘণ্টাভিত্তিক অ্যাক্টিভিটি চার্ট, টপ অ্যাপ/সাইট, ওই দিনের সব স্ক্রিনশট |
| **Screenshot Gallery** | গ্রিড ভিউ, তারিখ + স্টাফ ফিল্টার, ক্লিকে ফুল সাইজ, কি-বোর্ড নেভিগেশন |
| **মাসিক অগ্রগতি** | হিটম্যাপ (স্টাফ × তারিখ) — রঙের গভীরতা = ওই দিনের ঘণ্টা; পাশে মোট vs ২০৮ |
| **Reports** | কাস্টম ডেট রেঞ্জ → Excel/PDF ডাউনলোড |
| **Settings** (owner) | Work policy (মাসিক টার্গেট, সাপ্তাহিক ছুটির দিন, ক্যাপচার উইন্ডো), screenshot interval, idle threshold, retention, app categories, ছুটির ক্যালেন্ডার, স্টাফ ও ডিভাইস ম্যানেজমেন্ট |

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
D:\oXeio\
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
| রাত ২:৩০ | `pg_dump` → `D:\oXeio\backups\` (৩০ দিন রাখবে) |
| রাত ৩:০০ | ব্যাকআপ + স্ক্রিনশট → এক্সটার্নাল HDD বা Google Drive-এ কপি |
| প্রতি ৫ মিনিট | কোনো এজেন্ট ১০ মিনিট ধরে চুপ? → অ্যালার্ট |

---

## ৭. Security

| স্তর | ব্যবস্থা |
|---|---|
| Agent ↔ Server | HTTPS (TLS), প্রতি ডিভাইসে আলাদা ২৫৬-বিট token, সার্ভারে শুধু hash জমা |
| Enrollment | এককালীন enrollment code, ২৪ ঘণ্টায় expire, একবারই ব্যবহারযোগ্য |
| Dashboard | argon2id (m=19 MiB · t=2 · p=1), httpOnly JWT cookie, ৩০ মিনিট idle logout, ঐচ্ছিক TOTP 2FA *(Phase 6)* |

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
| 2FA | `totp_secret` বসানো থাকলে লগইন **আটকে যায়** — যাচাইয়ের কোড Phase 6-এ। fail-closed, নইলে 2FA আছে ভেবে ভুল নিরাপত্তাবোধ তৈরি হতো |
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
│  ├─ oXeio.Watchdog/          # Windows Service
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
├─ web/                        # React 19 + Vite + Tailwind + Recharts
│  └─ src/pages/{live,employee,gallery,monthly,reports,settings,my-data}
├─ docker-compose.yml
├─ docs/
│  ├─ deployment.md
│  ├─ agent-install.md
│  └─ monitoring-policy-template.md   # স্টাফদের সই করার জন্য
└─ README.md
```

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

- [ ] Monitoring policy লিখে স্টাফদের সই নেওয়া (টেমপ্লেট: `docs/monitoring-policy-template.md`)
- [ ] সব স্টাফকে জানিয়ে একটা ব্রিফিং মিটিং
- [ ] সার্ভার PC-তে static IP, UPS, BitLocker, অটো ব্যাকআপ
- [ ] ১৫টা PC-র এন্টিভাইরাসে agent exclusion যোগ
- [ ] স্টাফ যেন এজেন্ট আনইনস্টল করতে না পারে — non-admin Windows অ্যাকাউন্ট
- [ ] ৩টা PC-তে ১ সপ্তাহ পাইলট, তারপর পুরো রোলআউট
- [ ] ১ মাস পর রিভিউ — ১ মিনিট idle threshold ঠিক আছে কি না
