/**
 * **ডিজাইনের টার্গেট — খাঁটি নিয়ম** *(২২ আগস্ট ২০২৬)*, কোনো I/O নেই।
 *
 * ⭐ গবেষকেরা রোজ ~৫০০টা Amazon T-shirt URL জমা করেন; সেখান থেকে
 * ডিজাইনারদের মধ্যে র‍্যান্ডম বণ্টন হয়, আর প্রত্যেকে একটা করে নিয়ে
 * নতুন ডিজাইন বানান।
 *
 * ⚠️⚠️ **পরিচয় ASIN, URL নয়** — আর এটাই গোটা ব্যবস্থার ভিত্তি।
 */

/**
 * ⭐⭐ **ASIN — Amazon-এর পণ্য-পরিচয়, ঠিক ১০ অক্ষর।**
 *
 * ⚠️⚠️ **একই পণ্যের URL অসংখ্য রকম হয়:**
 * ```
 * https://www.amazon.com/dp/B0DJBD22LW
 * https://www.amazon.com/Funny-Cat-Shirt/dp/B0DJBD22LW/ref=sr_1_3?keywords=cat
 * https://www.amazon.com/gp/product/B0DJBD22LW?th=1
 * ```
 * তিনটেই **এক জিনিস**। URL ধরে ডুপ্লিকেট খুঁজলে তিনটেই আলাদা হিসেবে ঢুকত,
 * আর তিনজন ডিজাইনার একই পণ্যের ডিজাইন বানাতেন — অর্থাৎ তিন দিনের কাজ
 * নষ্ট। মালিকের শর্তটাই ছিল *"asin gula jeno unique hoy"*।
 */
const ASIN_PATTERNS = [
  /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
];

/** ⚠️ খালি একটা ASIN পেস্ট করলেও চলবে — মাঝে মাঝে লোকে তাই করে */
const BARE_ASIN = /^([A-Z0-9]{10})$/i;

export type RejectReason =
  | 'not_amazon'
  | 'short_link'
  | 'no_asin'
  | 'duplicate_in_paste';

export interface ParsedTarget {
  asin: string;
  /** ইনপুটে কত নম্বর লাইনে ছিল — ভুল দেখানোর জন্য */
  line: number;
}

/**
 * ⭐⭐ **ASIN থেকে URL বানানো হয়, URL জমা রাখা হয় না** *(মালিকের নিয়ম,
 * ২২ আগস্ট: "amora jekono asin `/dp/`-এর পরে বসিয়ে দিলেই ঝামেলা শেষ")*।
 *
 * ⚠️ প্রথমে ভেবেছিলাম মূল URL-টাও রেখে দেব ("কোথা থেকে এসেছিল")। কিন্তু
 * ওটা রাখার মানে হতো **একই জিনিসের দুটো রূপ** টেবিলে — একজন `?th=1`সহ
 * পেস্ট করলে সেটাই চিরকাল দেখাত, আরেকজনেরটা `ref=sr_1_3`সহ। ⭐ ASIN
 * সব দেশে ও সব রূপে এক, তাই একটাই স্বাভাবিক ঠিকানা যথেষ্ট।
 */
export function amazonUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}

export interface RejectedLine {
  line: number;
  text: string;
  reason: RejectReason;
}

/**
 * একটা লাইন থেকে ASIN।
 *
 * ⚠️ `amzn.to`/`a.co` ছোট লিঙ্ক থেকে ASIN **বের করা যায় না** — Amazon-কে
 * জিজ্ঞেস না করে জানার উপায় নেই, আর জিজ্ঞেস করা মানে সার্ভার থেকে বাইরের
 * সাইটে কল, যেটা এই পণ্য ইচ্ছাকৃতভাবে করে না। ⭐ তাই আলাদা কারণ দেখিয়ে
 * ফেরত — "কিছু একটা ভুল" নয়, "এই লিঙ্কটা খুলে আসল URL-টা দিন"।
 */
