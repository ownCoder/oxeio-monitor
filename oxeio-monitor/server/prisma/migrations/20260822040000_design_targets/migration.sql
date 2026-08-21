-- ⭐⭐ গবেষকের জমা করা ডিজাইন-টার্গেট (২২ আগস্ট ২০২৬)
CREATE TYPE "DesignTargetStatus" AS ENUM ('pool', 'assigned', 'done', 'skipped');

CREATE TABLE "design_targets" (
    "id" SERIAL NOT NULL,
    -- ⚠️⚠️ পরিচয় ASIN, URL নয় — একই পণ্যের URL অসংখ্য রকম হয়
    "asin" VARCHAR(10) NOT NULL,
    "status" "DesignTargetStatus" NOT NULL DEFAULT 'pool',
    "job_number" INTEGER,
    "added_by_id" INTEGER NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_to_id" INTEGER,
    "assigned_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_via" VARCHAR(16),
    "skipped_reason" TEXT,

    CONSTRAINT "design_targets_pkey" PRIMARY KEY ("id")
);

-- ⚠️⚠️ এই দুটো unique-ই গোটা ব্যবস্থার নিরাপত্তা:
--    asin → একই পণ্য দুবার ঢুকতে পারে না
--    job_number → দুটো টার্গেট একই নম্বর পেতে পারে না
CREATE UNIQUE INDEX "design_targets_asin_key" ON "design_targets"("asin");
CREATE UNIQUE INDEX "design_targets_job_number_key" ON "design_targets"("job_number");
CREATE INDEX "design_targets_status_idx" ON "design_targets"("status");
CREATE INDEX "design_targets_assigned_to_id_status_idx"
    ON "design_targets"("assigned_to_id", "status");

ALTER TABLE "design_targets" ADD CONSTRAINT "design_targets_added_by_id_fkey"
    FOREIGN KEY ("added_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "design_targets" ADD CONSTRAINT "design_targets_assigned_to_id_fkey"
    FOREIGN KEY ("assigned_to_id") REFERENCES "employees"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ⭐⭐ কাজের নম্বরের সিরিয়াল। শুরু ১০,০০,০০০ থেকে — মাপা সংখ্যা:
--    ডিজাইনারদের চলতি ফাইলে সবচেয়ে বড় নম্বর ৯,৭৩,০৬৫ (৭৮% পাঁচ অঙ্কের)।
-- ⚠️ কম থেকে শুরু করলে পুরোনো কোনো ফাইল ভুল করে টার্গেট বন্ধ করে দিত।
CREATE SEQUENCE "design_job_number_seq" START WITH 1000000 INCREMENT BY 1;

-- ⭐ কর্মীপ্রতি দৈনিক টার্গেট — "karo 25 ta, kono designer er 15 ta"।
-- ⚠️ NULL = পলিসির সংখ্যাটাই খাটবে; ডিফল্ট বসানো হয়নি ইচ্ছাকৃতভাবে।
ALTER TABLE "employees" ADD COLUMN "daily_design_target" INTEGER;
