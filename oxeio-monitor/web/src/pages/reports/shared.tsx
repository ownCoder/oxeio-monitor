import type { ReactNode } from 'react';

import type { DayType, ReportMeta, UsageCategory } from '../../api/reports';
import { Caveat } from '../../components/States';
import {
  formatDate,
  formatDateTime,
  formatHoursAsDuration,
  parseWorkDate,
} from '../../lib/format';

/**
 * চারটে রিপোর্ট ট্যাবের সাধারণ টুকরোগুলো।
 *
 * ⭐ `meta` দেখানোর কাজটা এক জায়গায় রাখা হয়েছে, কারণ ওখানেই দুটো জিনিস
 * আছে যা **লুকিয়ে ফেলা সবচেয়ে সহজ আর সবচেয়ে ক্ষতিকর** — ছেঁটে দেওয়া রেঞ্জ
 * (`clampedToToday`) আর বাদ পড়া কর্মী (`excludedEmployees`)। প্রতিটা ট্যাবে
 * আলাদা করে লিখলে একটায় ভুলে যাওয়া প্রায় নিশ্চিত ছিল।
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * F08 — এক রিকোয়েস্টে সর্বোচ্চ কত দিন।
 * ⚠️ সংখ্যাটা সার্ভারের `reports/reports.range.ts` → `MAX_RANGE_DAYS`-এর
 *    প্রতিলিপি। বড় রেঞ্জ চাইলে সার্ভার ৪০০ দেয়; এখানে আগেই ধরে ফেলা হয়
 *    যাতে একটা নিশ্চিত-ব্যর্থ রিকোয়েস্ট পাঠাতেই না হয়।
 */
export const MAX_REPORT_DAYS = 370;

