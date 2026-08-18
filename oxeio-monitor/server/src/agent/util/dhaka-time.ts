/**
 * Asia/Dhaka = UTC+06:00, কোনো DST নেই — তাই অফসেট ধ্রুবক ধরে হিসাব করা নিরাপদ।
 *
 * ⚠️ v1-এ শুধু Asia/Dhaka সাপোর্টেড। `work_policies.timezone` কলামটা আছে ভবিষ্যতের
 *    জন্য, কিন্তু অন্য টাইমজোনে যেতে হলে এখানে একটা আসল tz লাইব্রেরি
 *    (যেমন Temporal বা luxon) বসাতে হবে — DST থাকলে এই সরল হিসাব ভাঙবে।
 */
export const DHAKA_OFFSET_MIN = 360;

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = DHAKA_OFFSET_MIN * 60 * 1000;

/**
 * কোনো instant ঢাকার সময়ে কোন তারিখে পড়ে।
 * ফেরত আসে ওই তারিখের UTC-midnight — Prisma-র `@db.Date` ঠিক এটাই চায়।
 */
export function workDateOf(instant: Date): Date {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
}

/** ওই instant-এর ঠিক পরের **স্থানীয়** মধ্যরাত, UTC instant হিসেবে (§ ২.১-ক) */
export function nextLocalMidnight(instant: Date): Date {
  const localMidnightUtc = workDateOf(instant).getTime() - OFFSET_MS;
  return new Date(localMidnightUtc + DAY_MS);
}

/**
 * ওই instant ঢাকার সময়ে কত ঘণ্টায় (০–২৩)।
 *
 * ⚠️ `getHours()` সার্ভারের টাইমজোন ধরে — সার্ভার UTC-তে চললে ঢাকার রাত
 * ২টা এখানে সন্ধ্যা ৮টা দেখাত। retention আর দিন-ক্লোজ দুটোই এই সংখ্যার
 * উপর দাঁড়ানো, তাই ভুল হলে জব ভুল সময়ে চলত।
 */
export function dhakaHourOf(instant: Date): number {
  return new Date(instant.getTime() + OFFSET_MS).getUTCHours();
}

/**
 * ঢাকার ঘড়ি, `HH:MM` — যেমন `18:30`।
 *
 * ⚠️ `dhakaHourOf`-এর মতোই একই কৌশলে (offset যোগ করে UTC পড়া), আর একই
 * কারণে: `getHours()` সার্ভারের টাইমজোন ধরত, আর কনটেইনার UTC-তে চলে।
 * ⭐ দৈনিক রিপোর্টে এটা লেখা থাকে যাতে পাঠক জানেন সংখ্যাগুলো **কোন
 * মুহূর্তের** — সন্ধ্যা ৬:৩০-এর হিসাবে অনেকেই তখনো কাজে।
 */
export function dhakaClock(instant: Date): string {
  const local = new Date(instant.getTime() + OFFSET_MS);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');

  return `${hh}:${mm}`;
}

export function sameWorkDate(a: Date, b: Date): boolean {
  return workDateOf(a).getTime() === workDateOf(b).getTime();
}

/** ফাইলের পাথ বানাতে — ঢাকার তারিখ অনুযায়ী YYYY/MM/DD */
export function dhakaPathParts(instant: Date): {
  year: string;
  month: string;
  day: string;
  hhmmss: string;
} {
  const s = new Date(instant.getTime() + OFFSET_MS);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return {
    year: String(s.getUTCFullYear()),
    month: pad(s.getUTCMonth() + 1),
    day: pad(s.getUTCDate()),
    hhmmss: `${pad(s.getUTCHours())}${pad(s.getUTCMinutes())}${pad(s.getUTCSeconds())}`,
  };
}
