-- ⭐⭐ **একটা PC বেছে আগে দেওয়া** (১ সেপ্টেম্বর ২০২৬, মালিকের চাওয়া)
--
--    মালিক: "OX-05 ei update age powa dorkar."
--
-- ⚠️⚠️ **নকশার ফাঁকটা মাঠে ধরা পড়েছে।** রোলআউট ঠিক হয় হ্যাশ-বালতি ধরে
--    (`sha256(machineGuid + " " + version) % 100 < percent`), অর্থাৎ **মেশিন
--    ধরে, মানুষ ধরে নয়**। ফলে যে PC-তে বাগটা ধরা পড়েছে, সংশোধনটা ঠিক
--    সেখানেই আগে পরীক্ষা করা **যেত না** — OX-05-এর বালতি ৮৬, তাই canary (৭)
--    বা partial (৫০) কোনোটাতেই তিনি পড়তেন না, আর `all` মানে একসাথে ১২টা PC।
--
-- ⭐ এই একটা ঘর সেই ফাঁকটা বন্ধ করে: বেছে দেওয়া ডিভাইস বালতি নির্বিশেষে
--    অফার পায়। ⚠️ কিন্তু `halted`-এ **নয়** — জরুরি ব্রেক সবার জন্য, পাইলটও
--    বাদ যায় না (নইলে খারাপ বিল্ড থামানোর পরেও একটা মেশিনে যেতেই থাকত)।
--
-- ⚠️ ডিভাইস মুছে গেলে ঘরটা NULL হয়ে যায়, ভার্সন সারিটা টেকে — একটা
--    বাতিল PC-র কারণে রিলিজের ইতিহাস হারানোর কোনো মানে নেই।
ALTER TABLE "agent_versions" ADD COLUMN "pilot_device_id" INTEGER;

ALTER TABLE "agent_versions"
  ADD CONSTRAINT "agent_versions_pilot_device_id_fkey"
  FOREIGN KEY ("pilot_device_id") REFERENCES "devices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
