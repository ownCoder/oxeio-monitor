# Design Pool: permanent skip, instant replacement, fair distribution

**Historical plan through release 456.** The reason-based review gate changed in [release 459](audits/2026-10-07-four-reason-skip-review-release.md): Page Not Found needs no review; Event, Copyright and Others queue for review, and every reason attempts a replacement immediately. Use [current operations](skip-review-operations.md) for today's rules.

৭ অক্টোবর ২০২৬। **Implemented and deployed in releases 453–456.** [Release record](audits/2026-10-07-skip-replacement-release.md)। Owner correction: designer যে design Not Found, Events বা Copyright দিয়ে skip করবেন, accepted হলে সেটি **`skipped`-ই থাকবে এবং assignable pool-এ ফিরবে না**। আগের ৭ দিনের hold/re-entry ধারণা ভুল ছিল এবং বাতিল। Accepted skip-এর সঙ্গে সঙ্গে একই designer সমপরিমাণ নতুন design issue করার চেষ্টা হয়; pool/slot/day cap না থাকলে durable owed থাকে। Morning distribution, hourly top-up এবং owed-replacement sweep-এ eligible staff-এর processing order random হয়।

## Before release and production scope

- প্রথম ৩টি successful skip request per Dhaka day automatic; পরেরগুলো owner/manager approval-এর অপেক্ষায় `assigned` থাকে। Rejected request একই designer-এর কাছে থাকে।
- Accepted skip target `skipped` status-এ থাকে; automatic pool return নেই। Skip/approval-এর পরে `topUp()` চলে, কিন্তু এটি দৈনিক completion goal ও ৬০/day cap দেখে; প্রত্যেক skip-এ ১:১ replacement নিশ্চিত করে না।
- Pool target নির্বাচন `ORDER BY random()`; designer-দের processing order staff code অনুযায়ী স্থির। Pool shortage হলে আগের staff code আগে পায়।
- Production read-only snapshot: ৭৯৫ skipped (৯৫ reason unknown; ৪০৫ copyright; ৭৩ events; ২২২ not_found); ০ pending review। Existing `deleted` ২৪টি, সব not_found। এই counts সময়ের সঙ্গে বদলাবে। পুরোনো skipped design-ও assignable pool-এ ফিরবে না।

## Implemented behavior

1. **Accepted skip transaction:** reason, actor, timestamp ও original designer history লিখে target-কে `skipped` status-এ রাখুন। Pending request আগের মতো designer-এর slot দখল করবে; approval হলে skip কার্যকর হবে, rejection হলে assignment বহাল থাকবে। Distribution, top-up ও manual issue কেবল `pool` থেকে তুলবে—`skipped` থেকে কখনো নয়।
2. **Immediate replacement:** accepted skip-এর একই workflow-তে pool থেকে সেই designer-কে ১টি নতুন random design দিন। একই সময়ে একাধিক accepted skip হলে সমসংখ্যক replacement। DB transaction/lock দিয়ে double issue আটকাতে হবে। Pool খালি বা per-designer daily issuance safety cap পৌঁছালে replacement silently হারিয়ে না গিয়ে `owed replacement` হিসাবে record/queue করে staff ও owner-কে দেখাতে হবে; পরের pool addition বা hourly sweep-এ আগে পূরণ হবে। Daily completion target-এর সাধারণ top-up থেকে এই ১:১ replacement আলাদা।
3. **Fair random:** Pool target selection random থাকবে; assignment recipient order-ও প্রতি run-এ shuffle হবে। প্রত্যেক active designer/manager-এর current open count সর্বোচ্চ ৩০ এবং দৈনিক cap/eligibility বজায় থাকবে। Pool shortage হলে round-robin একে একে issue করে যেন fixed staff code সবসময় আগে না পায়। Historical assignments দিয়ে per-person fairness monitor রাখতে হবে।
4. **UI/operations:** Pipeline-এ Pool, In hand ও Skipped আলাদা counts; skipped row-তে reason, skipped by ও time। Designer-এর My targets-এ replacement পাওয়া বা queued থাকার clear notice। Daily skip report-এ reason, replacement delivered/owed এবং per-designer issue count দেখানো। Owner/manager-এর existing review action বজায় থাকবে; Un-skip/To pool হলো আলাদা deliberate owner action, automatic return নয়।

## Migration and verification

- Existing ৭৯৫ skipped target `skipped`-ই থাকবে; bulk pool return বা cooldown migration হবে না। New implementation replacement delivery/owed state record করবে; old skips-এর replacement অনুমান করে backfill করবে না।
- Migration/test-এ automatic ১–৩ skip, pending/approve/reject, concurrent skip and distribution, pool empty, cap reached, overnight return, old skipped history ও Deleted protection cover করতে হবে। Simulation-এ কয়েক দিনের assignment counts এবং skip-to-replacement latency দেখতে হবে।
- Daily designs & skips report-এ issued/reason/replacement issued/owed দেখা যায়; Pipeline-এ মোট owed থাকলে দেখায়। First week operational review-তে replacement latency ও কোনো eligible staff শূন্য হাতে আছে কি না দেখতে হবে। স্বয়ংক্রিয় zero-in-hand alert এখনো যোগ হয়নি।

## Settled limits and follow-up

- Daily **৬০ issue cap** বহাল; সীমায় replacement durable owed হয়, unlimited browsing হয় না। My targets ও Pipeline-এ owed visibility আছে; separate notification alert নেই।
- Owner ইচ্ছাকৃত Un-skip/To pool করলে পুরোনো skip history থাকবে, কিন্তু target আবার assignable হবে; এই action-এর আলাদা reason ও audit প্রয়োজন। Automatic flow এমন করবে না।
