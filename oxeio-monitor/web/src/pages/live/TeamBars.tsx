import type { LiveCard, LiveStatus } from '../../api/dashboard';
import { ProgressBar } from '../../components/ProgressRing';
import { StatusDot } from '../../components/StatusDot';
import { formatDuration, pctOf } from '../../lib/format';
import { dayDuty } from './roster';

/**
 * E01 — বোর্ডের দুটো বার: **দল এখন কোন অবস্থায়**, আর **কে কোথায় দাঁড়িয়ে**।
 */

/** স্ট্রিপে ও তালিকায় একই ক্রম — চোখ একবার শিখলে দ্বিতীয়বার খুঁজতে হয় না */
const ORDER: { status: LiveStatus; label: string }[] = [
  { status: 'active', label: 'Working' },
  { status: 'idle', label: 'Idle' },
  { status: 'offline', label: 'Offline' },
];

const FILL: Record<LiveStatus, string> = {
  active: 'var(--color-ok)',
  idle: 'var(--color-idle)',
  offline: 'var(--color-offline)',
};

/**
 * ⭐ **অংশ-থেকে-পূর্ণ** — তাই একটাই অনুভূমিক স্তরে-ভাগ করা বার, পাই নয়।
 *    দশজনের চারটে ভাগ পাইতে বসালে ছোট ভাগগুলোর কোণ তুলনা করাই যেত না।
 *
 * ⚠️ প্রতিটা ভাগের মাঝে **২px ফাঁক, পটভূমির রঙে** — বর্ডার নয়। বর্ডার
 *    ডেটা নয়, অথচ ডেটার মতো কালি যোগ করে; ফাঁকটা কিছু যোগ না করেই আলাদা করে।
 *
 * ⚠️⚠️ **রঙ এখানে একা যথেষ্ট নয়, আর সেটা মেপে দেখা হয়েছে।** চারটে অবস্থার
 *    রং যন্ত্র দিয়ে যাচাই করে পাওয়া গেল — সবুজ (`ok`) আর হলুদ (`idle`)
 *    protanopia-তে প্রায় **একই রং**: ΔE ৩.২ (ডার্ক) ও ৫.১ (লাইট), যেখানে
 *    নিরাপদ সীমা ≥ ৮। অথচ স্বাভাবিক দৃষ্টিতে ওদের দূরত্ব ১৭.৮ — অর্থাৎ
 *    **খালি চোখে সমস্যাটা কখনো ধরা পড়ত না**।
 *
 *    ⭐ রংগুলো বদলানো হয়নি ইচ্ছাকৃতভাবে: এগুলো গোটা অ্যাপের প্রতিষ্ঠিত
 *    অবস্থা-বর্ণমালা (`StatusDot`, কার্ড, লেজেন্ড — সবখানে একই), আর
 *    একটা পর্দার জন্য সেটা বদলালে বাকি সব পর্দার সাথে মিল ভাঙত।
 *
 *    বদলে **তিনটে বাড়তি চ্যানেল** দেওয়া হয়েছে, যাতে রং না বুঝলেও পড়া যায়:
 *      · নিচে প্রতিটা ভাগের **নাম ও সংখ্যা লেখা** — আসল তথ্য ওখানেই
 *      · ক্রম **স্থির** (কাজ → নিষ্ক্রিয় → অফলাইন → বন্ধ), স্ট্রিপ ও
 *        তালিকা দুটোতেই এক, আর শূন্য ভাগগুলো তালিকায় **ম্লান** থাকে
 *      · প্রতিটা ভাগে hover করলে নাম ও সংখ্যা বলে
 */
