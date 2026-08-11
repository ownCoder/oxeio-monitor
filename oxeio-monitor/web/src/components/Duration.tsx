import {
  formatDuration,
  formatHours,
  formatHoursAsDuration,
} from '../lib/format';

/**
 * সময়কাল দেখানো — সেকেন্ড → `7h 32m`।
 *
 * ⭐ `.num` ক্লাসটা এখানেই বসে (tabular-nums)। সরাসরি `formatDuration()`
 *    ডেকে `<span>`-এ বসালে ক্লাসটা বসাতে ভুলে যাওয়া যেত, আর তখন লাইভ
 *    বোর্ডের ঘণ্টাগুলো প্রতি ৩০ সেকেন্ডের রিফ্রেশে সামান্য লাফাত — দেখতে
 *    অস্থির, আর সংখ্যাগুলোকে অবিশ্বাস্য করে তোলে।
 *
 * ⚠️ `tone="muted"` দিন যখন সময়টা **গোনা হয়নি** (idle, locked)। নিরেট
 *    `ink` = গোনা হওয়া কাজ, ধূসর = গোনা হয়নি — এই পার্থক্যটাই ব্র্যান্ডের
 *    নিয়ম। (⚠️ "কালো" নয় — Midnight থিমে `ink` প্রায় সাদা।)
 */
export function Duration({
  seconds,
  tone = 'counted',
  className = '',
}: {
  seconds: number | null | undefined;
  tone?: 'counted' | 'muted';
  className?: string;
}) {
  const text = formatDuration(seconds);
  return (
    <span
      className={`num ${tone === 'muted' ? 'text-ink-3' : ''} ${className}`}
      title={
        seconds === null || seconds === undefined
          ? undefined
          : `${formatHours(seconds, 2)} hours`
      }
    >
      {text}
    </span>
  );
}

/**
 * দশমিক ঘণ্টা → `7h 32m`।
 *
 * ⚠️ রিপোর্টের API ঘণ্টা পাঠায় (`workedHours: 7.53`), পে-রোল ঘণ্টা
 *    **স্ট্রিং** হিসেবে (`'7.53'`) — দুটোই এখানে চলে। এই সেতুটা না থাকলে
 *    রিপোর্ট পেজে "7.53" আর লাইভ বোর্ডে "7h 32m" দেখা যেত, আর কেউ
 *    মেলাতে পারত না যে দুটো একই সংখ্যা।
 */
export function Hours({
  hours,
  tone = 'counted',
  className = '',
}: {
  hours: number | string | null | undefined;
  tone?: 'counted' | 'muted';
  className?: string;
}) {
  return (
    <span className={`num ${tone === 'muted' ? 'text-ink-3' : ''} ${className}`}>
      {formatHoursAsDuration(hours)}
    </span>
  );
}
