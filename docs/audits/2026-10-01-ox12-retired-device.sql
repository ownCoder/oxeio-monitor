-- Owner confirmed OX-12's former INTERN_2 PC/SSD is retired.
BEGIN;
WITH changed AS (
  UPDATE devices
  SET status = 'revoked'
  WHERE id = 17
    AND employee_id = 25
    AND hostname = 'INTERN_2'
    AND windows_username = 'Intern_2\Intern_PC2'
    AND machine_guid = 'b23f5293-83be-41a1-a76d-6f4ad56bfee8'
    AND status = 'active'
  RETURNING id, hostname
)
INSERT INTO audit_log (user_id, action, target_type, target_id, meta)
SELECT NULL, 'revoke_device', 'device', id::text,
       jsonb_build_object(
         'hostname', hostname,
         'reason', 'OX-12 former PC/SSD retired after reassignment to Sadia PC',
         'source', 'Owner confirmed retirement on 2026-10-01'
       )
FROM changed
RETURNING id, action, target_id;
COMMIT;
