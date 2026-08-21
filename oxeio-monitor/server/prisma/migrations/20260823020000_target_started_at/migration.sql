-- ⭐⭐ "কাজ শুরু হয়েছে" — ফাইলটা প্রথমবার খোলা হয়েছে (২৩ আগস্ট ২০২৬)।
-- ⚠️⚠️ আগে এই সংকেতটাকেই "শেষ" ধরা হতো, আর তাতে টার্গেট খোলামাত্র বন্ধ
--    হয়ে যেত। শেষ হওয়া এখন ডিজাইনার নিজে বলেন (Complete বোতাম)।
ALTER TABLE "design_targets" ADD COLUMN "started_at" TIMESTAMPTZ(3);

-- ⚠️ ইমপোর্ট নয় এমন যেগুলো ইতিমধ্যে 'filename' দিয়ে বন্ধ হয়েছে, সেগুলো
--    আসলে "শুরু হয়েছে" — ফিরিয়ে দেওয়া হচ্ছে, নইলে ওই কাজগুলো নীরবে
--    শেষ বলে গোনা থাকত।
UPDATE "design_targets"
   SET status = 'assigned', started_at = "completed_at",
       completed_at = NULL, completed_via = NULL
 WHERE "completed_via" = 'filename';
