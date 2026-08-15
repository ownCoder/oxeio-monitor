import { useState } from 'react';

import type { TeamTrend } from '../../api/dashboard';
import { formatDateShort, formatDuration, pctOf, weekdayOf } from '../../lib/format';
import { targetText } from './TodayRing';

/**
 * E01 — বোর্ডের দুটো পেছন-ফিরে-দেখা কার্ড: **শেষ সাত দিন**, আর **চলতি মাস**।
 *
 * ⭐ উৎস `daily_summary` ও `monthly_summary` — বেতনের ভিত্তি যেগুলো, আর
 *    `summary-refresh` জব ওদের প্রতি ১৫ মিনিটে তাজা রাখে (K06)।
 */

/**
 * ⭐⭐ **সাত দিন — আর এখানকার একমাত্র সত্যিই কঠিন সিদ্ধান্ত।**
 *
 * ⚠️⚠️ যে দিনগুলোতে ট্র্যাকিং শুরুই হয়নি, সেগুলো **শূন্য বার নয়** — ডটেড
 *    রূপরেখা। শূন্য দেখালে চার্টটা দাবি করত "ওই দিন কেউ কাজ করেনি", অথচ
 *    সত্যিটা হলো **আমরা তখন দেখছিলামই না**। প্রথম সপ্তাহে ওই মিথ্যাটা
 *    গোটা দলকে অকারণে ব্যর্থ দেখাত।
 *
 * ⭐ এটা এই অ্যাপেরই পুরোনো নিয়ম, নতুন কিছু নয়: `offline` (কর্মী চলে
 *    গেছেন) আর `agent_down` (এজেন্ট মরে গেছে) কখনো এক রঙে দেখানো হয় না।
 *    **"জানি না"-কে "নেই" বলে ফেললে ব্যবহারকারী ভুল কাজে চলে যান।**
 */
