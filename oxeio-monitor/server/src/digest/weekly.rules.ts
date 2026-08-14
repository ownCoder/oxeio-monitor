import { workDateOf } from '../agent/util/dhaka-time';
import { addDays, toIsoDate } from '../reports/reports.range';
import type { AttendanceRow, SummaryRow } from '../reports/reports.types';

/**
 * **R3** — সাপ্তাহিক সারাংশের সব হিসাব ও টেলিগ্রামের লেখা। খাঁটি ফাংশন, কোনো I/O নেই।
 *
 * ⭐ **এখানে কোনো নতুন সংজ্ঞা নেই** — `digest.math.ts`-এর মতোই। ঘণ্টা, টার্গেট,
 * ছুটি, কর্মদিবস সবকিছু আসে `ReportsService`-এর F01/F02 সারি থেকে। নিজে
 * `daily_summary` পড়ে সপ্তাহের টার্গেট বানালে ছুটির ক্যালেন্ডারের **চতুর্থ**
 * একটা বাস্তবায়ন দাঁড়াত, আর একদিন টেলিগ্রাম বলত ৩৮ ঘণ্টা টার্গেট, রিপোর্ট
 * বলত ৪০ — তখন দুটোর কোনোটাই আর বিশ্বাসযোগ্য থাকত না।
 *
 * ⚠️⚠️ **"রেকর্ড নেই" আর "শূন্য কাজ" এক জিনিস নয়।** এই ফাইলের সবচেয়ে জরুরি
 * নিয়ম। যে কর্মীর সারা সপ্তাহে একটাও পর্যবেক্ষণ নেই তাঁকে "০ ঘণ্টা কাজ
 * করেছেন" বলে র‍্যাঙ্কিংয়ে বসানো মানে অনুপস্থিত পর্যবেক্ষণকে ব্যর্থতা বলে
 * গোনা — এজেন্ট বন্ধ ছিল, নাকি PC বন্ধ ছিল, নাকি সত্যিই কাজ হয়নি, সেটা এই
 * ফাইল জানে না। তাই ওঁরা "পিছিয়ে" তালিকায় যান না, আলাদা "Not observed" ঘরে
 * যান, আর কারণটা বার্তার পাদটীকায় স্পষ্ট করে লেখা থাকে।
 *
 * ⚠️⚠️ **"সারি নেই" আর "সারি আছে কিন্তু ০ ঘণ্টা" — এ দুটোও আলাদা।** F01/F02
 * দুটোকেই এক করে "no activity" বলে (`reports.service.ts`-এ
 * `status: worked > 0 ? 'worked' : 'no_activity'`), কিন্তু পার্থক্যটা DB-তে
 * **আছে**: `refreshDate()` প্রতিদিন **প্রতিটি সক্রিয় কর্মীর** সারি লেখে,
 * সে কাজ করুক বা না করুক। তাই সারি থাকা = ওই দিনটা মাপা হয়েছে। দুটো এক
 * করে ফেললে ভুলটা **দুই দিকেই** যেত: এজেন্ট দিব্যি চলছে অথচ কেউ সারা
 * সপ্তাহে ০ ঘণ্টা — তাঁকেও "এজেন্ট বন্ধ ছিল" বলা হতো, আর সত্যিকারের
 * অনুপস্থিতি কোনোদিন "Behind" তালিকায় উঠত না। সেজন্যই `observed`
 * (`WeeklySource`) — সংখ্যা নয়, নিছক "ওই দিনটা আদৌ দেখা হয়েছিল কি না"।
 *
 * ⚠️⚠️ **প্রত্যাশা গোনা শুরু হয় সার্ভার যেদিন থেকে আসলেই দেখেছে।** এই
 * ইনস্টলেশনে ট্র্যাকিং বসেছে ১৩ আগস্ট ২০২৬, আর ডিফল্ট শিডিউল শুক্রবার
 * সন্ধ্যা ৬টা — অর্থাৎ **প্রথম** বার্তার উইন্ডো ৮–১৪ আগস্ট, যার ৮–১২
 * কেউ দেখেনি। ওই দিনগুলোর টার্গেট প্রত্যাশায় ধরলে প্রথম বার্তাটাই নাম
 * ধরে ধরে বলত "৩২ ঘণ্টা পিছিয়ে" — এমন দিনের জন্য যখন মাপার যন্ত্রটাই
 * বসেনি, আর টেলিগ্রামের বার্তা একবার গেলে ফেরত নেওয়া যায় না। তাই যে দিন
 * দেখা হয়নি সেটা প্রত্যাশাতেও নেই, ঘাটতিতেও নেই।
 *
 * ⭐ আর সমন্বয়টা **বার্তায় লেখা থাকে** (`counted from …`)। না লিখলে
 * সংখ্যাটা ঠিক হতো, কিন্তু কেন ছোট সেটা অদৃশ্য অনুমান হয়ে যেত — আর পাঠক
 * নিজের মাথায় পুরো সপ্তাহ ধরে হিসাব মেলাতে গিয়ে আবার সেই ভুলেই পৌঁছাতেন।
 *
 * ⭐ নিয়মটা নতুন নয় — মাসিক পাতায় `summary.math.ts`-এর `elapsedWindow()`
 * ঠিক এই কাজটাই করে: max(জানালার শুরু, `joinedOn`, ট্র্যাকিং-শুরু)। এখানে
 * সীমাটা **কর্মীপ্রতি**, কারণ `daily_summary`-র সারিও কর্মীপ্রতি লেখা হয়;
 * ফলে এই জানালা মাসিক পাতার চেয়ে কখনো **আগে** শুরু হয় না, কেবল সমান বা
 * পরে — দুই পাতা বিপরীত কথা বলার সুযোগ নেই (G88)।
 *
 * ⚠️ **এই বার্তায় কখনো স্ক্রিনশট, অ্যাপের নাম বা ডোমেইন যায় না** — শুধু
 * ঘণ্টা ও নাম। টেলিগ্রামের বার্তা ওদের সার্ভারে জমে থাকে আর ফোনের লক
 * স্ক্রিনে ভেসে ওঠে; কারো ব্রাউজিং ওখানে পাঠানো মানে ড্যাশবোর্ডের role-এর
 * দেয়ালটা কার্যত তুলে দেওয়া। এই ফাইলের কোনো টাইপে ডোমেইন বা ফাইলের নামের
 * জায়গাই নেই — সেটা দুর্ঘটনা নয়।
 *
 * ⚠️ **টাকার কোনো কথা নেই** — বেতন owner-only ও audit করা (ADR-023)।
 */

/** ঘণ্টা দুই দশমিকে — বার্তার সব সংখ্যা একই চেহারার */
function h(hours: number): string {
  return hours.toFixed(2);
}

/** দুই দশমিকে গোল করা (রিপোর্টের ঘণ্টাগুলো এমনিতেই দুই দশমিকে) */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── উইন্ডো ও শিডিউল ─────────────────────────────────────────────────────────

/**
 * সারাংশ কত দিনের।
 *
 * ⭐ ইচ্ছাকৃতভাবে **"শেষ ৭ দিন"**, ক্যালেন্ডার-সপ্তাহ নয়। সপ্তাহের সীমানা
 * এই প্রকল্পে কর্মীপ্রতি আলাদা (`weekStartIsoDay()` — সাপ্তাহিক ছুটির পরের
 * দিন), তাই "গত সপ্তাহ" বলে একটাই তারিখজোড়া বেছে নিলে যাঁদের ছুটি অন্য
 * দিনে তাঁদের কর্মসপ্তাহ মাঝখান থেকে কেটে যেত। শেষ ৭ দিন সবার জন্য সমান
 * দৈর্ঘ্যের, আর বার্তার মাথায় তারিখ দুটো লেখাই থাকে — পাঠক ঠিক কী দেখছেন
 * তা নিয়ে ধোঁয়াশা থাকে না।
 */
