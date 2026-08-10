import { describe, expect, it } from 'vitest';

import {
  buildDigest,
  digestBody,
  digestSubject,
  type DigestSource,
} from '../src/digest/digest.math';
import type { AttendanceRow, SummaryRow } from '../src/reports/reports.types';

/**
 * F07 — দৈনিক ডাইজেস্ট।
 *
 * ⭐ এখানকার প্রতিটা ভুল **নীরব**: ইমেইলটা ঠিকই যেত, শুধু ভেতরের কথাটা
 * ভুল হতো। সবচেয়ে বড় দুটো — (১) "পিছিয়ে" তালিকায় প্রতিদিন সবাইকে বসিয়ে
 * দেওয়া, (২) ইমেইলে ডোমেইন/স্ক্রিনশট ফাঁস করা।
 */

function day(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    employeeId: 1,
    empCode: 'OX-001',
    fullName: 'Jane Doe',
    department: null,
    date: '2026-08-11',
    dayType: 'workday',
    status: 'worked',
    workedHours: 7.5,
    idleHours: 0.5,
    adjustmentHours: 0,
    creditedHours: 7.5,
    targetHours: 8,
    ...over,
  };
}

function month(over: Partial<SummaryRow> = {}): SummaryRow {
  return {
    employeeId: 1,
    empCode: 'OX-001',
    fullName: 'Jane Doe',
    bucket: '2026-08',
    bucketStart: '2026-08-01',
    bucketEnd: '2026-08-11',
    workdays: 9,
    daysWithWork: 9,
    workedHours: 72,
    adjustmentHours: 0,
    creditedHours: 72,
    // ৯ কর্মদিবস × ৮ ঘণ্টা — **আজকের দিনটাসহ**
    targetHours: 72,
    shortfallHours: 0,
    overtimeHours: 0,
    ...over,
  };
}

function source(over: Partial<DigestSource> = {}): DigestSource {
  return {
    workDate: '2026-08-11',
    monthFrom: '2026-08-01',
    monthTo: '2026-08-11',
    today: [day()],
    month: [month()],
    ...over,
  };
}

describe('buildDigest — আজকের টার্গেট বাদ দেওয়া', () => {
  it('⭐ প্রত্যাশা গোনা হয় গতকাল পর্যন্ত — আজকের ৮ ঘণ্টা বাদ', () => {
    // মাসের টার্গেট আজ পর্যন্ত ৭২, আজকের টার্গেট ৮ → গতকাল পর্যন্ত ৬৪
    const digest = buildDigest(source());

    expect(digest.rows[0].expectedHours).toBe(64);
    expect(digest.rows[0].paceHours).toBe(8);
    expect(digest.rows[0].behind).toBe(false);
  });

  it('⭐⭐ ঠিক টার্গেট ধরে চলা কেউ সন্ধ্যা ৬:৩০-এ "পিছিয়ে" হন না', () => {
    // এটাই আসল ফাঁদ: `monthly_summary.pace_sec` ব্যবহার করলে এই লোক
    // ০.৫ ঘণ্টা পিছিয়ে দেখাতেন (আজকের পুরো ৮ ঘণ্টা প্রত্যাশায় ধরা থাকত),
    // আর তালিকায় প্রতিদিন সবাই থাকত
    const digest = buildDigest(
      source({
        today: [day({ creditedHours: 7.5 })],
        month: [month({ creditedHours: 71.5, targetHours: 72 })],
      }),
    );

    expect(digest.behind).toHaveLength(0);
    expect(digest.rows[0].paceHours).toBe(7.5);
  });

  it('আগের দিনগুলোর আসল ঘাটতি ধরা পড়ে', () => {
    // গতকাল পর্যন্ত ৬৪ হওয়ার কথা, হয়েছে ৫০ → ১৪ ঘণ্টা পিছিয়ে
    const digest = buildDigest(
      source({
        today: [day({ creditedHours: 0, status: 'no_activity' })],
        month: [month({ creditedHours: 50 })],
      }),
    );

    expect(digest.rows[0].paceHours).toBe(-14);
    expect(digest.behind).toHaveLength(1);
  });

  it('⚠️ প্রত্যাশা কখনো ঋণাত্মক নয় — মাসের প্রথম কর্মদিবসে', () => {
    // ১ তারিখে মাসের টার্গেট = আজকের টার্গেট, বিয়োগ করলে ঠিক ০
    const digest = buildDigest(
      source({
        today: [day({ targetHours: 8, creditedHours: 3 })],
        month: [month({ targetHours: 8, creditedHours: 3, workdays: 1 })],
      }),
    );

    expect(digest.rows[0].expectedHours).toBe(0);
    expect(digest.rows[0].paceHours).toBe(3);
    expect(digest.behind).toHaveLength(0);
  });

  it('ছুটির দিনে আজকের টার্গেট ০, তাই প্রত্যাশা মাসের পুরোটাই', () => {
    const digest = buildDigest(
      source({
        today: [day({ dayType: 'weekly_off', targetHours: 0, creditedHours: 0, status: 'no_activity' })],
        month: [month({ targetHours: 64, creditedHours: 64 })],
      }),
    );

    expect(digest.rows[0].offToday).toBe(true);
    expect(digest.rows[0].expectedHours).toBe(64);
    // ⚠️ ছুটির দিনে কাজ না করা "কোনো কাজ নেই" তালিকায় ওঠে না
    expect(digest.rows[0].idleToday).toBe(false);
    expect(digest.idle).toHaveLength(0);
  });
});

