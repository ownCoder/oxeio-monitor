ALTER TABLE design_targets
  ADD COLUMN skip_review_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN skip_requested_at TIMESTAMPTZ(3);

-- Do not fabricate dates or pending decisions for historical skips.
CREATE TABLE design_skip_requests (
  id SERIAL PRIMARY KEY,
  target_id INTEGER NOT NULL REFERENCES design_targets(id) ON DELETE RESTRICT,
  employee_id INTEGER NOT NULL,
  actor_user_id INTEGER,
  reason VARCHAR(16) NOT NULL CHECK (reason IN ('not_found', 'copyright', 'events')),
  requested_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('automatic', 'pending', 'approved', 'rejected')),
  decided_at TIMESTAMPTZ(3),
  reviewer_user_id INTEGER
);
CREATE INDEX design_skip_requests_employee_id_requested_at_idx ON design_skip_requests(employee_id, requested_at);
CREATE INDEX design_skip_requests_target_id_decision_idx ON design_skip_requests(target_id, decision);
CREATE UNIQUE INDEX design_skip_requests_one_pending ON design_skip_requests(target_id) WHERE decision = 'pending';
ALTER TABLE design_targets ADD CONSTRAINT pending_skip_stays_assigned
  CHECK (NOT skip_review_pending OR (status = 'assigned' AND assigned_to_id IS NOT NULL AND skip_requested_at IS NOT NULL));
