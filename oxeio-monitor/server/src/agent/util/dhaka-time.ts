/**
 * Asia/Dhaka = UTC+06:00, কোনো DST নেই — তাই অফসেট ধ্রুবক ধরে হিসাব করা নিরাপদ।
 *
 * ⚠️ v1-এ শুধু Asia/Dhaka সাপোর্টেড। `work_policies.timezone` কলামটা আছে ভবিষ্যতের
 *    জন্য, কিন্তু অন্য টাইমজোনে যেতে হলে এখানে একটা আসল tz লাইব্রেরি
 *    (যেমন Temporal বা luxon) বসাতে হবে — DST থাকলে এই সরল হিসাব ভাঙবে।
 *
 * Update: any zone WITHOUT DST can now be chosen with `WORK_TIMEZONE`
 * (default Asia/Dhaka). Zones with DST are still refused at startup, for the
 * reason above. The `dhaka*` names are kept so callers did not have to change.
 */

/**
 * The work-day time zone, from the `WORK_TIMEZONE` env var (IANA name).
 * Default `Asia/Dhaka`, so a deployment that sets nothing behaves exactly
 * as before.
 *
 * Read from `process.env` at import time, not through `ConfigService`: the
 * `@Cron({ timeZone })` options in `summary/scheduling.ts` are evaluated
 * when the class is defined, before Nest's DI container exists.
 *
 * Only zones WITHOUT daylight saving are accepted (see `fixedOffsetMinutes`).
 * Everything below shifts an instant by one constant offset; with DST that
 * offset would be wrong for half the year and every work date near midnight
 * would land on the wrong day, silently.
 */
export const WORK_TIMEZONE = process.env.WORK_TIMEZONE?.trim() || 'Asia/Dhaka';

/**
 * Minutes east of UTC for `timeZone` (Asia/Dhaka = 360, America/Sao_Paulo =
 * -180). Throws if the name is unknown or the zone observes DST in `year`.
 *
 * Compares 1 January with 1 July: any DST rule, northern or southern
 * hemisphere, puts those two dates on different offsets.
 */
export function fixedOffsetMinutes(
  timeZone: string,
  year = new Date().getUTCFullYear(),
): number {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
  } catch {
    throw new Error(
      `WORK_TIMEZONE="${timeZone}" is not a known IANA time zone ` +
        `(example: Asia/Dhaka, America/Sao_Paulo)`,
    );
  }

  const offsetAt = (month: number): number => {
    const name =
      format
        .formatToParts(new Date(Date.UTC(year, month, 1, 12)))
        .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    // "GMT+06:00" · "GMT-03:00" · "GMT" (UTC itself has no digits)
    const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
    if (!m) throw new Error(`Unexpected offset "${name}" for ${timeZone}`);
    if (!m[1]) return 0;
    const minutes = Number(m[2]) * 60 + Number(m[3]);
    return m[1] === '-' ? -minutes : minutes;
  };

  const january = offsetAt(0);
  if (offsetAt(6) !== january) {
    throw new Error(
      `WORK_TIMEZONE="${timeZone}" observes daylight saving time, which is ` +
        `not supported yet: every work date is computed with one fixed offset`,
    );
  }
  return january;
}

/** Minutes east of UTC for `WORK_TIMEZONE` — refuses to start on a DST zone */
export const LOCAL_OFFSET_MIN = fixedOffsetMinutes(WORK_TIMEZONE);

/**
 * The old name, kept so the many callers stay untouched. With the default
 * zone it is still 360; with another zone it is that zone's offset.
 */
export const DHAKA_OFFSET_MIN = LOCAL_OFFSET_MIN;

/** The offset as an ISO-8601 suffix: `+06:00`, `-03:00`, `+00:00` */
export const LOCAL_OFFSET_ISO = ((): string => {
  const abs = Math.abs(LOCAL_OFFSET_MIN);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${LOCAL_OFFSET_MIN < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
})();

/**
 * Short place name for human-facing text ("… (Dhaka)" in the digest).
 * `Asia/Dhaka` → `Dhaka`, `America/Sao_Paulo` → `Sao Paulo`, `UTC` → `UTC`.
 */
export const WORK_TIMEZONE_LABEL = (
  WORK_TIMEZONE.split('/').pop() ?? WORK_TIMEZONE
).replace(/_/g, ' ');

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

/**
 * ⭐⭐⭐ **ওই instant-এর ঢাকা-দিনটা যে মুহূর্তে শুরু হয়েছে** *(G166)*।
 *
 * ⚠️⚠️ <b>`workDateOf()` নয়।</b> ওটা একটা **লেবেল** — ঢাকার দিনটাকে
 * UTC-মধ্যরাত হিসেবে লেখা। ওই মানটাকে সরাসরি মুহূর্ত ধরে ব্যবহার করলে
 * সীমানাটা **৬ ঘণ্টা দেরিতে** বসে, অর্থাৎ ঢাকার ভোর ৬টায়। এই প্রকল্পে
 * এই একটা ভুলই সবচেয়ে বেশিবার হয়েছে, তাই সংখ্যাটা আর কোথাও হাতে কষা
 * হয় না — সবাই এখান থেকে নেয়।
 */
export function localMidnightOf(instant: Date): Date {
  return new Date(workDateOf(instant).getTime() - OFFSET_MS);
}

/** ওই instant-এর ঠিক পরের **স্থানীয়** মধ্যরাত, UTC instant হিসেবে (§ ২.১-ক) */
export function nextLocalMidnight(instant: Date): Date {
  return new Date(localMidnightOf(instant).getTime() + DAY_MS);
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
