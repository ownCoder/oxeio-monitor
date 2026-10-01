# OX-07 offboarding and monthly payday — 1 October 2026

## Live records

- Owner stated Sadia Akther (OX-07) last worked **30 September 2026**. Production had still marked her active. [Guarded offboarding transaction](2026-10-01-ox07-offboarding.sql) set `status=inactive`, `left_on=2026-09-30`, disabled her portal user and recorded audit #4607. No active OX-07 devices or unused enrollment codes remained. Historical work and screenshots were preserved.
- Before correction, the deposit ledger had August ৳500, September ৳500, and an erroneous October ৳500 created on 1 October while she was still active. A settlement entered earlier on 1 October said `refunded` for ৳1,500. Owner stated only **৳1,000** had been deposited. [Guarded correction](2026-10-01-ox07-deposit-correction.sql) removed the post-departure October row and corrected the settlement principal snapshot to ৳1,000; audit #4611 records the before/after. Ledger now totals ৳1,000. **The pre-existing `refunded` outcome was left unchanged; actual cash return still needs owner confirmation.**
- No `salary_payments` row existed for Sadia, or for any staff, at this check. No historical payment was inferred or created. September salary remains on the Salary page because her last day is within September. Its actual calculated net payable still requires owner review before marking payment.

## Payday release

- Every selected salary month now shows a scheduled payday on the **5th of the following month**: September 2026 → 5 October 2026; December 2026 → 5 January 2027. After the due date, rows without `Paid` show a reminder to verify actual payment. `Not recorded` is not silently converted to `Unpaid`, and no money is disbursed.
- Scoped files: `server/src/payroll/salary-payday.ts`, `salary.service.ts`, `server/test/salary-payday.spec.ts`, `web/src/api/salary.ts`, `web/src/pages/SalaryPage.tsx`. Clean release mirror: `.release-salary/oxeio-monitor`; dirty main checkout was not used for deployment.
- Date rollover tests (2), API/web typecheck, lint and build passed. Production API/web images healthy; public health reports **build 440 / `076916f0b5c01905fe7db62afe16c8b6e7281de2`**. Public JS hash matched web container. PostgreSQL container was not replaced; salary-payment count remained zero. No migration or seed ran.
- VPS release evidence/source bundle: `/opt/oxeio-releases/payday-20261001`. Rollback images: `oxeio-api:before-payday-20261001`, `oxeio-web:before-payday-20261001` (build 437). Both compose files are required.

## Follow-up

- Confirm whether the previously recorded `refunded` deposit outcome reflects an actual ৳1,000 return. If not, correct the settlement outcome with a separate audited action; do not assume a refund occurred merely from this record.
- On 5 October, review the final September payroll, then record Sadia's and each staff member's **actual** Paid/Partial/Unpaid status and payment date. The scheduled date is not proof of disbursement.
