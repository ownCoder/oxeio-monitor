-- ⭐⭐ **বানান-যাচাইয়ের শেকল** (২৫ আগস্ট ২০২৬, মালিকের ওয়ার্কফ্লো — ADR-038)
--
--    ডিজাইনার "শেষ" বলার পর কাজটা এখনো বাকি: কেউ বানান দেখেন, ভুল পেলে
--    কেউ ঠিক করেন, তারপর ফাইলটা Complete ফোল্ডারে যায়। মাঠে এটা হয়ই,
--    কিন্তু সিস্টেম জানত না — তাই "কোনগুলো দেখা বাকি" কেউ বলতে পারত না।
--
-- ⚠️⚠️ **অবস্থা (status) নয়, তারিখ** — আর এটাই এই ফাইলের সবচেয়ে জরুরি
--    সিদ্ধান্ত। `uploaded`/`live`-এর সময়েও ঠিক এই কারণেই তারিখ বসেছিল:
--    নতুন অবস্থা বানালে সারিটা `done` থেকে **সরে যেত**, আর গোটা সিস্টেমে
--    "কতগুলো ডিজাইন হয়েছে" যত জায়গায় গোনা হয় (বোর্ড · দৈনিক টেলিগ্রাম ·
--    মাসিক রিপোর্ট · কর্মীর নিজের পাতা) সব **নীরবে কমে যেত**।
--
-- ⭐ চারটে তারিখ, তিনটে অবস্থা বোঝায়:
--       checked_at IS NULL                    → এখনো দেখা হয়নি
--       checked_at, error_found_at IS NULL    → দেখা হয়েছে, ঠিক ছিল
--       error_found_at, fixed_at IS NULL      → ভুল পাওয়া গেছে, ঠিক হয়নি
--       fixed_at                              → ঠিক করা হয়ে গেছে
ALTER TABLE "design_targets"
  ADD COLUMN "checked_at"     TIMESTAMPTZ(3),
  ADD COLUMN "checked_by_id"  INTEGER,
  ADD COLUMN "error_found_at" TIMESTAMPTZ(3),
  ADD COLUMN "fixed_at"       TIMESTAMPTZ(3),
  ADD COLUMN "fixed_by_id"    INTEGER;

-- ⚠️ `users`-এর দিকে, `employees`-এর নয় — যিনি বোতাম চাপেন তিনি একজন
--    **ব্যবহারকারী**। ২৩ আগস্ট `completed_by_id`-তে ঠিক এই ভুলটা প্রায়
--    হয়ে গিয়েছিল: দুটো id-জগৎ আলাদা, আর ভুল ঘর ধরলে মিল নীরবে ব্যর্থ হয়।
-- ⚠️ ON DELETE SET NULL — কেউ চলে গেলে তারিখটা থাকে, কেবল নামটা যায়।
ALTER TABLE "design_targets"
  ADD CONSTRAINT "design_targets_checked_by_id_fkey"
    FOREIGN KEY ("checked_by_id") REFERENCES "users"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT "design_targets_fixed_by_id_fkey"
    FOREIGN KEY ("fixed_by_id") REFERENCES "users"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;

-- ⭐⭐ **`last_activity_at`-এ নতুন তারিখ দুটো যোগ করা** — নইলে সদ্য যাচাই
--    করা সারি তালিকায় **উপরে উঠত না**, কারণ ক্রম সবসময় ওই ঘর ধরে।
--
-- ⚠️ জেনারেটেড কলামের সংজ্ঞা বদলানো যায় না, তাই ফেলে নতুন করে বানাতে হয়।
--    ইনডেক্স দুটোও সাথে যায়, তাই সেগুলোও ফিরিয়ে আনা হচ্ছে।
-- ⚠️ `error_found_at` ইচ্ছাকৃতভাবে **বাদ** — ওটা `checked_at`-এর সাথেই
--    বসে (একই ক্লিকে), তাই GREATEST-এ যোগ করলে কেবল খরচ বাড়ত, ফল বদলাত না।
DROP INDEX IF EXISTS "design_targets_assigned_to_id_last_activity_at_idx";
DROP INDEX IF EXISTS "design_targets_last_activity_at_idx";

ALTER TABLE "design_targets" DROP COLUMN "last_activity_at";

ALTER TABLE "design_targets"
  ADD COLUMN "last_activity_at" TIMESTAMPTZ(3)
  GENERATED ALWAYS AS (
    GREATEST("added_at", "assigned_at", "started_at",
             "completed_at", "checked_at", "fixed_at",
             "uploaded_at", "live_at")
  ) STORED;

CREATE INDEX "design_targets_last_activity_at_idx"
  ON "design_targets" ("last_activity_at" DESC);

CREATE INDEX "design_targets_assigned_to_id_last_activity_at_idx"
  ON "design_targets" ("assigned_to_id", "last_activity_at" DESC);

-- ⭐ কিউয়ের ছাঁকনি দুটোর জন্য — "যাচাই বাকি" আর "ঠিক করতে হবে"।
-- ⚠️ আংশিক (partial) ইনডেক্স: কেবল যে সারিগুলো সত্যিই কিউতে থাকতে পারে।
--    ৩৯ হাজার সারির মধ্যে ওগুলো কয়েকশো, তাই ইনডেক্সটা ছোট ও দ্রুত।
CREATE INDEX "design_targets_to_check_idx"
  ON "design_targets" ("completed_at" DESC)
  WHERE "completed_at" IS NOT NULL AND "checked_at" IS NULL;

CREATE INDEX "design_targets_to_fix_idx"
  ON "design_targets" ("error_found_at" DESC)
  WHERE "error_found_at" IS NOT NULL AND "fixed_at" IS NULL;
