-- OX-07's former Windows account/device was confirmed reassigned to OX-12.
-- Guard every identity field; preserve telemetry history and invalidate the old token.
BEGIN;
WITH changed AS (
  UPDATE devices
  SET status = 'revoked'
  WHERE id = 26
    AND employee_id = 20
    AND hostname = 'SADIA'
    AND windows_username = 'SADIA\Intern'
    AND machine_guid = '84369b1f-b0e8-400f-96b2-77e8fc319cb1'
    AND status = 'active'
  RETURNING id, hostname
)
INSERT INTO audit_log (user_id, action, target_type, target_id, meta)
SELECT NULL, 'revoke_device', 'device', id::text,
       jsonb_build_object(
         'hostname', hostname,
         'reason', 'Physical PC reassigned from OX-07 to OX-12 after SSD replacement',
         'source', 'Admin recovery requested by owner on 2026-10-01'
       )
FROM changed
RETURNING id, action, target_id;
COMMIT;
