/**
 * লগইন লকআউটের মাপ — খাঁটি ফাংশন, `.env` থেকে পড়া মান ব্যাখ্যা করে।
 *
 * ⚠️⚠️ **কেন এটা আলাদা করে খুলতে হলো:** মাপগুলো হার্ডকোড ছিল — ৫ বার ভুল,
 * ১৫ মিনিট লক। ব্রুট-ফোর্সের বিরুদ্ধে যুক্তিসঙ্গত, কিন্তু বাস্তবে যা ঘটল:
 * মালিক স্টাফের পাসওয়ার্ড রিসেট করলেন, স্টাফ কয়েকবার ভুল টাইপ করলেন
 * (পাসওয়ার্ডটা তখন `l/1/O/0` মেশানো ছিল), আর পর্দায় এল
 * <i>"Try again in 13 minutes."</i> — একটা ১৫ জনের অফিসে যেখানে সবাই
 * পাশের ঘরে বসে, এটা সুরক্ষা নয়, শুধু বাধা।
 *
 * ⭐ তাই মাপ দুটো এখন `.env`-এ, আর ডিফল্টও অনেক নরম।
 *
 * ⚠️ পুরোপুরি বন্ধ করা যায় — `LOGIN_LOCK_MINUTES=0`। একটাই নব, তাই
 * "কোনটা বন্ধ করলে কী হয়" মনে রাখতে হয় না।
 */

export interface ThrottleLimits {
  /** কতবার ভুলের পর লক — **একই ইমেইল + একই IP** জোড়ার জন্য */
  maxFails: number;
  /**
   * ⭐⭐ কতবার ভুলের পর **গোটা IP** লক — ইমেইল যাই হোক (G116)।
   *
   * ⚠️⚠️ **এই ঘরটা কেন দরকার হলো:** জোড়া-চাবি (`email|ip`) কেবল ধরে
   *    "একজনের পাসওয়ার্ড বারবার অনুমান"। কিন্তু আসল আক্রমণটা উল্টো —
   *    এক IP থেকে **হাজারটা আলাদা ইমেইল**, প্রতিটার জন্য এক-দুবার। তখন
   *    প্রতিটা চেষ্টা আলাদা চাবিতে পড়ত, কোনো কাউন্টার সীমা ছুঁত না, আর
   *    তালা **কখনো পড়ত না**। অচেনা ইমেইলেও ব্যর্থতা গোনা হয়
   *    (`auth.service.ts`), তাই এই কাউন্টারটাই ওই ফাঁকটা বন্ধ করে।
   *
   * ⚠️ সীমাটা ইচ্ছাকৃতভাবে **অনেক উঁচু**: গোটা অফিস একটাই IP-র পেছনে,
   *    তাই পাসওয়ার্ড রিসেটের দিনে সাতজনের কয়েকটা করে টাইপো মিলে সহজেই
   *    ২০–৩০ হয়ে যেতে পারে। এটা নিরাপত্তার শেষ কথা নয়, বরং "অসীম" থেকে
   *    "মাপা" — আর ওই তফাতটাই এখানে আসল।
   */
  ipMaxFails: number;
  /** কতক্ষণ লক — মিলিসেকেন্ড */
  lockMs: number;
  /** `false` হলে লকআউট পুরোপুরি বন্ধ */
  enabled: boolean;
}

/**
 * ⚠️ ডিফল্ট **১০ বার / ২ মিনিট** — আগে ছিল ৫ বার / ১৫ মিনিট।
 *
 * ⭐ যুক্তি: অনলাইনে পাসওয়ার্ড অনুমান করা ঠেকাতে গুরুত্বপূর্ণ হলো
 * **হার**, সময়ের দৈর্ঘ্য নয়। ২ মিনিটের লকও প্রতি ঘণ্টায় চেষ্টা ৩০০-তে
 * নামিয়ে আনে, অর্থাৎ অনুমান করে ভাঙা তখনও অসম্ভব। কিন্তু টাইপো করা
 * স্টাফের জন্য ১৫ মিনিট আর ২ মিনিটের তফাত বিরাট।
 */
const DEFAULT_MAX_FAILS = 10;
const DEFAULT_LOCK_MINUTES = 2;

