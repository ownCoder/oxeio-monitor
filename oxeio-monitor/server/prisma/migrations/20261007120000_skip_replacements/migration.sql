-- Existing skip requests are historical facts, not retroactive replacement debt.
ALTER TABLE "design_skip_requests"
  ADD COLUMN "replacement_due" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "replacement_target_id" INTEGER,
  ADD COLUMN "replacement_issued_at" TIMESTAMPTZ(3);

ALTER TABLE "design_skip_requests"
  ADD CONSTRAINT "design_skip_requests_replacement_target_id_fkey"
  FOREIGN KEY ("replacement_target_id") REFERENCES "design_targets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "design_skip_requests_employee_id_replacement_due_requested_at_idx"
  ON "design_skip_requests"("employee_id", "replacement_due", "requested_at");

ALTER TABLE "design_skip_requests"
  ADD CONSTRAINT "design_skip_requests_replacement_state_check"
  CHECK (
    NOT (replacement_due AND replacement_target_id IS NOT NULL)
    AND NOT (replacement_due AND replacement_issued_at IS NOT NULL)
    AND ((replacement_target_id IS NULL) = (replacement_issued_at IS NULL))
  );
