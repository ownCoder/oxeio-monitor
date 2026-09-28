# Design Pool — functionality audit ও ব্যবহার সহজ করা

২৮ সেপ্টেম্বর ২০২৬ · baseline live **412 / b317bd9**, repository **c37ec84**।

## কী যাচাই হয়েছে

| Functionality | যাচাই |
|---|---|
| Links/ASIN bulk add | Duplicate protection, input limits এবং role permissions-এর existing integration tests |
| Assignment | Random allocation, stable job number, occupied slots, started-work protection, end-of-day return এবং skip-review tests |
| Search | ASIN, exact job number, numeric ASIN, long numeric input এবং case normalization tests; Chrome-এ পরিচিত job search |
| Filters | Status, designer, added-by, date, Done today, no-file trace; Chrome-এ filters ও spelling-fix queue |
| Pagination | ৫০টি করে page, previous/next এবং filter বদলালে page reset; loading-এ navigation disabled |
| Production queues | Check/fix/upload/live eligibility, cutoff, queue count বনাম result count; dropped targets exclusion |
| Actions | Complete/undo, pool return, check/error/fix, upload/live, skip decision ও reviewed acknowledgement |
| Deletion | Single/bulk routes, reason, deduped IDs, soft deletion, repeat delete এবং protected completed/pending work |
| Access | Owner/manager/researcher বনাম ordinary employee; delete ও skip decision owner/manager-only |
| UI | Loading/error/empty states, hidden filters, reset, refresh, accessible control labels এবং CSV export |

Live browser checks are read-only. Production targets-এর status, review, delete বা allocation audit করার জন্য বদলানো হয়নি। Mutation tests আলাদা disposable PostgreSQL database-এ চলে।

## সংশোধন

1. **Delete permission mismatch:** UI-তে researcher-এর Delete ছিল না, কিন্তু API তাঁকে delete করতে দিত। Single ও bulk API route এখন owner/manager-only।
2. **Unfixed error upload:** সরাসরি API দিয়ে বানানের recorded error অতিক্রম করা যেত। Upload statement-এর ভেতরেই eligibility বসেছে; error fix না হলে 400 হয়।
3. **Dropped design in production:** পুরোনো completion/stage field থাকা skipped/deleted target queue-তে উঠতে ও stage advance করতে পারত। Queue, counts ও stage write এখন completed target ধরে।
4. **Done-date filter:** পরে upload/live হলে Done today বা completion-date result থেকে কাজ হারাত। Done status-এর date filter এখন `completedAt` ধরে। Review/Skipped `skipRequestedAt`, অন্য filters latest activity ধরে। Reversed date range useful error দেয়।
5. **Misleading bulk selection:** Finished, already-deleted এবং pending-review কাজ এখন select করা যায় না। Select-all শুধু visible page-এর deletable কাজ নেয়। Refresh/reset selection সরায়; backend protection-ও বহাল।
6. **Unused frontend client:** আগের Distribute now removal-এর পরে অব্যবহৃত `distributeTargets` client ছিল; full frontend tests সেটি ধরেছে। Client সরানো হয়েছে।

## নতুন ব্যবহার সুবিধা

- সব search/status/designer/date filter একবারে **Reset all filters** দিয়ে সরানো যায়। Review page নিজের locked queue-তেই থাকে।
- **Refresh** table ও queue counts আবার আনে। Loading ও pagination-এর অবস্থা পরিষ্কার।
- **Today** ও **Last 7 days** date shortcuts, Dhaka time-এর ব্যাখ্যা ও native date-range bounds।
- **Export this page · CSV**: বর্তমানে দেখা সর্বোচ্চ ৫০টি matching row; পুরো pool export নয়। ASIN, job, status, people ও dates থাকে। UTF-8 BOM, escaped quotes এবং spreadsheet formula protection আছে।
- Matching result count, review sorting hint, clear empty state এবং More actions-এর পরিচয় যোগ হয়েছে।

## পরের উপযোগী additions

- Saved filter/view এবং shareable filtered URL: একই কাজের queue বারবার খুলতে সুবিধা।
- Owner/manager-এর per-job history drawer: source সংগ্রহ থেকে assignment, skip ও decision এক জায়গায়; existing history ledger ব্যবহার করা যাবে। পূর্ণ Production workspace এখনও আলাদা unreleased scope।
- Recorded request ledger থেকে employee skip-rate report: automatic/pending/approved/rejected আলাদা, denominator ও period স্পষ্ট। Historical missing timestamps দিয়ে হার বানানো যাবে না।
- প্রয়োজন হলে server-side পূর্ণ filtered export; বর্তমান CSV শুধু visible page।

## Validation ও deployment

- Frontend typecheck/build এবং targeted lint passed.
- Final scoped frontend: **281 tests passed**, including 3 safe CSV regressions.
- Backend typecheck/build and targeted lint passed.
- Complete scoped backend: **138 tests passed** (82 existing Design Pool, 40 rules, 8 skip review, 8 audit regressions). Final stable-clock audit fixtures re-ran successfully: 8/8. Disposable PostgreSQL 16; production database was not used for mutation tests.
- Deployed **414 / 352682c**, 28 September 2026, 11:21 Asia/Dhaka. API/web/PostgreSQL healthy; public HTTPS health matches the commit. Public HTML references `index-ChT0wCqd.js`; its SHA-256 matches the deployed web image. PostgreSQL retained its original container identity.
- Live Chrome verification: known job search, protected finished selection, Today (28 September), Last 7 days (22–28 September), Done today completion-date explanation/results, Reset all filters and Refresh passed. Refresh retrieved updated queue counts while staff continued normal work. [Verified UI](design-pool-release414.png).

Release files: `/opt/oxeio-releases/design-pool-audit-20260928`। Database migration বা seed এই পরিবর্তনের জন্য প্রয়োজন নেই। Release 411-এর pending-skip rollback restriction বহাল।


## Recovery ও shared record

- Verified encrypted backup: `/opt/oxeio-releases/design-pool-audit-20260928/before-pool-audit.dump.enc`; decrypted archive parsed successfully in a disposable container. Existing backup passphrase was reused without printing it.
- Previous images: `oxeio-api:before-pool-audit-20260928`, `oxeio-web:before-pool-audit-20260928` (release 412, includes skip review).
- New images: `oxeio-api:pool-audit-352682c`, `oxeio-web:pool-audit-352682c`.
- Source bundle: release directory `source.bundle`; current application marker `/opt/oxeio/.git/oxeio-deployed-commit`. Later docs-only commits may advance repository HEAD.
- [Usage guide](../design-pool-operations.md) · [Current state](../current-state.md). Shared copies are saved in the VPS repository; no GitHub push is included in this task.
