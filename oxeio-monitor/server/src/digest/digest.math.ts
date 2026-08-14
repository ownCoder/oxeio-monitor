import type { AttendanceRow, SummaryRow } from '../reports/reports.types';

/**
 * F07 — দৈনিক ডাইজেস্টের সব হিসাব ও ইমেইলের লেখা। খাঁটি ফাংশন, কোনো I/O নেই।
 *
 * ⭐ **এখানে কোনো নতুন সংজ্ঞা নেই।** ঘণ্টা, টার্গেট, ছুটি, কর্মদিবস — সব
 * আসে `ReportsService`-এর তৈরি করা F01/F02 সারি থেকে। ইচ্ছে করলে এখানে
 * `daily_summary` আর work policy সরাসরি পড়ে টার্গেট বের করা যেত, কিন্তু
 * তাতে ছুটির ক্যালেন্ডার ও দৈনিক টার্গেটের **তৃতীয় একটা বাস্তবায়ন** তৈরি
 * হতো — আর একদিন ইমেইল বলত ৮.০০ ঘণ্টা টার্গেট, রিপোর্ট বলত ৭.৯৪, আর
 * কোনটা সত্যি কেউ বলতে পারত না। ডাইজেস্ট তাই রিপোর্টেরই কণ্ঠস্বর।
 *
 * ⭐⭐ **"এ পর্যন্ত কত হওয়ার কথা ছিল"-ও এখন রিপোর্টের meta থেকেই আসে**
 * (`expectedHours`)। আগে এটুকু এখানে নিজে গোনা হতো — মাসের টার্গেট বিয়োগ
 * আজকের টার্গেট — আর সেটাই ছিল প্রত্যাশার জানালার একটা আলাদা সংজ্ঞা,
 * যেটা "ট্র্যাকিং কবে শুরু" ধারণাটা চিনত না। ফলে ইমেইল আর ড্যাশবোর্ড একই
 * কর্মীর নামে দু-রকম ঘাটতি বলত।
 *
 * ⚠️ **এই ইমেইলে কখনো স্ক্রিনশট, অ্যাপের নাম বা ডোমেইন যায় না** — শুধু
 * ঘণ্টা। ইমেইল ফরওয়ার্ড হয়, আর্কাইভ হয়, ফোনে নোটিফিকেশনে ভেসে ওঠে;
 * কারো ব্রাউজিং ওখানে পাঠানো মানে ড্যাশবোর্ডের role-এর দেয়ালটা কার্যত
 * তুলে দেওয়া। এই ফাইলের কোনো টাইপে ডোমেইন বা ফাইলের নামের জায়গাই নেই —
 * সেটা দুর্ঘটনা নয়।
 *
 * ⚠️ **টাকার কোনো কথা নেই** — বেতন owner-only ও audit করা (ADR-023)।
 */

/** ঘণ্টা দুই দশমিকে — ইমেইলের সব সংখ্যা একই চেহারার */
function h(hours: number): string {
  return hours.toFixed(2);
}

