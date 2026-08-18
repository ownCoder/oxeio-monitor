/**
 * **অফসাইট ব্যাকআপের সেটিং (R5 · G39)** — খাঁটি নিয়ম, কোনো I/O নেই।
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো:** B2-র কী-জোড়া বসাতে হতো VPS-এ SSH করে,
 * `rclone config` চালিয়ে, তারপর `/etc/oxeio-offsite.env` সম্পাদনা করে।
 * মালিকের পক্ষে সেটা কার্যত অসম্ভব — আর ১৮ আগস্ট মাঠে ঠিক সেটাই ঘটেছে:
 * একটা ভুল-পেস্ট করা key নিয়ে `401 bad_auth_token`, আর কারণটা বুঝতে
 * টার্মিনালে বসে খোঁজাখুঁজি।
 *
 * ⭐ এখন পর্দা থেকেই বসানো যায়, আর **সাথে সাথে পরীক্ষা** করা যায়।
 * `.env`/`/etc/oxeio-offsite.env` **fallback হিসেবে থাকে** — পুরোনো
 * ইনস্টলেশনে কিছু ভাঙে না।
 *
 * ⚠️ ধাঁচটা `alerts/telegram.settings.ts`-এর হুবহু অনুকরণ, ইচ্ছাকৃতভাবে:
 * গোপন মান রাখা ও পর্দায় না পাঠানোর নিয়মগুলো দুই জায়গায় দু-রকম হলে
 * একদিন একটায় ফাঁক থেকে যেত।
 */

/** ডাটাবেসে `settings` টেবিলে এই চাবিতে বসে */
export const OFFSITE_SETTING_KEY = 'ops.offsite';

export interface OffsiteSettings {
  /** B2-র `keyID` — ২৫ অক্ষর */
  keyId: string;
  /** B2-র `applicationKey` — ৩১ অক্ষর, ⚠️ গোপন */
  appKey: string;
  /** যেমন `oxeio-backups` */
  bucket: string;
}

/**
 * ⚠️⚠️ **পর্দায় যা যায় — applicationKey কখনো নয়।**
 *
 * ব্রাউজারে পাঠালে সেটা DevTools, প্রক্সি লগ বা স্ক্রিন শেয়ারে দেখা যেত।
 * তাই কেবল **শেষ চারটে অক্ষর** — মালিক যেন মিলিয়ে নিতে পারেন কোনটা বসানো
 * আছে, কিন্তু কেউ যেন ওটা দিয়ে ব্যাকআপে হাত দিতে না পারে।
 */
export interface OffsiteSettingsView {
  configured: boolean;
  /** `…9f2a` — বসানো না থাকলে `null` */
  keyHint: string | null;
  /**
   * ⭐ keyID **গোপন নয়** — ওটা কেবল একটা পরিচয়, আর ওটা দিয়ে একা কিছু
   * করা যায় না (টেলিগ্রামের `chatId`-র মতোই)। পুরোটা ফেরত পাঠানো হয়
   * যাতে পর্দায় "আগেরটাই থাক" সত্যিই কাজ করে — নইলে bucket শুধরাতে
   * গিয়ে keyID মুছে যেত।
   */
  keyId: string;
  /** ⭐ bucket-এর নাম গোপন নয় — ওটা দিয়ে কিছু করা যায় না */
  bucket: string;
  /** ⚠️ ডাটাবেস না সার্ভারের ফাইল — কোনটা খাটছে, মালিকের জানা দরকার */
  source: 'database' | 'env' | 'none';
}

/**
 * ⚠️ চার অক্ষরের কম হলে কিছুই দেখানো হয় না — খুব ছোট মান মানে হয় ভুল
 * বসানো, নয় পরীক্ষার মান; দুই ক্ষেত্রেই অংশ দেখিয়ে লাভ নেই।
 */
export function keyHint(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.length < 4) return null;

  return `…${trimmed.slice(-4)}`;
}

/**
 * ডাটাবেস ও সার্ভারের ফাইল মিলিয়ে **কোনটা আসলে খাটবে**।
 *
 * ⭐⭐ ডাটাবেস জিতবে, কিন্তু **তিনটে ঘরই ভরা থাকলে**। দুটো ভরা আর একটা
 * খালি রেখে দিলে অফসাইট আধা-কনফিগার হয়ে চুপচাপ বন্ধ থাকত, অথচ সার্ভারে
 * কাজ করা মান বসেই আছে — অর্থাৎ পর্দায় হাত দিয়ে জিনিসটা **ভাঙানো** যেত।
 */
