/**
 * **G46 — মাউস-জিগলার / নকল ইনপুট ধরা।** খাঁটি নিয়ম, কোনো I/O নেই।
 *
 * ⚠️⚠️ **কেন এটা দরকার:** এজেন্ট idle মাপে `GetLastInputInfo` দিয়ে, আর
 * ওই API **আসল আর নকল ইনপুট আলাদা করে না**। দশ লাইনের একটা স্ক্রিপ্ট —
 * প্রতি মিনিটে `SendKeys("{F15}")` — টাইমারটা চিরকাল রিসেট করে রাখে, আর
 * পর্দায় কিচ্ছু দেখা যায় না। ফলে সারাদিন "Working"।
 *
 * ⭐⭐ **বিচারটা সার্ভারে, এজেন্টে নয় — এটাই নকশার মূল কথা।** এজেন্ট চলে
 * স্টাফের নিজের মেশিনে, তাই তাকে বিশ্বাস করা যায় না: কোড বদলানো যায়,
 * বন্ধ করা যায়, ফাইল ছোঁয়া যায়। কিন্তু **কোন ডেটা সার্ভারে পৌঁছাল**
 * সেটার আকৃতি লুকানো যায় না। তাই সন্দেহের নিয়মটা এখানে, যেখানে যাঁকে
 * নিয়ে সন্দেহ তাঁর হাত পৌঁছায় না।
 *
 * ⚠️⚠️ **low-level keyboard hook ব্যবহার করা হয়নি — ইচ্ছাকৃত।** ওটা দিয়ে
 * `LLKHF_INJECTED` দেখে নকল কীস্ট্রোক নিশ্চিতভাবে ধরা যেত, কিন্তু ওটা
 * কীলগিং-এর যন্ত্র, আর 04-Features § L-এ ওটা স্পষ্টভাবে নিষিদ্ধ। *"What
 * you typed is never recorded"* — এই প্রতিশ্রুতি ঠকবাজি ধরার জন্যও ভাঙা
 * হবে না। তাই এখানে **আচরণের আকৃতি** দেখা হয়, ইনপুটের বিষয়বস্তু নয়।
 *
 * ⚠️ এটা **অভিযোগ নয়, দেখার অনুরোধ**। মিথ্যা ইঙ্গিত সম্ভব (নিচে দেখুন),
 * তাই বার্তাগুলোতেও "এটা ঘটেছে" লেখা হয়, "ইনি ঠকাচ্ছেন" নয়।
 */

/** একটা ACTIVE খণ্ড — `activity_segments` থেকে যতটুকু লাগে */
export interface ActiveSegment {
  startedAt: Date;
  endedAt: Date;
  /** ০–১০০, না থাকলে `null` */
  inputScore: number | null;
}

/** foreground উইন্ডো — `app_usage` থেকে */
export interface WindowSpan {
  startedAt: Date;
  endedAt: Date;
  /** process + title মিলিয়ে একটা চাবি; একই চাবি = পর্দা বদলায়নি */
  key: string;
}

export interface SyntheticLimits {
  /**
   * ⚠️⚠️ **এই সংখ্যাটাই পুরো নিয়মের ভিত্তি: মানুষ থামে।**
   *
   * দুই ঘণ্টা একটানা কাজ করে কেউ একবারও ৬০ সেকেন্ড থামবেন না — চা, বাথরুম,
   * ভাবনা, কারো ডাক — এমনটা কার্যত ঘটে না। জিগলার **গাণিতিকভাবেই** থামতে
   * পারে না, কারণ সে থামলে idle হয়ে যাবে, আর তাহলে তার কোনো মানেই থাকে না।
   */
  minStretchSec: number;
  /**
   * ⚠️ ওই পুরো সময়ে সর্বোচ্চ কতগুলো আলাদা foreground উইন্ডো।
   *
   * ⭐ শুধু অ্যাপ নয়, **শিরোনামসহ** — একই Word-এ কাজ করলেও নথির নাম বদলায়,
   * ব্রাউজারে ট্যাব বদলায়। জিগলারের পর্দা একেবারে স্থির।
   */
  maxWindows: number;
  /**
   * ⚠️ `input_score`-এর সর্বোচ্চ ওঠানামা (সর্বোচ্চ − সর্বনিম্ন)।
   *
   * মানুষের হাত অসমান — কখনো ৬০, কখনো ১০০। জিগলার প্রতি মিনিটে ঠিক একবার
   * চাপে, তাই স্কোরটা **প্রায় ধ্রুবক** হয়ে যায়।
   */
  maxScoreSpread: number;
}

