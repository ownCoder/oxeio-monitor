-- ⭐⭐ **বাদ-যাওয়া ডিজাইন মালিক ও ম্যানেজার দেখে নেন** (৩১ আগস্ট ২০২৬)
--
--    মালিক: "ami and manager ei delete and skip deya design gula alada vabe
--    management korte paruk… kono designer kono target design skip dilo.
--    erpore seTa manager er skip list e show korlo. manager next time skip
--    deyar issue ta check kore dekholO"
--
-- ⭐ এই দুটো ঘরই গোটা কিউটাকে সম্ভব করে: `reviewed_at` NULL মানে "এখনো কেউ
--    দেখেনি", আর সেটাই কিউয়ের একমাত্র শর্ত। বাকি ধাপগুলোও (`checked_at`,
--    `fixed_at`, `uploaded_at`, `live_at`) হুবহু এই ছাঁচেই লেখা।
--
-- ⚠️⚠️ **কিউ কখনো খালি না হলে সেটা কিউ নয়, পাহাড়।** ২৪ আগস্টে ঠিক এই
--    ভুলটা একবার হয়েছিল: আপলোড-কিউতে ২৭,৬৪১টা পুরোনো সারি দাঁড়িয়ে গিয়েছিল,
--    আর পাহাড় দেখলে কেউ শুরুই করে না। ⭐ তাই একটা "দেখা হয়েছে" চিহ্ন
--    থাকতেই হয় — নইলে তালিকাটা সপ্তাহে সপ্তাহে বাড়ত আর একদিন কেউ আর খুলত না।
--
-- ⚠️ কে দেখেছেন সেটাও রাখা হয় (`reviewed_by_id` → users), কারণ মালিক ও
--    ম্যানেজার দুজনেই দেখতে পারেন, আর "কে ছেড়ে দিয়েছিল" প্রশ্নটা পরে ওঠে।
ALTER TABLE "design_targets"
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "reviewed_by_id" INTEGER;

ALTER TABLE "design_targets"
  ADD CONSTRAINT "design_targets_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ⚠️ কিউয়ের কোয়েরি ঠিক এই দুটো ঘর ধরে চলে, তাই ইনডেক্সটা আংশিক —
--    যেগুলো এখনো দেখা হয়নি কেবল সেগুলোই ইনডেক্সে বসে।
CREATE INDEX "design_targets_to_review_idx"
  ON "design_targets" ("status")
  WHERE "reviewed_at" IS NULL AND "drop_reason" IS NOT NULL;