/** দুই প্রান্তসহ দিনসংখ্যা। তারিখ অবৈধ হলে ০ — NaN নয়। */
export function rangeDays(from: string, to: string): number {
  const start = parseWorkDate(from);
  const end = parseWorkDate(to);
  if (!start || !end) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

/**
 * রেঞ্জ, তৈরির সময়, আর যা যা বলা দরকার।
 *
 * ⚠️ `clampedToToday` সত্যি হলে **বলতেই হবে**। "১–৩১ আগস্ট" চেয়ে ১১ তারিখ
 *    পর্যন্ত ডেটা পেয়ে কেউ ভাবত সবাই বিশাল পিছিয়ে আছে — অথচ বাকি দিনগুলো
 *    এখনো আসেইনি।
 *
 * ⚠️ `excludedEmployees` — যাদের রাখা যায়নি, নাম ধরে। চুপচাপ বাদ দিলে
 *    "সবাই আছে" ধরে নিয়ে কেউ মিলিয়ে দেখত না।
 */
export function MetaNote({ meta }: { meta: ReportMeta }) {
  return (
    <div className="mt-3">
      <p className="text-[11.5px] text-ink-3">
        <span className="num">{formatDate(meta.from)}</span> —{' '}
        <span className="num">{formatDate(meta.to)}</span> ·{' '}
        <span className="num">{meta.days}</span> days · generated{' '}
        <span className="num">{formatDateTime(meta.generatedAt)}</span>
      </p>

      {meta.clampedToToday && (
        <Caveat>
          Data was requested up to{' '}
          <b className="num">{formatDate(meta.requestedTo)}</b>, but future days
          have none — so this shows up to{' '}
          <b className="num">{formatDate(meta.to)}</b>. The targets for the
          remaining days are not added in here.
        </Caveat>
      )}

      {meta.excludedEmployees.length > 0 && (
        <Caveat>
          These <span className="num">{meta.excludedEmployees.length}</span>{' '}
          could not be included (inactive, with no last working day on file):{' '}
          {meta.excludedEmployees.join(', ')}
        </Caveat>
      )}

      {/*
        ⭐⭐ G108 — সংখ্যাগুলো ভুল নয়, কিন্তু **অনিশ্চিত**, আর সেটাই এতদিন
        অদৃশ্য ছিল। চান্দ্র ছুটির তারিখ চাঁদ দেখার পর নড়ে; নড়লে ওই মাসের
        কর্মদিবস বদলায়, তার সাথে দৈনিক টার্গেটের হর আর পে-রোলের `d ÷ D`।

        ⚠️⚠️ যে সময়ে এটা ধরা পড়ত সেটাই সবচেয়ে খারাপ সময়: ঘোষণা এসে তারিখ
        সরার পর — অর্থাৎ সংখ্যাটা তখন ইতিমধ্যে ছাপা ও বিলি হয়ে গেছে।

        ⚠️ তালিকাটা `meta` থেকেই, নতুন করে গোনা হয় না — গুনলে অনিশ্চয়তার
        দ্বিতীয় সংজ্ঞা দাঁড়াত, আর একদিন পর্দা ও Excel দুই তালিকা দেখাত।
      */}
      {meta.approximateHolidayDates.length > 0 && (
        <Caveat>
          <span className="num">{meta.approximateHolidayDates.length}</span>{' '}
          holiday date
          {meta.approximateHolidayDates.length > 1 ? 's' : ''} in this range{' '}
          {meta.approximateHolidayDates.length > 1 ? 'are' : 'is'} not final yet
          (
          {meta.approximateHolidayDates.map((d, i) => (
            <span key={d}>
              {i > 0 && ', '}
              <b className="num">{formatDate(d)}</b>
            </span>
          ))}
          ). Lunar dates move after the moon is sighted — if one moves, the
          working days for that month change, and so do the target hours and the
          payroll day fraction.
        </Caveat>
      )}
    </div>
  );
}

/**
 * সরু আউটলাইন চিপ — দিনের ধরন, ক্যাটাগরি, অ্যাপ/সাইট।
 * ⚠️ সলিড লাল **নয়**। এগুলো কোনো সমস্যা নয়, শুধু শ্রেণিবিভাগ।
 */
export function Pill({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap ${
        muted ? 'border-line text-ink-3' : 'border-line bg-paper text-ink-2'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * সমন্বয়ের ঘণ্টা — **চিহ্ন সহ**।
 *
 * ⭐⚠️ এখানে `<Hours>` ব্যবহার করা যায় না। `formatDuration()` ভেতরে
 *    `Math.max(0, …)` করে, তাই −১.৫ ঘণ্টার সমন্বয় পর্দায় "0মি" হয়ে যেত —
 *    অর্থাৎ **কেটে নেওয়া ঘণ্টা একেবারে অদৃশ্য**। অথচ `delta_sec` ঋণাত্মক
 *    হতেই পারে (schema: "+ = ঘণ্টা ফেরত · − = কেটে নেওয়া"), আর কারো ঘণ্টা
 *    কেটে নেওয়া হলে সেটাই রিপোর্টের সবচেয়ে জরুরি সংখ্যা।
 *
 * ⚠️ শূন্য হলে `—`, `0মি` নয়: বেশিরভাগ সারিতেই কোনো সমন্বয় থাকে না, আর
 *    কলামজুড়ে "0মি" থাকলে যেখানে সত্যিই সমন্বয় হয়েছে সেটা চোখেই পড়ত না।
 */
export function SignedHours({ hours }: { hours: number }) {
  if (!Number.isFinite(hours) || hours === 0) {
    return <span className="num text-ink-3">—</span>;
  }

  const negative = hours < 0;
  return (
    <span className={`num ${negative ? 'text-brand-ink' : 'text-ink-2'}`}>
      {negative ? '−' : '+'}
      {formatHoursAsDuration(Math.abs(hours))}
    </span>
  );
}

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  workday: 'Workday',
  weekly_off: 'Weekly off',
  holiday: 'Holiday',
};

export const CATEGORY_LABEL: Record<UsageCategory, string> = {
  productive: 'Productive',
  neutral: 'Neutral',
  unproductive: 'Unproductive',
  uncategorized: 'Uncategorized',
};

/**
 * ⚠️ বড় রেঞ্জে সারি হাজারে পৌঁছায় (৩৭০ দিন × ১৫ জন = ৫৫৫০)। সবগুলো DOM-এ
 *    বসালে পেজটা কয়েক সেকেন্ডের জন্য জমে যেত, অথচ পর্দায় কেউ দুশোর বেশি
 *    সারি পড়ে না। তাই কেটে দেখানো হয় — কিন্তু **চুপচাপ নয়**, আর পুরোটা
 *    যে Excel-এ আছে সেটাও বলে দেওয়া হয়।
 */
export const MAX_SHOWN_ROWS = 500;

export function TrimmedNote({ total }: { total: number }) {
  return (
    <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
      Showing the first <span className="num">{MAX_SHOWN_ROWS}</span> of{' '}
      <span className="num">{total}</span> rows — the full list is in the Excel
      file.
    </p>
  );
}
