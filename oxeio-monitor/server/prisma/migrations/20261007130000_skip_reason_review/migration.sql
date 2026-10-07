ALTER TABLE design_skip_requests DROP CONSTRAINT IF EXISTS design_skip_requests_reason_check;
ALTER TABLE design_skip_requests ADD CONSTRAINT design_skip_requests_reason_check
  CHECK (reason IN ('not_found', 'events', 'copyright', 'others'));

ALTER TABLE design_targets DROP CONSTRAINT pending_skip_stays_assigned;
ALTER TABLE design_targets ADD CONSTRAINT pending_skip_stays_assigned
  CHECK (NOT skip_review_pending OR (status IN ('assigned', 'skipped') AND assigned_to_id IS NOT NULL AND skip_requested_at IS NOT NULL));