describe('buildDigest — তালিকা ও ক্রম', () => {
  it('মাসের সারি না থাকলেও সারিটা থাকে, শূন্য ধরে', () => {
    const digest = buildDigest(source({ month: [] }));

    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0].monthHours).toBe(0);
    expect(digest.rows[0].expectedHours).toBe(0);
  });

  it('⚠️ ভিত্তি আজকের অ্যাটেনডেন্স সারি — মাসে আছে কিন্তু আজ নেই, এমন কেউ ঢোকে না', () => {
    // যিনি গতকাল ছেড়ে গেছেন তাঁর আজকের সারি F01-এ নেই; তবু মাসের
    // সারি আছে। ইমেইলে রোজ "০ ঘণ্টা" নিয়ে বসে থাকা চলবে না।
    const digest = buildDigest(
      source({
        today: [],
        month: [month({ employeeId: 9, empCode: 'OX-009' })],
      }),
    );

    expect(digest.rows).toHaveLength(0);
    expect(digest.totals.employees).toBe(0);
  });

  it('সারি এমপ কোডের ক্রমে, পিছিয়ে থাকার তালিকা সবচেয়ে পিছিয়ে আগে', () => {
    const digest = buildDigest(
      source({
        today: [
          day({ employeeId: 3, empCode: 'OX-003', fullName: 'C', creditedHours: 0, status: 'no_activity' }),
          day({ employeeId: 1, empCode: 'OX-001', fullName: 'A', creditedHours: 8 }),
          day({ employeeId: 2, empCode: 'OX-002', fullName: 'B', creditedHours: 0, status: 'no_activity' }),
        ],
        month: [
          month({ employeeId: 3, empCode: 'OX-003', creditedHours: 40 }), // −২৪
          month({ employeeId: 1, empCode: 'OX-001', creditedHours: 72 }), // +৮
          month({ employeeId: 2, empCode: 'OX-002', creditedHours: 60 }), // −৪
        ],
      }),
    );

    expect(digest.rows.map((r) => r.empCode)).toEqual([
      'OX-001',
      'OX-002',
      'OX-003',
    ]);
    expect(digest.behind.map((r) => r.empCode)).toEqual(['OX-003', 'OX-002']);
    expect(digest.idle.map((r) => r.empCode)).toEqual(['OX-002', 'OX-003']);
    expect(digest.totals).toEqual({
      employees: 3,
      workedToday: 1,
      hoursToday: 8,
    });
  });

  it('আজকের মোট ঘণ্টা যোগ হয়, ভাসমান বিন্দুর লেজ ছাড়াই', () => {
    const digest = buildDigest(
      source({
        today: [
          day({ employeeId: 1, empCode: 'OX-001', creditedHours: 0.1 }),
          day({ employeeId: 2, empCode: 'OX-002', creditedHours: 0.2 }),
        ],
        month: [],
      }),
    );

    // ০.১ + ০.২ = ০.৩০০০০০০০০০০০০০০০৪ — গোল না করলে ইমেইলে ওটাই যেত
    expect(digest.totals.hoursToday).toBe(0.3);
  });
});

