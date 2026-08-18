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
 * ⭐ **রিংটা সবুজ** — যতটুকু কাজ হয়েছে ততটুকুই সবুজ *(১৭ আগস্ট)*।
 *
 *    আগে চলতি অবস্থাটা ছিল নিরপেক্ষ `ink` (ডার্ক থিমে সাদা), আর সবুজ হতো
 *    কেবল টার্গেট ছোঁয়ার পর। মালিক পর্দায় দেখে বললেন সাদাটা মানানসই নয় —
 *    ⭐ আর যুক্তিটা ঠিক: **কাজ হয়ে যাওয়া মানেই ভালো খবর**, ৮ ঘণ্টা পূর্ণ
 *    হওয়ার আগেও। সাদা রিংটা "এখনো কিছু হয়নি"-র মতো পড়াত।
 *
 * ⚠️⚠️ তবু **"হয়ে গেছে" আর "হচ্ছে" আলাদা থাকতেই হবে**, নইলে টার্গেট
 *    ছোঁয়ার মুহূর্তটা হারিয়ে যেত। তাই দুই ধাপ: চলতি অবস্থায় **হালকা**
 *    সবুজ (`ok/70`), আর টার্গেট ছুঁলে **গাঢ়** সবুজ — সাথে বৃত্তটাও তখন
 *    সম্পূর্ণ, কোথাও ফাঁক থাকে না। রঙ আর আকৃতি দুটো মিলে খবরটা দেয়,
 *    একা রঙের উপর ভরসা নয় (রং-অন্ধতার জন্যও সেটাই দরকার)।
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
            met ? 'stroke-ok' : 'stroke-ok/70'
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
 *
 * ⚠️⚠️ **রঙের নিয়ম রিংয়েরই** — হুবহু। এক পাতায় একই মাপ (আজ কত কাজ হলো)
 * দুই আকৃতিতে দেখা যায়; দুটোর রং আলাদা হলে পাঠক ভাবতেন দুটো আলাদা কথা
 * বলছে। তাই রিংয়ের রং বদলালে এটাও একই সাথে বদলায়।
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
   * ⭐ `'ok'` — শুরু থেকেই **গাঢ়** সবুজ *(১৫ আগস্ট)*।
   *
   * ⚠️ ১৭ আগস্ট থেকে `'auto'`-ও সবুজ, শুধু হালকা — তাই তফাতটা এখন
   *    "সবুজ কি না" নয়, **"গাঢ় কি না"**। মানেটা অবিকল আগেরই: যেখানে
   *    **কোনো টার্গেটই নেই** সেখানে "হয়ে গেছে/হয়নি" প্রশ্নটাই ওঠে না
   *    (ছুটির দিনে করা কাজ), তাই বারটা অসম্পূর্ণ দেখানোর কারণ নেই।
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
          met ? 'bg-ok' : 'bg-ok/70'
        }`}
        style={{ width: `${shown}%` }}
      />
    </div>
  );
}

/**
 * ⭐⭐ **আজকের মিটার — তিনটে আলাদা সত্যি, তিনটে আলাদা চেহারা।**
 *
 * `ProgressBar` জানে একটাই গল্প: "কতটা হয়েছে"। কিন্তু রোস্টারে তিন রকম
 * সারি পাশাপাশি বসে, আর ওদের গুলিয়ে ফেলা যাবে না:
 *
 * | অবস্থা | চেহারা | মানে |
 * |---|---|---|
 * | `counted` | ভরাট সবুজ | মাপা হয়েছে, এতটা কাজ হয়েছে |
 * | `zero` | **ড্যাশ করা খালি** | মাপা হয়েছে, আজ শূন্য |
 * | `unknown` | **হ্যাচ করা** | মাপাই হয়নি (এজেন্ট বসেনি / কখনো সাড়া দেয়নি) |
 *
 * ⚠️⚠️ শেষ দুটো আগে **একই খালি বার** ছিল, আর তাতে "এজেন্ট বসানোই হয়নি"
 * নীরবে "আজ কিছু করেননি"-র অভিযোগ হয়ে যেত। ⭐ ভাগটা এখানে **রঙ দিয়ে
 * নয়, টেক্সচার দিয়ে** — বর্ণান্ধতায়ও পার্থক্যটা টেকে (`TeamBars`-এর
 * মাপা ΔE-র শিক্ষা: হিউয়ের উপর ভরসা করা যায় না)।
 *
 * ⚠️ ন্যূনতম প্রস্থ ২px — নইলে ০.৩% কাজ GDI-র মতোই শূন্যে গোল হয়ে যেত,
 * আর "একটু" ও "কিছুই না" এক দেখাত।
 */
export function TodayMeter({
  kind,
  value,
  max,
  className = '',
  ariaLabel = "Today's target",
}: {
  kind: 'counted' | 'zero' | 'unknown';
  value: number;
  max: number;
  className?: string;
  ariaLabel?: string;
}) {
  if (kind !== 'counted') {
    const unknown = kind === 'unknown';
    return (
      <div
        className={`h-1.5 rounded-full ${
          unknown
            ? // হ্যাচ — "গোনাই হয়নি"
              'bg-[repeating-linear-gradient(135deg,var(--color-line)_0_3px,transparent_3px_6px)]'
            : // ড্যাশ করা খালি ঘর — "গোনা হয়েছে, শূন্য"
              'border border-dashed border-line'
        } ${className}`}
        role="img"
        aria-label={unknown ? `${ariaLabel} — not counted yet` : `${ariaLabel} — nothing counted today`}
      />
    );
  }

  const pct = pctOf(value, max);
  const shown = Math.min(100, Math.max(0, pct));
  const met = pct >= 100;

  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-line ${className}`}
      role="img"
      aria-label={`${ariaLabel} — ${Math.round(pct)} percent`}
    >
      <div
        className={`h-full min-w-[2px] rounded-full transition-[width] duration-700 ${
          met ? 'bg-ok' : 'bg-ok/70'
        }`}
        style={{ width: `${shown}%` }}
      />
    </div>
  );
}