export const WEEKLY_WINDOW_DAYS = 7;

/** ⚠️ ডিফল্ট শুক্রবার (ISO ৫) — বাংলাদেশে সাপ্তাহিক ছুটির দিন, সপ্তাহের শেষ */
export const WEEKLY_DIGEST_DEFAULT_DAY = 5;
/** সন্ধ্যা ৬টা (ঢাকা) — দৈনিক ডাইজেস্টের ৬:৩০-এর ঠিক আগে, যাতে দুটো একসাথে না আসে */
export const WEEKLY_DIGEST_DEFAULT_HOUR = 18;

export interface WeeklyWindow {
  /** উইন্ডোর প্রথম দিন, YYYY-MM-DD (ঢাকা) */
  from: string;
  /** উইন্ডোর শেষ দিন = আজ */
  to: string;
  days: number;
}

/**
 * `now` ঢাকার যে দিনে পড়ে, সেই দিনসহ পেছনের ৭ দিন।
 *
 * ⚠️ "আজ" মানে **ঢাকার** আজ। সার্ভার UTC-তে চলে; শুক্রবার সন্ধ্যা ৬টায়
 * `now` UTC-তে তখনো দুপুর, তাই তারিখটা মিলে যেত — কিন্তু কেউ রাত ১১টায়
 * হাতে চালালে UTC-তে তখন পরদিন, আর উইন্ডোটা পুরো একদিন সরে যেত।
 */
export function weeklyWindow(now: Date): WeeklyWindow {
  const today = workDateOf(now);
  return {
    from: toIsoDate(addDays(today, -(WEEKLY_WINDOW_DAYS - 1))),
    to: toIsoDate(today),
    days: WEEKLY_WINDOW_DAYS,
  };
}

export interface WeeklySchedule {
  /** ISO দিন — ১ = সোম … ৭ = রবি (`weekly_off_day` কলামের মতোই) */
  isoDay: number;
  /** ০–২৩, ঢাকার ঘণ্টা */
  hour: number;
  /** `@Cron`-এ যা বসবে — ৬ ঘরের ছক: সেকেন্ড মিনিট ঘণ্টা দিন মাস বার */
  expression: string;
  /** যে চলকগুলো পড়া যায়নি — জব চালুর সময় লগে ওঠে, নীরবে ডিফল্টে নামে না */
  ignored: string[];
}