export function StatusStrip({ cards }: { cards: LiveCard[] }) {
  const counts = ORDER.map((slot) => ({
    ...slot,
    n: cards.filter((c) => c.status === slot.status).length,
  }));
  const total = cards.length;

  if (total === 0) return null;

  return (
    /*
      ⭐⭐ **মকআপ ক-এর বিন্যাস — চারটে আলাদা সারি, একটা স্ট্রিপ নয়।**

      ⚠️⚠️ এখানে আগে একটাই স্তরে-ভাগ করা বার ছিল আর নিচে লেজেন্ড। বারটা
      "অংশ-থেকে-পূর্ণ" ভালো দেখাত, কিন্তু **কোন ভাগ কতটুকু** পড়তে হলে চোখকে
      রঙ ধরে লেজেন্ডে গিয়ে ফিরে আসতে হতো — দুবার তাকানো। মকআপে প্রতিটা
      অবস্থার নিজের সারি, নিজের বার, ডানে নিজের সংখ্যা: **একবার তাকালেই হয়**।

      ⭐ আর বারগুলো একই মাপে (`total`-এর বিপরীতে) আঁকা, তাই পাশাপাশি
      দৈর্ঘ্য তুলনা করাই যথেষ্ট — রঙের উপর নির্ভর করতে হয় না। ⚠️ ওই
      নির্ভরতাটা এখানে আসল ঝুঁকি ছিল: সবুজ (`ok`) আর হলুদ (`idle`)
      protanopia-তে ΔE মাত্র ৩.২, অথচ স্বাভাবিক দৃষ্টিতে ১৭.৮ — খালি চোখে
      সমস্যাটা কোনোদিন ধরা পড়ত না।
    */
    <ul className="divide-y divide-line">
      {counts.map((c) => (
        <li
          key={c.status}
          className="flex items-center gap-3 px-4 py-2"
          title={`${c.label} — ${c.n} of ${total}`}
        >
          <span className="flex min-w-24 shrink-0 items-center gap-1.5 text-[12.5px] text-ink-2">
            <StatusDot status={c.status} />
            {c.label}
          </span>

          {/*
            ⚠️ শূন্য হলে বার আঁকা হয় **না** — এক পিক্সেলের একটা রেখাও
               "সামান্য কিছু আছে" বলে পড়া যায়, অথচ সংখ্যাটা ঠিক শূন্য।
          */}
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line/50">
            {c.n > 0 && (
              <span
                className="block h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${(c.n / total) * 100}%`,
                  backgroundColor: FILL[c.status],
                }}
              />
            )}
          </span>

          <span
            className={`num w-6 shrink-0 text-right text-[13px] font-semibold ${
              c.n === 0 ? 'text-ink-3' : 'text-ink'
            }`}
          >
            {c.n}
          </span>
        </li>
      ))}
    </ul>
  );
}


/**
 * ⭐ **আজকের টার্গেটের বিপরীতে সবাই, এক নজরে** — সবচেয়ে এগিয়ে থাকা উপরে।
 *
 * ⚠️⚠️ বারের রং **অবস্থা অনুযায়ী নয়**, আর এটাই এখানকার সবচেয়ে সহজ ভুল
 *    হতে পারত। `ProgressRing`-এর ডকে লেখা আছে কেন: চলতি অগ্রগতি একসময়
 *    ব্র্যান্ড-লালে আঁকা হতো, ফলে রোজ কাজ করা প্রতিটা মানুষের কার্ডে
 *    সারাদিন লাল জ্বলত আর দু-দিনেই লাল মানে "কিছু না" হয়ে যেত। তাই বার
 *    নিরপেক্ষ, আর **টার্গেট ছুঁলে সবুজ** — সবুজ মানে "হয়ে গেছে"।
 *    অবস্থাটা বোঝায় নামের পাশের **বিন্দু**, বারটা নয়।
 *
 * ⭐ ক্রম বদলালেও রং বদলায় না — রং ব্যক্তির অবস্থার সাথে বাঁধা, তালিকায়
 *    তার অবস্থানের সাথে নয়।
 */
