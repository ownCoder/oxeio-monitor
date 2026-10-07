# Design Pool — ব্যবহারবিধি

৭ অক্টোবর ২০২৬ · Live **451 / 49d899e** · [Pipeline panel release](audits/2026-10-07-pipeline-panel.md) · [Daily report page](audits/2026-10-03-daily-design-page.md)

Design Pool-এর উপরে **The Pipeline** panel-এ In the pool, In hand ও Designed-এর live সংখ্যা এবং বাদ যাওয়া Skipped/Deleted সংখ্যা দেখা যায়। Panel-টি **Every Target** তালিকার আগে থাকে; Add design targets পাতায় শুধু **Add Links** থাকে। Design Pool-এর Refresh বা target action-এর পরে panel-এর সংখ্যাও আবার আনা হয়।

## প্রতিদিন কার কত Complete / Skip

Owner/manager হিসেবে **Targets → Daily designs & skips** আলাদা page খুলুন (`/targets/daily`)। Design Pool-এর তালিকায় report আর খোলে না। Default-এ শেষ ৭ Dhaka day দেখায়। From/To দিয়ে সর্বোচ্চ ৩১ দিন বাছুন; **Today** ও **Last 7 days** shortcuts আছে। **Staff** dropdown দিয়ে একজনকে বাছলে daily row ও উপরের মোট সংখ্যা সেই ব্যক্তির হবে। Refresh report দিয়ে নতুন কাজ/skip review সিদ্ধান্ত আনুন।

**Completed** হলো completion timestamp থাকা design, completion-এর Dhaka day-তে বর্তমান assigned staff-এর নামে। **Skipped** হলো ওই Dhaka day-তে করা automatic বা পরে approved হওয়া skip request; একই design-এর সফল repeated request থাকলে প্রতিটি action গণনা হয়। **Pending** আলাদা; rejected request Skipped নয়। Approved/rejected decision বদলালে অতীতের request-day সংখ্যা বদলাতে পারে। এটি skip-এর সঙ্গে completed-এর সরাসরি conversion rate নয়। ২৭ সেপ্টেম্বরের মাঝপথে skip ledger চালু হয়েছে; **২৮ সেপ্টেম্বরের আগের Skipped/Pending “—” মানে তথ্য অজানা, শূন্য নয়**।

নিচের **Skip-rate details** আগের cohort report: recorded assignments, requests ও review decisions দেখায়। Daily table-এর সংখ্যা এবং cohort rate-এর denominator আলাদা, তাই সরাসরি তুলনা করবেন না।

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

Amazon link-এ **Page Not Found / Dogs of Amazon** দেখালে ASIN দিয়ে row খুঁজে select করে **Delete selected → Not Found** দিন; পরে row-তে **Deleted · Not Found** নিশ্চিত করুন। একটি product-এর “Currently unavailable”, robot/CAPTCHA, network error বা temporary block মানেই missing নয়। ৭ অক্টোবরের সীমিত live audit-এ ১৮টি confirmed missing target চিহ্নিত হয়েছে; [audit record](audits/2026-10-07-amazon-not-found.md)-এ scope, ASIN ও বাকি কাজ আছে।

## কাজের ধাপ

Design Pool-এ Complete, spelling check/error ও প্রয়োজন হলে Fixed actions আছে। Uploaded ও Live buttons মূল row এবং More actions থেকে সরানো হয়েছে। আগের upload/live records ও backend rules সংরক্ষিত আছে। Ordinary designers নিজের My targets-এ কাজ করেন; Design Pool-এর management/research কাজ role অনুযায়ী সীমিত।

**More actions**-এর `⋯`-এ অতিরিক্ত actions আছে। ভুল Complete হলে eligible design-এ **Undo complete** ব্যবহার করুন; **To pool** assignment ছেড়ে দেয়। No-file-trace নিজে থেকে কাজ না হওয়ার প্রমাণ নয়—job number ছাড়া নাম বা unsaved file-ও trace না রাখতে পারে।

## CSV

**Export this page · CSV** বর্তমানে দেখা সর্বোচ্চ ৫০টি matching row export করে। পুরো pool বা অন্য pages এতে থাকে না। আরও row চাইলে next page খুলে export করুন। CSV-তে ASIN, job number, status, designer, added-by এবং relevant dates/reason আছে; timestamps ISO format-এ। Pending assignment-এর status `pending_skip_review` হয়।

UTF-8 Bengali names, quotes ও spreadsheet formula protection আছে। Saved views, per-job history drawer, skip-rate report এবং full filtered export-এর পরবর্তী scope [audit doc](audits/2026-09-28-design-pool.md)-এ আছে।


## Recorded insights, history and saved views — release 421

Owner/manager-এর জন্য আলাদা Daily designs & skips page-এর **Skip-rate details**-এ Dhaka date range দিয়ে requests/automatic/pending/approved/rejected, unique recorded assignments এবং cohort rate দেখা যায়। Pending/rejected numerator-এ যায় না; period-এর বাইরে assignment unknown/carry-in হিসেবে আলাদা থাকে। Assignment recording 27 September 12:33 থেকে; আগের data তৈরি করা হয়নি। একই target repeated assignment/request হলেও rate double-count করে না।

History button recorded actor/source ও status transition দেখায়; Older events দিয়ে cursor pagination। Missing old history কাজ হয়নি বা bypass হয়েছে—এমন প্রমাণ নয়।

View name দিয়ে current filters save করা যায় (প্রতি browser/account/page সর্বোচ্চ ১০টি)। Saved button filters restore করে; × removes that saved view. Shareable view link search/status/staff/adder/date filters URL-এ রাখে, অন্য PC-তে সেই link খুলুন। Saved list automatic cloud sync হয় না। Removed upload/live queues ফিরে আসে না।
