# Deposit collection pause and unpaid refund correction — 4 November 2026

The owner instructed us to stop taking staff deposits, confirmed no deposit money was collected in November 2026, and said previously held money will be returned during November. The owner later confirmed **no refund has yet been paid**. This record distinguishes a ledger calculation from actual cash movement.

## Live change

- Before the change, `deposit_policy.active=true` with a ৳500 monthly rule. An automatic ledger had created 12 November rows totalling ৳6,000. No November salary payment or month closure existed.
- A guarded database transaction set the policy inactive and removed **only** those 12 November rows. It wrote an audit entry. August–October ledger rows were left intact. With the policy inactive, `ensureLedger()` does not generate new instalments, and payroll's deposit deduction for November has no ledger entries to use.
- The sole existing settlement was OX-07 Sadia Akther's ৳1,000, marked `refunded` on 1 October. Because the owner confirmed no refund was paid, a second guarded transaction removed that incorrect settlement and wrote a correction audit entry with the prior settlement details. The original `deposit_settle` audit remains. Sadia's ৳1,000 is now an open amount due to her.
- Final read-only check: policy inactive, **zero** November deposit rows, 13 open balances totalling **৳17,000**, and zero settled balances. This amount is due to staff; it has **not** been paid back or marked refunded. It includes Sadia's ৳1,000. The earlier August–October ledger total is ৳17,000. The owner should reconcile each staff amount against actual historical collections before paying it.
- Owner Deposits page now shows **Collection paused** and explains that existing balances await payment. Web release **507 / `cb4b6933a24e65df4c15a9d9aa13b6e13f473bb2`**. API and PostgreSQL containers were not rebuilt; all three services healthy, public bundle includes the paused text. Frontend typecheck and lint passed. No visual browser QA was completed.

## Refund work still due

Pay and verify each staff member's actual balance during November. After each real payment, use **Record refund** on that person's row and put the payment date/reference in the Note. The action records the full calculated balance and closes that person's deposit ledger permanently; check each current employee's amount and future collection policy before using it, especially if collection may resume. Partial refunds need a separate tracking method because this workflow records only full settlement. Do **not** bulk-mark the 13 balances as refunded before paying them. When all actual refunds are complete, the owner page should show no open held balance.

The prechange table-only backup is `/opt/oxeio-releases/deposit-hold-20261104/prechange-deposits.dump` (mode 600, SHA-256 `23261e1aac95c691c8220f13054b949cfbf594e69e3846d98e4611fc86f9b733`). Transaction SQL and logs are in the same restricted release directory. Previous web image remains tagged `oxeio-web:before-deposit-hold-20261104`. VPS disk after deployment was 86% used, about 11 GiB available; old tagged Docker images remain the main retention issue.
