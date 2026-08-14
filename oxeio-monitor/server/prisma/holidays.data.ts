/**
 * বাংলাদেশের সরকারি ছুটি ২০২৬–২৭ — তালিকা ও তালিকা যাচাই।
 * খাঁটি ফাংশন, কোনো I/O নেই (`parse-staff.ts`-এর মতোই, একই কারণে:
 * `seed.ts` import হলেই নিজে চলতে শুরু করে, তাই ওর ভেতরের কিছু টেস্ট করা যায় না)।
 *
 * ⚠️⚠️ **কেন এটা দরকার ছিল:** seed-এ ছিল কেবল ৭টা নির্দিষ্ট-তারিখের ছুটি।
 *    ঈদ, আশুরা, শবে বরাত, দুর্গাপূজা — সব বাদ। ফলে ওই দিনগুলো **কর্মদিবস**
 *    ধরে গোনা হচ্ছিল, আর তাতে প্রত্যেকের টার্গেট ও pace দুটোই বেশি দেখাত
 *    (§ ২.১-খ · roadmap R7 · open question O2)। শুধু ২০২৬-এর ঈদ দুটোতেই
 *    ১১টা দিন ভুল দিকে গোনা হতো।
 *
 * ─── ⭐⭐ এই ফাইলের সবচেয়ে জরুরি সিদ্ধান্ত: `approximate` ───────────────
 *
 * চান্দ্র ছুটির তারিখ **চাঁদ দেখার উপর নির্ভর করে** — সরকার আগেভাগে একটা
 * সম্ভাব্য তারিখ ছাপে, তারপর ঘোষণা এলে প্রজ্ঞাপন সংশোধন করে। হিন্দু ও বৌদ্ধ
 * পঞ্জিকার ছুটিগুলোও তিথি-নির্ভর, একই রকম নড়ে।
 *
 * আগে অনুমান বলে **কিছুই বসানো হয়নি** — সেটা ছিল এক রকম মিথ্যা ("ছুটি নেই")।
 * কিন্তু আনুমানিক তারিখকে নিশ্চিত বলে দেখানো **আরেক রকম মিথ্যা**, আর সেটা
 * আরও খারাপ: তখন কেউ যাচাই করার কথাই ভাববে না। তাই প্রতিটা সারিতে
 * `approximate` — আর যেটা `true`, তার নামের শেষে "(সম্ভাব্য)" জুড়ে DB-তে
 * যায়, যাতে মালিক Settings → Holidays পাতায় **চোখেই দেখতে পান** কোনটা
 * এখনো পাকা নয়।
 *
 * ⚠️ চিহ্নটা `type` ঘরে বসানো হয়নি, যদিও ওটাই স্বাভাবিক জায়গা মনে হয়।
 *    কারণ পর্দার Type বাছাইয়ে মাত্র তিনটে মান আছে (public/optional/company);
 *    অচেনা একটা মান থাকলে মালিক ছুটিটা Edit করে Save চাপলেই সেটা নিঃশব্দে
 *    `public` হয়ে ফিরত — অর্থাৎ চিহ্নটা হারাত, আর কেউ টের পেত না।
 *    নাম ঘরটা মালিক নিজে পড়েন ও বদলান, তাই চিহ্ন ওখানেই টেকে।
 *
 * ─── সূত্র (২০২৬-০৮-১৪ তারিখে মিলিয়ে দেখা) ────────────────────────────
 *
 * ২০২৬: জনপ্রশাসন মন্ত্রণালয়ের প্রজ্ঞাপন (০৯-১১-২০২৫, মোট ২৮ দিন — ১৪
 *   সাধারণ + ১৪ নির্বাহী আদেশে)। ⚠️ mopa.gov.bd-র PDF-টা **স্ক্যান করা ছবি**,
 *   তাই সারিগুলো ওখান থেকে সরাসরি পড়া যায়নি; নিচের তারিখগুলো চারটে আলাদা
 *   সূত্র মিলিয়ে নেওয়া — bangladatetoday.com, officeholidays.com,
 *   calendarlabs.com, mypihr.com — এবং প্রতিটা তারিখের **বার** আলাদা করে
 *   মিলিয়ে দেখা হয়েছে (সব মিলেছে)।
 * ২০২৭: ⚠️⚠️ **প্রজ্ঞাপন এখনো বেরোয়নি** — সাধারণত নভেম্বরে বেরোয়। তাই
 *   ২০২৭-এর চান্দ্র তারিখগুলো জ্যোতির্গণনার হিসাব, সরকারি সিদ্ধান্ত নয়।
 *
 * ⚠️ **নির্দিষ্ট-তারিখের ছুটিতেও ২০২৭ নিয়ে একটা অনিশ্চয়তা আছে, কিন্তু সেটা
 *    অন্য রকম:** ২৬ মার্চ কবে সেটা নিয়ে সন্দেহ নেই — সন্দেহ হলো দিনটা তখনো
 *    সরকারি ছুটি থাকবে কি না (তালিকা বদলায়: ১৭ মার্চ ও ১৫ আগস্ট ২০২৪-এ বাদ
 *    পড়েছে, ৭ নভেম্বর ফিরে এসেছে)। `approximate` মানে **"তারিখটা নড়তে
 *    পারে"** — "ছুটিটা থাকবে কি না" নয়। দুটো এক করে ফেললে চিহ্নটার মানে
 *    ঘোলা হয়ে যেত, তাই নির্দিষ্ট-তারিখের ছুটি ২০২৭-এও `false`।
 *
 * ⚠️ **এই তালিকায় যা নেই:** এক-বারের ছুটি (শোক, দুর্যোগ, হরতাল), ঐচ্ছিক
 *    ধর্মীয় ছুটি, আর পার্বত্য চট্টগ্রামের বৈসাবি। এগুলো Settings → Holidays
 *    থেকে হাতে যোগ করতে হবে। ⚠️ ২০২৬-এর ২৮ দিনের সরকারি হিসাবের সাথে নিচের
 *    গোনা মিলবে না — কারণ ১ মে-তে দুটো ছুটি (মে দিবস ও বুদ্ধ পূর্ণিমা) একই
 *    দিনে পড়েছে, আর `holidays` টেবিলে একটা তারিখে একটাই সারি।
 */

/** তালিকার একটি সারি */
export interface HolidayEntry {
  /** `YYYY-MM-DD` — ঢাকার তারিখ (কোনো ঘড়ি নয়) */
  date: string;
  /** বাংলা নাম — এটাই DB-তে ও পর্দায় যায় */
  name: string;
  /** ইংরেজি নাম — পর্দা ইংরেজি, তাই খোঁজা ও ভবিষ্যতের অনুবাদের জন্য রাখা */
  nameEn: string;
  /**
   * ⭐⭐ `true` = তারিখটা চাঁদ দেখা বা পঞ্জিকার তিথির উপর নির্ভর, সরকার পরে
   * বদলাতে পারে। উপরের লম্বা নোটটা পড়ুন — এই ঘরটাই এই ফাইলের মূল কথা।
   */
  approximate: boolean;
  /**
   * একই উৎসবের টানা দিনগুলো এক গুচ্ছে। ⚠️ কাজে লাগে seed-এ: ঈদ একদিন
   * এগোলে/পিছোলে মালিক **পুরো গুচ্ছটাই** সরান, তাই গুচ্ছের একটা দিনও হাতে
   * সরানো দেখলে seed গোটা গুচ্ছে আর হাত দেয় না (`planHolidaySeed`)।
   */
  cluster?: string;
}