export function asinOf(raw: string): { asin: string } | { reason: RejectReason } {
  const text = raw.trim();
  if (text.length === 0) return { reason: 'no_asin' };

  const bare = BARE_ASIN.exec(text);
  if (bare) return { asin: bare[1].toUpperCase() };

  if (/(^|\/\/)(amzn\.to|a\.co)\//i.test(text)) return { reason: 'short_link' };

  // ⚠️ যেকোনো amazon ডোমেইন (.com · .co.uk · .de) — TLD বাঁধা হয়নি,
  //    কারণ একই ASIN সব দেশেই এক
  if (!/(^|\/\/|\.)amazon\.[a-z.]{2,}\//i.test(text)) {
    return { reason: 'not_amazon' };
  }

  for (const pattern of ASIN_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { asin: match[1].toUpperCase() };
  }

  return { reason: 'no_asin' };
}

/**
 * ⭐⭐ **একবারে ৫০০টা লাইন** — গবেষকের রোজকার কাজ।
 *
 * ⚠️⚠️ **পেস্টের ভেতরের ডুপ্লিকেটও ধরা হয়** (`duplicate_in_paste`), শুধু
 * ডাটাবেসেরটা নয়। একই তালিকায় একটা ASIN দুবার থাকা খুব সাধারণ (দুটো
 * আলাদা সার্চ থেকে একই পণ্য), আর সেটা না ধরলে `createMany` নিজেই
 * থমকে যেত।
 *
 * ⚠️ ব্যর্থ লাইনগুলো **ফেলে দেওয়া হয় না, ফেরত দেওয়া হয়** — কারণসহ।
 * ৫০০টার মধ্যে ৭টা বাদ পড়লে গবেষকের জানা দরকার **কোন ৭টা**, নইলে
 * তিনি সেগুলো আবার সংগ্রহ করতে পারতেন না।
 */
export function parseBulk(text: string): {
  accepted: ParsedTarget[];
  rejected: RejectedLine[];
} {
  const accepted: ParsedTarget[] = [];
  const rejected: RejectedLine[] = [];
  const seen = new Set<string>();

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    // ⚠️ খালি লাইন নীরবে বাদ — ভুল নয়, আর ৫০০ লাইনের পেস্টে ওগুলো থাকেই
    if (raw.length === 0) continue;

    const result = asinOf(raw);

    if ('reason' in result) {
      rejected.push({ line: i + 1, text: raw, reason: result.reason });
      continue;
    }

    if (seen.has(result.asin)) {
      rejected.push({ line: i + 1, text: raw, reason: 'duplicate_in_paste' });
      continue;
    }

    seen.add(result.asin);
    accepted.push({ asin: result.asin, line: i + 1 });
  }

  return { accepted, rejected };
}

/**
 * ⭐⭐ **নতুন সিরিয়াল শুরু হয় ১০ লাখ থেকে — আর এটা মাপা সংখ্যা।**
 *
 * ⚠️⚠️ ডিজাইনাররা ফাইলের নামে যে নম্বর বসান সেটা আগে থেকেই আছে
 * (`37933-…T-Shirt.ai`)। মাঠে গোনা হয়েছে: **৭৮% পাঁচ অঙ্কের**
 * (১০,০০৮–৯৩,০৪১), আর সবচেয়ে বড় সংখ্যাটা **৯,৭৩,০৬৫** (ছয় অঙ্ক,
 * সম্ভবত স্টক ফাইলের আইডি)। সাত অঙ্কের একটাও নেই।
 *
 * ⭐ তাই ১০,০০,০০০ থেকে শুরু করলে **সংঘর্ষের সুযোগ কার্যত শূন্য**, আর
 * পুরোনো কোনো ফাইল ভুল করে "শেষ হয়ে গেছে" বলে ধরা পড়বে না।
 */
export const JOB_NUMBER_START = 1_000_000;

/**
 * ⚠️ একজন ডিজাইনারের হাতে একবারে কতগুলো টার্গেট থাকবে।
 *
 * ⭐ তাঁর **দৈনিক টার্গেটের চেয়ে বেশি** (মালিকের বাছাই, ২২ আগস্ট): যাঁর
 * টার্গেট ২৫, তিনিও ৩০টা পান। বেছে নেওয়ার জায়গা থাকে, আর দু-একটা পছন্দ
 * না হলেও কাজ আটকায় না। ⚠️ ঠিক টার্গেটের সমান দিলে "বেছে নেওয়া" কথাটার
 * কোনো মানেই থাকত না।
 */
export const POOL_PER_DESIGNER = 30;

export interface DesignerNeed {
  employeeId: number;
  /** এখন হাতে কতগুলো `assigned` টার্গেট আছে */
  openCount: number;
}

/**
 * ⭐⭐ **কাকে কতগুলো দিতে হবে** — খাঁটি অঙ্ক, র‍্যান্ডম বাছাইয়ের আগে।
 *
 * ⚠️ হাতে থাকা টার্গেট **বাদ দিয়ে** হিসাব: রোজ ৩০টা করে দিলে সপ্তাহখানেকে
 * কারো হাতে দুশো জমে যেত, আর পুল ফুরিয়ে যেত অকারণে।
 *
 * ⚠️ পুলে যথেষ্ট না থাকলে **যতটা আছে ততটাই**, আর কে আগে পাবে সেটা
 * `needs`-এর ক্রম অনুযায়ী — কলার ওই ক্রম কর্মী-কোড ধরে দেয়, তাই
 * ঘাটতির দিনেও বণ্টন অনুমেয় থাকে, র‍্যান্ডম নয়।
 */
export function allocationSizes(
  needs: readonly DesignerNeed[],
  poolSize: number,
  perDesigner = POOL_PER_DESIGNER,
): Map<number, number> {
  const out = new Map<number, number>();
  let left = poolSize;

  for (const need of needs) {
    if (left <= 0) break;

    const want = Math.max(0, perDesigner - need.openCount);
    if (want === 0) continue;

    const give = Math.min(want, left);
    out.set(need.employeeId, give);
    left -= give;
  }

  return out;
}
