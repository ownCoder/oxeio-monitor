-- R21 — সিকিউরিটি মানি (জামানত)।
--
-- মালিকের কথা: প্রতি মাসে বেতন থেকে ৫০০ টাকা কেটে রাখা হয়, আর কেউ
-- ৩০ দিন আগে জানিয়ে চাকরি ছাড়লে পুরো জমাটা ফেরত পান।
--
-- তিনটে টেবিল, তিনটে আলাদা কাজ:
--   deposit_policy       — নিয়ম (একটাই সারি)
--   security_deposits    — খাতা (এক কর্মীর এক মাসের কিস্তি = এক সারি)
--   deposit_settlements  — নিষ্পত্তি (ফেরত না বাজেয়াপ্ত)

-- ── নিয়ম ────────────────────────────────────────────────────────────────
CREATE TABLE "deposit_policy" (
    "id"               INTEGER      NOT NULL,
    "amount_paisa"     INTEGER      NOT NULL,
    "start_year_month" CHAR(7)      NOT NULL,
    "notice_days"      INTEGER      NOT NULL DEFAULT 30,
    "active"           BOOLEAN      NOT NULL DEFAULT true,
    "updated_at"       TIMESTAMPTZ(3) NOT NULL,
    "updated_by"       TEXT         NOT NULL,

    CONSTRAINT "deposit_policy_pkey" PRIMARY KEY ("id")
);

-- ⚠️ একাধিক সারি হওয়ার পথটা ডাটাবেসেই বন্ধ। কোড `id = 1` ধরে upsert করে,
--    কিন্তু কোড ভুল হলে ডাটাবেস দ্বিতীয় সারিটা নিতে অস্বীকার করবে — নইলে
--    "নিয়ম কোনটা" প্রশ্নের দুটো উত্তর দাঁড়াত।
ALTER TABLE "deposit_policy" ADD CONSTRAINT "deposit_policy_single_row"
    CHECK ("id" = 1);

-- ⚠️ ঋণাত্মক বা শূন্য কিস্তি অর্থহীন, আর ঋণাত্মক নোটিশ-দিন তো বটেই।
ALTER TABLE "deposit_policy" ADD CONSTRAINT "deposit_policy_amount_positive"
    CHECK ("amount_paisa" > 0);
ALTER TABLE "deposit_policy" ADD CONSTRAINT "deposit_policy_notice_sane"
    CHECK ("notice_days" >= 0);

-- ── খাতা ────────────────────────────────────────────────────────────────
CREATE TABLE "security_deposits" (
    "id"           SERIAL         NOT NULL,
    "employee_id"  INTEGER        NOT NULL,
    "year_month"   CHAR(7)        NOT NULL,
    "amount_paisa" INTEGER        NOT NULL,
    "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_deposits_pkey" PRIMARY KEY ("id")
);

-- ⭐ একই মাসে দুবার কিস্তি বসতে পারে না — খাতা idempotent-ভাবে তৈরি হয়,
--    অর্থাৎ পাতা রিফ্রেশ করলেই কারো জমা বেড়ে যায় না।
CREATE UNIQUE INDEX "security_deposits_employee_id_year_month_key"
    ON "security_deposits"("employee_id", "year_month");

CREATE INDEX "security_deposits_year_month_idx"
    ON "security_deposits"("year_month");

ALTER TABLE "security_deposits"
    ADD CONSTRAINT "security_deposits_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── নিষ্পত্তি ───────────────────────────────────────────────────────────
CREATE TABLE "deposit_settlements" (
    "id"                SERIAL         NOT NULL,
    "employee_id"       INTEGER        NOT NULL,
    "outcome"           TEXT           NOT NULL,
    "amount_paisa"      INTEGER        NOT NULL,
    "notice_given_on"   DATE,
    "last_working_day"  DATE,
    "notice_days_given" INTEGER,
    "notice_days_rule"  INTEGER        NOT NULL,
    "note"              TEXT,
    "settled_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_by"        TEXT           NOT NULL,

    CONSTRAINT "deposit_settlements_pkey" PRIMARY KEY ("id")
);

-- ⭐ একজনের একটাই নিষ্পত্তি।
CREATE UNIQUE INDEX "deposit_settlements_employee_id_key"
    ON "deposit_settlements"("employee_id");

-- ⚠️ outcome-এ যা খুশি বসানো যায় না — টাইপো হলে পর্দা কিছুই দেখাত না,
--    আর "ফেরত দেওয়া হয়েছে কি না" প্রশ্নের উত্তর নীরবে হারাত।
ALTER TABLE "deposit_settlements" ADD CONSTRAINT "deposit_settlements_outcome_known"
    CHECK ("outcome" IN ('refunded', 'forfeited'));

ALTER TABLE "deposit_settlements"
    ADD CONSTRAINT "deposit_settlements_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── নিয়মের প্রথম সারি ───────────────────────────────────────────────────
-- মালিকের সিদ্ধান্ত (১৫ আগস্ট): ৫০০ টাকা, আগস্ট ২০২৬ থেকে, ৩০ দিনের নোটিশ।
-- ⚠️ ON CONFLICT DO NOTHING — migration আবার চললে (বা কেউ ইতিমধ্যে পর্দা
--    থেকে বদলে থাকলে) মালিকের বসানো মান মুছে যাবে না।
INSERT INTO "deposit_policy"
    ("id", "amount_paisa", "start_year_month", "notice_days", "active", "updated_at", "updated_by")
VALUES
    (1, 50000, '2026-08', 30, true, CURRENT_TIMESTAMP, 'migration')
ON CONFLICT ("id") DO NOTHING;
