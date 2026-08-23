-- ⭐⭐ **পুরোনো বেতন** (২৩ আগস্ট ২০২৬) — অতীতের পে-রোল যাতে না নড়ে।
--
-- ⚠️⚠️ R1 মাস বন্ধ করে *ঘণ্টা* সুরক্ষিত করেছে, কিন্তু পে-রোল বেতনের
--    সংখ্যাটা নেয় employees.monthly_salary থেকে — **লাইভ**। ফলে কারো
--    বেতন বাড়ালে বন্ধ মাসের পে-রোলও নীরবে বদলে যেত।
--
-- ⚠️ **ব্যাকফিল ইচ্ছাকৃতভাবে নেই।** খালি টেবিল মানে "কারো বেতন কোনোদিন
--    বদলায়নি" — আর আজ সেটাই সত্যি। ভুয়া সারি বসালে ইতিহাস আছে বলে
--    দাবি করা হতো যা আসলে জানা নেই।
CREATE TABLE "salary_periods" (
    "id"             SERIAL       PRIMARY KEY,
    "employee_id"    INTEGER      NOT NULL,
    -- 'YYYY-MM' — এই মাস পর্যন্ত (অন্তর্ভুক্ত) এই বেতনই ছিল
    "through_month"  CHAR(7)      NOT NULL,
    "monthly_salary" DECIMAL(12,2) NOT NULL,
    "note"           TEXT,
    "changed_by_id"  INTEGER,
    "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_periods_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
      ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ⚠️ একই কর্মীর একই মাসের জন্য দুটো সারি থাকলে "কোনটা সত্যি" ফিরে আসত
CREATE UNIQUE INDEX "salary_periods_employee_id_through_month_key"
    ON "salary_periods" ("employee_id", "through_month");
CREATE INDEX "salary_periods_employee_id_idx"
    ON "salary_periods" ("employee_id");