function intIn(raw: string | undefined, min: number, max: number): number | null {
  const text = (raw ?? '').trim();
  if (text.length === 0) return null;
  // ⚠️ `parseInt` নয় — "18abc" কে ১৮ ধরে নিত, আর টাইপোটা কোনোদিন ধরা পড়ত না
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

/**
 * `WEEKLY_DIGEST_DAY` / `WEEKLY_DIGEST_HOUR` → cron expression।
 *
 * ⚠️ **ISO দিন আর cron-এর বার এক নয়।** cron-এ রবিবার ০, কিন্তু ISO-তে ৭
 * (আর এই রিপোর `weekly_off_day` সহ সব জায়গায় ISO ব্যবহার করে)। `% 7` না
 * করলে `WEEKLY_DIGEST_DAY=7` cron-এ "৭" হয়ে যেত — node-cron ওটাকেও রবিবার
 * ধরে, কিন্তু নির্ভর করার মতো নয়; আর ভুলটা ধরা পড়ত কেবল সাত দিন পর, যখন
 * বার্তাটা আসত না।
 *
 * ⚠️ ভুল মান পেলে **ক্র্যাশ নয়, ডিফল্ট + `ignored`** — একটা টাইপোর দাম
 * "সার্ভার ওঠে না" হতে পারে না। কিন্তু চুপ করেও থাকা যায় না, নইলে মালিক
 * ভাবতেন সোমবার সেট করা আছে অথচ বার্তা আসত শুক্রবার।
 */
export function weeklyScheduleOf(
  dayRaw?: string,
  hourRaw?: string,
): WeeklySchedule {
  const ignored: string[] = [];

  const day = intIn(dayRaw, 1, 7);
  if (day === null && (dayRaw ?? '').trim().length > 0) {
    ignored.push(`WEEKLY_DIGEST_DAY must be 1..7 (Mon..Sun), got "${dayRaw}"`);
  }

  const hour = intIn(hourRaw, 0, 23);
  if (hour === null && (hourRaw ?? '').trim().length > 0) {
    ignored.push(`WEEKLY_DIGEST_HOUR must be 0..23, got "${hourRaw}"`);
  }

  const isoDay = day ?? WEEKLY_DIGEST_DEFAULT_DAY;
  const atHour = hour ?? WEEKLY_DIGEST_DEFAULT_HOUR;

  return {
    isoDay,
    hour: atHour,
    expression: `0 0 ${atHour} * * ${isoDay % 7}`,
    ignored,
  };
}

// ── কোথায় পাঠানো নিরাপদ ─────────────────────────────────────────────────────

/**
 * ⭐ **ব্যক্তিগত চ্যাটের id কি না** — টেলিগ্রামের নিজের নিয়মেই বোঝা যায়।
 *
 * ব্যক্তিগত চ্যাটের id সবসময় **ধনাত্মক পূর্ণসংখ্যা** (ওটা user id-ই)।
 * গ্রুপ, সুপারগ্রুপ ও চ্যানেলের id **ঋণাত্মক** (`-100…`), আর `@name` কেবল
 * প্রকাশ্য চ্যানেল/সুপারগ্রুপেরই হয় — বট কোনো ব্যক্তিগত চ্যাটকে `@name`
 * দিয়ে ডাকতে পারে না। তাই "শুধু অঙ্ক" = "ব্যক্তিগত চ্যাট"।
 *
 * ⚠️ উল্টো দিকে অজানা কিছু (`abc`, `+880…`) এখানে **ব্যক্তিগত নয়** ধরা
 *    হয়, কারণ প্রশ্নটা "এটা কি গ্রুপ?" নয় — "এটা যে গ্রুপ **নয়** তা কি
 *    আমরা জানি?"। জানি না মানে জানি না, আর তখন নাম-ধরে-র‍্যাঙ্কিং পাঠানোর
 *    ঝুঁকি নেওয়ার কোনো কারণ নেই (নিয়ম ২: "জানি না"-কে "শূন্য" বলা নিষেধ)।
 */
export function isPrivateChatId(rawChatId: string): boolean {
  return /^\d+$/.test(rawChatId.trim());
}

/** `weeklyGateOf()`-এর সিদ্ধান্ত — পাঠানো হবে কি না, আর না হলে কেন */
export interface WeeklyGate {
  send: boolean;
  /** ⚠️ `send === false` হলে **সবসময়** থাকে, নইলে `null` */
  blockedBecause: string | null;
}

/**
 * ⚠️ যে চলকটা লিখলে মালিক সজ্ঞানে গ্রুপেও পাঠাতে পারেন।
 * ⭐ `.env.example` **ও** `docker-compose.yml` — দুটোতেই আছে, একটাতে নয়।
 */
export const WEEKLY_ALLOW_GROUP_ENV = 'WEEKLY_DIGEST_ALLOW_GROUP';

/**
 * ⭐⭐ **সাপ্তাহিক সারাংশ এই চ্যাটে যেতে পারে কি না।**
 *
 * ⚠️⚠️ চ্যাট আইডিটা **অ্যালার্টের সাথে ভাগ করা** (`TELEGRAM_CHAT_ID`)।
 * অ্যালার্টে যায় কেবল হোস্টনেম ও অ্যালার্টের ধরন — দলের গ্রুপে ওটা
 * তুলনায় নিরীহ, তাই অনেকেই ওখানে দলের গ্রুপ বসিয়ে রাখেন। কিন্তু সাপ্তাহিক
 * সারাংশ **নাম ধরে ধরে বলে কে পিছিয়ে**; একই চ্যাটে সেটা চলে গেলে প্রথম
 * শুক্রবারেই সাপ্তাহিক প্রকাশ্য অপমান, আর **টেলিগ্রামের বার্তা ফেরত নেওয়া
 * যায় না**। তিন জায়গায় "কর্মীদের গ্রুপে নয়" লেখা ছিল, কোথাও প্রহরী ছিল না
 * — এটাই সেই প্রহরী।
 *
 * ⭐ **নীরব বাধা নয়, সচেতন সিদ্ধান্ত।** মালিক সত্যিই গ্রুপে চাইলে
 * `WEEKLY_DIGEST_ALLOW_GROUP=true` লিখে পারবেন; পথটা খোলা, শুধু দুর্ঘটনাটা
 * বন্ধ।
 *
 * ⚠️ **অ্যালার্ট এই প্রহরীর আওতায় নয়** — এই ফাংশন কেবল সাপ্তাহিক সারাংশের
 * পথে বসে (`WeeklyDigestService`)। `TelegramChannel.runOnce()` আগের মতোই
 * চলে, কারণ সেখানে নাম যায় না।
 *
 * ⚠️ chat id **খালি** হলে এখানে কোনো সিদ্ধান্ত নেওয়া হয় না (`send: true`)।
 * খালি মানে টেলিগ্রাম আদৌ কনফিগার করা হয়নি, আর সেই কথাটা বলার একমাত্র
 * জায়গা `TelegramChannel` (`not_configured`)। এখানে আটকালে কারণটা লগে
 * ভুল লেখা হতো — "গ্রুপ মনে হচ্ছে", অথচ আসলে কিছুই বসানো হয়নি।
 */
export function weeklyGateOf(
  rawChatId: string | undefined,
  rawAllowGroup: string | undefined,
): WeeklyGate {
  const chatId = (rawChatId ?? '').trim();

  // ⚠️ কনফিগারই করা হয়নি — সিদ্ধান্তটা চ্যানেলের, এই ফাংশনের নয়
  if (chatId.length === 0) return { send: true, blockedBecause: null };

  // ⭐ `alerts.mailer.ts`-এর `SMTP_SECURE` ঠিক এভাবেই পড়া হয় — একই ছাঁদ,
  //    নইলে একই রিপোতে দুরকম "true" থাকত
  if ((rawAllowGroup ?? '').trim().toLowerCase() === 'true') {
    return { send: true, blockedBecause: null };
  }

  if (isPrivateChatId(chatId)) return { send: true, blockedBecause: null };

  return {
    send: false,
    /**
     * ⚠️ লগ লাইনে **chat id লেখা হয় না** — ওটা হাতে পেলে (বট টোকেনসহ)
     *    যে-কেউ ওই গ্রুপে পাঠাতে পারে, আর `TelegramChannel` ঠিক এই কারণেই
     *    টোকেন ছেঁকে ফেলে। কী করতে হবে সেটা বলতে id-টা লাগেও না।
     */
    blockedBecause:
      'TELEGRAM_CHAT_ID is not a private chat id, so this could be a staff ' +
      'group. The weekly summary names who is behind and a Telegram message ' +
      'cannot be taken back, so it was not sent. Either point ' +
      "TELEGRAM_CHAT_ID at the owner's own chat (a positive numeric id), or " +
      `set ${WEEKLY_ALLOW_GROUP_ENV}=true to send it to that chat on purpose. ` +
      'Alerts are unaffected — they carry only hostnames and alert types.',
  };
}

// ── সপ্তাহের সারি ───────────────────────────────────────────────────────────

/**
 * কর্মীর অবস্থা।
 *
 * ⚠️ `no_records` কোনো ব্যর্থতা নয়, **অজ্ঞতা** — সার্ভার ওই কর্মীর একটা
 * দিনও দেখেনি। যিনি দেখা গেছেন অথচ কাজ করেননি তিনি এখানে আসেন **না**;
 * তিনি অঙ্ক অনুযায়ী `behind`, আর সেটাই সৎ। দুটো এক করে ফেলাই ছিল আগের
 * বাগ (ফাইলের মাথার নোট দেখুন)।
 */
export type WeeklyStanding = 'on_track' | 'behind' | 'no_records' | 'off';

export interface WeeklyRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  /** উইন্ডোর মোট `credited` — কাজ + owner-এর সংশোধন */
  creditedHours: number;
  /** উইন্ডোর মোট টার্গেট, আজকের দিনটাসহ */
  targetHours: number;
  /**
   * ⭐ **দেখা হয়েছে এমন দিনগুলোতে, গতকাল পর্যন্ত** যত ঘণ্টা হওয়ার কথা ছিল।
   *
   * দুটো আলাদা কারণে দিন বাদ পড়ে, আর দুটোই ইচ্ছাকৃত —
   *
   * ১· **আজকের দিন।** দৈনিক ডাইজেস্টের ঠিক একই সিদ্ধান্ত, একই কারণে
   *    (`digest.math.ts`-এর `expectedHours`): জব চলে সন্ধ্যা ৬টায়, দিনটা
   *    তখনো শেষ হয়নি। আজকের পুরো টার্গেট প্রত্যাশায় ধরলে **প্রতি সপ্তাহে
   *    প্রায় সবাই** "পিছিয়ে" তালিকায় থাকতেন, আর তালিকাটা দু-সপ্তাহেই পড়া
   *    বন্ধ হয়ে যেত। হিসাবটা তাই উদার — আজকের কাজ পুরো গোনা হয়, দাবি নয়।
   *
   * ২· ⚠️⚠️ **যে দিন সার্ভার দেখেইনি।** ট্র্যাকিং বসার আগের দিন, কিংবা
   *    সার্ভার বন্ধ থাকা দিন — ওই দিনের `daily_summary` সারিই নেই। ওদের
   *    টার্গেট প্রত্যাশায় ধরা মানে না-জানাকে ঘাটতি বলে গোনা, আর প্রথম
   *    সাপ্তাহিক বার্তাটাই তখন নাম ধরে ধরে মিথ্যে বলত (ফাইলের মাথা দেখুন)।
   */
  expectedHours: number;
  /** `creditedHours − expectedHours`; ঋণাত্মক = পিছিয়ে */
  paceHours: number;
  /** উইন্ডোর ভেতরে কর্মদিবস কয়টি (যোগ/ছাড়ার তারিখ ও ছুটি বাদ দিয়ে) */
  workdays: number;
  /** যতদিনে কাজ **রেকর্ড হয়েছে** */
  daysWithWork: number;
  /**
   * উইন্ডোর যতগুলো দিন তিনি কর্মরত ছিলেন (কর্মদিবস নয় — ছুটির দিনও গোনা)।
   * ⭐ `observedDays`-এর হর; শুধু একটার সংখ্যা দেখালে ভগ্নাংশটা বানানো যেত না।
   */
  windowDays: number;
  /** ওই দিনগুলোর কতটা সার্ভার আসলেই দেখেছে (`daily_summary` সারি আছে) */
  observedDays: number;
  /** `windowDays − observedDays` — এই দিনগুলো প্রত্যাশা থেকেও বাদ */
  unobservedDays: number;
  /**
   * প্রত্যাশা কোন দিন থেকে গোনা শুরু হলো — দেখা হয়েছে এমন **প্রথম** দিন
   * (আজকের দিনটা বাদে)। `null` = গোনার মতো একটা দিনও নেই।
   *
   * ⭐ বার্তায় এটা ছাপা হয় যখন উইন্ডোর শুরুর চেয়ে পরে — নইলে ছোট
   * `expectedHours` দেখে পাঠক ভাবতেন হিসাবে ভুল আছে।
   */
  countedFrom: string | null;
  /**
   * ⚠️ সপ্তাহে অন্তত একটা পর্যবেক্ষণ আছে কি না।
   *
   * ⭐ প্রধান শর্ত `observedDays > 0` — অর্থাৎ ওই দিনের সারি লেখা হয়েছিল,
   * ঘণ্টা শূন্য হোক বা না হোক। আগে শর্তটা ছিল "ঘণ্টা আছে কি না", ফলে
   * এজেন্ট চালু থাকা অবস্থায় সত্যিই কাজ না করা কর্মীও "রেকর্ড নেই" ঘরে
   * চলে যেতেন, আর প্রকৃত অনুপস্থিতি কোনোদিন কারো চোখে পড়ত না।
   *
   * ⚠️ পাশের দুটো শর্ত (`daysWithWork`, `creditedHours`) রক্ষাকবচ, বাহুল্য
   * নয়: owner হাতে সংশোধন বসালে (`adjustment_sec`) `worked_sec` শূন্য
   * থাকে, আর `observed` তালিকাটা কোনো কারণে খালি এলে (কোয়েরি বদলে গেল,
   * পুরোনো ডেটা migrate হলো) তখনো ঘণ্টা-থাকা কর্মীকে "দেখা হয়নি" বলা যাবে
   * না — owner-এর নিজের লেখা সংখ্যাটাকেই অস্বীকার করা হতো।
   */
  recorded: boolean;
  standing: WeeklyStanding;
}

