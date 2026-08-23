-- ⭐⭐ **কে "শেষ" বলেছেন** (২৩ আগস্ট ২০২৬, মালিকের রিপোর্ট)।
--
-- ⚠️⚠️ `completed_via` বলত কীভাবে হয়েছে ('manual'/'filename'), কিন্তু **কে**
--    করেছেন সেটা কোথাও লেখা হতো না। ফলে তালিকায় যাঁর নাম দেখা যেত তিনি
--    ছিলেন যাঁকে বরাদ্দ করা হয়েছিল — মালিক নিজে Complete চাপলেও
--    ডিজাইনারের নামই দেখাত, যা সরাসরি ভুল তথ্য।
--
-- ⚠️ ব্যাকফিল নেই: পুরোনো সারিগুলোর ক্ষেত্রে কে চেপেছিলেন তা **জানা নেই**,
--    আর অনুমান করে বসালে সেটা তথ্য নয়, বানানো গল্প হতো।
ALTER TABLE "design_targets" ADD COLUMN "completed_by_id" INTEGER;

ALTER TABLE "design_targets"
  ADD CONSTRAINT "design_targets_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "users"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX "design_targets_completed_by_id_idx"
  ON "design_targets" ("completed_by_id");