/** দুই দশমিকে গোল করা (রিপোর্টের ঘণ্টাগুলো এমনিতেই দুই দশমিকে) */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface DigestRow {
  employeeId: number;
  empCode: string;
  fullName: string;
  /** আজকের `credited` ঘণ্টা — কাজ + owner-এর সংশোধন */
  todayHours: number;
  /** আজকের টার্গেট; ছুটির দিনে ০ */
  todayTargetHours: number;
  /** আজ কর্মদিবস নয় (সাপ্তাহিক ছুটি বা ক্যালেন্ডার ছুটি) */
  offToday: boolean;
  /** কর্মদিবস, অথচ আজ একটুও কাজ হয়নি */
  idleToday: boolean;
  /** চলতি মাসে আজ পর্যন্ত মোট `credited` */
  monthHours: number;
  /**
   * ⭐⭐ **গতকাল পর্যন্ত** যত ঘণ্টা হওয়ার কথা ছিল।
   *
   * ⚠️ সংখ্যাটা এখানে **হিসাব করা হয় না** — সোজা `ReportMeta.expectedHours`
   * থেকে আসে, অর্থাৎ `summary.math.ts`-এর `elapsedWindow()` যে জানালাটা
   * ঠিক করে ঠিক সেটাই। tray, Live Board আর Monthly পাতা একই সংখ্যা দেখায়।
   *
   * ⚠️⚠️ আগে এটা `মাসের টার্গেট (১ তারিখ→আজ) − আজকের টার্গেট` করে বের করা
   * হতো। **আজকের দিনটা বাদ** — ওই অংশটা ঠিকই ছিল, আর কারণটাও জরুরি:
   * `monthly_summary.pace_sec` সেই সময় আজকের দিনটাও গুনত, তাই সন্ধ্যা
   * ৬:৩০-এ প্রত্যাশার মধ্যে আজকের পুরো ৮ ঘণ্টা ধরা থাকত অথচ দিনটা শেষ
   * হয়নি — "পিছিয়ে" তালিকায় প্রতিদিন সবাই থাকত আর তালিকাটা তিন দিনেই পড়া
   * বন্ধ হয়ে যেত।
   *
   * ⚠️ কিন্তু **শুরুটা ভুল ছিল**: গোনা হতো মাসের ১ তারিখ থেকে, অথচ এই
   * ইনস্টলেশনে এজেন্ট বসেছে ১৩ আগস্ট। এজেন্ট বসার আগের দিনগুলো নীরবে
   * "০ ঘণ্টা কাজ" হয়ে যেত, আর ইমেইল প্রত্যেককে ~৯৪ ঘণ্টা পিছিয়ে দেখাত।
   * **অনুপস্থিত পর্যবেক্ষণ ব্যর্থতা নয়।**
   *
   * হিসাবটা এখনো ইচ্ছাকৃতভাবে **উদার**: আজকের কাজ পুরো গোনা হয়, আজকের
   * দাবি গোনা হয় না। তাই এই তালিকায় নাম ওঠা মানে শেষ হয়ে যাওয়া ও
   * **দেখা হয়েছে** এমন দিনগুলোরই প্রকৃত ঘাটতি — মিথ্যে অ্যালার্ম নয়।
   */
  expectedHours: number;
  /** `monthHours − expectedHours`; ঋণাত্মক = পিছিয়ে */
  paceHours: number;
  behind: boolean;
}

export interface Digest {
  /** ঢাকার আজকের তারিখ, YYYY-MM-DD */
  workDate: string;
  /** মাসের যে অংশ হিসাবে এসেছে */
  monthFrom: string;
  monthTo: string;
  /** এমপ কোড অনুযায়ী সাজানো — রিপোর্টের সাথে একই ক্রম */
  rows: DigestRow[];
  /** সবচেয়ে বেশি পিছিয়ে আগে */
  behind: DigestRow[];
  /** কর্মদিবস, অথচ আজ শূন্য */
  idle: DigestRow[];
  totals: {
    employees: number;
    /** আজ কারা কিছু না কিছু করেছেন */
    workedToday: number;
    /** আজকের মোট credited ঘণ্টা */
    hoursToday: number;
  };
}

export interface DigestSource {
  workDate: string;
  monthFrom: string;
  monthTo: string;
  /** F01, ঠিক একটি দিনের (আজকের) সারি */
  today: readonly AttendanceRow[];
  /** F02 `groupBy=month`, মাসের ১ তারিখ → আজ */
  month: readonly SummaryRow[];
  /**
   * ⭐⭐ F02-এর `meta.expectedHours` — কর্মীপ্রতি "গতকাল পর্যন্ত কত হওয়ার
   * কথা ছিল", **সার্ভারের একমাত্র সংজ্ঞা** থেকে।
   *
   * ⚠️ এখানে নিজে গুনে নেওয়া যেত (মাসের টার্গেট বিয়োগ আজকের টার্গেট),
   * আর আগে তাই করা হতো — কিন্তু তাতে জানালার একটা **দ্বিতীয় সংজ্ঞা**
   * দাঁড়াত, যেটা ট্র্যাকিং শুরুর দিনটা চিনত না। ইমেইল আর ড্যাশবোর্ড তখন
   * একই কর্মীর নামে দু-রকম ঘাটতি বলত, আর কোনটা সত্যি তার উত্তর থাকত না।
   *
   * ⚠️ কারো এন্ট্রি না থাকলে `0` ধরা হয়, অর্থাৎ "তার নামে কোনো দাবি নেই"।
   * দিকটা ইচ্ছাকৃত: অজানাকে **ঘাটতি** বলে ধরলে সেটা একজন মানুষ সম্পর্কে
   * একটা অভিযোগ হয়ে যেত।
   */
  expectedHours: Readonly<Record<number, number>>;
}

