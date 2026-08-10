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
   * ⭐ **গতকাল পর্যন্ত** যত ঘণ্টা হওয়ার কথা ছিল — আজকের টার্গেট বাদ দিয়ে।
   *
   * ⚠️ এটাই এই ফাইলের সবচেয়ে জরুরি সিদ্ধান্ত। `monthly_summary.pace_sec`
   * সরাসরি ব্যবহার করলে চলত না: ওখানে `workdays_elapsed` **আজকের দিনটাও**
   * গোনে, তাই সন্ধ্যা ৬:৩০-এ প্রত্যাশার মধ্যে আজকের পুরো ৮ ঘণ্টা ধরা থাকে,
   * অথচ দিনটা তখনো শেষ হয়নি। ফলে "পিছিয়ে" তালিকায় **প্রতিদিন সবাই** থাকত,
   * আর তালিকাটা তিন দিনেই পড়া বন্ধ হয়ে যেত।
   *
   * আজকের টার্গেট বাদ দেওয়ায় হিসাবটা ইচ্ছাকৃতভাবে **উদার**: আজকের কাজ
   * পুরো গোনা হয়, আজকের দাবি গোনা হয় না। তাই এই তালিকায় নাম ওঠা মানে
   * শেষ হয়ে যাওয়া দিনগুলোরই প্রকৃত ঘাটতি — একটা মিথ্যে অ্যালার্ম নয়।
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
    // মাসের টার্গেট আজ পর্যন্ত, বিয়োগ আজকের টার্গেট = গতকাল পর্যন্ত
    const expectedHours = Math.max(
      0,
      round2((month?.targetHours ?? 0) - day.targetHours),
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
    digest.behind.length > 0 ? ` · ${digest.behind.length} জন পিছিয়ে` : '';
  return `[oXeio] দৈনিক সারাংশ ${digest.workDate} · ${h(digest.totals.hoursToday)} ঘণ্টা${behind}`;
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
    `${orgName} — দৈনিক সারাংশ · ${digest.workDate} (ঢাকা)`,
    '',
    `আজকের ঘণ্টা — মোট ${h(totals.hoursToday)}, ` +
      `${totals.workedToday}/${totals.employees} জন কাজ করেছেন`,
  ];

  if (digest.rows.length === 0) {
    lines.push('  (আজ কোনো কর্মী কর্মরত নেই)');
  }

  for (const r of digest.rows) {
    const target = r.offToday ? 'ছুটি' : `${h(r.todayTargetHours)} টার্গেট`;
    lines.push(
      `  • ${r.fullName} (${r.empCode}) — ${h(r.todayHours)} ঘণ্টা · ${target}`,
    );
  }

  lines.push('', `মাসের টার্গেটের চেয়ে পিছিয়ে — ${digest.behind.length} জন`);

  if (digest.behind.length === 0) {
    lines.push('  • কেউ নন।');
  }

  for (const r of digest.behind) {
    lines.push(
      `  • ${r.fullName} (${r.empCode}) — ${h(Math.abs(r.paceHours))} ঘণ্টা পিছিয়ে ` +
        `(গোনা ${h(r.monthHours)} · হওয়ার কথা ${h(r.expectedHours)})`,
    );
  }

  if (digest.idle.length > 0) {
    lines.push('', `আজ কর্মদিবস, অথচ কোনো কাজ নেই — ${digest.idle.length} জন`);
    for (const r of digest.idle) {
      lines.push(`  • ${r.fullName} (${r.empCode})`);
    }
  }

  lines.push(
    '',
    'সংখ্যাগুলো কীভাবে পড়বেন',
    `  • হিসাবের সময়: ${digest.monthFrom} — ${digest.monthTo}।`,
    '  • "ঘণ্টা" মানে credited — কাজ + owner-এর দেওয়া সংশোধন।',
    '  • পিছিয়ে থাকার হিসাবে আজকের টার্গেট ধরা হয়নি, কারণ দিনটা এখনো শেষ হয়নি।',
    '    তাই এই তালিকার ঘাটতি শেষ হয়ে যাওয়া দিনগুলোর।',
    '  • কেন কারো ঘণ্টা শূন্য (এজেন্ট বন্ধ, PC বন্ধ, না কি ছুটি) — সেটা এই',
    '    ইমেইল বলে না; ওই উত্তর অ্যালার্টে ও ড্যাশবোর্ডে।',
    '  • বিস্তারিত (কোন অ্যাপ, কোন সাইট, ছবি) শুধু ড্যাশবোর্ডে — ইমেইলে নয়।',
  );

  return lines.join('\n');
}
