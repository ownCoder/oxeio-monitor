# All-staff deposit audit — 1 October 2026

Read-only production reconciliation: [query](2026-10-01-deposit-ledger-audit.sql). This audit made no data changes.

- **13 staff records:** 11 active, OX-07 inactive since 30 September, and one inactive test record.
- **No remaining post-departure instalment:** zero rows dated after an employee's `left_on` month. Sadia's erroneous October instalment was the only observed departure-related case and was corrected before this audit.
- **No settlement mismatch:** Sadia's only settlement snapshot is ৳1,000 and equals her August + September ledger total. The pre-existing outcome is `refunded`; actual cash return remains unconfirmed.
- **General timing issue:** all 11 currently active staff already have an October ৳500 instalment, total **৳5,500**, although today is 1 October. `ensureLedger()` writes the current month's instalment whenever the employee is active, and the Deposits UI calls the ledger “held from salary.” This is an accrual/scheduled figure; the database does not link it to an actual salary disbursement or receipt.
- `salary_payments` had zero rows at the audit. That means actual payment status is **not recorded**, not that nobody has been paid.

If the owner confirms that deposit is actually withheld when the prior month's salary is paid on the following month's 5th, the current “held” presentation is premature for all active staff. A correct fix must distinguish scheduled instalments from confirmed collection and handle already generated rows; simply deleting October rows would fail because `ensureLedger()` recreates them on page load. If deposit is collected separately at the start of each month, the October rows are expected. Await owner policy clarification before mutating other employees' financial records.
