-- Owner states OX-07 Sadia Akther's last working day was 2026-09-30.
-- Mirror the employee deactivation transaction without impersonating a portal user.
BEGIN;
WITH staff AS (
  UPDATE employees
  SET status = 'inactive', left_on = DATE '2026-09-30'
  WHERE id = 20 AND emp_code = 'OX-07' AND status = 'active'
  RETURNING id, emp_code
), revoked AS (
  UPDATE devices
  SET status = 'revoked'
  WHERE employee_id IN (SELECT id FROM staff) AND status = 'active'
  RETURNING id
), expired AS (
  UPDATE enrollment_codes
  SET expires_at = now()
  WHERE employee_id IN (SELECT id FROM staff)
    AND used_at IS NULL AND expires_at > now()
  RETURNING id
), disabled AS (
  UPDATE users
  SET is_active = false
  WHERE employee_id IN (SELECT id FROM staff) AND is_active = true
  RETURNING id
)
INSERT INTO audit_log (user_id, action, target_type, target_id, meta)
SELECT NULL, 'change_setting', 'employee', staff.id::text,
       jsonb_build_object(
         'op', 'deactivate',
         'empCode', staff.emp_code,
         'reason', 'Last working day 2026-09-30, per owner on 2026-10-01',
         'leftOn', '2026-09-30',
         'devicesRevoked', (SELECT count(*) FROM revoked),
         'codesExpired', (SELECT count(*) FROM expired),
         'portalDisabled', (SELECT count(*) FROM disabled),
         'source', 'Owner-directed admin recovery; no portal actor impersonated'
       )
FROM staff
RETURNING id, action, target_id;
COMMIT;
