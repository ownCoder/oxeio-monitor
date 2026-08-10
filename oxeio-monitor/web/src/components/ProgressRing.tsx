import { pctOf } from '../lib/format';

/**
 * E02 — মাসিক অগ্রগতির রিং।
 *
 * ⭐⚠️ রিংটা **মাসিক**, দৈনিক নয় (`monthWorkedSec / monthTargetSec`)। দিনের
 *    অগ্রগতি দেখাতে ব্যবহার করবেন না — একই আকৃতি দুটো আলাদা জিনিস বোঝালে
 *    কেউ আর কোনোটাই বিশ্বাস করত না।
 *
 * ⭐ **পূর্ণ হলে রঙ বদলায়**: ১০০%-এর নিচে সরু ব্র্যান্ড-লাল (এটা ব্র্যান্ড,
 *    সতর্কতা নয়), টার্গেট ছুঁলে কালো — কালো মানে "গোনা হয়ে গেছে"। উল্টো
 *    করলে টার্গেট পূরণ করাটাই দেখতে সমস্যার মতো লাগত।
 */
export function ProgressRing({
  value,
  max,
  size = 46,
  label,
}: {
  /** যত হয়েছে (সেকেন্ড বা ঘণ্টা — একই একক হলেই হলো) */
  value: number;
  /** যত হওয়ার কথা। ⚠️ শূন্য বা অবৈধ হলে রিং খালি দেখায়, NaN নয়। */
  max: number;
  size?: number;
  /**
   * মাঝের লেখা। না দিলে শতাংশ বসে।
   * ⚠️ `null` দিলে কিছুই বসে না — ছোট রিংয়ে (< ৩৬px) লেখা পড়াই যায় না।
   */
  label?: string | null;
}) {
  const pct = pctOf(value, max);
  // ⚠️ ১০০%-এর বেশি হলেও রিং ভরাট থামে — নইলে ১৪০% হলে বৃত্তটা আবার
  //    শুরু থেকে আঁকা শুরু করত আর দেখতে ৪০%-এর মতো লাগত।
  const shown = Math.min(100, Math.max(0, pct));
  const met = pct >= 100;

  const stroke = size < 36 ? 3 : 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - shown / 100);

  const text = label === null ? null : (label ?? `${Math.round(pct)}`);

  return (
    <div
      className="relative flex-none"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`মাসিক অগ্রগতি ${Math.round(pct)} শতাংশ`}
      title={`মাসিক অগ্রগতি ${Math.round(pct)}%`}
    >
      {/* -90° ঘুরিয়ে দেওয়া, যাতে ভরাট উপর থেকে শুরু হয় */}
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-line"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-[stroke-dashoffset] duration-700 ${
            met ? 'stroke-ink' : 'stroke-brand'
          }`}
        />
      </svg>

      {text !== null && (
        <span
          className={`num absolute inset-0 grid place-items-center font-bold ${
            met ? 'text-ink' : 'text-ink-2'
          }`}
          style={{ fontSize: size < 36 ? 9 : 10.5 }}
        >
          {text}
        </span>
      )}
    </div>
  );
}

/**
 * সরু অনুভূমিক বার — যেখানে রিং বড্ড বেশি (টেবিলের সারিতে, তালিকায়)।
 * একই রঙের নিয়ম মেনে চলে।
 */
export function ProgressBar({
  value,
  max,
  className = '',
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const pct = pctOf(value, max);
  const shown = Math.min(100, Math.max(0, pct));
  const met = pct >= 100;

  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}
      role="img"
      aria-label={`${Math.round(pct)} শতাংশ`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${
          met ? 'bg-ink' : 'bg-brand'
        }`}
        style={{ width: `${shown}%` }}
      />
    </div>
  );
}
