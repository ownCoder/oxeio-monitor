import type { LiveCard, LiveStatus } from '../../api/dashboard';
import { ProgressBar } from '../../components/ProgressRing';
import { StatusDot } from '../../components/StatusDot';
import { formatDuration, pctOf } from '../../lib/format';

/**
 * E01 — বোর্ডের দুটো বার: **দল এখন কোন অবস্থায়**, আর **কে কোথায় দাঁড়িয়ে**।
 */

/** স্ট্রিপে ও তালিকায় একই ক্রম — চোখ একবার শিখলে দ্বিতীয়বার খুঁজতে হয় না */
const ORDER: { status: LiveStatus; label: string }[] = [
  { status: 'active', label: 'Working' },
  { status: 'idle', label: 'Idle' },
  { status: 'offline', label: 'Offline' },
  { status: 'agent_down', label: 'Agent down' },
];

const FILL: Record<LiveStatus, string> = {
  active: 'var(--color-ok)',
  idle: 'var(--color-idle)',
  offline: 'var(--color-offline)',
  agent_down: 'var(--color-attention)',
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

  const present = counts.filter((c) => c.n > 0);

  return (
    <div className="px-4 pt-1 pb-3">
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {present.map((c) => (
          <span
            key={c.status}
            className="transition-[flex-grow] duration-500"
            style={{ flexGrow: c.n, backgroundColor: FILL[c.status] }}
            title={`${c.label} — ${c.n} of ${total}`}
            // ⚠️ পুরো স্ট্রিপটা একটাই ছবি — প্রতিটা ভাগ আলাদা করে স্ক্রিন
            //    রিডারে পড়ালে "৩ ৪ ২ ১" শোনা যেত, কোনো প্রসঙ্গ ছাড়া।
            //    নিচের তালিকাটাই স্ক্রিন রিডারের আসল পথ।
            aria-hidden
          />
        ))}
      </div>

      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {counts.map((c) => (
          <li
            key={c.status}
            className={`flex items-center gap-1.5 text-xs ${
              c.n === 0 ? 'text-ink-3' : 'text-ink-2'
            }`}
          >
            <StatusDot status={c.status} />
            <span>{c.label}</span>
            <span
              className={`num font-semibold ${c.n === 0 ? 'text-ink-3' : 'text-ink'}`}
            >
              {c.n}
            </span>
          </li>
        ))}
      </ul>
    </div>
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

  /**
   * ⭐⭐ **আজ কারো টার্গেট না থাকলে তুলনার কলামটাই থাকে না** *(১৫ আগস্ট)*।
   *
   * ⚠️ সাপ্তাহিক ছুটি বা সরকারি ছুটির দিনে আগে যা দেখা যেত: বারো জনের
   *    বারো লাইন, প্রত্যেকের পাশে একটা **খালি ধূসর রেল** আর ডানে "off" —
   *    অথচ সবাই ৩ ঘণ্টা, ২ ঘণ্টা করে কাজ করেছেন। খালি রেলটা দেখতে
   *    "শূন্য শতাংশ"-এর মতো, তাই সংখ্যাটা কাজের কথা বলত আর ছবিটা ঠিক
   *    উল্টোটা — ছুটির দিনে কাজ করাটাকেই ব্যর্থতার মতো দেখাত।
   *
   * ⭐ "off" লেখাটাও তখন কিছুই আলাদা করে না — সবাই off। লেবেল তখনই
   *    দরকার যখন সে **কাউকে অন্যদের থেকে আলাদা করে**; তাই মিশ্র দিনে
   *    (কেউ ছুটিতে, কেউ নয়) ওটা থাকে, আর সবার ছুটির দিনে কার্ডের
   *    হেডিং একবার কথাটা বলে দেয়।
   */
  const anyTarget = rows.some(hasTarget);

  return (
    <ul className="divide-y divide-line">
      {rows.map((card) => {
        const targeted = hasTarget(card);
        const pct = targeted
          ? Math.round(pctOf(card.todayWorkedSec, card.dailyTargetSec))
          : null;

        return (
          <li
            key={card.employeeId}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 ${
              anyTarget ? 'sm:grid-cols-[minmax(120px,1.1fr)_minmax(0,2fr)_auto]' : ''
            }`}
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
            {anyTarget && (
              <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                {targeted ? (
                  <ProgressBar
                    value={card.todayWorkedSec}
                    max={card.dailyTargetSec}
                    ariaLabel={`${card.fullName} — today's target`}
                  />
                ) : (
                  <div
                    className="h-1.5 rounded-full bg-line/60"
                    title="Weekly off or holiday — nothing is expected today"
                  />
                )}
              </div>
            )}

            <div className="flex items-baseline justify-end gap-1.5 text-right">
              <span className="num text-[13px] font-semibold">
                {formatDuration(card.todayWorkedSec)}
              </span>
              {/*
                ⚠️ `w-9` ঘরটা **শুধু তুলনার দিনে** — শতাংশগুলো ডানদিকে এক
                   রেখায় বসানোর জন্য ওটা দরকার। ছুটির দিনে ওই ঘরটা রেখে
                   দিলে প্রতিটা সারির ডানে ন-পিক্সেল ফাঁকা থাকত, আর
                   সংখ্যাগুলো কিনারা থেকে ঝুলে থাকত।
              */}
              {anyTarget && (
                <span className="num w-9 text-[11px] text-ink-3">
                  {pct === null ? 'off' : `${pct}%`}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** আজ এই কর্মীর সত্যিই টার্গেট আছে কি না — ছুটির দিনে নেই */
function hasTarget(card: LiveCard): boolean {
  return card.todayIsWorkday && card.dailyTargetSec > 0;
}
