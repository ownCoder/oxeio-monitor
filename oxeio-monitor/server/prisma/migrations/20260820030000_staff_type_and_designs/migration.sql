-- ⭐ কর্মীর কাজের ধরন (২০ আগস্ট ২০২৬)
CREATE TYPE "StaffType" AS ENUM ('designer', 'researcher', 'manager');

ALTER TABLE "employees" ADD COLUMN "staff_type" "StaffType";

-- ⚠️⚠️ পুরোনো মুক্ত-লেখা `designation` থেকে ভরে দেওয়া — নইলে ১১ জনের
--    ধরন হাতে বসাতে হতো, আর ততক্ষণ ডিজাইনারের টার্গেট কারো উপরেই খাটত না।
-- ⚠️ ILIKE, আর '%designer%' — মাঠে লেখা আছে "Graphic Designer"; ভবিষ্যতে
--    "Sr. Designer" লেখা থাকলেও ধরা পড়বে।
UPDATE "employees" SET "staff_type" = 'designer'
 WHERE "designation" ILIKE '%designer%';

UPDATE "employees" SET "staff_type" = 'researcher'
 WHERE "staff_type" IS NULL AND "designation" ILIKE '%research%';

UPDATE "employees" SET "staff_type" = 'manager'
 WHERE "staff_type" IS NULL AND "designation" ILIKE '%manager%';

-- ⭐⭐ ডিজাইনের ক্রেডিট — একটা (কর্মী, ডিজাইন) জোড়া একবারই বসে
CREATE TABLE "design_credits" (
    "employee_id" INTEGER NOT NULL,
    "design_id" VARCHAR(16) NOT NULL,
    "first_work_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_credits_pkey" PRIMARY KEY ("employee_id", "design_id")
);

CREATE INDEX "design_credits_employee_id_first_work_date_idx"
    ON "design_credits" ("employee_id", "first_work_date");

ALTER TABLE "design_credits" ADD CONSTRAINT "design_credits_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ⚠️ ০ ডিফল্ট: পুরোনো সব দিনের মানে বদলায় না ("মাপা হয়নি" আর "শূন্য" এক
--    দেখাত — কিন্তু ডিজাইনারের কলামটাই তখন দেখানো হয় না, তাই নিরাপদ)
ALTER TABLE "daily_summary" ADD COLUMN "designs_done" INTEGER NOT NULL DEFAULT 0;

-- ⭐ ডিজাইনারের দৈনিক টার্গেট — ঘণ্টার টার্গেটের পাশে, বিকল্প নয়।
-- ⚠️ ডিফল্ট ২৫: মালিকের বলা সংখ্যা (২০ আগস্ট)। ০ বসালে টার্গেট বন্ধ।
ALTER TABLE "work_policies"
  ADD COLUMN "daily_design_target" INTEGER NOT NULL DEFAULT 25;
