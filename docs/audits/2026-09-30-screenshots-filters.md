# Screenshots gallery filters — 30 September 2026

Application **435 / d9f312e** at `https://hub.oxeio.com`.

## ব্যবহার

Screenshots page-এ আগের Staff selector-এর সঙ্গে From/To, Today, Yesterday, Last 7 days, Time (Dhaka), App contains এবং Monitor number আছে। Date range সর্বোচ্চ ৭টি পূর্ণ Dhaka work date। App name-এর একটি অংশ লিখে বা monitor number (পর্দায় ১ থেকে শুরু) দিয়ে **Apply** চাপুন। Date shortcut ও time selection তাৎক্ষণিক কাজ করে; **Clear filters** আজকের সব staff/all-day view ফেরায়। কোনো ফল না থাকলে অন্য filter নেওয়ার নির্দেশ দেখায়।

Manager/owner team দেখতে এবং Staff বেছে নিতে পারেন; employee/researcher শুধু নিজের screenshot দেখতে পারেন। Active app name search হয়, window title বা screen content নয়। Count এবং pagination filtering-এর পর হয়। Original `?date=` API এখনও চলে; নতুন `fromDate`/`toDate` জোড়া ছাড়া বা date-এর সঙ্গে একসঙ্গে দিলে 400। Gallery view audit log-এ filter context সহ লেখা হয়। Signed image URLs-এর ৫ মিনিট মেয়াদ অপরিবর্তিত।

## যাচাই

- Clean VPS-aligned six-file source: API typecheck, targeted lint, production build; isolated PostgreSQL integration suite-এ ৪টি নতুন filter case + আগের ৬টি latest-screenshot case passed। Date boundary, combined count/pagination, audit, role isolation এবং invalid query দেখা হয়েছে।
- Web targeted lint, production build/typecheck এবং ২৯৩ frontend tests passed। Chrome synthetic preview-এ range/shortcut, time/app/monitor/staff filters, clear এবং staff-only scope দেখা হয়েছে। [Synthetic sample screenshot](screenshots-filters-preview.png)। Actual employee screenshots browser-এ খোলা হয়নি।
- Production: API/web healthy, public HTTPS health, public JS `/assets/index-jm6FBPes.js` hash `8bae931aa096aa4db357782776a1864e15cb5b08847540f9e32908e958d5c92b` container-এর সঙ্গে মেলে, unauthenticated gallery 401, PostgreSQL container অপরিবর্তিত। Six deployed source hashes clean mirror-এর সঙ্গে মেলে। No migration, seed or production screenshot read।

## Source ও rollback

- Clean mirror: `.release-office/oxeio-monitor`। Dirty main checkout-এর unrelated agent/payroll/Studio কাজ release-এ যায়নি। Scoped source list: [screenshots-filter-files.txt](screenshots-filter-files.txt)। Final source hash: [screenshots-filter-local-sha256.txt](screenshots-filter-local-sha256.txt)।
- VPS source/evidence/bundle/build/test logs: `/opt/oxeio-releases/screenshots-filters-20260930`। App commit `d9f312e11d460ff12cc723227487fd86d3d44496`, deployed marker `/opt/oxeio/.git/oxeio-deployed-commit`। Shared handoff: `/opt/oxeio/docs/current-state.md`।
- API/web rollback image tags: `oxeio-api:before-screenshots-filters-20260930`, `oxeio-web:before-screenshots-filters-20260930` (application 433)। Both compose files are required to operate the deployment. No schema rollback necessary. Keep the untracked VPS `setup-telegram.sh` and unrelated local changes untouched.
- GitHub push বা অন্য PC-তে automatic sync যাচাই করা হয়নি। পরের PC থেকে শুরুতে shared VPS handoff এবং live deployed commit marker মিলিয়ে নিন।
