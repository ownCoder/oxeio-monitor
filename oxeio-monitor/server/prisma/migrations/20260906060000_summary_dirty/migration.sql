-- ⭐⭐⭐ যে কর্মদিবসটা আবার গুনতে হবে (৬ সেপ্টেম্বর ২০২৬)
--
-- ⚠️⚠️ rollup চলত কেবল আজ (K06) আর গতকালের (K05) উপর। এর বাইরের কোনো
-- দিনের সেগমেন্ট পরে এলে daily_summary-তে কোনোদিন উঠত না — আর সেখান থেকে
-- মাসিক সারি, আর সেখান থেকে বেতন।
CREATE TABLE "summary_dirty" (
    "work_date"  DATE NOT NULL,
    "marked_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "summary_dirty_pkey" PRIMARY KEY ("work_date")
);

-- ⚠️ নিষ্কাশন হয় পুরোনো আগে — সূচকটা ঠিক সেই ক্রমের জন্য
CREATE INDEX "summary_dirty_marked_at_idx" ON "summary_dirty" ("marked_at");

-- ⭐⭐ পুরোনো ক্ষতিটা এখানেই সারানো হয়: যেসব (কর্মী, দিন) জোড়ায় সত্যিকারের
-- active সেগমেন্ট আছে কিন্তু daily_summary কম বলছে, সেই দিনগুলো চিহ্নিত
-- করে দেওয়া হয় — পরের টিকেই জব ওগুলো আবার গুনে নেবে।
--
-- ⚠️ বন্ধ মাস বাদ (R1) — ওখানে সংখ্যা নড়ানো যায় না।
INSERT INTO "summary_dirty" ("work_date")
SELECT DISTINCT s.work_date
FROM (
    SELECT employee_id, work_date,
           extract(epoch FROM sum(upper(r) - lower(r)))::bigint AS active_sec
    FROM (
        SELECT employee_id, work_date,
               range_agg(tstzrange(started_at, ended_at)) AS rs
        FROM "activity_segments"
        WHERE state = 'active' AND ended_at IS NOT NULL
        GROUP BY employee_id, work_date
    ) g CROSS JOIN LATERAL unnest(g.rs) r
    GROUP BY employee_id, work_date
) s
LEFT JOIN "daily_summary" d
       ON d.employee_id = s.employee_id AND d.work_date = s.work_date
LEFT JOIN "month_closures" c
       ON c.year_month = to_char(s.work_date, 'YYYY-MM')
WHERE c.year_month IS NULL
  AND s.active_sec - coalesce(d.worked_sec, 0) > 60
ON CONFLICT ("work_date") DO NOTHING;