/**
 * F01 + F02 → ডাইজেস্টের সারি।
 *
 * ⚠️ ভিত্তি **আজকের অ্যাটেনডেন্স সারি**, কর্মীর তালিকা নয়। যিনি আজ
 * কর্মরত নন (যোগ দেননি বা ছেড়ে গেছেন) তাঁর সারি F01-এই থাকে না, আর
 * ইমেইলেও থাকা উচিত নয় — নইলে ছেড়ে যাওয়া কর্মী রোজ "০ ঘণ্টা" নিয়ে
 * তালিকায় বসে থাকতেন।
 *
 * ⚠️ **"কেন শূন্য" সেটা এখানে বলার চেষ্টা করা হয় না।** এজেন্ট বন্ধ, PC
 * বন্ধ, না কি সত্যিই কাজ হয়নি — তার উত্তর অ্যালার্টে (G01 · G06), আর
 * সেখানে heartbeat ও tamper দুটোই দেখা হয়। এখানে আবার আন্দাজ করলে
 * দ্বিতীয় একটা দুর্বল agent-down সনাক্তকারী তৈরি হতো, যেটা মাঝে মাঝে
 * অন্য কথা বলত।
 */
export function buildDigest(source: DigestSource): Digest {
  const monthBy = new Map<number, SummaryRow>();
  for (const row of source.month) {
    // ⚠️ `groupBy=month` হলেও রেঞ্জ দুই মাসে ছড়ালে একজনের দুটো সারি আসত।
    //    ডাইজেস্ট চলতি মাসের ১ তারিখ থেকে চায়, তাই একটাই — তবু শেষেরটাই
    //    রাখা হয় যাতে ভুল করে বড় রেঞ্জ এলে অন্তত **সাম্প্রতিক** মাসটা বসে।
    monthBy.set(row.employeeId, row);
  }

  const rows: DigestRow[] = source.today.map((day) => {
    const month = monthBy.get(day.employeeId);

    const monthHours = month?.creditedHours ?? 0;

    /**
     * ⭐ সার্ভারের হিসাব করা জানালা — ট্র্যাকিং শুরু থেকে গতকাল পর্যন্ত।
     * ⚠️ `Math.max(0, …)` রাখা হয়েছে: সার্ভার ঋণাত্মক পাঠায় না, কিন্তু
     *    "প্রত্যাশা −৩ ঘণ্টা" কথাটার কোনো মানে নেই, আর একটা ভুল সংখ্যা
     *    এখানে ইমেইলে ছাপা হয়ে যেত।
     */
    const expectedHours = Math.max(
      0,
      round2(source.expectedHours[day.employeeId] ?? 0),
    );
    const paceHours = round2(monthHours - expectedHours);
    const offToday = day.dayType !== 'workday';

    return {
      employeeId: day.employeeId,
      empCode: day.empCode,
      fullName: day.fullName,
      todayHours: day.creditedHours,
      todayTargetHours: day.targetHours,
      offToday,
      idleToday: !offToday && day.status === 'no_activity',
      monthHours,
      expectedHours,
      paceHours,
      /**
       * ⚠️ কোনো সহনশীলতা (`< -0.5 ঘণ্টা` জাতীয়) ধরে নেওয়া হয়নি। "কত
       * পিছিয়ে থাকলে জানানো দরকার" সেটা ব্যবসায়িক সিদ্ধান্ত, কেউ নেয়নি;
       * একটা সংখ্যা বসিয়ে দিলে সেটাই নীরবে নীতি হয়ে যেত। বদলে ইমেইলে
       * আসল ঘণ্টাটাই লেখা থাকে, আর কতটা গুরুতর সেটা পাঠক ঠিক করেন।
       */
      behind: paceHours < 0,
    };
  });

  rows.sort((a, b) => (a.empCode < b.empCode ? -1 : a.empCode > b.empCode ? 1 : 0));

  const behind = rows
    .filter((r) => r.behind)
    // বেশি পিছিয়ে আগে; সমান হলে কোডের ক্রমে — একই দিনের দুটো রান একই ইমেইল
    .sort((a, b) => a.paceHours - b.paceHours || (a.empCode < b.empCode ? -1 : 1));

  return {
    workDate: source.workDate,
    monthFrom: source.monthFrom,
    monthTo: source.monthTo,
    rows,
    behind,
    idle: rows.filter((r) => r.idleToday),
    totals: {
      employees: rows.length,
      workedToday: rows.filter((r) => r.todayHours > 0).length,
      hoursToday: round2(rows.reduce((sum, r) => sum + r.todayHours, 0)),
    },
  };
}