/**
 * ⚠️ আনুমানিক ছুটির নামের শেষে এটা জোড়ে — পর্দায় চোখে পড়ার জন্য।
 *
 * ⚠️⚠️ **হুবহু একই স্ট্রিং `src/reports/reports.range.ts`-এও আছে**
 *    (`APPROX_HOLIDAY_SUFFIX`) — seed এটা **লেখে**, রিপোর্ট ওটা **পড়ে**।
 *    দুটোর একটাকে আরেকটা import করানো যায়নি, দুই দিকেই ভাঙে বলে:
 *    · `src/` → `prisma/` করলে `nest build`-এর rootDir সরে গিয়ে আউটপুট
 *      `dist/src/main.js`-এ পড়ে, অথচ `start:prod` চালায় `dist/main.js`।
 *    · `prisma/` → `src/` করলে seed **runtime ইমেজে** ভাঙত — সেখানে
 *      `prisma/` ও `dist/` আছে, `src/` নেই (`server/Dockerfile`)।
 *    তাই দুটো কপি, আর দুটো এক আছে কি না তা `test/holidays.spec.ts` পাহারা
 *    দেয়। কপিটা সরে গেলে seed চিহ্ন বসাত ঠিকই, কিন্তু রিপোর্ট সেটা চিনত না
 *    আর চিরকাল "কোনো সম্ভাব্য তারিখ নেই" বলত — অনিশ্চয়তাটা নিঃশব্দে উবে যেত।
 */
export const APPROX_SUFFIX = ' (সম্ভাব্য)';

// ── ২০২৬ ────────────────────────────────────────────────────────────────────

const HOLIDAYS_2026: HolidayEntry[] = [
  {
    date: '2026-02-04',
    name: 'শবে বরাত',
    nameEn: 'Shab-e-Barat',
    approximate: true,
  },
  /**
   * ⚠️ এক-বারের ছুটি, বছরের নিয়মিত তালিকার অংশ নয় — ত্রয়োদশ জাতীয় সংসদ
   *    নির্বাচন ও গণভোট উপলক্ষে নির্বাহী আদেশে সারা দেশে ছুটি ছিল
   *    (জনপ্রশাসন মন্ত্রণালয়ের আদেশ, একাধিক দপ্তরের বিজ্ঞপ্তিতেও আছে)।
   *    ⭐ তবু রাখা হলো, কারণ দিন দুটো সত্যিই কর্মদিবস ছিল না — বাদ দিলে
   *    ফেব্রুয়ারি ২০২৬-এর টার্গেট আজও দুই দিন বেশি দেখাত।
   *    ⚠️ পরের বছরের তালিকা বানানোর সময় এই দুটো **কপি করবেন না**।
   */
  {
    date: '2026-02-11',
    name: 'ত্রয়োদশ জাতীয় সংসদ নির্বাচন (ভোটের আগের দিন)',
    nameEn: '13th Parliamentary Election (day before poll)',
    approximate: false,
    cluster: 'election-2026',
  },
  {
    date: '2026-02-12',
    name: 'ত্রয়োদশ জাতীয় সংসদ নির্বাচন ও গণভোট',
    nameEn: '13th Parliamentary Election & Referendum',
    approximate: false,
    cluster: 'election-2026',
  },
  {
    date: '2026-02-21',
    name: 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস',
    nameEn: 'Language Martyrs’ Day',
    approximate: false,
  },
  {
    date: '2026-03-17',
    name: 'শবে কদর',
    nameEn: 'Laylat al-Qadr',
    approximate: true,
  },
  // ⚠️ ঈদুল ফিতর ১৯–২৩ মার্চ (৫ দিন), ঈদ ২১ মার্চ — চারটে সূত্রেই এক।
  {
    date: '2026-03-19',
    name: 'ঈদুল ফিতরের ছুটি (ঈদের আগের দিন)',
    nameEn: 'Eid-ul-Fitr holiday (eve)',
    approximate: true,
    cluster: 'eid-ul-fitr-2026',
  },
  {
    date: '2026-03-20',
    name: 'জুমাতুল বিদা ও ঈদুল ফিতরের ছুটি',
    nameEn: 'Jumatul Bida & Eid-ul-Fitr holiday',
    approximate: true,
    cluster: 'eid-ul-fitr-2026',
  },
  {
    date: '2026-03-21',
    name: 'ঈদুল ফিতর',
    nameEn: 'Eid-ul-Fitr',
    approximate: true,
    cluster: 'eid-ul-fitr-2026',
  },
  {
    date: '2026-03-22',
    name: 'ঈদুল ফিতরের ছুটি (২য় দিন)',
    nameEn: 'Eid-ul-Fitr holiday (2nd day)',
    approximate: true,
    cluster: 'eid-ul-fitr-2026',
  },
  {
    date: '2026-03-23',
    name: 'ঈদুল ফিতরের ছুটি (৩য় দিন)',
    nameEn: 'Eid-ul-Fitr holiday (3rd day)',
    approximate: true,
    cluster: 'eid-ul-fitr-2026',
  },
  {
    date: '2026-03-26',
    name: 'স্বাধীনতা ও জাতীয় দিবস',
    nameEn: 'Independence Day',
    approximate: false,
  },
  {
    date: '2026-04-14',
    name: 'পহেলা বৈশাখ (বাংলা নববর্ষ)',
    nameEn: 'Pahela Baishakh (Bengali New Year)',
    approximate: false,
  },
  /**
   * ⚠️ এই দিনে দুটো ছুটি একসাথে, কিন্তু `holiday_date` unique — একটাই সারি।
   *    বুদ্ধ পূর্ণিমা তিথি-নির্ভর (নড়ে), মে দিবস নড়ে না। দিনটা যেহেতু মে
   *    দিবসের কারণেই নিশ্চিত ছুটি, তাই সারিটা `approximate: false` — নইলে
   *    একটা পাকা ছুটিকে "সম্ভাব্য" বলা হতো।
   */
  {
    date: '2026-05-01',
    name: 'মে দিবস ও বুদ্ধ পূর্ণিমা',
    nameEn: 'May Day & Buddha Purnima',
    approximate: false,
  },
  // ⚠️ ঈদুল আজহা ২৬–৩১ মে (৬ দিন), ঈদ ২৮ মে — চারটে সূত্রেই এক।
  {
    date: '2026-05-26',
    name: 'ঈদুল আজহার ছুটি (১ম দিন)',
    nameEn: 'Eid-ul-Azha holiday (1st day)',
    approximate: true,
    cluster: 'eid-ul-azha-2026',
  },
  {
    date: '2026-05-27',
    name: 'ঈদুল আজহার ছুটি (ঈদের আগের দিন)',
    nameEn: 'Eid-ul-Azha holiday (eve)',
    approximate: true,
    cluster: 'eid-ul-azha-2026',
  },
  {
    date: '2026-05-28',
    name: 'ঈদুল আজহা',
    nameEn: 'Eid-ul-Azha',
    approximate: true,
    cluster: 'eid-ul-azha-2026',
  },
  {
    date: '2026-05-29',
    name: 'ঈদুল আজহার ছুটি (২য় দিন)',
    nameEn: 'Eid-ul-Azha holiday (2nd day)',
    approximate: true,
    cluster: 'eid-ul-azha-2026',
  },
  {
    date: '2026-05-30',
    name: 'ঈদুল আজহার ছুটি (৩য় দিন)',
    nameEn: 'Eid-ul-Azha holiday (3rd day)',
    approximate: true,
    cluster: 'eid-ul-azha-2026',
  },
  {
    date: '2026-05-31',
    name: 'ঈদুল আজহার ছুটি (৪র্থ দিন)',
    nameEn: 'Eid-ul-Azha holiday (4th day)',
    approximate: true,
    cluster: 'eid-ul-azha-2026',
  },
  {
    date: '2026-06-26',
    name: 'পবিত্র আশুরা',
    nameEn: 'Ashura',
    approximate: true,
  },
  {
    date: '2026-08-05',
    name: 'জুলাই গণঅভ্যুত্থান দিবস',
    nameEn: 'July Mass Uprising Day',
    approximate: false,
  },
  {
    date: '2026-08-26',
    name: 'ঈদে মিলাদুন্নবী (সা.)',
    nameEn: 'Eid-e-Miladunnabi',
    approximate: true,
  },
  {
    date: '2026-09-04',
    name: 'শুভ জন্মাষ্টমী',
    nameEn: 'Janmashtami',
    approximate: true,
  },
  {
    date: '2026-10-20',
    name: 'দুর্গাপূজা (মহানবমী)',
    nameEn: 'Durga Puja (Maha Navami)',
    approximate: true,
    cluster: 'durga-puja-2026',
  },
  {
    date: '2026-10-21',
    name: 'বিজয়া দশমী (দুর্গাপূজা)',
    nameEn: 'Vijaya Dashami (Durga Puja)',
    approximate: true,
    cluster: 'durga-puja-2026',
  },
  /**
   * ⚠️ প্রজ্ঞাপনটা নভেম্বর ২০২৫-এর, আর এই ছুটিটা মন্ত্রিসভা ফিরিয়েছে
   *    ১৬ এপ্রিল ২০২৬-এ ("ক-শ্রেণির দিবস")। অর্থাৎ মূল তালিকার বাইরে —
   *    ওই এক তালিকা দেখে বসালে এটা বাদ পড়ত।
   */
  {
    date: '2026-11-07',
    name: 'জাতীয় বিপ্লব ও সংহতি দিবস',
    nameEn: 'National Revolution and Solidarity Day',
    approximate: false,
  },
  {
    date: '2026-12-16',
    name: 'বিজয় দিবস',
    nameEn: 'Victory Day',
    approximate: false,
  },
  {
    date: '2026-12-25',
    name: 'বড়দিন',
    nameEn: 'Christmas Day',
    approximate: false,
  },
];

