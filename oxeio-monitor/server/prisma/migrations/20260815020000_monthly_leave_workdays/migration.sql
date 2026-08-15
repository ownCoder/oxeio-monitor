-- R2 — মাসিক সারাংশে ছুটির কর্মদিবস।
--
-- DEFAULT 0 রাখা হয়েছে যাতে পুরোনো সারিগুলো অপরিবর্তিত থাকে: ছুটির খাতা
-- চালুর আগের মাসে কারো ছুটি লেখা ছিল না, তাই ০-ই সঠিক — অনুমান নয়।
ALTER TABLE "monthly_summary"
  ADD COLUMN "leave_workdays" INTEGER NOT NULL DEFAULT 0;
