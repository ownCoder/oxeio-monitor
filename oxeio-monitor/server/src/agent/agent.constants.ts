/** এজেন্ট প্রতিটি রিকোয়েস্টে নিজের ঘড়ির সময় এখানে পাঠায় (§ ২ · clock drift) */
export const CLIENT_TIME_HEADER = 'x-client-time';

/** স্পেক § ৪.১ — ingest-এর সীমা */
export const MAX_BATCH_SIZE = 500;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_SCREENSHOT_MIME = 'image/webp';

/** ডিভাইসপ্রতি rate limit (প্রতি মিনিটে) */
export const RATE_LIMIT_INGEST = 60;
export const RATE_LIMIT_SCREENSHOT = 20;

/** enrollment code — একবার ব্যবহার্য, ২৪ ঘণ্টায় expire (H05) */
export const ENROLLMENT_CODE_TTL_HOURS = 24;
