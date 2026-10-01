-- Read-only audit of every employee's deposit months against departure and settlement.
WITH ledger AS (
  SELECT e.id, e.emp_code, e.full_name, e.status, e.joined_on, e.left_on,
         e.deposit_start_year_month,
         count(sd.id) AS instalments,
         coalesce(sum(sd.amount_paisa), 0) AS ledger_paisa,
         min(sd.year_month) AS first_month,
         max(sd.year_month) AS last_month,
         count(sd.id) FILTER (
           WHERE e.left_on IS NOT NULL
             AND sd.year_month > to_char(e.left_on, 'YYYY-MM')
         ) AS after_departure_months,
         coalesce(sum(sd.amount_paisa) FILTER (
           WHERE e.left_on IS NOT NULL
             AND sd.year_month > to_char(e.left_on, 'YYYY-MM')
         ), 0) AS after_departure_paisa
  FROM employees e
  LEFT JOIN security_deposits sd ON sd.employee_id = e.id
  GROUP BY e.id
)
SELECT l.id, l.emp_code, l.full_name, l.status, l.joined_on, l.left_on,
       l.deposit_start_year_month, l.instalments, l.ledger_paisa,
       l.first_month, l.last_month, l.after_departure_months,
       l.after_departure_paisa, s.outcome AS settlement_outcome,
       s.amount_paisa AS settlement_paisa,
       (s.amount_paisa IS NOT NULL AND s.amount_paisa <> l.ledger_paisa) AS settlement_mismatch
FROM ledger l
LEFT JOIN deposit_settlements s ON s.employee_id = l.id
ORDER BY l.emp_code;
