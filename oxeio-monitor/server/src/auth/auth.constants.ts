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

/** I11 — ব্রুট-ফোর্স */
export const MAX_LOGIN_FAILS = 5;
export const LOGIN_LOCK_MIN = 15;

/** পাসওয়ার্ডের সর্বনিম্ন দৈর্ঘ্য */
export const MIN_PASSWORD_LENGTH = 10;
