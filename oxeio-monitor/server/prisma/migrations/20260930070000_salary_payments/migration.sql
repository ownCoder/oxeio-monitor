CREATE TABLE "salary_payments" (
  "id" SERIAL PRIMARY KEY,
  "employee_id" INTEGER NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "year_month" CHAR(7) NOT NULL,
  "status" VARCHAR(7) NOT NULL CHECK ("status" IN ('unpaid', 'partial', 'paid')),
  "paid_amount" DECIMAL(12,2) NOT NULL CHECK ("paid_amount" >= 0),
  "net_payable_at_record" DECIMAL(12,2),
  "paid_on" DATE,
  "note" VARCHAR(500),
  "recorded_by_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "salary_payments_employee_id_year_month_key" UNIQUE ("employee_id", "year_month"),
  CONSTRAINT "salary_payments_state_check" CHECK (
    ("status" = 'unpaid' AND "paid_amount" = 0 AND "paid_on" IS NULL)
    OR ("status" = 'partial' AND "paid_amount" > 0 AND "paid_on" IS NOT NULL)
    OR ("status" = 'paid' AND "paid_on" IS NOT NULL)
  )
);
CREATE INDEX "salary_payments_year_month_idx" ON "salary_payments"("year_month");
