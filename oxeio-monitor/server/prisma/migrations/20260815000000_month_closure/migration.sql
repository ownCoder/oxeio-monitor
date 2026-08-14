-- R1 — মাস বন্ধ করা (payroll lock)
--
-- ⚠️ শুধু একটা টেবিল যোগ, কোনো কলাম বদলায় না — তাই পুরোনো ডেটা অক্ষত,
--    আর মাইগ্রেশনটা ফেরানোও সহজ (DROP TABLE)।
CREATE TABLE "month_closures" (
    "year_month" CHAR(7) NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "month_closures_pkey" PRIMARY KEY ("year_month")
);
