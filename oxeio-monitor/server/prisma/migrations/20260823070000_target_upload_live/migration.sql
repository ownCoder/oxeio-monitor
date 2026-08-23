-- ⭐⭐ **আপলোড ও লাইভ** (২৩ আগস্ট ২০২৬) — কাজের শেকল শেষ পর্যন্ত।
--
-- ⚠️⚠️ নতুন `status` মান নয়, **তারিখ** — `started_at`/`completed_at`-এর মতো।
--    status-এ ঢোকালে একটা কাজ 'done' থেকে 'uploaded' হয়ে যেত, আর
--    `status = 'done'` ধরে যত গণনা আছে সব নীরবে কমে যেত।
--
-- ⭐ এতে প্রথমবার প্রশ্নটা করা যাবে: ৩০ দেওয়া → ২৫ ডিজাইন → ২০ আপলোড →
--    ১২ লাইভ। মাঝের ফুটোটা আজ পর্যন্ত দেখাই যেত না।
ALTER TABLE "design_targets" ADD COLUMN "uploaded_at" TIMESTAMPTZ(3);
ALTER TABLE "design_targets" ADD COLUMN "live_at"     TIMESTAMPTZ(3);

-- ⚠️ উপরের `asin`-এর সাথে গুলিয়ে ফেলা যাবে না: ওটা গবেষকের খুঁজে আনা
--    **নমুনা** পণ্য, আর এটা আমাদের নিজের **বিক্রয়যোগ্য** পণ্য।
ALTER TABLE "design_targets" ADD COLUMN "live_asin"   VARCHAR(20);
