-- R22a — app_usage-এ কোন অবস্থায় দেখা হয়েছে।
--
-- ⚠️ DEFAULT 'active' ইচ্ছাকৃত: পুরোনো সব সারি (আর পুরোনো এজেন্টের পাঠানো
--    নতুন সারিও) সংজ্ঞা অনুযায়ী ACTIVE — এজেন্ট তখন অন্য অবস্থায় রেকর্ডই
--    করত না। ডিফল্ট না দিলে ব্যাকফিল লাগত, আর NULL মানে "জানি না" হয়ে
--    যেত, যা এখানে মিথ্যা।
ALTER TABLE "app_usage"
  ADD COLUMN "segment_state" "SegmentState" NOT NULL DEFAULT 'active';

-- ⭐ R22b-র overlap কোয়েরির জন্য — idle সেগমেন্টের সাথে সময় মেলাতে
--    work_date নয়, started_at ধরে খুঁজতে হবে।
CREATE INDEX "app_usage_employee_id_started_at_idx"
  ON "app_usage" ("employee_id", "started_at");
