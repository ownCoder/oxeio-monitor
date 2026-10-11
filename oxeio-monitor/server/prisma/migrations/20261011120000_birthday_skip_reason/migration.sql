ALTER TABLE design_skip_requests DROP CONSTRAINT IF EXISTS design_skip_requests_reason_check;
ALTER TABLE design_skip_requests ADD CONSTRAINT design_skip_requests_reason_check
  CHECK (reason IN ('not_found', 'events', 'copyright', 'birthday', 'others'));