export interface Weekly {
  from: string;
  to: string;
  days: number;
  /** এমপ কোড অনুযায়ী সাজানো — রিপোর্টের সাথে একই ক্রম */
  rows: WeeklyRow[];
  /** সবচেয়ে বেশি পিছিয়ে আগে */
  behind: WeeklyRow[];
  onTrack: WeeklyRow[];
  /** ⚠️ এঁদের নিয়ে আমরা কিছুই জানি না — "শূন্য ঘণ্টা" নয় */
  noRecords: WeeklyRow[];
  /** পুরো উইন্ডোতে একটাও কর্মদিবস ছিল না (ঈদের ছুটি জাতীয়) */
  off: WeeklyRow[];
  /**
   * ⚠️ যাঁরা রিপোর্টেই ওঠেননি — `status=inactive` অথচ `left_on` খালি
   * (`reports.service.ts`)। কবে থেকে ছিলেন না তা জানা নেই, তাই তাঁদের
   * ঘণ্টা বা টার্গেট কিছুই বের করা যায় না।
   *
   * ⭐ নামগুলো বার্তায় **যায়**। রিপোর্ট ইচ্ছে করেই নাম ধরে জানায়
   * ("চুপচাপ বাদ না দিয়ে"), কিন্তু সাপ্তাহিক বার্তা `meta` ফেলে দিত — ফলে
   * ওঁরা টেলিগ্রামে অদৃশ্য হয়ে যেতেন, আর "N of M staff" পড়ে মালিক ভাবতেন
   * দলটা এই M জনই। যে ভুল সংশোধন করার একমাত্র উপায় ছিল কারো হঠাৎ মনে পড়া।
   */
  excludedEmployees: string[];
  totals: {
    employees: number;
    /** যাঁদের ব্যাপারে অন্তত কিছু জানা আছে */
    withData: number;
    /** ⚠️ "দলের মোট" নয় — **রেকর্ড হওয়া** মোট। তথ্য না থাকলে যোগ হয় না। */
    hoursRecorded: number;
    /** যতজনের অন্তত একটা দিন দেখাই হয়নি — বার্তার সতর্কবাক্যটা এর উপরই বসে */
    withGaps: number;
    /** রিপোর্ট থেকে বাদ পড়া কর্মীর সংখ্যা */
    excluded: number;
  };
}

/**
 * "ওই কর্মীর ওই দিনটা সার্ভার দেখেছিল" — `daily_summary`-তে সারি আছে।
 *
 * ⭐ ইচ্ছাকৃতভাবে **কোনো সংখ্যা নেই**, কেবল অস্তিত্ব। ঘণ্টা, টার্গেট,
 * কর্মদিবস সবই আগের মতোই F01/F02 থেকে আসে (ফাইলের মাথার নোট); এখানে যোগ
 * হচ্ছে শুধু সেই একটা তথ্য যেটা রিপোর্টের ধরনে প্রকাশ করার জায়গাই নেই।
 */
export interface ObservedDay {
  employeeId: number;
  /** YYYY-MM-DD (ঢাকা) */
  date: string;
}

export interface WeeklySource {
  from: string;
  to: string;
  days: number;
  /**
   * F01, **পুরো উইন্ডোর** সারি — কর্মীপ্রতি প্রতিদিন একটা।
   *
   * ⭐ দরকার পড়ে **দিনের টার্গেট** জানতে, আর সেটা দিনভিত্তিক ছাড়া হয় না:
   * প্রত্যাশা থেকে বাদ যায় আজকের দিন **এবং** যে দিনগুলো দেখা হয়নি। F02
   * পুরো সপ্তাহের একটাই টার্গেট দেয়, তা থেকে "১১ আগস্টের টার্গেট" আলাদা
   * করার কোনো উপায় নেই।
   *
   * ⚠️ যোগদানের আগের বা ছেড়ে যাওয়ার পরের দিনের সারি এখানে **থাকেই না**
   * (`reports.service.ts`-এর `employedOn`) — তাই `joinedOn` নিয়ে এই ফাইলের
   * আলাদা কিছু করার নেই; ওই দিনগুলো এমনিতেই প্রত্যাশায় নেই।
   *
   * ⚠️ ঘণ্টা এখান থেকে **যোগ করা হয় না**, F02 থেকেই আসে। প্রতিদিনের
   * দুই-দশমিকে-গোল করা মান সাত দিন যোগ করলে F02-র যোগফলের সাথে দু-এক
   * শতাংশাংশ তফাত হতো, আর তখন টেলিগ্রাম ও রিপোর্ট পাতা একই সপ্তাহের জন্য
   * দুটো আলাদা সংখ্যা বলত (G88)।
   */
  daily: readonly AttendanceRow[];
  /** F02 `groupBy=week`, উইন্ডোর প্রথম দিন → আজ */
  week: readonly SummaryRow[];
  /** কোন (কর্মী, দিন) জোড়া আদৌ দেখা হয়েছে */
  observed: readonly ObservedDay[];
  /** F01/F02-র `meta.excludedEmployees` */
  excludedEmployees: readonly string[];
}