// ── ইমেইলের লেখা ─────────────────────────────────────────────────────────────

/**
 * ⚠️ subject-এ কারো নাম নেই।
 *
 * ইমেইলের বিষয় ফোনের লক স্ক্রিনে, প্রিভিউ প্যানেলে আর ফরোয়ার্ড করা
 * থ্রেডের মাথায় ভেসে থাকে — সেখানে "করিম ৩ ঘণ্টা পিছিয়ে" লেখা থাকা মানে
 * একজন কর্মীর হিসাব এমন লোকের চোখে পড়া যিনি ইমেইলটা খোলেননি।
 * সংখ্যা নিরাপদ, নাম নয়।
 */
export function digestSubject(digest: Digest): string {
  const behind =
    digest.behind.length > 0 ? ` · ${digest.behind.length} behind` : '';
  return `[oXeio] Daily summary ${digest.workDate} · ${h(digest.totals.hoursToday)}h${behind}`;
}

/**
 * প্লেইন টেক্সট বডি।
 *
 * ⚠️ ছাপার মতো কলাম সাজানোর চেষ্টা করা হয়নি (`padEnd` ইত্যাদি)। বাংলা
 * অক্ষরের প্রস্থ ফন্টে ফন্টে আলাদা আর যুক্তাক্ষর একাধিক code unit — তাই
 * সাজানো কলাম কারো কারো ক্লায়েন্টে সোজা, কারো কারোটায় এলোমেলো দেখাত।
 * সরল বুলেট সব জায়গায় একরকম পড়া যায়।
 */
export function digestBody(digest: Digest, orgName: string): string {
  const { totals } = digest;
  const lines: string[] = [
    `${orgName} — Daily summary · ${digest.workDate} (Dhaka)`,
    '',
    `Hours today — ${h(totals.hoursToday)} total, ` +
      `${totals.workedToday}/${totals.employees} staff worked`,
  ];

  if (digest.rows.length === 0) {
    lines.push('  (no staff are active today)');
  }

  for (const r of digest.rows) {
    const target = r.offToday ? 'Off' : `${h(r.todayTargetHours)} target`;
    lines.push(
      `  • ${r.fullName} (${r.empCode}) — ${h(r.todayHours)}h · ${target}`,
    );
  }

  lines.push('', `Behind the monthly target — ${digest.behind.length} staff`);

  if (digest.behind.length === 0) {
    lines.push('  • Nobody.');
  }

  for (const r of digest.behind) {
    lines.push(
      `  • ${r.fullName} (${r.empCode}) — ${h(Math.abs(r.paceHours))}h behind ` +
        `(counted ${h(r.monthHours)} · expected ${h(r.expectedHours)})`,
    );
  }

  if (digest.idle.length > 0) {
    lines.push('', `Workday today, but no work at all — ${digest.idle.length} staff`);
    for (const r of digest.idle) {
      lines.push(`  • ${r.fullName} (${r.empCode})`);
    }
  }

  lines.push(
    '',
    'How to read these numbers',
    `  • Period covered: ${digest.monthFrom} — ${digest.monthTo}.`,
    '  • "Hours" means credited — work plus adjustments made by the owner.',
    "  • The behind figures leave out today's target, because the day is not over",
    '    yet. So the shortfall listed here is from days that have already ended.',
    // ⭐ এই লাইনটা না থাকলে পাঠক ধরে নিতেন প্রত্যাশা মাসের ১ তারিখ থেকে গোনা,
    //    আর এজেন্ট বসার আগের দিনগুলো নীরবে কারো ঘাটতি হয়ে যেত।
    '  • They also leave out any day before tracking started for that person —',
    '    days nobody was measuring are not counted as a shortfall.',
    '  • Why someone has zero hours (agent down, PC off, or a day off) is not',
    '    answered by this email; that answer is in the alerts and on the dashboard.',
    '  • Details (which app, which site, screenshots) are on the dashboard only —',
    '    never in email.',
  );

  return lines.join('\n');
}