describe('digestSubject', () => {
  it('⚠️ subject-এ কারো নাম নেই — লক স্ক্রিনে ভেসে থাকে', () => {
    const digest = buildDigest(
      source({
        today: [day({ fullName: 'Jane Doe', creditedHours: 0, status: 'no_activity' })],
        month: [month({ creditedHours: 10 })],
      }),
    );

    const subject = digestSubject(digest);
    expect(subject).not.toContain('Jane');
    expect(subject).not.toContain('OX-001');
    expect(subject).toContain('2026-08-11');
    expect(subject).toContain('1 জন পিছিয়ে');
  });

  it('কেউ পিছিয়ে না থাকলে subject-এ ওই অংশটাই নেই', () => {
    expect(digestSubject(buildDigest(source()))).not.toContain('পিছিয়ে');
  });
});

describe('digestBody', () => {
  const digest = buildDigest(
    source({
      today: [
        day({ employeeId: 1, empCode: 'OX-001', fullName: 'মামুনুর রশিদ', creditedHours: 7.5 }),
        day({ employeeId: 2, empCode: 'OX-002', fullName: 'Jane Doe', creditedHours: 0, status: 'no_activity' }),
      ],
      month: [
        month({ employeeId: 1, empCode: 'OX-001', creditedHours: 72 }),
        month({ employeeId: 2, empCode: 'OX-002', creditedHours: 40 }),
      ],
    }),
  );
  const body = digestBody(digest, 'oXeio Office');

  it('বাংলা নাম অক্ষত — ইমেইল UTF-8, PDF-এর মতো সীমা নেই', () => {
    expect(body).toContain('মামুনুর রশিদ');
  });

  it('প্রত্যেকের আজকের ঘণ্টা ও টার্গেট থাকে', () => {
    expect(body).toContain('মামুনুর রশিদ (OX-001) — 7.50 ঘণ্টা · 8.00 টার্গেট');
  });

  it('পিছিয়ে থাকার লাইনে গোনা ও প্রত্যাশা দুটোই থাকে', () => {
    expect(body).toContain('Jane Doe (OX-002) — 24.00 ঘণ্টা পিছিয়ে');
    expect(body).toContain('গোনা 40.00');
    expect(body).toContain('হওয়ার কথা 64.00');
  });

  it('আজকের টার্গেট বাদ দেওয়ার কারণটা ইমেইলেই লেখা থাকে', () => {
    // ⭐ না লিখলে পাঠক ভাবতেন সংখ্যাটা মাসের পুরো pace, আর ড্যাশবোর্ডের
    //    সাথে না মেলায় দুটোর একটাকে "ভাঙা" ধরে নিতেন
    expect(body).toContain('আজকের টার্গেট ধরা হয়নি');
  });

  it('⚠️⚠️ কোনো ডোমেইন, প্রসেসের নাম বা URL যায় না', () => {
    // এই টেস্টটা উদ্দেশ্যের দলিল: ইমেইল ফরওয়ার্ড হয় ও আর্কাইভে থাকে,
    // তাই ওখানে কারো ব্রাউজিং পাঠানো চলবে না। `DigestRow`-এ ওসব রাখার
    // ঘরই নেই, কিন্তু কেউ একদিন একটা "top app" কলাম যোগ করতে চাইলে
    // এই লাইনটাতেই প্রথম হোঁচট খাবে।
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toMatch(/\.(com|net|org|io|exe)\b/i);
  });

  it('⚠️ টাকার কোনো কথা নেই — বেতন owner-only ও audit করা (ADR-023)', () => {
    expect(body).not.toMatch(/৳|salary|বেতন/i);
  });

  it('কেউ পিছিয়ে না থাকলে "কেউ নন" লেখা থাকে, খালি অংশ নয়', () => {
    expect(digestBody(buildDigest(source()), 'oXeio')).toContain('কেউ নন');
  });

  it('একজনও কর্মরত না থাকলেও বডি অর্থপূর্ণ থাকে', () => {
    const empty = digestBody(
      buildDigest(source({ today: [], month: [] })),
      'oXeio',
    );
    expect(empty).toContain('কোনো কর্মী কর্মরত নেই');
  });
});