// ── ২০২৭ ────────────────────────────────────────────────────────────────────
//
// ⚠️⚠️ প্রজ্ঞাপন **এখনো বেরোয়নি**। চান্দ্র/তিথির তারিখগুলো গণনার হিসাব,
//    সরকারি সিদ্ধান্ত নয় — তাই সবগুলো `approximate: true`।
// ⚠️ ঈদের ছুটি এখানে ছোট (৩ দিন) দেখাচ্ছে, কারণ সূত্রগুলো শুধু ওই ক'দিনেই
//    একমত। প্রজ্ঞাপন এলে বাংলাদেশে সচরাচর এর চেয়ে বেশি দিন থাকে — বাকি
//    দিনগুলো অনুমান করে বসানো হয়নি, কারণ "ছুটি নেই" বলার চেয়ে "ছুটি আছে"
//    বলে ভুল করাটা কর্মদিবসের হিসাবে উল্টো দিকে নিয়ে যেত।

const HOLIDAYS_2027: HolidayEntry[] = [
  {
    date: '2027-01-24',
    name: 'শবে বরাত',
    nameEn: 'Shab-e-Barat',
    approximate: true,
  },
  {
    date: '2027-02-21',
    name: 'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস',
    nameEn: 'Language Martyrs’ Day',
    approximate: false,
  },
  {
    date: '2027-03-05',
    name: 'জুমাতুল বিদা',
    nameEn: 'Jumatul Bida',
    approximate: true,
  },
  {
    date: '2027-03-06',
    name: 'শবে কদর',
    nameEn: 'Laylat al-Qadr',
    approximate: true,
  },
  {
    date: '2027-03-09',
    name: 'ঈদুল ফিতর',
    nameEn: 'Eid-ul-Fitr',
    approximate: true,
    cluster: 'eid-ul-fitr-2027',
  },
  {
    date: '2027-03-10',
    name: 'ঈদুল ফিতরের ছুটি (২য় দিন)',
    nameEn: 'Eid-ul-Fitr holiday (2nd day)',
    approximate: true,
    cluster: 'eid-ul-fitr-2027',
  },
  {
    date: '2027-03-11',
    name: 'ঈদুল ফিতরের ছুটি (৩য় দিন)',
    nameEn: 'Eid-ul-Fitr holiday (3rd day)',
    approximate: true,
    cluster: 'eid-ul-fitr-2027',
  },
  {
    date: '2027-03-26',
    name: 'স্বাধীনতা ও জাতীয় দিবস',
    nameEn: 'Independence Day',
    approximate: false,
  },
  {
    date: '2027-04-14',
    name: 'পহেলা বৈশাখ (বাংলা নববর্ষ)',
    nameEn: 'Pahela Baishakh (Bengali New Year)',
    approximate: false,
  },
  {
    date: '2027-05-01',
    name: 'মে দিবস',
    nameEn: 'May Day',
    approximate: false,
  },
  {
    date: '2027-05-16',
    name: 'ঈদুল আজহার ছুটি (ঈদের আগের দিন)',
    nameEn: 'Eid-ul-Azha holiday (eve)',
    approximate: true,
    cluster: 'eid-ul-azha-2027',
  },
  {
    date: '2027-05-17',
    name: 'ঈদুল আজহা',
    nameEn: 'Eid-ul-Azha',
    approximate: true,
    cluster: 'eid-ul-azha-2027',
  },
  {
    date: '2027-05-18',
    name: 'ঈদুল আজহার ছুটি (২য় দিন)',
    nameEn: 'Eid-ul-Azha holiday (2nd day)',
    approximate: true,
    cluster: 'eid-ul-azha-2027',
  },
  {
    date: '2027-05-20',
    name: 'বুদ্ধ পূর্ণিমা',
    nameEn: 'Buddha Purnima',
    approximate: true,
  },
  {
    date: '2027-06-15',
    name: 'পবিত্র আশুরা',
    nameEn: 'Ashura',
    approximate: true,
  },
  {
    date: '2027-08-05',
    name: 'জুলাই গণঅভ্যুত্থান দিবস',
    nameEn: 'July Mass Uprising Day',
    approximate: false,
  },
  {
    date: '2027-08-15',
    name: 'ঈদে মিলাদুন্নবী (সা.)',
    nameEn: 'Eid-e-Miladunnabi',
    approximate: true,
  },
  // ⚠️ দুই সূত্রে এক দিনের ফারাক (২৪ বনাম ২৫ আগস্ট) — তিথি-নির্ভর বলে
  //    এমনিতেই `approximate`, তাই একটা বেছে নেওয়া হয়েছে, দুটো বসানো হয়নি।
  {
    date: '2027-08-25',
    name: 'শুভ জন্মাষ্টমী',
    nameEn: 'Janmashtami',
    approximate: true,
  },
  {
    date: '2027-10-09',
    name: 'দুর্গাপূজা (মহানবমী)',
    nameEn: 'Durga Puja (Maha Navami)',
    approximate: true,
    cluster: 'durga-puja-2027',
  },
  {
    date: '2027-10-10',
    name: 'বিজয়া দশমী (দুর্গাপূজা)',
    nameEn: 'Vijaya Dashami (Durga Puja)',
    approximate: true,
    cluster: 'durga-puja-2027',
  },
  {
    date: '2027-11-07',
    name: 'জাতীয় বিপ্লব ও সংহতি দিবস',
    nameEn: 'National Revolution and Solidarity Day',
    approximate: false,
  },
  {
    date: '2027-12-16',
    name: 'বিজয় দিবস',
    nameEn: 'Victory Day',
    approximate: false,
  },
  {
    date: '2027-12-25',
    name: 'বড়দিন',
    nameEn: 'Christmas Day',
    approximate: false,
  },
];