/**
 * F01 + F02 + পর্যবেক্ষণ → সপ্তাহের সারি।
 *
 * ⭐ তিনটে উৎসের কাজ তিন রকম, আর সেটা ইচ্ছাকৃত —
 *   · **F02** (`week`) দেয় ঘণ্টা, মোট টার্গেট, কর্মদিবস। বার্তায় যত সংখ্যা
 *     ছাপা হয় তার সবগুলোই এখান থেকে, তাই রিপোর্ট পাতা আর টেলিগ্রাম কখনো
 *     আলাদা কথা বলে না।
 *   · **F01** (`daily`) দেয় কেবল **দিনের টার্গেট** — প্রত্যাশা থেকে কোন
 *     দিনটা বাদ যাবে তা ঠিক করতে।
 *   · **`observed`** দেয় শুধু "ওই দিনটা আদৌ মাপা হয়েছিল কি না"।
 *
 * ⚠️ ভিত্তি **সপ্তাহের সারাংশ সারি**, আজকের অ্যাটেনডেন্স নয় — দৈনিক
 * ডাইজেস্টের উল্টো। কারণ: যিনি বুধবার চাকরি ছেড়েছেন তাঁর শনি–মঙ্গলের
 * ঘণ্টা সপ্তাহের হিসাবে থাকা **উচিত**; আজকের সারি ধরলে তিনি উধাও হয়ে
 * যেতেন আর দলের মোট ঘণ্টা নীরবে কম দেখাত।
 *
 * ⚠️ ৭ দিনের উইন্ডো এক কর্মীর জন্য **দুটো** সপ্তাহ-বালতিতে ভাগ হতে পারে —
 * কারো সাপ্তাহিক ছুটি শুক্র, কারো শনি, আর `bucketOf()` সপ্তাহের শুরু ঠিক
 * করে ছুটির পরের দিন থেকে। তাই বালতিগুলো **যোগ** করা হয়, শেষেরটা নেওয়া
 * হয় না; নিলে যাঁদের সপ্তাহ মাঝখানে ভাগ হয়েছে তাঁদের অর্ধেক ঘণ্টা হারাত।
 *
 * ⚠️ `shortfallHours` / `overtimeHours` যোগ করা হয় **না** — ওগুলো প্রতি
 * বালতিতে `max(0, …)`, আর ধনাত্মক সংখ্যা দুটো যোগ করলে ঘাটতি ও অতিরিক্ত
 * দুটোই একসাথে বাড়ত (এক বালতিতে +৫, আরেকটায় −৫ হলে ফল "৫ ঘাটতি ও ৫
 * অতিরিক্ত" — অর্থহীন)। তাই যোগফল থেকে নতুন করে হিসাব হয়।
 */
export function buildWeekly(source: WeeklySource): Weekly {
  const coverage = coverageOf(source);

  /** employeeId → জমতে থাকা যোগফল */
  const folded = new Map<
    number,
    {
      empCode: string;
      fullName: string;
      creditedHours: number;
      targetHours: number;
      workdays: number;
      daysWithWork: number;
    }
  >();

  for (const row of source.week) {
    const acc = folded.get(row.employeeId) ?? {
      empCode: row.empCode,
      fullName: row.fullName,
      creditedHours: 0,
      targetHours: 0,
      workdays: 0,
      daysWithWork: 0,
    };

    acc.creditedHours += row.creditedHours;
    acc.targetHours += row.targetHours;
    acc.workdays += row.workdays;
    acc.daysWithWork += row.daysWithWork;

    folded.set(row.employeeId, acc);
  }

  const rows: WeeklyRow[] = [...folded].map(([employeeId, acc]) => {
    const creditedHours = round2(acc.creditedHours);
    const targetHours = round2(acc.targetHours);

    const seen = coverage.get(employeeId) ?? EMPTY_COVERAGE;

    /**
     * ⚠️ **বিয়োগ, যোগ নয়।** মোট টার্গেট আসে F02 থেকে, আর তা থেকে বাদ যায়
     * কেবল না-গোনা দিনগুলোর টার্গেট। দিনগুলো যোগ করে প্রত্যাশা বানালে
     * প্রতিদিনের গোল করা মান জমে F02-র সংখ্যার সাথে মিলত না, আর "কত
     * পিছিয়ে" দুই পর্দায় দুই রকম হতো।
     *
     * ⚠️ `max(0, …)` — সব দিন বাদ পড়লে প্রত্যাশা ঋণাত্মক নয়, শূন্য। আর
     * শূন্য প্রত্যাশায় কেউ পিছিয়ে থাকতে পারেন না, যেটাই চাই: যে সপ্তাহের
     * একটা দিনও দেখা হয়নি সে সপ্তাহে কাউকে দোষ দেওয়ার ভিত্তি নেই।
     */
    const expectedHours =
      seen.windowDays > 0 && seen.countedFrom === null
        ? // ⚠️ একটাও দিন গোনা যায়নি → প্রত্যাশা **ঠিক** শূন্য, "প্রায়" শূন্য
          //    নয়। বিয়োগফলে দিনগুলোর গোল করা টার্গেট জমে ০.০২ জাতীয় একটা
          //    উচ্ছিষ্ট থেকে যেত, আর প্রথম বার্তাতেই গোটা দল "০.০২ ঘণ্টা
          //    পিছিয়ে" হয়ে বসত — সংখ্যাটা ছোট, কিন্তু বাক্যটা মিথ্যে।
          0
        : Math.max(0, round2(targetHours - seen.uncountedTarget));
    const paceHours = round2(creditedHours - expectedHours);
    const recorded =
      seen.observedDays > 0 || acc.daysWithWork > 0 || creditedHours !== 0;

    return {
      employeeId,
      empCode: acc.empCode,
      fullName: acc.fullName,
      creditedHours,
      targetHours,
      expectedHours,
      paceHours,
      workdays: acc.workdays,
      daysWithWork: acc.daysWithWork,
      windowDays: seen.windowDays,
      observedDays: seen.observedDays,
      unobservedDays: seen.windowDays - seen.observedDays,
      countedFrom: seen.countedFrom,
      recorded,
      standing: standingOf(acc.workdays, recorded, paceHours),
    };
  });

  rows.sort((a, b) => (a.empCode < b.empCode ? -1 : a.empCode > b.empCode ? 1 : 0));

  const of = (s: WeeklyStanding): WeeklyRow[] =>
    rows.filter((r) => r.standing === s);

  const behind = of('behind').sort(
    // বেশি পিছিয়ে আগে; সমান হলে কোডের ক্রমে — একই সপ্তাহের দুটো রান একই বার্তা
    (a, b) => a.paceHours - b.paceHours || (a.empCode < b.empCode ? -1 : 1),
  );

  return {
    from: source.from,
    to: source.to,
    days: source.days,
    rows,
    behind,
    onTrack: of('on_track'),
    noRecords: of('no_records'),
    off: of('off'),
    // ⚠️ নামের ক্রম রিপোর্টের মতোই রাখা হয় (`empCode asc`-এ সাজানো কর্মী
    //    তালিকা থেকেই আসে) — একই সপ্তাহে দুবার চালালে বার্তা একই হয়
    excludedEmployees: [...source.excludedEmployees],
    totals: {
      employees: rows.length,
      withData: rows.filter((r) => r.recorded).length,
      // ⚠️ যোগ হয় সব সারির — যাঁদের রেকর্ড নেই তাঁরা ০ দেন, আর সেটা ঠিকই
      //    আছে: আমরা তাঁদের **কোনো ঘণ্টা রেকর্ড করিনি**। বার্তায় পাশেই
      //    "N of M staff have data" লেখা থাকে, তাই যোগফলটা সম্পূর্ণ বলে
      //    ভুল হওয়ার সুযোগ নেই।
      hoursRecorded: round2(rows.reduce((sum, r) => sum + r.creditedHours, 0)),
      withGaps: rows.filter((r) => r.unobservedDays > 0).length,
      excluded: source.excludedEmployees.length,
    },
  };
}

/** এক কর্মীর জন্য "কতটা দেখা হয়েছে" — `coverageOf()`-এর জমার ঘর */
interface Coverage {
  /** উইন্ডোতে তাঁর কর্মকালে পড়া দিন (F01-এ যতগুলো সারি) */
  windowDays: number;
  /** তার কতগুলোর `daily_summary` সারি আছে */
  observedDays: number;
  /** প্রত্যাশা থেকে যত ঘণ্টা টার্গেট বাদ যাবে (আজ + না-দেখা দিন) */
  uncountedTarget: number;
  countedFrom: string | null;
}

