# Design Pool — ব্যবহারবিধি

২৮ সেপ্টেম্বর ২০২৬ · Live **418 / e559b45** · [Latest UI change](audits/2026-09-28-pool-no-upload-live.md) · [Audit ও verification](audits/2026-09-28-design-pool.md)

## খোঁজা ও ছাঁকা

- **Search ASIN or job number**-এ ASIN বা job number লিখুন। Amazon URL-এর বদলে ASIN দিতে হবে।
- **Target status**-এ Waiting, In hand, Done, Done today, no file trace, Skipped ও Deleted আছে। **To check** ও **To fix** বোতাম বানান যাচাই ও সংশোধনের queue দেখায়। Upload/live queues এই পাতায় নেই।
- **Filters** খুলে Designer, Added by ও date range বাছুন। **Today** ও **Last 7 days** Dhaka calendar day ধরে।
- Done-এর date হলো completion time; পরে upload/live হলেও ওই দিনের result-এ থাকে। Review/Skipped-এর date হলো skip-request time। অন্য views latest activity ধরে।
- পুরোনো skip-এর সময় জানা না থাকলে এবং Review-এ deleted target দেখতে date filter clear করুন।
- **Reset all filters** search, status, people ও date একসঙ্গে clear করে। Review page নিজের review queue-তেই থাকে।
- **Refresh** latest table ও queue counts আনে এবং selection clear করে। Queue buttons-এর counts পুরো queue-এর; table count active filters-এর matching results।

## Select ও delete

শুধু owner/manager Delete করতে পারেন। Select-all শুধু এই page-এর deletable targets নেয়। Finished, already-deleted ও pending skip-review target select করা যায় না। Backend-ও completed/pending কাজ রক্ষা করে।

Delete-এ reason লাগে। Target স্থায়ীভাবে database থেকে মুছে যায় না; Deleted হয়, নতুন assignment-এ যায় না এবং একই ASIN আবার bulk add করে নতুন target বানানো যায় না। ভুল হলে existing **Un-delete** action দিয়ে pool-এ ফেরানো যায়। Pending skip-এর ক্ষেত্রে আগে owner/manager **Approve skip** বা **Reject** দেবেন।

## কাজের ধাপ

Design Pool-এ Complete, spelling check/error ও প্রয়োজন হলে Fixed actions আছে। Uploaded ও Live buttons মূল row এবং More actions থেকে সরানো হয়েছে। আগের upload/live records ও backend rules সংরক্ষিত আছে। Ordinary designers নিজের My targets-এ কাজ করেন; Design Pool-এর management/research কাজ role অনুযায়ী সীমিত।

**More actions**-এর `⋯`-এ অতিরিক্ত actions আছে। ভুল Complete হলে eligible design-এ **Undo complete** ব্যবহার করুন; **To pool** assignment ছেড়ে দেয়। No-file-trace নিজে থেকে কাজ না হওয়ার প্রমাণ নয়—job number ছাড়া নাম বা unsaved file-ও trace না রাখতে পারে।

## CSV

**Export this page · CSV** বর্তমানে দেখা সর্বোচ্চ ৫০টি matching row export করে। পুরো pool বা অন্য pages এতে থাকে না। আরও row চাইলে next page খুলে export করুন। CSV-তে ASIN, job number, status, designer, added-by এবং relevant dates/reason আছে; timestamps ISO format-এ। Pending assignment-এর status `pending_skip_review` হয়।

UTF-8 Bengali names, quotes ও spreadsheet formula protection আছে। Saved views, per-job history drawer, skip-rate report এবং full filtered export-এর পরবর্তী scope [audit doc](audits/2026-09-28-design-pool.md)-এ আছে।