/** পুরো তালিকা — তারিখ অনুসারে সাজানো */
export const BD_HOLIDAYS: readonly HolidayEntry[] = [
  ...HOLIDAYS_2026,
  ...HOLIDAYS_2027,
];

/** তালিকাটা যে বছরগুলো ঢাকে — seed শুধু এই বছরগুলোর সারি দেখে */
export const HOLIDAY_YEARS: readonly number[] = [
  ...new Set(BD_HOLIDAYS.map((h) => yearOf(h.date))),
];

// ── ⚠️⚠️ যে বছরের প্রজ্ঞাপন এখনো বেরোয়নি ────────────────────────────────────

/** প্রজ্ঞাপনের অপেক্ষায় থাকা একটা বছর */
export interface PendingGazette {
  year: number;
  /** প্রজ্ঞাপন কবে বেরোনোর কথা — মিলিয়ে দেখার সময়টা মালিককে বলার জন্য */
  dueBy: string;
}

/**
 * ⚠️⚠️ **যে বছরগুলোর সরকারি প্রজ্ঞাপন এখনো বেরোয়নি।**
 *
 * ওই বছরের চান্দ্র/তিথির তারিখগুলো জ্যোতির্গণনার হিসাব, সরকারি সিদ্ধান্ত নয়
 * (ফাইলের মাথার সূত্র-নোট দেখুন)। ⭐ তবু ওগুলো তালিকায় আছে — কারণ "ছুটি
 * নেই" বলাটা "ছুটি সম্ভবত আছে" বলার চেয়ে বেশি ভুল।
 *
 * ⚠️ কিন্তু চুপ করে থাকা যাবে না: সারিগুলো বসামাত্রই **ভবিষ্যতের মাসগুলোর
 *    `monthWorkdays` বদলে দেয়**, তাই ওই মাসগুলোর টার্গেট আজ থেকেই একটা
 *    অনুমানের উপর দাঁড়ানো। seed প্রতিবার সেটা গুনে বলে (`gazetteNotes`)।
 *
 * ⭐ **প্রজ্ঞাপন বেরোলে করণীয়:** তারিখগুলো মিলিয়ে এই ফাইলের তালিকা ঠিক
 *    করুন, তারপর বছরটা এখান থেকে **সরিয়ে দিন** — নইলে সতর্কবার্তাটা মিথ্যে
 *    হয়ে বাজতেই থাকত, আর কিছুদিন পর কেউ আর ওটা পড়ত না।
 */
export const PENDING_GAZETTES: readonly PendingGazette[] = [
  { year: 2027, dueBy: 'নভেম্বর ২০২৬' },
];

/**
 * প্রজ্ঞাপনহীন বছরগুলো নিয়ে seed-এর সতর্কবার্তা — **কয়টা তারিখ, কবে
 * মেলাতে হবে**।
 *
 * ⭐⭐ শুধু `approximate` সারিগুলো গোনা হয়, বছরের সবগুলো নয়। কারণ ২৬ মার্চ
 *    কবে সেটা প্রজ্ঞাপনের উপর নির্ভর করে না — নির্দিষ্ট-তারিখের দিবস নিয়ে
 *    সন্দেহটা অন্য রকম ("দিনটা তখনো ছুটি থাকবে কি"), আর সেটা এই সংখ্যায়
 *    মিশিয়ে দিলে **এক সংখ্যা, দুই সংজ্ঞা** হয়ে যেত।
 *
 * ⚠️ গোনা শূন্য হলে কোনো বার্তা নয় — না-থাকা অনিশ্চয়তা নিয়ে কথা বলার মানে
 *    হয় না।
 */
export function gazetteNotes(
  entries: readonly HolidayEntry[],
  pending: readonly PendingGazette[] = PENDING_GAZETTES,
): string[] {
  return pending.flatMap(({ year, dueBy }) => {
    const unsure = entries.filter(
      (e) => yearOf(e.date) === year && e.approximate,
    );
    if (unsure.length === 0) return [];

    return [
      `⚠️ ${year}-এর ${unsure.length}টি তারিখ জ্যোতির্গণনার হিসাব — প্রজ্ঞাপন এখনো বেরোয়নি ` +
        `(${unsure[0].date} … ${unsure[unsure.length - 1].date})। ` +
        `ওগুলো এখনই ${year}-এর ওই মাসগুলোর কর্মদিবস ও টার্গেট ঠিক করছে। ` +
        `${dueBy}-এ প্রজ্ঞাপনের সাথে মিলিয়ে prisma/holidays.data.ts হালনাগাদ করুন।`,
    ];
  });
}

// ── যাচাই ───────────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `YYYY-MM-DD` সত্যিই একটা তারিখ কি না।
 *
 * ⚠️ `new Date('2026-02-30')` **থামে না** — JS চুপচাপ ২ মার্চ বানিয়ে দেয়।
 *    ফিরিয়ে মিলিয়ে না দেখলে তালিকার একটা টাইপো সরাসরি কর্মদিবসের হিসাবে
 *    ঢুকে যেত, অন্য একটা দিনকে ছুটি বানিয়ে।
 */
export function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

/** ⚠️ শুধু বৈধ তারিখেই ডাকুন — `isRealDate()` আগে চালানো ধরে নেওয়া হয়েছে */
export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * তালিকার ভুল খুঁজে বার্তার তালিকা ফেরত দেয় (খালি মানে সব ঠিক)।
 *
 * ⚠️ **থামানো হয় না, সব ভুল একসাথে ফেরত দেওয়া হয়** — নইলে ৫০ সারির তালিকা
 *    ঠিক করতে গিয়ে একবারে একটা করে ভুল ধরতে হতো।
 */
