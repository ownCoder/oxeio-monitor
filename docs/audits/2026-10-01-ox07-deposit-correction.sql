-- Owner confirmed Sadia OX-07 deposited only BDT 1,000 through 2026-09-30.
-- October's BDT 500 row was generated while she was incorrectly left active.
-- Keep the pre-existing settlement outcome; correct only its principal snapshot.
BEGIN;
DO $$
DECLARE
  affected integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = 20 AND emp_code = 'OX-07' AND status = 'inactive'
      AND left_on = DATE '2026-09-30'
  ) THEN
    RAISE EXCEPTION 'OX-07 offboarding guard failed';
  END IF;

  IF (SELECT COALESCE(sum(amount_paisa), 0) FROM security_deposits
      WHERE employee_id = 20 AND year_month IN ('2026-08', '2026-09')) <> 100000 THEN
    RAISE EXCEPTION 'OX-07 August/September deposit total is not BDT 1,000';
  END IF;

  DELETE FROM security_deposits
  WHERE id = 41221 AND employee_id = 20 AND year_month = '2026-10'
    AND amount_paisa = 50000;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one erroneous October instalment';
  END IF;

  UPDATE deposit_settlements
  SET amount_paisa = 100000
  WHERE id = 1 AND employee_id = 20 AND outcome = 'refunded'
    AND amount_paisa = 150000 AND last_working_day = DATE '2026-09-30';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one settlement amount to correct';
  END IF;

  INSERT INTO audit_log (user_id, action, target_type, target_id, meta)
  VALUES (
    NULL, 'deposit_policy_update', 'employee', '20',
    jsonb_build_object(
      'op', 'correct_departure_deposit', 'empCode', 'OX-07',
      'removedYearMonth', '2026-10', 'removedPaisa', 50000,
      'settlementBeforePaisa', 150000, 'settlementAfterPaisa', 100000,
      'outcomeUnchanged', 'refunded',
      'reason', 'Owner confirmed only BDT 1,000 was deposited through last working day 2026-09-30',
      'source', 'Owner-directed admin correction; no portal actor impersonated'
    )
  );
END $$;
COMMIT;
