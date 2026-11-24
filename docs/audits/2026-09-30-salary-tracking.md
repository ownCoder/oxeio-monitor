# Owner-only Salary and payment tracking — 30 September 2026

Application **437 / 3422cb7** at `https://hub.oxeio.com`.

## ফল

- Sidebar-এ owner-only **Salary** page। Month অনুযায়ী staff-এর salary, existing payroll-এর Net payable, recorded amount/date/note ও Not recorded/Unpaid/Partial/Paid। Monthly rollup না থাকলেও staff ও তার salary (থাকলে) তালিকায় থাকে; Net payable খালি দেখায়। Status filter ও count আছে। [ব্যবহারবিধি](../salary-operations.md)।
- নতুন `salary_payments` table-এ employee+month প্রতি একটি manual cumulative record। Payment amount আসল bank transfer নয়; ঐতিহাসিক status migration/seed থেকে অনুমান করা হয়নি। Existing payroll math বদলায়নি। Net payable record করার সময় snapshot রাখা হয়; পরে হিসাব বদলালে UI review warning দেয়।
- Owner ছাড়া manager/staff/unauthed read/write করতে পারে না। Payment write ও before/after audit একই DB transaction-এ; owner-এর salary read `payroll_view` audit-এ থাকে। Paid amount বর্তমান calculated net-এর সমান; Partial তা থেকে কম ও ধনাত্মক; missing calculation-এ Paid/Partial block। Open month-এ recording সম্ভব, provisional warning আছে।

## যাচাই

- Clean VPS-aligned source-এ Prisma generate, additive migration, API typecheck/lint/build; isolated PostgreSQL-এ ৪টি নতুন salary/payment/role case + ৩৬টি payroll/proration integration cases passed। Web typecheck/lint/build এবং ২৯৫ frontend tests passed।
- Current encrypted pre-release backup-এর isolated restore/migration drill passed। Employees ১৩, targets ৫১,১৭০, monthly rows ২৫ এবং অন্য core counts অপরিবর্তিত; নতুন payment table খালি। Production data-তে কোনো payment status লেখা হয়নি।
- Chrome synthetic owner page, status save এবং staff access denial verified। [Synthetic preview](salary-preview.png)। Real employee salary browser-এ খোলা হয়নি।
- Public HTTPS health reports `437 / 3422cb7`, API/web healthy, unauthenticated Salary endpoint 401, frontend `/assets/index-DBfo6qTW.js` SHA256 `f6b28050d5c4eb8d122815bec1624e7e8510d08b7d21d35cd6ca460d99343b95` matches the container, PostgreSQL container unchanged, ১৩টি scoped source hash match।

## Source ও recovery

- App commit `3422cb7ea355b2903ac63ec3b87258da05bb349f`; deployed marker `/opt/oxeio/.git/oxeio-deployed-commit`। Clean local mirror `.release-salary/oxeio-monitor`; dirty main checkout-এর unrelated agent/payroll/Studio পরিবর্তন release-এ নেই। [Scoped source list](salary-source-files.txt) · [hashes](salary-local-sha256.txt)।
- VPS evidence, encrypted backup, source bundles, build/test/migration logs: `/opt/oxeio-releases/salary-20260930`। Shared handoff `/opt/oxeio/docs/current-state.md`।
- Rollback images `oxeio-api:before-salary-20260930`, `oxeio-web:before-salary-20260930` (application 435)। Both compose files required। Migration `20260930070000_salary_payments` additive; rollback-এ table/payment records মুছবেন না।
- GitHub push বা অন্য PC-তে automatic sync যাচাই করা হয়নি। অন্য PC থেকে VPS handoff ও deployed marker মিলিয়ে কাজ শুরু করুন।
