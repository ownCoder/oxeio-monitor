# Salary — ব্যবহারবিধি

**Salary** sidebar-এ শুধু owner দেখতে পাবেন। পৃষ্ঠার Month বেছে ওই মাসে কর্মরত staff-দের নাম, মাসিক salary, হিসাবকৃত **Net payable** এবং payment status দেখুন। Manager বা staff এই পাতা বা API খুলতে পারেন না। Salary দেখা ও payment status বদল—দুটিই audit log-এ লেখা হয়।

প্রতিটি মাসের salary দেওয়ার নির্ধারিত দিন **পরের মাসের ৫ তারিখ**—যেমন সেপ্টেম্বরের salary ৫ অক্টোবর, ডিসেম্বরের salary পরের বছরের ৫ জানুয়ারি। Salary page-এ এই scheduled date দেখা যায়; পেরিয়ে গেলে payment যাচাইয়ের reminder আসে। এটি প্রকৃত payment date নয় এবং কোনো status নিজে থেকে Paid/Unpaid করে না।

## Payment status

- **Not recorded**: ঐতিহাসিক payment-এর কোনো তথ্য নথিভুক্ত নেই। এটিকে Unpaid ধরে নেবেন না। Release-এর সময় আগের কোনো মাসের status নিজে থেকে বসানো হয়নি।
- **Unpaid**: owner স্পষ্টভাবে zero paid লিখেছেন।
- **Partial**: কিছু টাকা দেওয়া হয়েছে। Paid amount-এ **এখন পর্যন্ত মোট দেওয়া টাকা** লিখুন; পরের কিস্তির পর record edit করে নতুন মোট ও সর্বশেষ payment date দিন। এটি আলাদা কিস্তির ledger নয়।
- **Paid**: ওই মুহূর্তের হিসাবকৃত Net payable-এর সমান amount নথিভুক্ত করা হয়েছে। Recording কোনো bank transfer বা salary disbursement করে না।

Staff row-এর **Record / edit** চাপুন, status বাছুন, Partial হলে মোট amount দিন, payment date ও প্রয়োজন হলে note/reference লিখে **Save status** চাপুন। ভুল হলে একই row আবার edit করে ঠিক করুন; আগের ও পরের status/amount/date audit log-এ থাকে। Status filter দিয়ে Unpaid/Partial/Paid/Not recorded আলাদা দেখা যায়।

Net payable পাওয়া না গেলে (monthly rollup বা salary setting অনুপস্থিত) সেই staff-এর বেতন থাকলে তা দেখাবে, কিন্তু Paid/Partial লেখা যাবে না। Month open থাকলেও record করা যায়; সংখ্যাটি তখন বদলাতে পারে। পরবর্তীতে payable বদলালে row-তে review warning দেখাবে। চূড়ান্ত payroll/holiday/date যাচাই করে মাস বন্ধ করা উত্তম। `Settings → Staff`-এ monthly salary বদলালে historical salary period-এর নিয়ম আগের মতোই থাকে।

Payment amount একটি manual cumulative record; bank transaction বা পৃথক instalment history এই release-এ নেই। Note-এ গোপন banking credential লিখবেন না। বাস্তবে দেওয়া payment অনুযায়ী status লিখুন; system নিজে Paid/Unpaid অনুমান করে না।
