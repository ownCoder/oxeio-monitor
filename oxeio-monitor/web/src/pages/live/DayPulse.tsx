import { useState } from 'react';

import type { TeamHour } from '../../api/dashboard';
import { formatDuration } from '../../lib/format';

/**
 * E01 — **দিনের ছন্দ**: ২৪টা ঘণ্টায় গোটা দল কতটা কাজ করেছে।
 *
 * ⭐ **কেন কলাম, রেখা নয়।** ডেটাটা বালতি-করা (প্রতিটা ঘণ্টা একটা যোগফল),
 *    ধারাবাহিক সংকেতের নমুনা নয়। রেখা টানলে সে দাবি করত "১০টা ৩০-এ মান
 *    এতটা ছিল" — অথচ ওই প্রশ্নের কোনো উত্তরই ডেটায় নেই। কলাম ঠিক যতটা
 *    জানা, ততটাই বলে।
 *
 * ⚠️⚠️ **একটাই অক্ষ।** `people` (কতজন) সংখ্যাটা আঁকা হয় না, শুধু hover-এ
 *    থাকে। দুটো ভিন্ন মাপ এক চার্টে দুই অক্ষে বসানো চার্টের সবচেয়ে চেনা
 *    মিথ্যা — দুটো রেখার ক্রসিং তখন অর্থহীন, অথচ চোখে অর্থপূর্ণ লাগে।
 *
 * ⭐ রঙ সবুজ (`ok`), আর সেটা নির্বিচারে নয়: এই সিস্টেমে সবুজ মানেই
 *    "কাজ হচ্ছে", আর এই চার্ট ঠিক সেটাই মাপে। এক সিরিজ, তাই কোনো
 *    legend নেই — শিরোনামই বলে দেয় কী আঁকা।
 */
