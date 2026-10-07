# Design skip — ব্যবহার ও review

৭ অক্টোবর ২০২৬ · Live release **460 / e3cb2b2** · [সাইট](https://hub.oxeio.com) · [Release record](audits/2026-10-07-four-reason-skip-review-release.md)

## Designer-এর নিয়ম

Design-এর পাশে **Skip** চাপলে চারটি বিকল্প দেখাবে: **Page Not Found, Event, Copyright, Others**। একটি কারণ বাছলেই design `skipped` হয়ে কাজের তালিকা থেকে সরে যায়; এটি নিজে থেকে Design Pool-এ ফেরে না। Page Not Found-এর জন্য review লাগে না। অন্য তিনটি manager/owner review queue-তে যায়, কিন্তু review-এর জন্য replacement আটকে থাকে না।

প্রতিটি skip-এর সঙ্গে একই transaction-এ ওই designer-কে Ready pool থেকে **ঠিক ১টি random replacement** দেওয়ার চেষ্টা হয়। একদিনের owner extra grant-এ হাতে ৩০-এর বেশি থাকলেও এটি ১:১ swap হিসেবে হয়; open সংখ্যা বাড়ে না। Pool খালি বা ওই Dhaka day-তে ৬০টি issue হয়ে থাকলে replacement হারায় না: **owed** হিসেবে থাকে এবং pool addition, সকাল ৮টার distribution বা hourly sweep-এ সাধারণ top-up-এর আগে পূরণ করার চেষ্টা হয়। পরে owed পূরণে সাধারণ ৩০-open limit প্রযোজ্য। Skip click নিজে আর অতিরিক্ত goal-based top-up চালায় না। My targets-এ owed count এবং manager-এর Design Pool Pipeline-এ team owed count দেখা যায়।

Pending-review skip ডিজাইনারের **Pending skip review** অংশে দেখা যায়; সেটি আবার complete বা skip করা যায় না। একই request retry বা অন্যের assignment skip করলে দ্বিতীয় request/replacement হয় না। পুরোনো pending request-এর অবস্থা ও সিদ্ধান্ত অপরিবর্তিত আছে।

## Manager/owner review

**Review** পাতায় pending Event, Copyright ও Others skip দেখুন। **Approve skip** দিলে design skipped-ই থাকে। **Reject · return to designer** দিলে মূল design একই designer-এর হাতে ফিরে আসে। ইতিমধ্যে দেওয়া replacement কেড়ে নেওয়া হয় না; ফলে rejection-এর পরে সাময়িকভাবে সাধারণ ৩০-open সীমার বেশি হাতে থাকতে পারে। হাতে শুরু না-করা design রাত ২৩:৫৫-এর return নিয়মে ফেরে। একই request-এ একাধিক সিদ্ধান্ত একসঙ্গে এলে প্রথম সফল সিদ্ধান্ত বহাল থাকে। সাধারণ status change, delete বা Reviewed action দিয়ে pending review পাশ কাটানো যায় না।

Page Not Found skip manager queue-তে যায় না। পুরোনো Page Not Found skipped row-ও ওই queue থেকে বাদ, তবে আগের pending review request migration-এ নিজে থেকে approve করা হয়নি। শুধু owner/manager সিদ্ধান্ত দিতে পারেন।

## রিপোর্ট ও সীমা

**Daily designs & skips**-এ request-এর Dhaka day অনুযায়ী Skipped, Pending, Page Not Found, Event, Copyright, Others, replacement issued ও owed দেখা যায়। Pending request design ইতিমধ্যে skipped বলে Skipped সংখ্যাতেও থাকে; rejected হলে ওই দিনের Skipped থেকে সরে যায়। পুরোনো **Skip-rate details** cohort rate pending request-কে approval না হওয়া পর্যন্ত numerator-এ ধরে না। ২৮ সেপ্টেম্বরের আগের skip ledger অসম্পূর্ণ; “—” শূন্য নয়।

Replacement তখনই তাৎক্ষণিক পাওয়া সম্ভব যখন pool-এ Ready design আছে এবং ৬০/day issue limit বাকি। OX-09-কে ৭ অক্টোবর দেওয়া আলাদা extra design-এর ফলে তাঁর হাতে ৩৪টি ছিল; নতুন atomic swap ওই অবস্থাতেও ৩৪টি বজায় রেখে replacement দেয়। কোনো real staff skip দিয়ে live পরীক্ষা করা হয়নি; isolated integration test ও release checks পাস করেছে।
