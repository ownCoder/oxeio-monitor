import { pctOf } from '../lib/format';

/**
 * E02 — অগ্রগতির রিং।
 *
 * ⭐⚠️ রিংটা **কীসের** অগ্রগতি সেটা কলার ঠিক করে, এই কম্পোনেন্ট নয়। আগে
 *    aria-label-এ "মাসিক অগ্রগতি" হার্ডকোড করা ছিল; লাইভ বোর্ড রিংটাকে
 *    **আজকের** টার্গেটে সরানোর পর ওই লেখাটা নীরবে মিথ্যা বলত — পর্দায়
 *    দিনের হিসাব, অথচ স্ক্রিন রিডার বলত "মাসিক"। তাই `ariaLabel`।
 *
 * ⚠️ যে রিং দিনের টার্গেট দেখায় আর যেটা মাসের, দুটোকে **একই পাতায় একই
 *    আকারে** বসাবেন না — একই আকৃতি দুটো আলাদা জিনিস বোঝালে কেউ আর
 *    কোনোটাই বিশ্বাস করত না।
 *
 * ⭐ **পূর্ণ হলে রঙ বদলায়**: ১০০%-এর নিচে নিরপেক্ষ `ink`, টার্গেট ছুঁলে
 *    **সবুজ** (`ok`) — সবুজ মানে "হয়ে গেছে"। উল্টো করলে টার্গেট পূরণ
 *    করাটাই দেখতে সমস্যার মতো লাগত।
 *
 * ⚠️⚠️ চলতি অবস্থাটা আগে **ব্র্যান্ড-লাল** ছিল, আর সেটাই Midnight-এ ধরা
 *    পড়া আসল ভুল: `--color-attention` আর `--color-brand` **হুবহু একই
 *    হেক্স**। অর্থাৎ "সরু লাল = ব্র্যান্ড, ভরাট লাল = সতর্কতা" পার্থক্যটা
 *    রং দেখে বোঝার উপায় নেই, শুধু ওজন দেখে — আর ৪px-এর ভরাট চাপ একটা
 *    বৃত্তচাপ ওজনে "সতর্কতা"-র দিকেই পড়ে। ফলে রোজ কাজ করা প্রতিটা মানুষের
 *    কার্ডে সারাদিন একটা লাল রিং জ্বলত, আর দু-দিনেই লাল মানে "কিছু না"
 *    হয়ে যেত (index.css-এর নিয়ম দেখুন)। লাল এখন **শুধু** ঘাটতি ও
 *    এজেন্ট বন্ধের জন্য।
 */
export function ProgressRing({
  value,
  max,
  size = 46,
  label,
  ariaLabel = 'Progress',
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
  /**
   * কীসের অগ্রগতি — `"Today's target"`, `"This month"`। শতাংশটা নিজে
   * থেকেই পরে জুড়ে যায়, তাই এখানে শুধু নামটুকু লিখুন।
   */
  ariaLabel?: string;
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
      aria-label={`${ariaLabel} — ${Math.round(pct)} percent`}
      title={`${ariaLabel} — ${Math.round(pct)}%`}
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
            met ? 'stroke-ok' : 'stroke-ink'
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
  ariaLabel = 'Progress',
  tone = 'auto',
}: {
  value: number;
  max: number;
  className?: string;
  /** রিংয়ের মতোই — কীসের অগ্রগতি */
  ariaLabel?: string;
  /**
   * ⭐ `'ok'` — শুরু থেকেই সবুজ *(১৫ আগস্ট)*।
   *
   * ⚠️ ডিফল্ট `'auto'`-ই প্রায় সবখানে ঠিক: বার নিরপেক্ষ থাকে আর
   *    **টার্গেট ছুঁলে** সবুজ হয়, অর্থাৎ সবুজ মানে "হয়ে গেছে"। সেটা
   *    ভাঙার একটাই বৈধ কারণ — যেখানে **কোনো টার্গেটই নেই**, তাই "হয়ে
   *    গেছে/হয়নি" প্রশ্নটাই ওঠে না (ছুটির দিনে করা কাজ)। ওখানে
   *    নিরপেক্ষ রং "এখনো হয়নি"-র মতো পড়া যেত।
   */
  tone?: 'auto' | 'ok';
}) {
  const pct = pctOf(value, max);
  const shown = Math.min(100, Math.max(0, pct));
  const met = tone === 'ok' || pct >= 100;

  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}
      role="img"
      aria-label={`${ariaLabel} — ${Math.round(pct)} percent`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${
          met ? 'bg-ok' : 'bg-ink'
        }`}
        style={{ width: `${shown}%` }}
      />
    </div>
  );
}