/**
 * ⭐ IP-সীমা ডিফল্টে জোড়া-সীমার **পাঁচ গুণ** — আলাদা একটা সংখ্যা নয়,
 * গুণিতক। কেউ `LOGIN_MAX_FAILS` নরম করলে IP-সীমাও সাথে নরম হয়, তাই দুটো
 * নব কখনো একে অন্যের বিরুদ্ধে দাঁড়ায় না।
 *
 * ⚠️ ডিফল্টে ৫০ ভুল / ২ মিনিট। শুনতে ঢিলে, কিন্তু হিসাবটা এরকম: এতে
 * ঘণ্টায় চেষ্টা নামে ~১৫০০-তে, আর **আগে ছিল অসীম**। ৭টা অ্যাকাউন্টের
 * শক্ত পাসওয়ার্ডের বিরুদ্ধে ওটা কার্যকর বাধা; আর অফিসের কেউ কোনোদিন
 * ৫০ বার ভুল করবে না।
 */
const IP_FAILS_MULTIPLIER = 5;

/**
 * ⚠️ উপরের সীমা রাখা হয়েছে ইচ্ছাকৃতভাবে। `LOGIN_LOCK_MINUTES=100000`
 * টাইপ করে ফেললে কেউ কার্যত চিরকালের জন্য নিজেকে তালাবন্ধ করে ফেলত,
 * আর কাউন্টার মেমরিতে বলে ফেরার একমাত্র পথ হতো সার্ভার রিস্টার্ট।
 */
const MAX_LOCK_MINUTES = 60;
const MAX_FAILS_CEILING = 100;

/**
 * @param raw `.env` থেকে আসা কাঁচা মান — যাচাই করা হয়নি ধরে নেওয়া হয়।
 *
 * ⚠️ অবৈধ মানে **থামা হয় না, ডিফল্টে ফেরা হয়**। লগইন হলো ভেতরে ঢোকার
 * একমাত্র দরজা; `.env`-এর একটা টাইপোর জন্য গোটা সার্ভার না ওঠা মানে
 * মালিক নিজের সিস্টেম থেকেই বেরিয়ে যেতেন।
 */
export function resolveThrottle(raw: {
  maxFails?: string | number | null;
  lockMinutes?: string | number | null;
  ipMaxFails?: string | number | null;
}): ThrottleLimits {
  const maxFails = clamp(
    toNumber(raw.maxFails, DEFAULT_MAX_FAILS),
    1,
    MAX_FAILS_CEILING,
    DEFAULT_MAX_FAILS,
  );

  /**
   * ⚠️ ডিফল্ট গুণিতক থেকে, আর সিলিংও জোড়া-সীমার সিলিংয়ের পাঁচ গুণ —
   *    নইলে `LOGIN_MAX_FAILS=100` দিলে IP-সীমা (৫০০) সিলিংয়ে আটকে গিয়ে
   *    **জোড়া-সীমার চেয়ে ছোট** হয়ে যেত, অর্থাৎ IP আগে লক হতো আর নবটার
   *    মানেই উল্টে যেত।
   * ⚠️ নিচের সীমা `maxFails` — IP-সীমা কখনো জোড়া-সীমার চেয়ে কম হতে পারে না।
   */
  const ipMaxFails = clamp(
    toNumber(raw.ipMaxFails, maxFails * IP_FAILS_MULTIPLIER),
    maxFails,
    MAX_FAILS_CEILING * IP_FAILS_MULTIPLIER,
    maxFails * IP_FAILS_MULTIPLIER,
  );

  const lockMinutes = toNumber(raw.lockMinutes, DEFAULT_LOCK_MINUTES);

  // ⚠️ শূন্য বৈধ, আর এর মানে "বন্ধ" — clamp-এর নিচের সীমায় আটকানো যাবে না
  if (lockMinutes === 0) {
    return { maxFails, ipMaxFails, lockMs: 0, enabled: false };
  }

  const minutes = clamp(lockMinutes, 1, MAX_LOCK_MINUTES, DEFAULT_LOCK_MINUTES);
  return { maxFails, ipMaxFails, lockMs: minutes * 60 * 1000, enabled: true };
}

/**
 * ⚠️ `Number('')` শূন্য দেয়, আর `Number(undefined)` দেয় `NaN` — দুটোকেই
 * "দেওয়া হয়নি" ধরতে হবে। খালি স্ট্রিংকে শূন্য ধরলে `.env`-এ
 * `LOGIN_LOCK_MINUTES=` লেখা থাকলেই লকআউট নীরবে বন্ধ হয়ে যেত।
 */
function toNumber(value: string | number | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;

  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/** ⚠️ সীমার বাইরে গেলে ডিফল্ট — সীমায় কেটে দেওয়া নয়। কেউ ৯৯৯ লিখলে
 *  তার উদ্দেশ্য বোঝা যায় না, তাই অনুমান না করে চেনা মানে ফেরা নিরাপদ। */
function clamp(n: number, min: number, max: number, fallback: number): number {
  return n >= min && n <= max ? n : fallback;
}