export const DEFAULT_SYNTHETIC_LIMITS: SyntheticLimits = {
  /**
   * ⚠️ **১৬ আগস্ট ২ ঘণ্টা → ১ ঘণ্টা।** মালিকের সিদ্ধান্ত: দেরিতে ধরা
   * পড়া মানে ততক্ষণ ভুল ঘণ্টা জমা হওয়া, আর সেটা সরাসরি টাকার ক্ষতি।
   *
   * ⚠️⚠️ দাম আছে — এক ঘণ্টা একটানা কাজ **অস্বাভাবিক নয়**, তাই মিথ্যা
   * ইঙ্গিতের ঝুঁকি বাড়ল। সেজন্যই বাকি দুটো শর্ত (একটাই উইন্ডো, সমান
   * স্কোর) শিথিল করা হয়নি — ওরাই এখন মূল ছাঁকনি।
   */
  minStretchSec: 60 * 60,
  maxWindows: 1,
  maxScoreSpread: 2,
};

export interface SyntheticFinding {
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
  windows: number;
  /** `null` — কোনো খণ্ডেই স্কোর ছিল না */
  scoreSpread: number | null;
}

/**
 * পাশাপাশি ACTIVE খণ্ডগুলো জুড়ে একটানা "স্ট্রেচ" বানানো।
 *
 * ⚠️ কয়েক সেকেন্ডের ফাঁক সহ্য করা হয় (`gapToleranceSec`) — খণ্ডগুলো
 * সেকেন্ডে গোল করা, তাই ঠিক পিঠোপিঠি বসে না। ফাঁক সহ্য না করলে প্রতিটা
 * স্ট্রেচ কয়েক মিনিটেই ভেঙে যেত, আর নিয়মটা **কোনোদিন** কাউকে ধরত না —
 * নীরবে অকেজো একটা ফিচার।
 *
 * ⚠️⚠️ কিন্তু সহনশীলতা **ছোট** রাখতে হবে। বড় করলে আসল idle বিরতিও গিলে
 * ফেলত, আর তখন সত্যিকারের মানুষও "একটানা" দেখাত।
 */
export function mergeActive(
  segments: readonly ActiveSegment[],
  gapToleranceSec = 5,
): ActiveSegment[][] {
  const sorted = [...segments].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );

  const stretches: ActiveSegment[][] = [];
  let current: ActiveSegment[] = [];

  for (const seg of sorted) {
    if (current.length === 0) {
      current = [seg];
      continue;
    }

    const prevEnd = current[current.length - 1].endedAt.getTime();
    const gapSec = (seg.startedAt.getTime() - prevEnd) / 1000;

    // ⚠️ ঋণাত্মক ফাঁক = ওভারল্যাপ (দুই ডিভাইস) — সেটাও "ভাঙেনি" ধরা হয়
    if (gapSec <= gapToleranceSec) current.push(seg);
    else {
      stretches.push(current);
      current = [seg];
    }
  }

  if (current.length > 0) stretches.push(current);
  return stretches;
}

/**
 * ওই সময়ের মধ্যে কতগুলো **আলাদা** foreground উইন্ডো দেখা গেছে।
 *
 * ⚠️ যে উইন্ডো স্ট্রেচের সাথে **একটুও** মেলে সেটাই গোনা হয় — পুরোপুরি
 * ভেতরে থাকতে হয় না। নইলে সীমানায় বসা উইন্ডোগুলো বাদ পড়ত, আর গোনাটা
 * বাস্তবের চেয়ে কম দেখাত, অর্থাৎ **নির্দোষ মানুষও সন্দেহে পড়তেন**।
 */
export function distinctWindows(
  from: Date,
  to: Date,
  usage: readonly WindowSpan[],
): number {
  const keys = new Set<string>();

  for (const u of usage) {
    if (u.endedAt <= from) continue;
    if (u.startedAt >= to) continue;
    keys.add(u.key);
  }

  return keys.size;
}