export function resolveOffsite(
  db: Partial<OffsiteSettings> | null,
  env: Partial<OffsiteSettings>,
): { settings: OffsiteSettings | null; source: 'database' | 'env' | 'none' } {
  const pick = (s: Partial<OffsiteSettings> | null | undefined) => ({
    keyId: s?.keyId?.trim() ?? '',
    appKey: s?.appKey?.trim() ?? '',
    bucket: s?.bucket?.trim() ?? '',
  });

  const fromDb = pick(db);
  if (fromDb.keyId && fromDb.appKey && fromDb.bucket) {
    return { settings: fromDb, source: 'database' };
  }

  const fromEnv = pick(env);
  if (fromEnv.keyId && fromEnv.appKey && fromEnv.bucket) {
    return { settings: fromEnv, source: 'env' };
  }

  return { settings: null, source: 'none' };
}

/**
 * পর্দার জন্য ছবি।
 *
 * ⚠️ `source` পাঠানো হয় ইচ্ছাকৃতভাবে: সার্ভারের ফাইলে মান থাকা অবস্থায়
 * পর্দায় নতুন মান বসালে কোনটা খাটছে সেটা না জানালে মালিক ভাবতেন সেভ
 * হয়নি — অথচ হয়েছে, শুধু অন্যটা জিতছে না।
 */
export function offsiteView(
  resolved: ReturnType<typeof resolveOffsite>,
): OffsiteSettingsView {
  const s = resolved.settings;

  return {
    configured: s !== null,
    keyHint: s ? keyHint(s.appKey) : null,
    keyId: s?.keyId ?? '',
    bucket: s?.bucket ?? '',
    source: resolved.source,
  };
}

/**
 * ⭐⭐ **B2 কী-জোড়া সত্যিই কাজ করে কি না** — এটাই সেই পরীক্ষা যেটা ১৮
 * আগস্ট টার্মিনালে বসে করতে হয়েছিল।
 *
 * B2-র `b2_authorize_account` একটা সাধারণ HTTPS GET, Basic auth-এ
 * `keyId:appKey`। ⭐ সীমাবদ্ধ key-তেও এটা কাজ করে (bucket তালিকা করার
 * অনুমতি লাগে না), আর উত্তরে `allowed.bucketName` বলে দেয় key-টা **কোন**
 * bucket-এ বাঁধা — অর্থাৎ ভুল bucket লেখা থাকলেও ধরা পড়ে।
 *
 * ⚠️ এটা খাঁটি ফাংশন নয় (নেটওয়ার্ক লাগে), কিন্তু **সিদ্ধান্তটুকু** খাঁটি:
 * নিচের `b2Verdict()` কেবল উত্তরটা পড়ে রায় দেয়, তাই সেটা টেস্টযোগ্য।
 */
export interface B2AuthReply {
  status: number;
  /** B2-র JSON — `allowed.bucketName` থাকতে পারে */
  allowed?: { bucketName?: string | null; capabilities?: string[] };
  /** ব্যর্থ হলে B2-র বার্তা */
  message?: string;
}

export interface B2Verdict {
  ok: boolean;
  /** পর্দায় দেখানোর মতো এক লাইন */
  message: string;
  /** key-টা যে bucket-এ বাঁধা (সীমাবদ্ধ না হলে `null`) */
  boundTo: string | null;
}

export function b2Verdict(reply: B2AuthReply, bucket: string): B2Verdict {
  if (reply.status === 401) {
    return {
      ok: false,
      // ⚠️ ঠিক এই ভুলটাই মাঠে হয়েছে — তাই বার্তায় সরাসরি করণীয় লেখা
      message:
        'Backblaze rejected the key (401). The application key is usually the problem — it is shown only once, so copy it again or make a new one.',
      boundTo: null,
    };
  }

  if (reply.status !== 200) {
    return {
      ok: false,
      message: `Backblaze answered ${reply.status}${reply.message ? ` — ${reply.message}` : ''}`,
      boundTo: null,
    };
  }

  const bound = reply.allowed?.bucketName ?? null;

  /**
   * ⚠️⚠️ key ঠিক, কিন্তু **অন্য bucket-এ বাঁধা** — এটা নীরব ব্যর্থতার
   * চমৎকার উৎস: সব সবুজ দেখাত, আর ব্যাকআপ যেত অন্য কোথাও (বা কোথাওই না)।
   */
  if (bound !== null && bucket.trim().length > 0 && bound !== bucket.trim()) {
    return {
      ok: false,
      message: `The key works, but it is restricted to the bucket “${bound}”, not “${bucket.trim()}”.`,
      boundTo: bound,
    };
  }

  return {
    ok: true,
    message: bound
      ? `Connected. The key is restricted to “${bound}”, which is what we want.`
      : 'Connected. This key can reach every bucket in the account.',
    boundTo: bound,
  };
}