export function WeekBars({ days }: { days: TeamTrend['days'] }) {
  /**
   * ⚠️ মাপকাঠিতে টার্গেটও ধরা হয় — নইলে হালকা একটা দিনের বার পুরো উঁচু
   *    হয়ে বসত, আর দিনটা দেখতে দুর্দান্ত লাগত।
   */
  const peak = days.reduce(
    (m, d) => Math.max(m, d.workedSec, d.targetSec),
    0,
  );

  /**
   * ⚠️⚠️ বেছে নেওয়া দিনটা — **ফোনে এটাই একমাত্র উপায়**।
   *
   * আগে প্রতিটা বারের মান ছিল কেবল `title` টুলটিপে, আর বারগুলো ছিল `<div>`।
   * ⚠️ ছোঁয়ার পর্দায় টুলটিপ **কখনো ওঠে না**, আর `<div>`-এ ট্যাপেরও কিছু নেই —
   *    ফলে ফোনে কার্ডটা ছিল সাতটা **নামহীন বার**: আকৃতি বোঝা যেত, সংখ্যা নয়।
   * ⭐ নকশাটা নতুন নয় — `DayPulse`-এ ঠিক এই জিনিসটাই আছে (স্থির readout
   *    লাইন + পুরো কলামজোড়া hit-target), তাই এখানে সেটাই আনা হলো।
   */
  const [pick, setPick] = useState<string | null>(null);
  const shown = days.find((d) => d.date === pick) ?? null;

  // ⚠️ যোগফলে **কেবল দেখা দিনগুলো** — না-দেখা দিনকে ০ ধরে যোগ করলে
  //    সংখ্যাটা "এই সপ্তাহে এতটুকুই হয়েছে" বলে মিথ্যা দাবি করত।
  const seen = days.filter((d) => d.tracked);
  const seenSec = seen.reduce((s, d) => s + d.workedSec, 0);

  return (
    <div className="px-4 pt-1 pb-3">
      {/*
        ⭐ একটা মান সরাসরি, বাকিগুলো ছুঁয়ে — `DayPulse`-এর একই নিয়ম। প্রতিটা
           বারের গায়ে সংখ্যা বসালে সাতটা লেখা একটার উপর আরেকটা উঠে যেত।
      */}
      <div className="mb-2 flex items-end justify-between gap-3">
        <p className="text-xs text-ink-3">
          {shown ? (
            <span className="text-ink-2">
              <span className="num font-semibold text-ink">
                {formatDateShort(shown.date)}
              </span>{' '}
              ·{' '}
              {shown.tracked ? (
                <>
                  <span className="num">{formatDuration(shown.workedSec)}</span>
                  {shown.expectedStaff === 0 && ' · day off'}
                </>
              ) : (
                'not tracked yet'
              )}
            </span>
          ) : (
            <>
              Counted{' '}
              <span className="num font-semibold text-ink">
                {formatDuration(seenSec)}
              </span>
              {/* ⚠️ কটা দিন গোনা হলো সেটা বলা হয় **কেবল** যখন সাতটার কম —
                  নইলে প্রতিদিন একটা অপ্রয়োজনীয় সংখ্যা চোখে পড়ত। */}
              {seen.length < days.length && (
                <span className="text-ink-3">
                  {' '}
                  · <span className="num">{seen.length}</span> of{' '}
                  <span className="num">{days.length}</span> days tracked
                </span>
              )}
            </>
          )}
        </p>
      </div>

      <div className="relative">
        <div
          className="flex h-24 items-end gap-[3px]"
          onMouseLeave={() => setPick(null)}
        >
          {days.map((d) => {
            const h = peak > 0 ? (d.workedSec / peak) * 100 : 0;
            const off = d.expectedStaff === 0;

            return (
              <button
                key={d.date}
                type="button"
                /*
                 * ⚠️ hit-target পুরো কলামের উচ্চতা জুড়ে, শুধু বারটুকু নয় —
                 *    ২% উঁচু বারে আঙুল তাক করা যেত না।
                 * ⚠️ `onClick`-টা ফোনের জন্য বাধ্যতামূলক: Safari (iOS ও macOS)
                 *    **বোতামে ট্যাপ করলে ফোকাস দেয় না**, তাই `onFocus`-এ
                 *    ভরসা করলে ওখানে কিছুই হতো না।
                 */
                className="flex h-full flex-1 cursor-default items-end focus:outline-none"
                onMouseEnter={() => setPick(d.date)}
                onFocus={() => setPick(d.date)}
                onBlur={() => setPick(null)}
                onClick={() => setPick(d.date)}
                title={
                  d.tracked
                    ? `${formatDateShort(d.date)} — ${formatDuration(d.workedSec)}${
                        off ? ' · day off' : ''
                      }`
                    : `${formatDateShort(d.date)} — not tracked yet`
                }
              >
                {d.tracked ? (
                  <span
                    className="w-full rounded-t-[4px] transition-[height,opacity] duration-500"
                    style={{
                      // ⚠️ শূন্যেও ২px — নইলে "কাজ হয়নি" আর "দিনটাই নেই"
                      //    দেখতে এক হতো।
                      height: `max(2px, ${h}%)`,
                      backgroundColor: off
                        ? 'var(--color-line)'
                        : 'var(--color-ok)',
                      // ⭐ বাছাই হলে বাকিগুলো ম্লান — উপরের সংখ্যাটা **কোন**
                      //    বারের, সেটা তখন চোখেই দেখা যায়। ট্যাপে ওই যোগসূত্রটা
                      //    না থাকলে সংখ্যাটা কোথা থেকে এলো বোঝা যেত না।
                      opacity: pick === null || pick === d.date ? 1 : 0.45,
                    }}
                  />
                ) : (
                  /*
                    ⚠️ ভরাট নয়, **ফাঁপা রূপরেখা** — চোখে সাথে সাথেই আলাদা,
                       আর উচ্চতাটা কোনো মান দাবি করে না।
                  */
                  <span
                    className="w-full rounded-t-[4px] border border-dashed border-line"
                    style={{
                      height: '70%',
                      opacity: pick === null || pick === d.date ? 1 : 0.45,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/*
          ⭐ টার্গেট-রেখা — একটাই সরু কঠিন রেখা, ড্যাশ নয়। ড্যাশ করলে
             ওটাকে "অনুমান" বা "সীমা" মনে হতো, অথচ এটা নির্দিষ্ট সংখ্যা।
          ⚠️ দলের টার্গেট দিনভেদে বদলায় (কার ছুটি তার উপর), তাই একটাই
             রেখা টানা যায় না — সবচেয়ে সাধারণ টার্গেটটাই দেখানো হয়।
        */}
        {peak > 0 && commonTarget(days) > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-ink-3/60"
            style={{ bottom: `${(commonTarget(days) / peak) * 100}%` }}
          />
        )}
      </div>

      <div className="mt-2 flex gap-[3px]">
        {days.map((d) => (
          <span
            key={d.date}
            className="flex-1 text-center text-[10.5px] text-ink-3"
          >
            {weekdayOf(d.date).slice(0, 3)}
          </span>
        ))}
      </div>

      {/*
        ⚠️⚠️ **লেজেন্ডটা তুলে দেওয়া হয়েছে** *(মকআপ ক-এ ওটা নেই, ১৫ আগস্ট)*।

        ⭐ হারানোর কিছু নেই: কার্ডের `hint`-এ ইতিমধ্যেই লেখা আছে
        *"dashed = before tracking started"*, আর ছুটির দিনের ধূসর বার
        নিজের `title`-এ কারণটা বলে। অর্থাৎ তিনটে লাইন **একই কথা দ্বিতীয়বার**
        বলছিল, আর তার দাম দিচ্ছিল চার্টটা — সারির অন্য দুটো কার্ডের
        সমান উচ্চতায় বসে বারগুলো চেপে গিয়ে প্রায় অপঠ্য হয়ে যাচ্ছিল।

        ⚠️ রঙের ব্যাখ্যা মুছে ফেলা এই প্রকল্পে সাধারণত নিষিদ্ধ
        (`StatusLegend`-এর নোট দেখুন) — কিন্তু ওই নিয়মটা **অবস্থার চার রঙের**,
        যেগুলো অনুমান করা যায় না। এখানে ভরাট-বনাম-ডটেড পার্থক্যটা hint-এ
        বাক্যে লেখা, রঙে নয়।
      */}
    </div>
  );
}

/**
 * ⭐ চলতি মাস — **আর এখানে সংখ্যাটা যতটা জরুরি, তার ব্যাখ্যাটাও ততটাই।**
 *
 * ⚠️⚠️ pace আসে ট্র্যাকিং শুরুর দিন থেকে, মাসের ১ তারিখ থেকে নয়। কাঁচা
 *    হিসাবে আগস্টে দল **১০৪২ ঘণ্টা পিছিয়ে** দেখাত — সংখ্যাটা সত্য, গল্পটা
 *    মিথ্যা: ওই ঘাটতির পুরোটাই ১–১২ আগস্ট, যখন মনিটরিং ছিলই না।
 *
 * ⭐ তাই তারিখটা কার্ডেই **লেখা থাকে** — সমন্বয়টা অদৃশ্য অনুমান হয়ে
 *    গেলে সেটা আরেক রকম মিথ্যা হতো।
 */
export function MonthCard({ month }: { month: TeamTrend['month'] }) {
  const pct = pctOf(month.creditedSec, month.targetSec);
  const ahead = month.paceSec >= 0;

  return (
    <div className="px-4 pt-1 pb-3">
      <div className="flex items-baseline gap-2">
        <span className="num text-2xl leading-none font-semibold">
          {formatDuration(month.creditedSec)}
        </span>
        {/*
          ⚠️ `targetText`, সোজা `formatDuration` নয় — ২২৭২ ঘণ্টা পুরো
             ঘণ্টায় পড়ে, তাই ওটা লিখত `2272h 0m`। ওই শূন্য মিনিটটা
             প্রতিদিন চোখে লাগত অথচ কিছুই বলত না (TodayRing-এর নোট)।
        */}
        <span className="text-xs text-ink-3">
          of <span className="num">{targetText(month.targetSec)}</span>
        </span>
      </div>

      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-ok transition-[width] duration-700"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11.5px]">
        <span className="text-ink-2">
          <span className="num font-semibold text-ink">{Math.round(pct)}%</span>{' '}
          of the month&rsquo;s target
        </span>
        {/*
          ⚠️ "পিছিয়ে" **লাল নয়**, আর সেটা ইচ্ছাকৃত। এই থিমে সলিড লাল মানে
             "এখনই কিছু করুন" (এজেন্ট বন্ধ, ভুল) — মাসের মাঝপথে স্বাভাবিক
             ওঠানামাকে লাল দেখালে দু-দিনেই লাল মানে "কিছু না" হয়ে যেত।
        */}
        <span className={ahead ? 'text-ok' : 'text-ink-2'}>
          <span className="num font-semibold">
            {formatDuration(Math.abs(month.paceSec))}
          </span>{' '}
          {ahead ? 'ahead of pace' : 'behind pace'}
        </span>
      </div>

      {month.trackedFrom && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {/*
            ⚠️ তারিখটায় `.num` নয় — tabular figures ওকে `13  Aug`-এর মতো
               ঢিলে দেখাত। সমান-প্রস্থ অঙ্ক কেবল কলামে সাজানো সংখ্যার জন্য।
          */}
          Pace counts whole days from {formatDateShort(month.trackedFrom)}, when
          tracking started — the days before it, and today, are not counted
          against anyone.
        </p>
      )}
    </div>
  );
}

/**
 * ⭐ **Top performers** — **আজীবন** সবচেয়ে বেশি ঘণ্টা যাঁদের।
 *
 * ⚠️ মাপটা **সব মাস মিলিয়ে মোট ঘণ্টা**, মালিকের বাছা। ফলে যিনি আগে যোগ
 *    দিয়েছেন তিনি **স্থায়ীভাবে** উপরে থাকেন — নতুন কেউ যত ভালোই করুন,
 *    ধরতে পারবেন না। মাসিকে অন্তত প্রতি মাসে ক্রম নতুন করে শুরু হতো।
 *
 * ⭐ তাই প্রতিটা নামের পাশে **আসল ঘণ্টাটা** লেখা থাকে, আর বারগুলো শীর্ষ
 *    জনের সাপেক্ষে আঁকা। সবাই কাছাকাছি থাকলে বারগুলোও প্রায় সমান হয় —
 *    অর্থাৎ "ক্রমটা অর্থবহ কি না" প্রশ্নের উত্তর সংখ্যাগুলোই দিয়ে দেয়,
 *    আলাদা কোনো সতর্কবার্তা ছাড়াই।
 *
 * ⚠️ বার সবুজ নয়, নিরপেক্ষ `ink` — এটা টার্গেট ছোঁয়ার হিসাব নয়, নিছক
 *    তুলনা। সবুজ রাখলে "লক্ষ্য পূরণ" বলে ভুল হতো (ProgressBar-এর নিয়ম)।
 */
export function TopPerformers({ leaders }: { leaders: TeamTrend['leaders'] }) {
  if (leaders.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-3">
        No hours counted yet — the list fills in as people work.
      </p>
    );
  }

  const top = leaders[0].creditedSec;

  return (
    <ul className="divide-y divide-line">
      {leaders.map((p, i) => (
        <li
          key={p.employeeId}
          className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
        >
          <span className="num text-[11px] text-ink-3">{i + 1}</span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{p.fullName}</div>
            {/*
              ⭐ বারটা **সবুজ** (`ok`), সাদা (`ink`) নয় — বোর্ডের বাকি সব
                 চার্টে "গোনা হওয়া ঘণ্টা" ইতিমধ্যেই এই রঙেই আঁকা হয়
                 (দিনের ছন্দ, শেষ ৭ দিন)। এখানে সাদা থাকায় একই জিনিস একই
                 পর্দায় দুই রঙে দেখাত।

              ⚠️ এটা "টার্গেট পূরণ" বোঝায় না — ওই মানেটা `TargetBars`-এর,
                 যেখানে নিরপেক্ষ বার সবুজ **হয়ে যায়** টার্গেট ছুঁলে। এখানে
                 বারটা কেবল **অনুপাত**: শীর্ষজনের তুলনায় কে কতটা। তাই
                 লম্বাটা "ভালো" নয়, শুধু "বেশি" — আর সংখ্যাটা পাশেই লেখা
                 থাকে বলে ক্রমটা কীসের উপর দাঁড়ানো তা পর্দাতেই দেখা যায়।
            */}
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-ok transition-[width] duration-700"
                style={{
                  width: `${top > 0 ? (p.creditedSec / top) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <span className="num text-[13px] font-semibold">
            {formatDuration(p.creditedSec)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * সবচেয়ে সাধারণ দৈনিক টার্গেট — রেখাটা এটার উপরেই বসে।
 *
 * ⚠️ গড় নেওয়া হয় না: ছুটির দিনের শূন্য টার্গেট গড়টাকে নিচে টেনে নামাত,
 *    আর রেখাটা এমন একটা উচ্চতায় বসত যেটা কোনো দিনেরই সত্যি নয়।
 */
function commonTarget(days: TeamTrend['days']): number {
  const counts = new Map<number, number>();
  for (const d of days) {
    if (d.targetSec > 0) {
      counts.set(d.targetSec, (counts.get(d.targetSec) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestN = 0;
  for (const [target, n] of counts) {
    if (n > bestN) {
      best = target;
      bestN = n;
    }
  }
  return best;
}