/**
 * ⚠️ F01-এ সারিই না থাকলে (এমন হওয়ার কথা নয় — F02-তে সারি থাকলে F01-এও
 * থাকে) কিছুই বাদ যায় না, অর্থাৎ প্রত্যাশা = পুরো টার্গেট। ইচ্ছাকৃতভাবে
 * **আগের আচরণ**: নতুন তথ্যটা না পেলে হিসাব যেন নীরবে শিথিল হয়ে সবাইকে
 * "on track" বলে না দেয়।
 */
const EMPTY_COVERAGE: Coverage = {
  windowDays: 0,
  observedDays: 0,
  uncountedTarget: 0,
  countedFrom: null,
};

/**
 * ⭐⭐ দিনভিত্তিক পর্যবেক্ষণ → কর্মীপ্রতি জানালা।
 *
 * ⚠️ শুধু **শুরুর দিকের** না-দেখা দিন নয়, মাঝখানের ফাঁকও বাদ যায়। সার্ভার
 * বুধবার সারাদিন বন্ধ ছিল আর আগে-পরে চলেছে — ওই বুধবারটাও কেউ দেখেনি,
 * তাই তার ৮ ঘণ্টা টার্গেট চাওয়ার অধিকারও নেই। "শুরু থেকে গোনা" নিয়মটা
 * ওই কেসে ফাঁকটা নীরবে ঘাটতি বানিয়ে দিত।
 *
 * ⚠️ আজকের দিনটা **দেখা হলেও** প্রত্যাশায় ধরা হয় না (দিন শেষ হয়নি), আর
 * `countedFrom`-এও ওঠে না — নইলে ট্র্যাকিং আজ শুরু হলে বার্তা বলত
 * "counted from আজ", অথচ আজকের কোনো ঘণ্টাই আসলে চাওয়া হচ্ছে না।
 */
function coverageOf(source: WeeklySource): Map<number, Coverage> {
  const seen = new Set(
    source.observed.map((o) => `${o.employeeId}|${o.date}`),
  );

  const byEmployee = new Map<number, Coverage>();

  for (const row of source.daily) {
    const acc = byEmployee.get(row.employeeId) ?? { ...EMPTY_COVERAGE };
    acc.windowDays += 1;

    const observed = seen.has(`${row.employeeId}|${row.date}`);
    if (observed) acc.observedDays += 1;

    if (observed && row.date !== source.to) {
      // ⚠️ তুলনাটা স্ট্রিং-এ চলে কারণ YYYY-MM-DD-তে বর্ণানুক্রম = কালানুক্রম
      if (acc.countedFrom === null || row.date < acc.countedFrom) {
        acc.countedFrom = row.date;
      }
    } else {
      acc.uncountedTarget += row.targetHours;
    }

    byEmployee.set(row.employeeId, acc);
  }

  return byEmployee;
}

/**
 * ⚠️ ক্রমটা জরুরি।
 *
 * ১· **কর্মদিবসই ছিল না** (পুরো উইন্ডো ঈদের ছুটি + সাপ্তাহিক ছুটি) → `off`।
 *    এঁদের "রেকর্ড নেই" বললে ছুটির সপ্তাহে গোটা দলের নাম ওই ঘরে উঠত, আর
 *    মালিক ভাবতেন এজেন্ট সব মেশিনে মরে গেছে।
 * ২· **একটাও পর্যবেক্ষণ নেই** → `no_records`। এঁদের `paceHours` অঙ্কে
 *    ঋণাত্মক, কিন্তু ওই ঋণটা একটা **ধরে নেওয়া শূন্যের** উপর দাঁড়ানো —
 *    সেটাকে "পিছিয়ে" বলা মানে না-জানাকে ব্যর্থতা বলে গোনা।
 *    ⚠️ যাঁর সারি **আছে** অথচ ঘণ্টা ০, তিনি এখানে আসেন না — তাঁর ব্যাপারে
 *    আমরা জানি, আর জানা অনুপস্থিতি লুকিয়ে রাখলে তালিকাটার মানেই থাকে না।
 * ৩· বাকিটা সোজা অঙ্ক।
 */
function standingOf(
  workdays: number,
  recorded: boolean,
  paceHours: number,
): WeeklyStanding {
  if (workdays === 0) return 'off';
  if (!recorded) return 'no_records';
  return paceHours < -PACE_TOLERANCE_HOURS ? 'behind' : 'on_track';
}

/**
 * ⚠️ তিন মিনিটের কম ঘাটতিকে "পিছিয়ে" বলা হয় না।
 *
 * F02-র সপ্তাহ-টার্গেট আর F01-এর দিন-টার্গেট — দুটোই দুই দশমিকে গোল করা
 * (`secondsToHours`), আর প্রত্যাশা বের হয় একটা থেকে আরেকটা বিয়োগ করে।
 * দৈনিক টার্গেট পূর্ণ সংখ্যায় না মিললে (২০৮ ÷ ২৭ = ৭.৭০৩৭ঘ) সাত দিনের
 * গোল-করা জমে দুই-তিন মিনিট এদিক-ওদিক হয়। ওই কয়েক সেকেন্ডের জন্য কারো
 * নাম "Behind" তালিকায় ওঠা মানে সংখ্যাটা কাউকে অন্যায্যভাবে দোষ দেওয়া —
 * আর নাম ধরে ধরে পাঠানো বার্তা ফেরত নেওয়া যায় না।
 *
 * ⭐ সহ্যসীমা কেবল **ঘরে ফেলার** সময়; ছাপা সংখ্যাটা (`paceHours`) কখনো
 * বদলায় না, তাই কিছু লুকোনোও হয় না।
 */
const PACE_TOLERANCE_HOURS = 0.05;

// ── টেলিগ্রামের বার্তা ───────────────────────────────────────────────────────

/**
 * টেলিগ্রামের `sendMessage` একটাই বার্তায় এর বেশি নেয় না — বেশি হলে গোটা
 * কলটাই HTTP 400, অর্থাৎ **কিছুই পৌঁছায় না**।
 *
 * ⚠️ মাপটা UTF-16 code unit-এ, আর JS-এর `String.length` ঠিক সেটাই গোনে।
 * তাই `Buffer.byteLength()` ব্যবহার করা যাবে না: বাংলা অক্ষর UTF-8-এ ৩ বাইট,
 * ফলে বাইট ধরে হিসাব করলে বাংলা নামের দলে বার্তাটা তিন ভাগের এক ভাগেই
 * "সীমা ছাড়িয়েছে" ধরে নিয়ে অর্ধেক নাম কেটে দিত।
 */
export const TELEGRAM_TEXT_LIMIT = 4096;

/** নামের জন্য — লম্বা নামে এক লাইন যেন পুরো পর্দা না নেয় */
const NAME_MAX = 40;
/** ⚠️ ORG_NAME env থেকে আসে; কেউ উপন্যাস বসিয়ে দিলে বার্তার মাথাই সীমা খেয়ে ফেলত */
const ORG_MAX = 60;

/**
 * ⚠️ নাম থেকে newline ও control character ছেঁটে ফেলা হয়।
 *
 * নামগুলো admin-এর হাতে লেখা, তাই বাঁকা কিছু নেই বলে ধরে নেওয়া যায় না।
 * একটা `\n` বসলে ওই সারিটা দু-লাইন হয়ে যেত আর নিচের নামটা কার ঘণ্টা কার
 * সাথে সেটা এলোমেলো দেখাত — ছাঁটাইয়ের হিসাবও (প্রতি সারি এক লাইন) ভেঙে যেত।
 *
 * ⭐ escape করার দরকার নেই, কারণ বার্তা **প্লেইন টেক্সট** হিসেবে যায়
 * (`telegram.channel.ts`-এ `parse_mode` নেই) — Markdown হলে নামের একটা `_`
 * গোটা বার্তাটা ৪০০ করে দিত।
 */