export function DayPulse({
  hours,
  /** ঢাকার এখনকার ঘণ্টা — ০–২৩, জানা না থাকলে `null` */
  currentHour,
}: {
  hours: TeamHour[];
  currentHour: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const peak = hours.reduce((m, h) => Math.max(m, h.activeSec), 0);
  const peakHour = hours.find((h) => h.activeSec === peak && peak > 0) ?? null;

  /**
   * ⚠️ পুরো দিন শূন্য হলে চার্টটা দেখানোই হয় না — ২৪টা শূন্য কলাম কিছুই
   *    বলে না, শুধু পাতাটা ভাঙা মনে হয়। রাত ১২টায় বোর্ড খুললে ঠিক এটাই ঘটত।
   */
  if (peak === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-3">
        No work counted yet today — the shape of the day fills in as people work.
      </p>
    );
  }

  const shown = hover !== null ? hours[hover] : null;

  return (
    <div className="px-4 pt-1 pb-3">
      {/*
        ⭐ শিরোনামের সারিতেই সর্বোচ্চটা লেখা — চার্টে প্রতিটা কলামের গায়ে
           সংখ্যা বসালে সেটা পড়ার অযোগ্য জঞ্জাল হতো। একটা মান সরাসরি,
           বাকিগুলো hover-এ।
      */}
      <div className="mb-2 flex items-end justify-between gap-3">
        <p className="text-xs text-ink-3">
          {shown ? (
            <span className="text-ink-2">
              <span className="num font-semibold text-ink">
                {hourLabel(shown.hour)}
              </span>{' '}
              · <span className="num">{formatDuration(shown.activeSec)}</span> ·{' '}
              <span className="num">{shown.people}</span>{' '}
              {shown.people === 1 ? 'person' : 'people'}
            </span>
          ) : (
            <>
              Busiest hour{' '}
              <span className="num font-semibold text-ink">
                {peakHour ? hourLabel(peakHour.hour) : '—'}
              </span>{' '}
              · <span className="num">{formatDuration(peak)}</span>
            </>
          )}
        </p>
      </div>

      {/*
        ⚠️ `items-end` — কলামগুলো **ভিত্তিরেখা থেকে** বাড়ে, নইলে উচ্চতার
           তুলনা মিথ্যা হয়ে যেত।
        ⭐ ফাঁকটা ২px, পটভূমির রঙেই — পাশাপাশি কলাম আলাদা করার কাজটা ফাঁক
           করে, বর্ডার নয়। বর্ডার হলে ওটা ডেটার কালি না হয়েও ডেটার মতো ওজন পেত।
      */}
      <div
        className="flex h-24 items-end gap-[2px]"
        onMouseLeave={() => setHover(null)}
      >
        {hours.map((h) => {
          const pct = (h.activeSec / peak) * 100;
          const isNow = currentHour === h.hour;
          const isHover = hover === h.hour;

          return (
            <button
              key={h.hour}
              type="button"
              // ⚠️ hit-target পুরো কলামের উচ্চতা জুড়ে, শুধু বারটুকু নয় —
              //    ভোরের ২% উঁচু বারে মাউস তাক করা যেত না।
              className="group relative flex h-full flex-1 cursor-default items-end focus:outline-none"
              onMouseEnter={() => setHover(h.hour)}
              onFocus={() => setHover(h.hour)}
              onBlur={() => setHover(null)}
              /*
               * ⚠️ ফোনের জন্য — `onMouseEnter`/`onFocus` দুটোর একটাও ওখানে
               *    ভরসা করা যায় না। Safari (iOS ও macOS) **বোতামে ট্যাপ
               *    করলে ফোকাস দেয় না**, আর সিন্থেটিক `mouseenter` ব্রাউজার
               *    ভেদে আসে-যায়। ফলে উপরের সারিটা সারাক্ষণ "সবচেয়ে ব্যস্ত
               *    ঘণ্টা"-তেই আটকে থাকত, আর বাকি ২৩ ঘণ্টার সংখ্যা ফোনে
               *    দেখারই কোনো উপায় থাকত না — অথচ hit-target পুরো কলাম
               *    জুড়ে বানানোই হয়েছিল ছোঁয়ার কথা ভেবে।
               */
              onClick={() => setHover(h.hour)}
              aria-label={`${hourLabel(h.hour)} — ${formatDuration(h.activeSec)}, ${h.people} people`}
            >
              <span
                className="w-full rounded-t-[4px] transition-[height,opacity] duration-500"
                style={{
                  // ⚠️ শূন্য নয় — ১px রেখে দেওয়া হয়, নইলে "কেউ কাজ করেনি"
                  //    আর "ঘণ্টাটাই নেই" দেখতে এক হতো।
                  height: h.activeSec === 0 ? 1 : `max(2px, ${pct}%)`,
                  backgroundColor:
                    h.activeSec === 0
                      ? 'var(--color-line)'
                      : 'var(--color-ok)',
                  opacity: isHover || isNow || hover === null ? 1 : 0.45,
                }}
              />
              {/*
                ⭐ এখনকার ঘণ্টাটা নিচে একটা সরু দাগ দিয়ে চিহ্নিত — লাইভ
                   বোর্ডে "আমরা দিনের কোথায়" প্রশ্নটা সবসময় থাকে।
              */}
              {isNow && (
                <span className="absolute inset-x-0 -bottom-[3px] h-[2px] rounded-full bg-ink" />
              )}
            </button>
          );
        })}
      </div>

      {/*
        ⚠️ ২৪টা ঘণ্টার লেবেল পাশাপাশি ধরে না — তাই প্রতি ছয় ঘণ্টায় একটা।
           সবগুলো বসালে ফোনে লেখাগুলো একটার উপর আরেকটা উঠে যেত।
      */}
      <div className="mt-2 flex justify-between text-[10.5px] text-ink-3">
        {[0, 6, 12, 18, 23].map((h) => (
          <span key={h} className="num">
            {hourLabel(h)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** `09:00` — ঢাকার স্থানীয় ঘণ্টা, দুই অঙ্কে */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
