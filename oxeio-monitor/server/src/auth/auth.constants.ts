/** httpOnly — ব্রাউজারের JS কখনো পড়তে পারবে না (ADR-016, XSS-এ টোকেন চুরি ঠেকাতে) */
export const SESSION_COOKIE = 'oxeio_session';

/**
 * CSRF-এর double-submit টোকেন। ইচ্ছাকৃতভাবে httpOnly **নয়** —
 * ফ্রন্টএন্ডকে এটা পড়ে `X-CSRF-Token` হেডারে ফেরত পাঠাতে হয়।
 */
export const CSRF_COOKIE = 'oxeio_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** I09 — ৩০ মিনিট নিষ্ক্রিয় থাকলে সেশন শেষ */
export const SESSION_TTL_MIN = 30;

/**
 * প্রতি রিকোয়েস্টে নতুন টোকেন ইস্যু করলে অযথা খরচ।
 * এই সময়ের বেশি পুরোনো হলে তবেই cookie নতুন করে বসে (sliding window)।
 */
export const SESSION_REFRESH_AFTER_MIN = 5;

/**
 * I09 — মেয়াদ শেষের কত আগে "আর ১ মিনিট" সতর্কবার্তা।
 * ⚠️ কাজের মাঝপথে চুপচাপ লগআউট নয় — এই জানালাটাই ইউজারকে একটা ক্লিকে
 *    সেশন বাঁচানোর সুযোগ দেয়।
 */
export const IDLE_WARN_BEFORE_SEC = 60;

/**
 * I11 — ব্রুট-ফোর্স।
 *
 * ⚠️⚠️ **মানগুলো এখান থেকে সরে গেছে** — `login-throttle.config.ts`-এ, আর
 * `.env` দিয়ে বদলানো যায় (`LOGIN_MAX_FAILS`, `LOGIN_LOCK_MINUTES`)।
 * এখানে ছিল ৫ বার / ১৫ মিনিট, আর ১৫ জনের অফিসে সেটা সুরক্ষা নয়, বাধা
 * হয়ে দাঁড়িয়েছিল: পাসওয়ার্ড রিসেটের পর স্টাফ কয়েকবার ভুল টাইপ করলেই
 * "Try again in 13 minutes" — আর মনে হতো রিসেটটাই কাজ করেনি।
 *
 * ⚠️ কোনো ধ্রুবক এখানে ফিরিয়ে আনবেন না — দুই জায়গায় দুই মাপ থাকলে কোনটা
 * আসলে খাটছে সেটা আর বলা যেত না।
 */

/** পাসওয়ার্ডের সর্বনিম্ন দৈর্ঘ্য */
export const MIN_PASSWORD_LENGTH = 10;

// ══════════════════ I06 — TOTP 2FA ══════════════════

/** authenticator অ্যাপে যে নামে অ্যাকাউন্টটা দেখাবে */
export const TOTP_ISSUER = 'oXeio Monitor';

/** RFC 6238-এর ডিফল্ট — Google Authenticator, Authy, 1Password সবাই এটাই ধরে */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD = 30;

/**
 * ⚠️ ±১ ধাপ (±৩০ সেকেন্ড) সহনশীলতা। ফোনের ঘড়ি কয়েক সেকেন্ড এদিক-ওদিক
 *    থাকা স্বাভাবিক; ০ রাখলে বহু বৈধ কোড অকারণে বাতিল হতো।
 */
export const TOTP_WINDOW = 1;

/** ⭐ ফোন হারালে ঢোকার একমাত্র পথ — একবারই দেখানো হয় */
export const RECOVERY_CODE_COUNT = 10;
/** ১০ অক্ষর × ৫ বিট = ৫০ বিট এনট্রপি */
export const RECOVERY_CODE_LENGTH = 10;
