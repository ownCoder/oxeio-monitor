-- R2 — ছুটির খাতা
--
-- ⚠️ এক সারি = এক দিন (তারিখের সীমা নয়) — গোনা ও বাদ দেওয়া তখন তুচ্ছ।
-- ⚠️ শুধু টেবিল যোগ, কোনো কলাম বদলায় না — পুরোনো ডেটা অক্ষত।
CREATE TABLE "leaves" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "leave_date" DATE NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'casual',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- ⭐ একই দিনে দুবার ছুটি লেখা আটকায় — নইলে গোনায় দুবার বাদ যেত
CREATE UNIQUE INDEX "leaves_employee_id_leave_date_key" ON "leaves"("employee_id", "leave_date");
CREATE INDEX "leaves_leave_date_idx" ON "leaves"("leave_date");

ALTER TABLE "leaves" ADD CONSTRAINT "leaves_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