export function validateHolidays(entries: readonly HolidayEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();

  entries.forEach((entry, i) => {
    const at = `সারি ${i + 1}`;

    if (!isRealDate(entry.date)) {
      problems.push(`${at}: "${entry.date}" — এমন কোনো তারিখ নেই`);
      return; // ⚠️ তারিখই ভুল হলে বাকি পরীক্ষাগুলোর মানে নেই
    }

    /**
     * ⚠️⚠️ একই তারিখ দুবার থাকলে seed-এর upsert **দ্বিতীয়টা দিয়ে প্রথমটা
     *    চাপা দিত**, কোনো এরর ছাড়াই — কারণ `holiday_date` unique। গুচ্ছ
     *    (ঈদ) হাতে লিখতে গিয়ে এটা খুব সহজেই ঘটে।
     */
    const before = seen.get(entry.date);
    if (before !== undefined) {
      problems.push(
        `${at}: ${entry.date} তারিখটা আগেও আছে ("${before}") — একটা তারিখে একটাই সারি`,
      );
    }
    seen.set(entry.date, entry.name);

    if (entry.name.trim() === '') {
      problems.push(`${at} (${entry.date}): নাম খালি`);
    }
    if (entry.nameEn.trim() === '') {
      problems.push(`${at} (${entry.date}): ইংরেজি নাম খালি`);
    }
    /** ⚠️ `name` কলামে API-র সীমা ১২০ অক্ষর (`CreateHolidayDto`) */
    if (holidayRowName(entry).length > 120) {
      problems.push(`${at} (${entry.date}): নাম ১২০ অক্ষরের বেশি`);
    }
    /**
     * ⚠️ "(সম্ভাব্য)" নিজে হাতে নামে লিখে রাখলে `approximate: false`-এর
     *    সাথে দ্বিমত তৈরি হতো, আর দুবার জোড়া লাগত।
     */
    if (entry.name.includes(APPROX_SUFFIX.trim())) {
      problems.push(
        `${at} (${entry.date}): নামে "${APPROX_SUFFIX.trim()}" লিখবেন না — approximate ঘরটাই যথেষ্ট`,
      );
    }
  });

  return problems;
}

// ── DB-তে যা যায় ────────────────────────────────────────────────────────────

/**
 * DB-র `name` ঘরে যা বসবে।
 *
 * ⭐ আনুমানিক হলে "(সম্ভাব্য)" জোড়া হয় — মালিক পর্দায় এটা দেখেই বুঝবেন
 *   তারিখটা এখনো পাকা নয়, আর ঘোষণা এলে ঠিক করে নেবেন।
 */
export function holidayRowName(entry: HolidayEntry): string {
  return entry.approximate ? `${entry.name}${APPROX_SUFFIX}` : entry.name;
}

/**
 * নামের **শেষে** "(সম্ভাব্য)" চিহ্নটা আছে কি না।
 *
 * ⚠️ শুধু লেজ দেখা হয়, `includes` নয় — নামের মাঝে বন্ধনীটা থাকা মানে
 *    চিহ্ন নয় (`src/reports/reports.range.ts`-এর `isApproximateHoliday`
 *    ঠিক একই নিয়ম মানে; দুটো এক থাকা `test/holidays.spec.ts` পাহারা দেয়)।
 */
export function hasApproxSuffix(name: string): boolean {
  return name.trim().endsWith(APPROX_SUFFIX.trim());
}

/** ⚠️ মালিক "(সম্ভাব্য)" মুছে দিলেও সারিটা যেন চেনা যায় — তাই তুলনার আগে ছাঁটা */
export function baseName(name: string): string {
  const trimmed = name.trim();
  return hasApproxSuffix(trimmed)
    ? trimmed.slice(0, -APPROX_SUFFIX.trim().length).trim()
    : trimmed;
}

// ── ⭐⭐ কোন মাসের হিসাব ইতিমধ্যে বেরিয়ে গেছে ────────────────────────────────

/** `YYYY-MM-DD` → `YYYY-MM`। ⚠️ শুধু বৈধ তারিখেই ডাকুন */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * ঢাকার **আজকের** তারিখ (`YYYY-MM-DD`)।
 *
 * ⚠️⚠️ `toISOString()` **সবসময় UTC-র তারিখ** দেয়, মেশিনের TZ যাই থাক।
 *    ঢাকার রাত ১২টা থেকে ভোর ৬টার মধ্যে UTC তারিখ এখনো আগের দিনে —
 *    তাই ৬ ঘণ্টা যোগ **আগে**, `toISOString()` পরে। নইলে ১ তারিখ ভোররাতে
 *    seed চালালে "আজ" গত মাসে পড়ত, seed **গত মাসটাকেই "চলতি মাস"** ধরত,
 *    আর সদ্য শেষ হওয়া মাসের ছুটি নিঃশব্দে বসে গিয়ে ওই মাসের পে-রোল
 *    নাড়িয়ে দিত।
 *
 * ⚠️ মেশিনের স্থানীয় সময় ব্যবহার করা হয়নি ইচ্ছাকৃতভাবে: compose-এর
 *    `migrate` সার্ভিসে `TZ=Asia/Dhaka` বসানো আছে ঠিকই, কিন্তু `npm run
 *    seed` মালিকের ল্যাপটপে যেকোনো টাইমজোনে চলতে পারে — আর তখন "আজ"
 *    মেশিনভেদে আলাদা হতো।
 *
 * ⚠️ বাংলাদেশ UTC+৬, আর DST চালু হয়েছিল একবারই — ২০০৯ সালে, ওই বছরেই
 *    বাতিল। তাই ৬ ঘণ্টা যোগ করাই যথেষ্ট, `Intl` লাগে না (`prisma/` থেকে
 *    `src/`-এর dhaka-time helper import করা যায় না — ফাইলের মাথার নোট)।
 */
