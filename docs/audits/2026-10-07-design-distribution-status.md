# Design Pool distribution — read-only production check

৭ অক্টোবর ২০২৬, ১১:৩৫ Asia/Dhaka। Live application release **451 / `49d899eb2ed070910ea0866ee19a03f1fc5ae35e`**। Source: production `design_target_events`, `design_targets`, `employees`; deployed `targets.job.ts`, `targets.service.ts`, `targets.rules.ts`। SQL ছিল `BEGIN READ ONLY`। কোনো distribution trigger, target edit বা deployment করা হয়নি।

## Actual state

- **আজ ০৮:০০:০০–০৮:০০:০১:** `distribution` source, actor null — **২৪৭ assignment**। সব event নির্ধারিত ৮টার window-তে।
- **আজ ০৮:৫৯–০৯:৫৭:** `top_up` source, actor null — **৮ assignment**। Top-up event-এর কিছু complete/skip action-এর পরপরই এসেছে; hourly sweep ০৯:০৫-এ একটি দিয়েছে।
- **৩০ সেপ্টেম্বর–৭ অক্টোবর:** প্রতিদিন ০৮:০০-এর `distribution` event আছে; দিনের count যথাক্রমে **২৮৯, ২৯১, ২৫৮, ২৫৮, ২৬২, ২৬৪, ২৬৮, ২৪৭**। এই period-এ manual assignment event নেই।
- **গতকাল ২৩:৫৫:** `end_of_day` source-এ **৮৮ target** পুলে ফেরত।
- Current status at ১১:৩৪: `pool` **১৪,০৬২**; `assigned` **১৯২**; `done` **৩৭,১৩১**; `skipped` **৭৯৫**; `deleted` **২৪**। API, web, PostgreSQL healthy; API `NODE_ENV=production`, scheduler code enabled।

| Staff | সকাল ৮টায় | আজ top-up | এখন হাতে |
| --- | ---: | ---: | ---: |
| OX-01 manager | 29 | 0 | 21 |
| OX-06 | 30 | 1 | 22 |
| OX-08 | 30 | 2 | 23 |
| OX-09 | 9 | 3 | 3 |
| OX-10 | 30 | 0 | 24 |
| OX-11 | 30 | 0 | 30 |
| OX-12 | 30 | 0 | 21 |
| OX-13 | 30 | 0 | 24 |
| OX-14 | 29 | 2 | 24 |

সকালে OX-09-এর ৯টি পাওয়ার অর্থ ২১টি আগের open assignment দিয়ে তাঁর ৩০টি slot-এর বাকি অংশ পূরণ হয়েছে; এটি পুলের ঘাটতি নয়। বর্তমানে তাঁর ২৪টি completion ও ৩টি open target আছে। কারও হাতে শূন্য নেই। Current open সংখ্যা সকাল/আজকের মোট issue-এর চেয়ে কম হওয়া স্বাভাবিক, কারণ completion/skip-এর পর target আর `assigned` থাকে না।

## Rules and limits

08:00 Asia/Dhaka cron active `designer` ও `manager` staff-এর open count ৩০ পর্যন্ত পূরণ করে; target নির্বাচন random এবং claim atomic। 09:05–19:05 hourly top-up, সঙ্গে complete/skip-এর পর event-driven top-up, daily completion goal reach করার প্রয়োজন থাকলে কাজ করে; issue cap ৬০/day। 23:55-এ unused/untouched target ফেরত যায়; started এবং pending skip-review target থাকে। Job failure log হতে পারে, কিন্তু cron-এর independent persistent run ledger নেই। এই check-এ actual assignment/return event দেখে execution নিশ্চিত করা হয়েছে; zero-assignment future run event দিয়ে একা প্রমাণ করা যাবে না।