function name(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (clean.length === 0) return '(no name)';
  return clean.length > NAME_MAX ? `${clean.slice(0, NAME_MAX - 1)}…` : clean;
}

function who(row: WeeklyRow): string {
  return `${name(row.fullName)} (${row.empCode})`;
}

function days(row: WeeklyRow): string {
  return `${row.daysWithWork}/${row.workdays} days`;
}

/** `+8.00` / `-0.25` — চিহ্নটা আলাদা করে বসে, নইলে "+-0.25" লেখা হতো */
function signed(hours: number): string {
  return hours < 0 ? `-${h(-hours)}` : `+${h(hours)}`;
}

/**
 * ⭐ প্রত্যাশার জানালা কোথায় ছোট হলো, সেটা **সারিতেই** লেখা।
 *
 * ⚠️ না লিখলে সংখ্যাটা ঠিক থাকত, কিন্তু কারণটা অদৃশ্য: পাঠক দেখতেন
 * "১৬ ঘণ্টা, ২/৬ দিন, পিছিয়ে নেই" আর নিজের মাথায় পুরো সপ্তাহ ধরে হিসাব
 * মিলিয়ে ভাবতেন যন্ত্রটা ঢিলে দিচ্ছে — অথচ আসল কথা হলো বাকি দিনগুলো
 * কেউ দেখেইনি।
 *
 * দুটো আলাদা ছবি, তাই দুটো আলাদা বাক্য —
 * ১· জানালা পরে শুরু হয়েছে (ট্র্যাকিং সদ্য বসেছে) → কোন দিন থেকে গোনা হলো।
 * ২· শুরু ঠিকই আছে, মাঝখানে ফাঁক (সার্ভার একদিন বন্ধ ছিল) → কয় দিন।
 */
function coverageNote(row: WeeklyRow, windowFrom: string): string {
  if (row.unobservedDays === 0) return '';

  if (row.countedFrom !== null && row.countedFrom > windowFrom) {
    return ` · counted from ${row.countedFrom}`;
  }

  const d = row.unobservedDays;
  return ` · ${d} day${d === 1 ? '' : 's'} not observed`;
}

/**
 * ⚠️⚠️ "দেখা হয়েছে, কাজ হয়নি" — এই কথাটা **আলাদা শব্দে** বলা হয়।
 *
 * `0.00h` লেখাটা নিজে দুটো সম্পূর্ণ আলাদা অর্থ বহন করতে পারে, আর সেটাই
 * ছিল বাগ: এজেন্ট চলছে অথচ কেউ সারা সপ্তাহে কিছু করেননি — সেটা একটা
 * **পর্যবেক্ষণ**, আর এজেন্ট বন্ধ থাকা মানে পর্যবেক্ষণের অভাব। প্রথমটা
 * পড়ে ব্যবস্থা নেওয়া যায়, দ্বিতীয়টা পড়ে কেবল এজেন্ট সারানো যায়। একই
 * শব্দে দুটো বললে মালিক ভুল কাজটা করতেন।
 */
function zeroWorkNote(row: WeeklyRow): string {
  return row.observedDays > 0 && row.creditedHours === 0
    ? ' · observed, no work recorded'
    : '';
}

interface Section {
  heading: string;
  lines: string[];
  /** যত বড় সংখ্যা, তত আগে ছাঁটা হয় */
  dropFirst: number;
}

export interface WeeklyMessage {
  text: string;
  /** ছাঁটাইয়ের ফলে কতগুলো **নাম** বাদ পড়ল — সংখ্যা কখনো বাদ পড়ে না */
  hidden: number;
}

/**
 * পুরো টেলিগ্রাম বার্তা।
 *
 * ⚠️ লেখাটা ইংরেজিতে — গোটা রিপোর দৈনিক ডাইজেস্টসহ (`digest.math.ts`) সব
 * বাইরে-যাওয়া লেখায় ইংরেজি ব্যবহার করে; মন্তব্য বাংলায়। দুটো মিশিয়ে
 * ফেললে একই মালিক দুই ভাষায় দুই রকম শব্দ পেতেন।
 *
 * ⚠️ ছাঁটাই হলেও **প্রতিটি ঘরের শিরোনামে আসল সংখ্যাটা থেকে যায়**
 * (`Behind (12)`) — বাদ পড়ে কেবল নাম। "৪ জন পিছিয়ে" দেখিয়ে আসলে ১২ জন
 * থাকা মানে সংখ্যাটা মিথ্যে বলা, আর সেটাই এই প্রকল্পে সবচেয়ে বড় অপরাধ।
 */