/**
 * ⚠️ স্কোর না থাকা খণ্ড বাদ যায়, আর একটাও না থাকলে `null` — শূন্য নয়।
 * শূন্য ধরলে "কোনো ওঠানামা নেই" মনে হতো, আর সেটাই সন্দেহের একটা শর্ত;
 * অর্থাৎ **তথ্যের অভাবকে প্রমাণ ধরা হতো**।
 */
export function scoreSpread(segments: readonly ActiveSegment[]): number | null {
  const scores = segments
    .map((s) => s.inputScore)
    .filter((s): s is number => s !== null);

  if (scores.length === 0) return null;
  return Math.max(...scores) - Math.min(...scores);
}

/**
 * ⭐⭐ **তিনটে শর্তই একসাথে লাগে** — আর সেটাই এই নিয়মের আসল শক্তি।
 *
 * আলাদা করে প্রতিটাই ভাঙা যায়:
 *   · শুধু দৈর্ঘ্য → ডিজাইনার দু ঘণ্টা এক ফাইলে কাজ করতে পারেন
 *   · শুধু উইন্ডো → ভিডিও দেখার সময়ও পর্দা বদলায় না
 *   · শুধু স্কোর → খুব একটানা কাজেও স্কোর সমান হতে পারে
 *
 * কিন্তু **একসাথে তিনটে** এমন একটা ছবি আঁকে যা মানুষের নয়: দু ঘণ্টা ধরে
 * একবারও না থেমে, একই উইন্ডোতে, একই ছন্দে হাত চলা।
 *
 * ⚠️ তবু নিশ্চয়তা নয় — যে জেনেশুনে এলোমেলো বিরতি আর উইন্ডো বদল যোগ করবে,
 * সে ফাঁকি দিতে পারবে। ⭐ সেটাই স্বীকার করে নেওয়া হয়েছে: লক্ষ্য "ধরা
 * অসম্ভব করা" নয়, **ফাঁকি দেওয়াটাকে যথেষ্ট কঠিন ও কষ্টসাধ্য করা**।
 */
export function findSyntheticInput(
  segments: readonly ActiveSegment[],
  usage: readonly WindowSpan[],
  limits: SyntheticLimits = DEFAULT_SYNTHETIC_LIMITS,
): SyntheticFinding[] {
  const findings: SyntheticFinding[] = [];

  for (const stretch of mergeActive(segments)) {
    const startedAt = stretch[0].startedAt;
    const endedAt = stretch[stretch.length - 1].endedAt;
    const durationSec = (endedAt.getTime() - startedAt.getTime()) / 1000;

    if (durationSec < limits.minStretchSec) continue;

    const windows = distinctWindows(startedAt, endedAt, usage);

    /**
     * ⚠️⚠️ **শূন্য মানে "জানা নেই", "বদলায়নি" নয়** — আর না-জানাকে প্রমাণ
     * ধরা যাবে না। `app_usage` না এলে (পুরোনো এজেন্ট, হারানো ব্যাচ, বা
     * কেউ ইচ্ছে করে ওই অংশটা থামিয়ে দিলে) শূন্য পাওয়া যায়, আর সেটাকে
     * "একই উইন্ডো" ধরলে **তথ্যের অভাবই অভিযোগ হয়ে দাঁড়াত**।
     *
     * ⭐ ইচ্ছে করে `app_usage` বন্ধ করে ফাঁকি দেওয়ার পথটা এতে খোলে না —
     * ওটা তখন সম্পূর্ণ আলাদা ও আরও জোরালো লক্ষণ (এজেন্টে হাত পড়েছে),
     * আর সেটা `agent_tamper` ধরে, এই নিয়ম নয়। প্রতিটা নিয়ম **একটাই**
     * প্রশ্নের উত্তর দিক।
     */
    if (windows === 0) continue;
    if (windows > limits.maxWindows) continue;

    const spread = scoreSpread(stretch);
    // ⚠️ স্কোর না জানলে সন্দেহ করা হয় না — উপরের `null`-এর যুক্তিই
    if (spread === null || spread > limits.maxScoreSpread) continue;

    findings.push({ startedAt, endedAt, durationSec, windows, scoreSpread: spread });
  }

  return findings;
}
