-- ⭐⭐ এক-দফার ইতিহাস সংশোধন — G164 · G165 (৭ সেপ্টেম্বর ২০২৬, চালানো হয়ে গেছে)
--
-- ⚠️ নিয়মিত জব নয়; রাখা হয়েছে নথি হিসেবে। গল্প: docs/09-Build-Log.md § ৩ঞ৩১.১৩
-- চালানো হয়েছিল:
--   ssh oxeio-new "docker exec -i oxeio-postgres psql -U oxeio -d oxeio" < এই ফাইল
-- ফল: UPDATE 7 · খামের বাইরে পড়া সেগমেন্ট ৫২ → ০
--
\set ON_ERROR_STOP on
BEGIN;

-- G164 ব্যাকফিল — সেশনের সীমা তার নিজের সেগমেন্টগুলোকে ধরুক।
--
-- ⚠️ ঠিক যা `widen()` করত: শুরু কেবল **পিছোয়**, শেষ কেবল **এগোয়**।
-- ⚠️⚠️ খোলা সেশনে (`ended_at IS NULL`) শেষ বসানো হয় না — CASE সেটা ধরে,
--     আর ওটা জরুরি: খোলা সেশনই দিন-ক্লোজ ও logoff-ক্লোজের ইনপুট।
-- ⚠️ `end_reason` ছোঁয়া হয় না — `widen()`-ও ছোঁয় না।

UPDATE work_sessions s
SET started_at = LEAST(s.started_at, b.min_start),
    ended_at   = CASE WHEN s.ended_at IS NULL THEN NULL
                      ELSE GREATEST(s.ended_at, b.max_end) END
FROM (SELECT session_id, min(started_at) AS min_start, max(ended_at) AS max_end
      FROM activity_segments GROUP BY session_id) b
WHERE b.session_id = s.id
  AND (s.started_at > b.min_start
       OR (s.ended_at IS NOT NULL AND s.ended_at < b.max_end));

-- ⭐ পাহারা: এখন একটাও সেগমেন্ট নিজের সেশনের বাইরে থাকতে পারবে না
DO $$
DECLARE bad int; neg int;
BEGIN
  SELECT count(*) INTO bad
  FROM work_sessions s JOIN activity_segments a ON a.session_id = s.id
  WHERE a.started_at < s.started_at
     OR (s.ended_at IS NOT NULL AND a.ended_at > s.ended_at);

  SELECT count(*) INTO neg
  FROM work_sessions WHERE ended_at IS NOT NULL AND ended_at < started_at;

  IF bad <> 0 OR neg <> 0 THEN
    RAISE EXCEPTION 'guard failed: outside=% negative=%', bad, neg;
  END IF;
END $$;

COMMIT;

SELECT 'broken_after' AS k, count(DISTINCT s.id)::text AS v
FROM work_sessions s JOIN activity_segments a ON a.session_id = s.id
WHERE a.started_at < s.started_at
   OR (s.ended_at IS NOT NULL AND a.ended_at > s.ended_at);
