/**
 * work policy-র নিয়মগুলোর খাঁটি অংশ — মূলত **ক্যাপচার উইন্ডো**।
 *
 * ⭐ এখানেই পণ্যের একটা কঠিন নিয়ম টাইপ নয়, কোড দিয়ে আটকানো হয়:
 * স্ক্রিনশট শুধু ০৭:০০–২৩:০০ ([ADR-011c](../../../docs/05-Options-Decisions.md))।
 * এটাই একমাত্র জায়গা যেখানে একজন মানুষ ওই উইন্ডো বদলাতে পারে, তাই
 * পাহারাটাও এখানেই।
 */

/** 'HH:MM' — ADR-011c-তে অনুমোদিত সীমা */
export const CAPTURE_EARLIEST = '07:00';
export const CAPTURE_LATEST = '23:00';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 'HH:MM' → মধ্যরাত থেকে কত মিনিট। ফরম্যাট ভুল হলে `null`। */
export function hhmmToMinutes(value: string): number | null {
  const m = HHMM.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * ঠিক থাকলে `null`, নইলে কারণটা লেখা স্ট্রিং।
 *
 * ⚠️ exception ছোড়া হয় না — তাহলে খাঁটি ফাংশনটা NestJS-এর
 * `BadRequestException`-এর সাথে বাঁধা পড়ে যেত, আর টেস্টে HTTP লেয়ার
 * টেনে আনতে হতো। কারণটা স্ট্রিং হিসেবে ফেরত দিয়ে সার্ভিস নিজে ঠিক করে
 * সেটা কোন স্ট্যাটাসে যাবে।
 */
export function captureWindowProblem(from: string, to: string): string | null {
  const start = hhmmToMinutes(from);
  const end = hhmmToMinutes(to);

  if (start === null) return `The capture window start must be in 'HH:MM' format — got "${from}"`;
  if (end === null) return `The capture window end must be in 'HH:MM' format — got "${to}"`;

  const earliest = hhmmToMinutes(CAPTURE_EARLIEST) as number;
  const latest = hhmmToMinutes(CAPTURE_LATEST) as number;

  if (start < earliest || end > latest) {
    return `Screenshot times cannot fall outside ${CAPTURE_EARLIEST}–${CAPTURE_LATEST} (ADR-011c)`;
  }

  // ⚠️ সমান হলেও নাকচ। from == to মানে শূন্য দৈর্ঘ্যের উইন্ডো — এজেন্ট
  //    তখন একটাও ছবি তুলত না, অথচ ড্যাশবোর্ডে সব ঠিকঠাক দেখাত। "কেউ
  //    স্ক্রিনশট বন্ধ করে দিয়েছে" আর "স্ক্রিনশট কাজ করছে না" — এই দুটো
  //    আলাদা করা যেত না।
  if (start >= end) {
    return 'The capture window start must be before the end';
  }

  return null;
}

/**
 * ⭐ `null` মানে "২৪ ঘণ্টা ছবি" — স্কিমার কমেন্ট তাই বলে, আর সেটাই
 * ADR-011c ভাঙে। তাই এই মডিউলের মধ্য দিয়ে কখনো `null` বসানো যায় না;
 * উইন্ডো না দিলে অনুমোদিত ডিফল্টটাই বসে।
 */
export const DEFAULT_CAPTURE_WINDOW = {
  screenshotFrom: CAPTURE_EARLIEST,
  screenshotTo: CAPTURE_LATEST,
} as const;