export function TargetBars({ cards }: { cards: LiveCard[] }) {
  /**
   * ⚠️ ছুটিতে থাকা কর্মী **তালিকার শেষে**, আর তাঁর কোনো বার নেই — শূন্যের
   *    বিপরীতে অগ্রগতি আঁকা মানে ছুটির দিনটাকেই ব্যর্থতার মতো দেখানো।
   */
  const rows = [...cards].sort((a, b) => {
    const ta = hasTarget(a);
    const tb = hasTarget(b);
    if (ta !== tb) return ta ? -1 : 1;
    if (ta && tb) {
      const pa = pctOf(a.todayWorkedSec, a.dailyTargetSec);
      const pb = pctOf(b.todayWorkedSec, b.dailyTargetSec);
      if (pa !== pb) return pb - pa;
    }
    return b.todayWorkedSec - a.todayWorkedSec;
  });

  if (rows.length === 0) return null;

  return (
    <ul className="divide-y divide-line">
      {rows.map((card) => {
        const targeted = hasTarget(card);

        /**
         * ⭐⭐ **ছুটির দিনে করা কাজও বারে দেখা যায়, আর সেটা সবুজ**
         * *(মালিকের চাওয়া, ১৫ আগস্ট)*।
         *
         * ⚠️ আগে ছুটির দিনে সবার পাশে একটা **খালি ধূসর রেল** থাকত, অথচ
         *    সংখ্যা বলত সবাই ৩ ঘণ্টা, ২ ঘণ্টা করে কাজ করেছেন। খালি রেল
         *    দেখতে হুবহু "শূন্য শতাংশ"-এর মতো — একই সারিতে সংখ্যা আর ছবি
         *    উল্টো কথা বলত, আর মানুষ ছবিটাই বিশ্বাস করে।
         *
         * ⭐ মাপকাঠি সেই **এক কর্মদিবসের টার্গেট** (`dailyTargetSec`) —
         *    ছুটির দিনেও ফিল্ডটা আসে, কারণ ওটা মাসের হিসাব
         *    (টার্গেট ÷ কর্মদিবস), আজকের নয়। ⚠️ ৮ ঘণ্টা **হার্ডকোড নয়**;
         *    ২৭ কর্মদিবসের মাসে সংখ্যাটা ৭ঘ ৪২মি।
         *
         * ⚠️ রংটা শুরু থেকেই সবুজ, কারণ ছুটির দিনে **"হয়নি" বলে কিছু
         *    নেই** — যতটুকু হয়েছে পুরোটাই বাড়তি। নিরপেক্ষ রং রাখলে
         *    আধা-ভরা বার "এখনো বাকি"-র মতো পড়া যেত।
         *
         * ⚠️ কিছুই না করলে বার নেই — ছুটির দিনে শূন্য কোনো ঘাটতি নয়,
         *    আর শূন্য-ভরা রেল ঠিক ওই দাবিটাই করত।
         */
        const bonus =
          !targeted && card.todayWorkedSec > 0 && card.dailyTargetSec > 0;

        const pct =
          targeted || bonus
            ? Math.round(pctOf(card.todayWorkedSec, card.dailyTargetSec))
            : null;

        return (
          <li
            key={card.employeeId}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[minmax(120px,1.1fr)_minmax(0,2fr)_auto]"
          >
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot status={card.status} />
              <span className="truncate text-[13px] font-medium">
                {card.fullName}
              </span>
            </div>

            {/*
              ⚠️ ফোনে বারটা নিজের সারিতে নেমে যায় (`col-span-2`), নইলে নাম
                 আর সংখ্যার মাঝে চেপে গিয়ে বারটা কয়েক পিক্সেল চওড়া হতো —
                 আর অত সরু বার কোনো তুলনাই বোঝাত না।
            */}
            <div className="order-last col-span-2 sm:order-none sm:col-span-1">
              {targeted || bonus ? (
                <ProgressBar
                  value={card.todayWorkedSec}
                  max={card.dailyTargetSec}
                  tone={bonus ? 'ok' : 'auto'}
                  ariaLabel={
                    bonus
                      ? `${card.fullName} — worked on a day off, against a normal day`
                      : `${card.fullName} — today's target`
                  }
                />
              ) : (
                <div
                  className="h-1.5 rounded-full bg-line/60"
                  title="Weekly off or holiday — nothing is expected today"
                />
              )}
            </div>

            <div className="flex items-baseline justify-end gap-1.5 text-right">
              <span className="num text-[13px] font-semibold">
                {formatDuration(card.todayWorkedSec)}
              </span>
              {/* `w-9` — শতাংশগুলো ডানদিকে এক রেখায় বসানোর জন্য */}
              <span className="num w-9 text-[11px] text-ink-3">
                {pct === null ? 'off' : `${pct}%`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * আজ এই কর্মীর সত্যিই টার্গেট আছে কি না — ছুটির দিনে নেই।
 *
 * ⚠️ নিয়মটা এখানে আর **লেখা নেই**, `roster.ts`-এর `dayDuty()`-তে। আগে
 *    তিনটে পর্দায় তিনবার লেখা ছিল, আর G130-এর ব্যক্তিগত ছুটিটা তখন
 *    একটাতে বসত আর দুটোতে বসত না।
 */
function hasTarget(card: LiveCard): boolean {
  return dayDuty(card) === 'target';
}
