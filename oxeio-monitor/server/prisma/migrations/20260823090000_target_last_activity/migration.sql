-- ⭐⭐ **শেষ যা ঘটেছে** (২৩ আগস্ট ২০২৬, মালিকের চাওয়া) — তালিকার ক্রম ও
--    তারিখ-ফিল্টার দুটোরই ভিত্তি।
--
-- ⚠️⚠️ কেন দরকার হলো: তালিকা সাজত `id desc` — অর্থাৎ **কবে যোগ হয়েছে**,
--    কবে কাজ হয়েছে নয়। ৩১,৩১১টা `done` সারির মাঝে দশ মিনিট আগে করা
--    একটা ভুল যেকোনো জায়গায় থাকতে পারত, আর মালিক সেটা খুঁজে পেতেন না।
--
-- ⭐ `GREATEST` PostgreSQL-এ **NULL উপেক্ষা করে** — ফল NULL হয় কেবল সব
--    কটা NULL হলে। `added_at` NOT NULL, তাই এই ঘর কখনো খালি থাকে না।
--
-- ⚠️ STORED, VIRTUAL নয় — ইনডেক্স বসাতে হবে, আর ৪১ হাজার সারিতে রোজ
--    বহুবার সাজানো হবে। জায়গার খরচ ৮ বাইট/সারি, প্রায় কিছুই নয়।
ALTER TABLE "design_targets"
  ADD COLUMN "last_activity_at" TIMESTAMPTZ(3)
  GENERATED ALWAYS AS (
    GREATEST("added_at", "assigned_at", "started_at",
             "completed_at", "uploaded_at", "live_at")
  ) STORED;

-- ⭐ ক্রম সবসময় এই ঘর ধরে, তাই ইনডেক্স ছাড়া প্রতিবার পুরো টেবিল সাজাতে হতো
CREATE INDEX "design_targets_last_activity_at_idx"
  ON "design_targets" ("last_activity_at" DESC);

-- ⚠️ কর্মী + অবস্থা ধরে ছাঁকার পর ক্রম — দুটো একসাথে থাকলে কুয়েরিটা
--    ইনডেক্সেই শেষ হয়, সারি টেনে এনে সাজাতে হয় না
CREATE INDEX "design_targets_assigned_to_id_last_activity_at_idx"
  ON "design_targets" ("assigned_to_id", "last_activity_at" DESC);
