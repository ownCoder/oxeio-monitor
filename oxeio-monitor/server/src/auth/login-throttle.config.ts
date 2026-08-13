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
  /** কতবার ভুলের পর লক */
  maxFails: number;
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
}): ThrottleLimits {
  const maxFails = clamp(
    toNumber(raw.maxFails, DEFAULT_MAX_FAILS),
    1,
    MAX_FAILS_CEILING,
    DEFAULT_MAX_FAILS,
  );

  const lockMinutes = toNumber(raw.lockMinutes, DEFAULT_LOCK_MINUTES);

  // ⚠️ শূন্য বৈধ, আর এর মানে "বন্ধ" — clamp-এর নিচের সীমায় আটকানো যাবে না
  if (lockMinutes === 0) {
    return { maxFails, lockMs: 0, enabled: false };
  }

  const minutes = clamp(lockMinutes, 1, MAX_LOCK_MINUTES, DEFAULT_LOCK_MINUTES);
  return { maxFails, lockMs: minutes * 60 * 1000, enabled: true };
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