export function dhakaToday(now: Date): string {
  const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
  return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * ⭐⭐ তারিখটা এমন মাসে পড়ে কি না যার হিসাব **ইতিমধ্যে চলে গেছে**।
 *
 * ⭐ **চলতি মাসও গোনা হয়** — এটাই এই ফাংশনের মূল সিদ্ধান্ত। চলতি মাসের
 *    `monthly_summary` সারিগুলো রোজ লেখা হচ্ছে, আর মাসের মাঝপথে একটা ছুটি
 *    বসলে ওই মাসের কর্মদিবস D কমে যায় → `dailyTargetSec = মাসিক ÷ D` বাড়ে
 *    → `target_sec`·`expected_sec`·`pace_sec` তিনটেই নড়ে, আর G37-এর
 *    `d ÷ D` ভগ্নাংশ (`src/payroll/payroll.service.ts`) সরাসরি টাকায় গিয়ে
 *    পড়ে। অর্থাৎ **গত দিনগুলোর হিসাবও পিছন ফিরে বদলায়**।
 *
 * ⚠️ ভবিষ্যতের মাস নিরাপদ — ওই মাসের কোনো `monthly_summary` সারিই এখনো
 *    নেই, তাই বসানোর সময় কারো কোনো সংখ্যা নড়ে না।
 *
 * ⚠️ মাসের **শুরু বন্ধ করা (payroll lock, roadmap R1) এখনো নেই** — থাকলে
 *    এই ফাংশনটা "মাসটা লক কি না" জিজ্ঞেস করত। R1 না আসা পর্যন্ত ক্যালেন্ডারই
 *    একমাত্র ভরসা, আর সেটা ইচ্ছাকৃতভাবে **বেশি সাবধানী**: একটা ভবিষ্যৎ মাসকে
 *    ভুল করে "বন্ধ" বললে বড়জোর একটা তারিখ হাতে বসাতে হয়, উল্টোটা করলে টাকা
 *    নড়ে যায়।
 */
export function isSettledMonth(date: string, today: string): boolean {
  return monthKey(date) <= monthKey(today);
}

// ── seed-এর পরিকল্পনা ───────────────────────────────────────────────────────

/** DB-তে ইতিমধ্যে থাকা একটা সারি */
export interface ExistingHoliday {
  /** `YYYY-MM-DD` */
  date: string;
  name: string;
}

export interface SeedPlan {
  /** নতুন বসাতে হবে */
  create: HolidayEntry[];
  /** ⚠️ ঐ তারিখে সারি আছে — ছোঁয়া হয়নি */
  keptByDate: HolidayEntry[];
  /** ⚠️ ঐ নামের সারি অন্য তারিখে আছে — মালিক সরিয়েছেন, তাই ছোঁয়া হয়নি */
  keptByName: { entry: HolidayEntry; foundAt: string }[];
  /** ⚠️ গুচ্ছের একটা দিন সরানো দেখে **গোটা গুচ্ছ** ছেড়ে দেওয়া হয়েছে */
  keptByCluster: HolidayEntry[];
  /** একই তারিখ, কিন্তু DB-র নাম আলাদা — মালিককে দেখানোর জন্য */
  renamed: { date: string; inDb: string; inList: string }[];
  /**
   * ⚠️ তালিকার **কোনো সারিই যেটাকে চিনতে পারেনি** এমন DB-সারি (ঢাকা
   * বছরগুলোতে) — **মোছা হয় না**, শুধু দেখানো হয়।
   *
   * ⚠️⚠️ "চিনতে পারা" মানে তারিখে **বা নামে** মেলা। আগে কেবল তারিখ দেখা
   *    হতো, আর তাতে seed একই সারি নিয়ে **দুটো পরস্পরবিরোধী কথা** বলত:
   *    মালিক বিজয় দিবস ১৬ → ১৫ ডিসেম্বরে সরালে সারিটা একসাথে
   *    `keptByName`-এ উঠত ("মালিক সরিয়েছেন, ছোঁয়া হয়নি") **আর**
   *    `unlisted`-এ উঠত ("তালিকায় নেই — এখনো ছুটি কি?")। এক জিনিস নিয়ে
   *    দুই সত্য ছাপা হলে পাঠক আর কোনোটাই বিশ্বাস করেন না, আর ঠিক ওই
   *    আস্থাটুকুর উপরেই বাকি নোটগুলো দাঁড়ানো।
   */
  unlisted: ExistingHoliday[];
}

/**
 * কোন সারিগুলো বসবে, কোনগুলো বসবে না — খাঁটি হিসাব, DB ছাড়াই টেস্টযোগ্য।
 *
 * ⭐⭐ **মূল নিয়ম: seed কখনো কিছু বদলায় না বা মোছে না, শুধু অনুপস্থিত সারি
 *    বসায়।** আগের কোড `update: { name }` করত; সেটা রাখলে মালিক ঘোষণা দেখে
 *    হাতে ঠিক করা নামটা পরের `db seed`-এ আবার "(সম্ভাব্য)" হয়ে ফিরত।
 *
 * ⚠️ **তারিখ চাবি, তাই যেটা ধরা পড়ে না:** মালিক যদি ঈদের সারিটা ২১ → ২০
 *    মার্চে সরান, ২১ তারিখটা তখন খালি — শুধু তারিখ দেখলে seed ওখানে আবার
 *    একটা ঈদ বানিয়ে ফেলত, অর্থাৎ **একটা বাড়তি ছুটি**। তাই নাম আর গুচ্ছ
 *    দিয়েও মেলানো হয়।
 *
 * ⚠️ তবু একটা ফাঁক থাকে: মালিক গুচ্ছের একটা দিন **মুছে** দিলে (ঈদ ৬ দিনের
 *    বদলে ৫ দিন হলে) এখান থেকে সেটা চেনা যায় না — মোছা সারি আর কখনো-না-বসা
 *    সারি দেখতে এক। ওটা `seed.ts` আলাদাভাবে সামলায়: যে বছর একবার বসানো
 *    হয়েছে, সেই বছরে seed আর ফিরে তাকায় না।
 */
/**
 * নাম ধরে মেলানোর চাবি: **বছর + ছাঁটা নাম**।
 *
 * ⚠️ বছরটা চাবির অংশ, নইলে ২০২৬-এর "ঈদুল ফিতর" ২০২৭-এরটাকে আটকে দিত —
 *    ওরা আলাদা ছুটি।
 *
 * ⚠️⚠️ চাবিটা এখন **এক জায়গায়** বানানো হয়; আগে একই টেমপ্লেট তিন জায়গায়
 *    হাতে লেখা ছিল আর বিভাজক হিসেবে সোর্সে একটা **অদৃশ্য NUL বাইট** বসে
 *    ছিল। কোনো এডিটর বা ফরম্যাটার সেটা এক জায়গায় ফেলে দিলে চাবিগুলো আর
 *    মিলত না — seed তখন মালিকের সরানো ছুটি চিনতে না পেরে পুরোনো তারিখে
 *    আবার বসিয়ে দিত (একটা বাড়তি ছুটি, নীরবে কর্মদিবস কমিয়ে), অথচ diff-এ
 *    চোখে পড়ার মতো কিছুই থাকত না।
 */
function nameKey(date: string, name: string): string {
  return `${yearOf(date)} ${baseName(name)}`;
}

export function planHolidaySeed(
  entries: readonly HolidayEntry[],
  existing: readonly ExistingHoliday[],
): SeedPlan {
  const years = new Set(entries.map((e) => yearOf(e.date)));
  const inScope = existing.filter((row) => years.has(yearOf(row.date)));

  const byDate = new Map(inScope.map((row) => [row.date, row]));
  const byName = new Map(
    inScope.map((row) => [nameKey(row.date, row.name), row]),
  );

  /** ⚠️ প্রথম পাশ — কোন গুচ্ছগুলো মালিক নিজে সরিয়েছেন */
  const movedClusters = new Set<string>();
  for (const entry of entries) {
    if (entry.cluster === undefined) continue;
    const found = byName.get(nameKey(entry.date, entry.name));
    if (found !== undefined && found.date !== entry.date) {
      movedClusters.add(entry.cluster);
    }
  }

  const plan: SeedPlan = {
    create: [],
    keptByDate: [],
    keptByName: [],
    keptByCluster: [],
    renamed: [],
    unlisted: [],
  };

  /**
   * ⭐ যে DB-সারিগুলো তালিকার কোনো-না-কোনো এন্ট্রি চিনতে পেরেছে — তারিখে
   *    হোক বা নামে। `unlisted` ঠিক এর **বাকিটুকু**, তাই দুটো তালিকা আর
   *    কখনো একই সারি নিয়ে উল্টো কথা বলতে পারে না।
   */
  const claimed = new Set<string>();

  for (const entry of entries) {
    const onDate = byDate.get(entry.date);
    const sameName = byName.get(nameKey(entry.date, entry.name));

    /**
     * ⚠️ দাবিটা বসে **শ্রেণি বাছাইয়ের আগেই**। নইলে সরানো গুচ্ছের বেলায়
     *    (নিচের `keptByCluster` শাখা আগেভাগে `continue` করে) মালিকের সরানো
     *    সারিটা কেউ দাবি করত না, আর ঈদটা একই সাথে "গুচ্ছ হাতে সরানো হয়েছে"
     *    ও "তালিকায় নেই" — দুটো উল্টো কথা হয়ে ছাপা হতো।
     */
    if (onDate !== undefined) claimed.add(onDate.date);
    if (sameName !== undefined) claimed.add(sameName.date);

    if (entry.cluster !== undefined && movedClusters.has(entry.cluster)) {
      plan.keptByCluster.push(entry);
      continue;
    }

    if (onDate !== undefined) {
      plan.keptByDate.push(entry);
      if (baseName(onDate.name) !== baseName(entry.name)) {
        plan.renamed.push({
          date: entry.date,
          inDb: onDate.name,
          inList: holidayRowName(entry),
        });
      }
      continue;
    }

    if (sameName !== undefined) {
      plan.keptByName.push({ entry, foundAt: sameName.date });
      continue;
    }

    plan.create.push(entry);
  }

  plan.unlisted = inScope.filter((row) => !claimed.has(row.date));

  return plan;
}

/**
 * কোন বছরগুলোতে seed এবার হাত দেবে।
 *
 * ⭐⭐ **যে বছর একবার বসানো হয়েছে, সেটা আর ছোঁয়া হয় না** — কারণ মালিক
 *    ঘোষণা দেখে একটা দিন **মুছে** দিলে সেটা DB-তে আর কোনো চিহ্ন রাখে না;
 *    পরের seed-এ দিনটা "নেই" দেখে আবার বসিয়ে দিত, আর ছুটি একদিন বেশি
 *    গোনা হতো — ঠিক যে ভুলটা ঠেকাতে এই ফাইলটা লেখা, তার উল্টোটা।
 *
 * ⚠️ নতুন বছর যোগ করলে সেটা আপনাআপনি বসবে (তালিকায় আছে, `seeded`-এ নেই)।
 *    কোনো বছর ইচ্ছে করে আবার বসাতে চাইলে `settings`-এর সারিটা থেকে বছরটা
 *    সরাতে হবে — সেটা সচেতন সিদ্ধান্ত, দুর্ঘটনা নয়।
 */
export function yearsToSeed(
  all: readonly number[],
  seeded: readonly number[],
): number[] {
  const done = new Set(seeded);
  return all.filter((year) => !done.has(year)).sort((a, b) => a - b);
}

// ── seed একবার চালালে কী ঘটবে ───────────────────────────────────────────────

/**
 * seed কোন সময়ে, কার সম্মতি নিয়ে চলছে।
 *
 * ⚠️ দুটোই **বাধ্যতামূলক**, ডিফল্ট নেই — ইচ্ছাকৃত। `allowPast`-এর একটা
 *    ডিফল্ট মান রাখলে সেটা হয় নীরবে অতীত মাস বসিয়ে দিত (ঠিক যে বাগটা
 *    ঠেকানো হচ্ছে), নয়তো নীরবে সব আটকে দিত। কলারকে দুটোই বলতে হয়।
 */
export interface SeedTiming {
  /** ঢাকার আজকের তারিখ `YYYY-MM-DD` — `dhakaToday(new Date())` */
  today: string;
  /**
   * ⭐⭐ চলতি ও অতীত মাসেও ছুটি বসানোর **স্পষ্ট সম্মতি**
   * (`SEED_HOLIDAYS_PAST=true`)। ⚠️ এটা `true` করা মানে ওই মাসগুলোর
   * টার্গেট ও পে-রোলের হর বদলাতে রাজি হওয়া — `isSettledMonth()`-এর নোট।
   */
  allowPast: boolean;
}

/** একটা seed-রানের পুরো ফল — DB ছাড়াই হিসাব করা যায়, তাই টেস্টযোগ্য */
export interface HolidaySeedRun {
  /** এবার সত্যিই DB-তে বসবে */
  create: HolidayEntry[];
  /**
   * ⭐⭐ তালিকায় আছে, DB-তে নেই, বছরটাও খোলা — তবু বসছে না, কারণ তারিখটা
   * **চলতি বা অতীত মাসে** পড়ে আর সম্মতি (`allowPast`) দেওয়া হয়নি।
   *
   * ⚠️ চুপ করে বাদ দেওয়া হয় না — প্রতিটার **নাম ও তারিখ ধরে** নোটে ওঠে।
   *    "বসানো হয়নি" আর "বসানোর দরকার নেই" এক কথা নয়, আর পার্থক্যটা
   *    মালিকের জানা দরকার।
   */
  needsConsent: HolidayEntry[];
  /**
   * ⚠️ তালিকায় আছে, DB-তে **নেই**, তবু বসছে না — কারণ বছরটা আগেই বসানো।
   *    সাধারণত মানে মালিক সারিটা নিজে মুছে দিয়েছেন (ঘোষণা এসেছে), আর
   *    সেটাই ঠিক। ⭐ তবু নাম ধরে বলা হয়: চুপ থাকলে "তালিকা আর DB এক" বলে
   *    ভুল ধারণা তৈরি হতো।
   */
  heldBack: HolidayEntry[];
  /** DB-তে আগে থেকেই ছিল — তারিখে, নামে বা গুচ্ছে মিলেছে */
  kept: number;
  /** ⭐⭐ প্রতিবারই ছাপার নোট — কিছু বসুক বা না বসুক */
  notes: string[];
}

/**
 * তালিকা + DB + "কোন বছরগুলো এখনো খোলা" → এবারের রান।
 *
 * ⭐⭐ **এক পরিকল্পনা, এক সত্য।** আগে seed কেবল **খোলা বছরগুলোর** সারি নিয়ে
 *    পরিকল্পনা করত, তাই দুই বছরই বসে যাওয়ার পর `unlisted`/`renamed` নোটগুলো
 *    **চিরতরে চুপ** হয়ে যেত: চলতি DB-তে `2026-08-15 জাতীয় শোক দিবস`
 *    (২০২৪-এ সরকারি তালিকা থেকে বাদ) বসে থেকে আগস্টের একটা কর্মদিবস কমিয়ে
 *    রাখছে, অথচ seed প্রথম রানের পর সেটা আর একবারও বলত না। ⚠️ "না বলা
 *    সিদ্ধান্ত নয়, চেপে যাওয়া" — নিয়মটা seed নিজেই দ্বিতীয় রানে ভাঙছিল।
 *
 * ⭐ তাই বছরের ফিল্টারটা এখন কেবল **কী বসবে** ঠিক করে, **কী বলা হবে** নয়।
 *    পরিকল্পনা হয় পুরো তালিকার উপর, প্রতিবার।
 *
 * ⚠️ `openYears`-এর বাইরের সারি বসে না — ওই সুরক্ষাটা অটুট
 *    (`yearsToSeed`-এর নোট দেখুন)।
 *
 * ⭐⭐ **দুটো আলাদা ছাঁকনি, দুটো আলাদা কারণ** — মেলানো হয়নি ইচ্ছাকৃতভাবে:
 *    · `heldBack` — বছরটা আগেই বসানো, তাই মালিকের মোছা দিন ফিরিয়ে আনা হবে না
 *    · `needsConsent` — মাসটার হিসাব বেরিয়ে গেছে, তাই টাকা নড়তে দেওয়া হবে না
 *    একটা সারি দুটোতেই পড়লে **কেবল `heldBack`-এ ওঠে**: বছরটা বন্ধ থাকলে
 *    সম্মতি দিয়েও ওটা বসত না, তাই সম্মতি চাওয়া হবে মিথ্যে আশা দেওয়া।
 */
export function planHolidaySeedRun(
  entries: readonly HolidayEntry[],
  existing: readonly ExistingHoliday[],
  openYears: readonly number[],
  when: SeedTiming,
): HolidaySeedRun {
  const plan = planHolidaySeed(entries, existing);
  const open = new Set(openYears);

  const heldBack = plan.create.filter((e) => !open.has(yearOf(e.date)));
  const inOpenYear = plan.create.filter((e) => open.has(yearOf(e.date)));

  const settled = inOpenYear.filter((e) => isSettledMonth(e.date, when.today));
  const future = inOpenYear.filter((e) => !isSettledMonth(e.date, when.today));

  const needsConsent = when.allowPast ? [] : settled;
  const create = when.allowPast ? inOpenYear : future;

  /**
   * ⚠️ ক্রমটা ইচ্ছাকৃত: **যা মালিকের নজর দাবি করে** (⚠️) আগে, তারপর
   *    যা কেবল জানানো (·)। কনসোলে নোট লম্বা হলে উপরেরগুলোই চোখে পড়ে।
   *    ⭐ আর সবার আগে টাকার কথাটা (⚠️⚠️)।
   */
  const notes = [
    ...needsConsent.map(
      (e) =>
        `⚠️⚠️ বসানো হয়নি: ${e.date} — "${holidayRowName(e)}" ` +
        `(${monthKey(e.date)} মাসের হিসাব ইতিমধ্যে চলে গেছে)`,
    ),
    /**
     * ⚠️⚠️ শেষ দুটো বাক্য **যাচাই করে** লেখা, অনুমান করে নয়
     *    (`src/summary/summary-refresh.job.ts` · `src/summary/day-close.job.ts` ·
     *    `src/adjustments/adjustments.service.ts`): চলতি মাসের rollup
     *    প্রতি ১৫ মিনিটে নিজে থেকেই নতুন করে লেখা হয়, কিন্তু **অতীত মাস
     *    ফেরত হিসাব করার কোনো কমান্ড বা endpoint আজ নেই** — ওই সারিগুলো
     *    বদলায় কেবল ওই মাসের কোনো time-adjustment অনুমোদন/বাতিলের সময়।
     *    ⭐ "seed চালিয়ে তারপর refresh করে নিন" লিখলে সেটা এমন একটা পথের
     *    দিকে পাঠাত যা নেই — আর তখন সংখ্যাগুলো নীরবে দ্বিমত নিয়ে বসে থাকত।
     */
    ...(needsConsent.length > 0
      ? [
          `⚠️⚠️ উপরের ${needsConsent.length}টি তারিখ বসালে ওই মাসগুলোর কর্মদিবস কমবে — ` +
            `target_sec · expected_sec · pace_sec আর পে-রোলের d÷D ভগ্নাংশ, সবই বদলাবে (সরাসরি টাকা)। ` +
            `চলতি মাস ১৫ মিনিটের মধ্যে নিজে থেকেই নতুন হিসাবে চলে যাবে; ` +
            `অতীত মাস স্থির থাকবে, তারপর ওই মাসের কোনো time-adjustment অনুমোদনের দিন হঠাৎ লাফ দেবে। ` +
            `সচেতনভাবে বসাতে: SEED_HOLIDAYS_PAST=true — তার আগে deploy/README.md § ২.১গ পড়ুন।`,
        ]
      : []),
    ...plan.unlisted.map(
      (row) => `⚠️ তালিকায় নেই: ${row.date} — "${row.name}" (এখনো ছুটি কি?)`,
    ),
    /**
     * ⚠️⚠️ শেষ বাক্যটা কেন দরকার: `planHolidaySeed()` তারিখে মিল পেলে নাম
     *    **বদলায় না** (ইচ্ছাকৃত — মালিকের হাতের কাজ যাতে না মুছে যায়)।
     *    ফল: পুরোনো seed যে সারিটা বসিয়ে গেছে, সেটা তালিকার নতুন নামের
     *    "(সম্ভাব্য)" চিহ্নটা **কোনোদিনই** পাবে না। চলতি VPS-এ ঠিক এটাই
     *    ঘটেছে ২০২৬-০৩-১৭-তে (DB-তে "জাতির পিতার জন্মদিন", তালিকায়
     *    "শবে কদর")। না বললে অনিশ্চয়তাটা ওই সারিতে চিরকাল অদৃশ্য থাকত।
     */
    ...plan.renamed.map((diff) => {
      const markLost = hasApproxSuffix(diff.inList) && !hasApproxSuffix(diff.inDb);
      return (
        `⚠️ একই তারিখ, আলাদা নাম: ${diff.date} — DB-তে "${diff.inDb}", তালিকায় "${diff.inList}" — ` +
        `seed নাম বদলায় না` +
        (markLost
          ? `, তাই সারিটা কোনোদিন "${APPROX_SUFFIX.trim()}" চিহ্ন পাবে না; ঠিক করতে Settings → Holidays`
          : `; বদলাতে চাইলে Settings → Holidays`)
      );
    }),
    ...heldBack.map(
      (e) =>
        `⚠️ তালিকায় আছে, DB-তে নেই: ${e.date} — "${holidayRowName(e)}" (${yearOf(e.date)} আগেই বসানো, তাই বসানো হয়নি)`,
    ),
    ...plan.keptByName.map(
      (kept) =>
        `· "${kept.entry.name}" ${kept.foundAt}-এ আছে (তালিকায় ${kept.entry.date}) — ছোঁয়া হয়নি`,
    ),
    ...(plan.keptByCluster.length > 0
      ? [`· ${plan.keptByCluster.length}টি সারি বাদ — গুচ্ছটা হাতে সরানো হয়েছে`]
      : []),
  ];

  return {
    create,
    needsConsent,
    heldBack,
    kept:
      plan.keptByDate.length +
      plan.keptByName.length +
      plan.keptByCluster.length,
    notes,
  };
}

/**
 * এই রানের পর কোন বছরগুলো "সম্পূর্ণ বসানো" বলে চিহ্নিত হবে।
 *
 * ⭐⭐ **যে বছরে সম্মতির অপেক্ষায় সারি রয়ে গেছে, সেই বছর বন্ধ হয় না।**
 *    নইলে প্রথম রানেই ২০২৬ বন্ধ হয়ে যেত, আর তখন `SEED_HOLIDAYS_PAST=true`
 *    দিয়ে চালালেও কিছুই বসত না (`yearsToSeed` বছরটাই বাদ দিয়ে দিত) —
 *    অর্থাৎ পতাকাটা থাকত, কাজ করত না। ⚠️ কমেন্ট যা বলে কোড তা না করলে
 *    সেটা বাগের চেয়েও খারাপ।
 *
 * ⚠️ **দাম আছে, আর সেটা লুকোনো হচ্ছে না:** যতদিন কোনো বছরে সম্মতির
 *    অপেক্ষায় সারি থাকে, বছরটা খোলা থাকে — অর্থাৎ মালিক ওই বছরের
 *    **ভবিষ্যৎ মাসের** কোনো ছুটি মুছে দিলে পরের seed সেটা আবার বসিয়ে দিতে
 *    পারে (`yearsToSeed`-এর নোটে বর্ণিত ফাঁক)। ⭐ তবু এটাই কম খারাপ:
 *    ভবিষ্যৎ মাসে একটা বাড়তি ছুটি চোখে পড়ে ও হাতে মোছা যায়, কিন্তু কাজ
 *    না করা একটা সম্মতি-পতাকা কেউ কোনোদিন ধরতে পারত না।
 */
export function yearsSettled(
  openYears: readonly number[],
  pending: readonly HolidayEntry[],
): number[] {
  const blocked = new Set(pending.map((e) => yearOf(e.date)));
  return openYears.filter((year) => !blocked.has(year));
}