export function weeklyMessage(
  weekly: Weekly,
  orgName: string,
  limit: number = TELEGRAM_TEXT_LIMIT,
): WeeklyMessage {
  const org = orgName.trim().slice(0, ORG_MAX) || 'oXeio Monitoring';
  const { totals } = weekly;

  const head = [
    `${org} — Weekly summary`,
    `${weekly.from} → ${weekly.to} (Dhaka, ${weekly.days} days)`,
    '',
  ];

  /**
   * রিপোর্ট থেকে বাদ পড়াদের ঘর — ⚠️ **সবসময়** বানানো হয়, "কেউ নেই" শাখাতেও।
   *
   * পুরো দল যদি inactive-অথচ-`left_on`-খালি হয়, তখন `totals.employees` ০,
   * আর নিচের শাখাটা তখন "Nobody was on the payroll" বলে থেমে যেত — অর্থাৎ
   * ঠিক যে অবস্থায় সমস্যাটা সবচেয়ে বড়, সেখানেই একটাও নাম যেত না।
   */
  const excludedSection: Section | null =
    weekly.excludedEmployees.length === 0
      ? null
      : {
          heading: `Not in this report (${weekly.excludedEmployees.length})`,
          lines: weekly.excludedEmployees.map((n) => `  • ${name(n)}`),
          // ⚠️ নাম কাটা পড়লেও শিরোনামের সংখ্যাটা থাকে — "কতজন হারিয়ে
          //    গেছেন" সেটাই এখানে আসল খবর
          dropFirst: 3,
        };

  const excludedTail = [
    '  • "Not in this report": marked inactive with no leaving date, so there',
    '    is no way to tell which days should have counted. Fill in the leaving',
    '    date (or reactivate them) and they come back.',
  ];

  // ── কেউ নেই ──────────────────────────────────────────────────────────────
  // ⚠️ "0.00h recorded · 0 of 0 staff" লেখা যেত, কিন্তু ওটা পড়ায় যেন দল
  //    সারা সপ্তাহে কিছুই করেনি। কেউ কর্মরত না থাকা আর কেউ কাজ না করা
  //    এক জিনিস নয়।
  if (totals.employees === 0) {
    return fit(
      [...head, 'Nobody was on the payroll in this window.'],
      excludedSection === null ? [] : [excludedSection],
      excludedSection === null ? [] : ['', 'How to read this', ...excludedTail],
      limit,
    );
  }

  // ── কারো কোনো রেকর্ড নেই ─────────────────────────────────────────────────
  // ⚠️⚠️ এই শাখাটাই R3-এর মূল নিয়ম। পুরো সপ্তাহে ট্র্যাকিং বন্ধ থাকলে
  //    (এজেন্ট আপডেট আটকে গেছে, সার্ভার নতুন বসেছে, ছুটির পর কেউ PC
  //    খোলেনি) সবার ঘণ্টা শূন্য আসত — আর "দল ০.০০ ঘণ্টা কাজ করেছে" পড়ে
  //    মালিক এমন সিদ্ধান্ত নিতে পারতেন যার ভিত্তি কেবল একটা মৃত এজেন্ট।
  // ⚠️ "০ ঘণ্টা কাজ হয়েছে" নয় — "কিছুই দেখা হয়নি"। `withData` এখন সারির
  //    অস্তিত্ব মাপে, ঘণ্টা নয়; তাই এই শাখায় পৌঁছানো মানে সপ্তাহজুড়ে
  //    কারো একটা দিনেরও সারি লেখা হয়নি, অর্থাৎ মাপার যন্ত্রটাই চলেনি।
  const teamLine =
    totals.withData === 0
      ? `Team — nothing was observed for any of the ${totals.employees} staff. ` +
        'This is not the same as nobody working; see the note below.'
      : `Team — ${h(totals.hoursRecorded)}h recorded · ` +
        `${totals.withData} of ${totals.employees} staff have data`;

  /**
   * ⭐ পুরো দলের জন্য একবার — কোনো দিন দেখা না হয়ে থাকলে সেটা বার্তার
   * **মাথায়** লেখা থাকে, প্রতিটা সারির লেজে নয়। প্রথম সপ্তাহে (ট্র্যাকিং
   * সদ্য বসেছে) এটাই গোটা বার্তার সবচেয়ে জরুরি বাক্য: সংখ্যাগুলো কেন
   * ছোট, তার উত্তর।
   */
  const gapLines =
    totals.withGaps === 0
      ? []
      : [
          `Not every day was observed — ${totals.withGaps} of ${totals.employees} staff ` +
            'have days with no data at all.',
          'Those days are left out of the expected hours, so they count neither as',
          'work nor as a shortfall.',
        ];

  const sections: Section[] = [
    {
      heading: `Behind (${weekly.behind.length})`,
      lines: weekly.behind.map(
        (r) =>
          `  • ${who(r)} — ${h(r.creditedHours)}h · ` +
          `${h(Math.abs(r.paceHours))} behind · ${days(r)}` +
          zeroWorkNote(r) +
          coverageNote(r, weekly.from),
      ),
      // ⚠️ সবার শেষে ছাঁটা হয় — এটাই একমাত্র ঘর যেটা পড়ে কিছু করার থাকে
      dropFirst: 0,
    },
    {
      heading: `On track (${weekly.onTrack.length})`,
      lines: weekly.onTrack.map(
        (r) =>
          `  • ${who(r)} — ${h(r.creditedHours)}h · ` +
          `${signed(r.paceHours)} · ${days(r)}` +
          zeroWorkNote(r) +
          coverageNote(r, weekly.from),
      ),
      dropFirst: 2,
    },
    {
      // ⚠️ শিরোনামে "No records" ছিল, আর ওই শব্দটা "০ ঘণ্টা রেকর্ড হয়েছে"
      //    বলেও পড়া যেত — ঠিক যে দুটো জিনিস আলাদা করা এই ঘরের কাজ
      heading: `Not observed (${weekly.noRecords.length})`,
      // ⚠️ এখানে ঘণ্টা লেখা হয় না — লেখার মতো কিছু জানা নেই
      lines: weekly.noRecords.map((r) => `  • ${who(r)}`),
      dropFirst: 1,
    },
    {
      heading: `Off all week (${weekly.off.length})`,
      lines: weekly.off.map(
        (r) =>
          `  • ${who(r)}${r.creditedHours > 0 ? ` — ${h(r.creditedHours)}h` : ''}`,
      ),
      dropFirst: 4,
    },
    ...(excludedSection === null ? [] : [excludedSection]),
  ].filter((s) => s.lines.length > 0);

  /**
   * ⚠️ ব্যাখ্যাগুলো **শর্তসাপেক্ষ** — যে ঘরটা বার্তায় নেই তার নিয়ম পড়ানোর
   * মানে হয় না, আর প্রতিটা অক্ষর ৪০৯৬-এর কোটা থেকেই কাটে। যেটা আছে তার
   * ব্যাখ্যা কখনো বাদ যায় না, কারণ পাদটীকা ছাঁটাইয়ের বাইরে।
   */
  const tail = [
    '',
    'How to read this',
    `  • Window: the ${weekly.days} days ending today (Dhaka).`,
    '  • Hours are credited — work plus adjustments made by the owner.',
    "  • Today's target is left out, because today is not over yet.",
  ];

  if (totals.withGaps > 0) {
    tail.push(
      '  • Days the server never saw are left out of the expected hours too.',
    );
    // ⚠️ চিহ্নটার ব্যাখ্যা কেবল তখনই, যখন চিহ্নটা আসলেই বার্তায় আছে —
    //    নইলে পাঠক এমন একটা লেখা খুঁজতেন যা কোথাও নেই
    if (
      weekly.rows.some(
        (r) => coverageNote(r, weekly.from).includes('counted from'),
      )
    ) {
      tail.push('    "counted from" is the first day that did count.');
    }
  }

  if (weekly.noRecords.length > 0) {
    tail.push(
      '  • "Not observed" does NOT mean zero work. Nothing was recorded at all —',
      '    the agent may have been off. Alerts and the dashboard answer that.',
    );
  }

  if (excludedSection !== null) tail.push(...excludedTail);

  return fit([...head, teamLine, ...gapLines], sections, tail, limit);
}

/**
 * সীমার মধ্যে বসানো — শেষ দিক থেকে নাম ছেঁটে, বদলে "… and N more"।
 *
 * ⚠️ প্রতিবার পুরো বার্তাটা আবার বানানো হয়, দৈর্ঘ্য আলাদা করে হিসাব করা
 * হয় না — কারণ "… and N more" লাইনটা যোগ হলে বার্তা এক ধাপে **লম্বাও**
 * হতে পারে, আর ধাপে ধাপে দৈর্ঘ্য যোগ-বিয়োগ করতে গিয়ে ওই কেসটা ভুল হওয়া
 * সহজ। জবটা সপ্তাহে একবার চলে; সরল ও নিশ্চিতভাবে ঠিক হওয়াটাই দামি।
 */
function fit(
  head: string[],
  sections: Section[],
  tail: string[],
  limit: number,
): WeeklyMessage {
  const shown = sections.map((s) => s.lines.length);

  const render = (): string => {
    const body: string[] = [];
    for (const [i, section] of sections.entries()) {
      const hidden = section.lines.length - shown[i];
      body.push('', section.heading, ...section.lines.slice(0, shown[i]));
      if (hidden > 0) body.push(`  … and ${hidden} more`);
    }
    return [...head, ...body, ...tail].join('\n');
  };

  const order = sections
    .map((s, i) => ({ i, dropFirst: s.dropFirst }))
    .sort((a, b) => b.dropFirst - a.dropFirst)
    .map((s) => s.i);

  let text = render();
  while (text.length > limit) {
    const next = order.find((i) => shown[i] > 0);
    if (next === undefined) break;
    shown[next] -= 1;
    text = render();
  }

  const hidden = sections.reduce(
    (sum, s, i) => sum + (s.lines.length - shown[i]),
    0,
  );

  // ⚠️ শেষ রক্ষাকবচ। সব নাম ছেঁটেও যদি না কুলোয় (শিরোনাম + পাদটীকা মিলেই
  //    সীমা ছাড়িয়ে গেলে) কেটে দেওয়া ছাড়া উপায় নেই — নইলে টেলিগ্রাম গোটা
  //    বার্তাটাই ৪০০ দিয়ে ফিরিয়ে দিত আর সপ্তাহের সারাংশ কোথাও পৌঁছাত না।
  return { text: text.length > limit ? text.slice(0, limit) : text, hidden };
}
