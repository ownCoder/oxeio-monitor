import type { UsageReport } from '../../api/activity';
import { formatDuration, pctOf } from '../../lib/format';

/**
 * E15 — **আজ দলটা কোন অ্যাপে সময় দিয়েছে**, সাজানো তালিকা।
 *
 * ⭐⭐ **রং দিয়ে পরিচয় বোঝানো হয় না, নাম দিয়ে বোঝানো হয়।** এই বোর্ডে
 * সবুজ = ঠিক আছে, হলুদ = নিষ্ক্রিয়, লাল = মনোযোগ দরকার — তিনটেই **অবস্থার**
 * রং। ওগুলো দিয়ে "কোন অ্যাপ কোনটা" রাঙালে অ্যালার্টের লাল আর চার্টের লাল
 * এক হয়ে যেত, আর তখন লাল দেখে আর বোঝা যেত না এখনই হাত দিতে হবে কি না।
 *
 * ⚠️ বাকি কোন হিউ নিরাপদ, সেটা চোখে আন্দাজ না করে মেপে দেখা হয়েছে (CVD
 * সিমুলেশন, OKLab ΔE): নীল↔বেগুনি **১.৪–৫.৫** — কালার-ব্লাইন্ড চোখে কার্যত
 * একই রং। নীল↔কমলা **২৪–৩১** — নিরাপদ। অর্থাৎ অবস্থার তিনটে রং বাদ দিলে
 * পরিচয়ের জন্য কার্যত **দুটোই স্লট** খোলা, আর পাঁচটা অ্যাপ রাঙানোর মতো
 * যথেষ্ট নয়।
 *
 * ⭐ তাই এখানে **একটাই হিউ, স্বচ্ছতার ধাপে** — ক্রমটা বোঝায় বারের দৈর্ঘ্য ও
 * তালিকার অবস্থান, রঙের ভিন্নতা নয়। এটা রঙের সীমা মেনে নেওয়া নয়, বরং
 * বেশি পড়ার মতো: পাঁচটা আলাদা হিউ মনে রাখতে হয়, একটা ক্রম চোখেই পড়ে।
 */
export function TopApps({ usage }: { usage: UsageReport }) {
  const rows = usage.rows.slice(0, 5);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-3">
        No app time counted yet today.
      </p>
    );
  }

  /**
   * ⚠️ হর **`totalSec`**, তালিকার যোগফল নয় — তালিকা দিয়ে ভাগ করলে সবসময়
   *    ১০০% হতো, আর "টপ ৫-ই সব" এমন একটা মিথ্যা তৈরি হতো। নিচের "everything
   *    else" সারিটাও সেই কারণেই।
   */
  const total = usage.totalSec;
  const shown = rows.reduce((s, r) => s + r.seconds, 0);
  const other = Math.max(0, total - shown);

  return (
    <ul className="flex flex-col gap-2.5 px-4 pt-1 pb-3">
      {rows.map((row, i) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="truncate">
              {row.label}
              {/*
                ⚠️ `mixed` — `chrome.exe`-এর ভেতরে ইউটিউবও আছে, ডকুমেন্টেশনও।
                   একটামাত্র ক্যাটাগরি দেখানো তখন মিথ্যা হতো, তাই কিছুই
                   দেখানো হয় না — শুধু বলা হয় যে ভেতরে মেশানো।
              */}
              {row.mixed && (
                <span className="ml-1.5 text-[10.5px] text-ink-3">mixed</span>
              )}
            </span>
            <span className="num shrink-0 text-[11.5px] text-ink-3">
              {formatDuration(row.seconds)}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-data"
              style={{
                width: `${pctOf(row.seconds, total)}%`,
                // ⭐ ক্রমই একমাত্র সংকেত — উপরেরটা নিরেট, নিচেরগুলো ক্রমে হালকা
                opacity: 1 - i * 0.16,
              }}
            />
          </div>
        </li>
      ))}

      {other > 0 && (
        <li className="text-[11.5px] text-ink-3">
          <div className="flex items-baseline justify-between gap-3">
            <span>everything else</span>
            <span className="num">{formatDuration(other)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-ink-3/40"
              style={{ width: `${pctOf(other, total)}%` }}
            />
          </div>
        </li>
      )}
    </ul>
  );
}
