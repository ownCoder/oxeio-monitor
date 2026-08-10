import { resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RunLock } from '../src/summary/scheduling';
import {
  countWorkdays,
  dhakaHourOf,
  hoursToSec,
  isInsideRoot,
  isWorkday,
  isoWeekday,
  mergeSpans,
  monthBounds,
  previousWorkDate,
  productivityPct,
  retentionCutoff,
  rollupMonth,
  summarizeDay,
  unionSec,
  type DaySegment,
} from '../src/summary/summary.math';

/** ২০৮ ঘণ্টা, সেকেন্ডে */
const TARGET = 208 * 3600;
const HOUR = 3600;

/** ঢাকার সময় লিখে UTC instant — টেস্টগুলো পড়তে সহজ হয় */
function dhaka(iso: string): Date {
  return new Date(`${iso}+06:00`);
}

function seg(
  state: DaySegment['state'],
  from: string,
  to: string,
): DaySegment {
  const startedAt = dhaka(from);
  const endedAt = dhaka(to);
  return {
    state,
    startedAt,
    endedAt,
    durationSec: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
  };
}

/** UTC-মধ্যরাত — Prisma-র `@db.Date` ও `workDateOf()` যা দেয় */
function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

// ══════════════════════════════════════════════════════════════════════════

describe('mergeSpans / unionSec — একজনের দুই ডিভাইস (§ ২.১-গ)', () => {
  it('আলাদা আলাদা খণ্ড যোগ হয়', () => {
    expect(
      unionSec([
        { startedAt: dhaka('2026-08-11T09:00:00'), endedAt: dhaka('2026-08-11T10:00:00') },
        { startedAt: dhaka('2026-08-11T11:00:00'), endedAt: dhaka('2026-08-11T12:00:00') },
      ]),
    ).toBe(2 * HOUR);
  });

  /**
   * ⭐ এই টেস্টটাই এই ফাইলের কারণ। ডেস্কটপ ও ল্যাপটপ একই সময়ে চললে
   * যোগফল দিত ৪ ঘণ্টা, অথচ মানুষটা বসেছিল ৩ ঘণ্টা।
   */
  it('একই সময়ে দুই ডিভাইস চললে সময় একবারই গোনা হয়', () => {
    const spans = [
      { startedAt: dhaka('2026-08-11T09:00:00'), endedAt: dhaka('2026-08-11T11:00:00') },
      { startedAt: dhaka('2026-08-11T10:00:00'), endedAt: dhaka('2026-08-11T12:00:00') },
    ];

    expect(unionSec(spans)).toBe(3 * HOUR);

    const naive = spans.reduce(
      (t, s) => t + (s.endedAt.getTime() - s.startedAt.getTime()) / 1000,
      0,
    );
    expect(naive).toBe(4 * HOUR); // যা হতো
  });

  it('একটা খণ্ড পুরোপুরি আরেকটার ভেতরে পড়লেও একবারই', () => {
    expect(
      unionSec([
        { startedAt: dhaka('2026-08-11T09:00:00'), endedAt: dhaka('2026-08-11T17:00:00') },
        { startedAt: dhaka('2026-08-11T10:00:00'), endedAt: dhaka('2026-08-11T11:00:00') },
      ]),
    ).toBe(8 * HOUR);
  });

  it('গা-ঘেঁষা দুটো খণ্ড এক হয়ে যায়', () => {
    const merged = mergeSpans([
      { startedAt: dhaka('2026-08-11T09:00:00'), endedAt: dhaka('2026-08-11T10:00:00') },
      { startedAt: dhaka('2026-08-11T10:00:00'), endedAt: dhaka('2026-08-11T11:00:00') },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].endedAt).toEqual(dhaka('2026-08-11T11:00:00'));
  });

  it('এলোমেলো ক্রমে এলেও ঠিক থাকে', () => {
    expect(
      unionSec([
        { startedAt: dhaka('2026-08-11T14:00:00'), endedAt: dhaka('2026-08-11T15:00:00') },
        { startedAt: dhaka('2026-08-11T09:00:00'), endedAt: dhaka('2026-08-11T11:00:00') },
        { startedAt: dhaka('2026-08-11T10:30:00'), endedAt: dhaka('2026-08-11T12:00:00') },
      ]),
    ).toBe(4 * HOUR);
  });

  it('শূন্য বা উল্টো দৈর্ঘ্যের খণ্ড বাদ পড়ে', () => {
    expect(
      unionSec([
        { startedAt: dhaka('2026-08-11T09:00:00'), endedAt: dhaka('2026-08-11T09:00:00') },
        { startedAt: dhaka('2026-08-11T12:00:00'), endedAt: dhaka('2026-08-11T11:00:00') },
      ]),
    ).toBe(0);
  });

  /** ⭐ ইনপুট Prisma-র সারি — সেগুলো বদলে গেলে কলার নীরবে ভুল ডেটা পেত */
  it('ইনপুটের অবজেক্ট বদলায় না', () => {
    const first = {
      startedAt: dhaka('2026-08-11T09:00:00'),
      endedAt: dhaka('2026-08-11T11:00:00'),
    };
    const spans = [
      first,
      { startedAt: dhaka('2026-08-11T10:00:00'), endedAt: dhaka('2026-08-11T12:00:00') },
    ];

    mergeSpans(spans);

    expect(first.endedAt).toEqual(dhaka('2026-08-11T11:00:00'));
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe('summarizeDay — একদিনের সারাংশ (K06)', () => {
  const empty = {
    screenshotCount: 0,
    adjustmentSec: 0,
    productiveSpans: [],
    unproductiveSpans: [],
    isOffDay: false,
  };

  it('active-এর কাঁচা যোগফল আর UNION আলাদা রাখে', () => {
    const n = summarizeDay({
      ...empty,
      segments: [
        seg('active', '2026-08-11T09:00:00', '2026-08-11T11:00:00'),
        seg('active', '2026-08-11T10:00:00', '2026-08-11T12:00:00'),
      ],
    });

    expect(n.activeSec).toBe(4 * HOUR); // দুই ডিভাইসের যোগফল
    expect(n.workedSec).toBe(3 * HOUR); // আসলে যতক্ষণ বসেছিল
  });

  it('locked সময়টাও idle-এ ধরা হয়', () => {
    const n = summarizeDay({
      ...empty,
      segments: [
        seg('active', '2026-08-11T09:00:00', '2026-08-11T13:00:00'),
        seg('idle', '2026-08-11T13:00:00', '2026-08-11T13:30:00'),
        seg('locked', '2026-08-11T13:30:00', '2026-08-11T14:00:00'),
      ],
    });

    expect(n.workedSec).toBe(4 * HOUR);
    expect(n.idleSec).toBe(HOUR);
  });

  it('idle বা locked কখনো কাজের সময়ে যোগ হয় না', () => {
    const n = summarizeDay({
      ...empty,
      segments: [
        seg('idle', '2026-08-11T09:00:00', '2026-08-11T17:00:00'),
        seg('locked', '2026-08-11T17:00:00', '2026-08-11T18:00:00'),
      ],
    });

    expect(n.workedSec).toBe(0);
    expect(n.creditedSec).toBe(0);
    expect(n.dayType).toBe('no_activity');
  });

  it('সংশোধন যোগ হয়ে credited হয় (§ ২.১-ঙ)', () => {
    const n = summarizeDay({
      ...empty,
      segments: [seg('active', '2026-08-11T09:00:00', '2026-08-11T11:00:00')],
      adjustmentSec: 2 * HOUR,
    });

    expect(n.workedSec).toBe(2 * HOUR);
    expect(n.creditedSec).toBe(4 * HOUR);
  });

  /** দৈনিক স্তরে ঋণাত্মক হতে দেওয়া হয় — owner-এর নির্দেশ অবিকৃত থাকে */
  it('কাজের চেয়ে বেশি কেটে নিলে দৈনিক credited ঋণাত্মক হয়', () => {
    const n = summarizeDay({
      ...empty,
      segments: [seg('active', '2026-08-11T09:00:00', '2026-08-11T10:00:00')],
      adjustmentSec: -3 * HOUR,
    });

    expect(n.creditedSec).toBe(-2 * HOUR);
  });

  it('প্রথম ও শেষ কাজের সময় ঢাকার ঘড়িতে বসে', () => {
    const n = summarizeDay({
      ...empty,
      segments: [
        seg('active', '2026-08-11T22:30:00', '2026-08-11T23:00:00'),
        seg('active', '2026-08-11T07:15:00', '2026-08-11T08:00:00'),
      ],
    });

    expect(n.firstActivityAt).toEqual(dhaka('2026-08-11T07:15:00'));
    expect(n.lastActivityAt).toEqual(dhaka('2026-08-11T23:00:00'));
    expect(n.earliestHour).toBe(7);
    expect(n.latestHour).toBe(23);
  });

  /** ⭐ § ২.১-খ — ছুটির দিনে কাজ করলে ঘণ্টা পুরোপুরি গোনা হয় */
  it('ছুটির দিনে কাজ করলে দিনটা holiday নয়, worked', () => {
    const n = summarizeDay({
      ...empty,
      segments: [seg('active', '2026-08-07T10:00:00', '2026-08-07T13:00:00')],
      isOffDay: true,
    });

    expect(n.dayType).toBe('worked');
    expect(n.workedSec).toBe(3 * HOUR);
  });

  it('ছুটির দিনে কেউ না বসলে holiday, সাধারণ দিনে no_activity', () => {
    expect(summarizeDay({ ...empty, segments: [], isOffDay: true }).dayType).toBe('holiday');
    expect(summarizeDay({ ...empty, segments: [], isOffDay: false }).dayType).toBe('no_activity');
  });

  it('কোনো সেগমেন্ট না থাকলে সময়গুলো null, শূন্য নয়', () => {
    const n = summarizeDay({ ...empty, segments: [] });

    expect(n.firstActivityAt).toBeNull();
    expect(n.lastActivityAt).toBeNull();
    expect(n.earliestHour).toBeNull();
    expect(n.productivityPct).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe('productivityPct — ক্যাটাগরির স্কোর', () => {
  it('productive ÷ (productive + unproductive)', () => {
    expect(productivityPct(3 * HOUR, HOUR)).toBe(75);
  });

  it('দুই দশমিক পর্যন্ত রাখে', () => {
    expect(productivityPct(1, 2)).toBe(33.33);
  });

  /** "কিছুই ক্যাটাগরি হয়নি" আর "সব খারাপ" — এক নয় */
  it('কোনো ক্যাটাগরি করা অ্যাপ না চললে null', () => {
    expect(productivityPct(0, 0)).toBeNull();
  });

  it('শুধু unproductive চললে ০', () => {
    expect(productivityPct(0, HOUR)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe('কর্মদিবস গোনা — § ২.১-খ', () => {
  /** ⭐ JS-এ রবিবার ০, ISO-তে ৭ — না মেলালে রবিবারের ছুটি কখনো ধরা পড়ত না */
  it('ISO সপ্তাহদিন: রবিবার ৭, শুক্রবার ৫', () => {
    expect(isoWeekday(day('2026-02-01'))).toBe(7); // রবিবার
    expect(isoWeekday(day('2026-08-07'))).toBe(5); // শুক্রবার
    expect(isoWeekday(day('2026-08-31'))).toBe(1); // সোমবার
  });

  it('রবিবার সাপ্তাহিক ছুটি (৭) দিলেও ঠিকমতো বাদ পড়ে', () => {
    expect(isWorkday(day('2026-02-01'), 7, new Set())).toBe(false);
    expect(isWorkday(day('2026-02-02'), 7, new Set())).toBe(true);
  });

  it('holidays টেবিলের দিন কর্মদিবস নয়', () => {
    const holidays = new Set([day('2026-08-10').getTime()]);
    expect(isWorkday(day('2026-08-10'), 5, holidays)).toBe(false);
    expect(isWorkday(day('2026-08-11'), 5, holidays)).toBe(true);
  });

  it('weeklyOffDay = null হলে প্রতিটি ক্যালেন্ডার দিনই কর্মদিবস', () => {
    expect(countWorkdays(day('2026-08-01'), day('2026-08-31'), null, new Set())).toBe(31);
  });

  it('আগস্ট ২০২৬ — শুক্রবার বাদে ২৭ দিন', () => {
    expect(countWorkdays(day('2026-08-01'), day('2026-08-31'), 5, new Set())).toBe(27);
  });

  it('"আজ পর্যন্ত" আজকের দিনটাও ধরে', () => {
    // ১–১১ আগস্টে একটাই শুক্রবার (৭ তারিখ)
    expect(countWorkdays(day('2026-08-01'), day('2026-08-11'), 5, new Set())).toBe(10);
  });

  it('ছুটি ও সাপ্তাহিক ছুটি একই দিনে পড়লে দুবার বাদ যায় না', () => {
    const holidays = new Set([day('2026-08-07').getTime()]); // ওটা শুক্রবারও
    expect(countWorkdays(day('2026-08-01'), day('2026-08-31'), 5, holidays)).toBe(27);
  });
});

describe('monthBounds ও previousWorkDate', () => {
  it('মাসের প্রথম ও শেষ দিন, আর year_month', () => {
    const b = monthBounds(day('2026-08-11'));
    expect(b.start).toEqual(day('2026-08-01'));
    expect(b.end).toEqual(day('2026-08-31'));
    expect(b.yearMonth).toBe('2026-08');
  });

  it('লিপ ইয়ারের ফেব্রুয়ারি ২৯ দিনে শেষ হয়', () => {
    expect(monthBounds(day('2024-02-10')).end).toEqual(day('2024-02-29'));
    expect(monthBounds(day('2026-02-10')).end).toEqual(day('2026-02-28'));
  });

  it('year_month-এ মাস দুই অঙ্কে থাকে', () => {
    expect(monthBounds(day('2026-01-05')).yearMonth).toBe('2026-01');
    expect(monthBounds(day('2026-12-31')).yearMonth).toBe('2026-12');
  });

  /**
   * ⭐ K05-এর মূল ভরসা। জব চলে ঢাকার ০০:১৫-তে, অর্থাৎ UTC-তে তখনো
   * **আগের দিনের** সন্ধ্যা — UTC ধরে হিসাব করলে ভুল দিন ক্লোজ হতো।
   */
  it('ঢাকার ০০:১৫-এ চললে আগের দিনটাই ক্লোজ হয়', () => {
    expect(previousWorkDate(dhaka('2026-08-12T00:15:00'))).toEqual(day('2026-08-11'));
  });

  it('মাসের ১ তারিখে চললে আগের মাসের শেষ দিন', () => {
    expect(previousWorkDate(dhaka('2026-09-01T00:15:00'))).toEqual(day('2026-08-31'));
    // ⭐ আর তখন মাসিক rollup যায় আগের মাসেই — নইলে ৩১ আগস্টের ঘণ্টা
    //    কোনো মাসের হিসাবেই ঢুকত না
    expect(monthBounds(previousWorkDate(dhaka('2026-09-01T00:15:00'))).yearMonth).toBe('2026-08');
  });

  it('দিনের যেকোনো সময়ে ডাকলেও একই আগের দিন', () => {
    expect(previousWorkDate(dhaka('2026-08-12T23:59:00'))).toEqual(day('2026-08-11'));
  });
});

describe('dhakaHourOf', () => {
  it('UTC নয়, ঢাকার ঘণ্টা দেয়', () => {
    expect(dhakaHourOf(new Date('2026-08-11T18:15:00Z'))).toBe(0); // ঢাকায় ১২ তারিখ ০০:১৫
    expect(dhakaHourOf(new Date('2026-08-11T01:00:00Z'))).toBe(7);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe('rollupMonth — মাসিক টার্গেট ও গতি', () => {
  const base = {
    adjustmentSec: 0,
    targetSec: TARGET,
    expectedWorkdays: 27,
    workdaysElapsed: 10,
    daysWithWork: 10,
  };

  it('expected = টার্গেট × গত কর্মদিবস ÷ মোট কর্মদিবস', () => {
    const m = rollupMonth({ ...base, workedSec: 80 * HOUR });

    expect(m.expectedSec).toBe(Math.round((TARGET * 10) / 27));
    expect(m.paceSec).toBe(80 * HOUR - m.expectedSec);
  });

  /** ⭐ § ২.১-খ — মাসের শেষ কর্মদিবসে pace ঠিক শূন্যে ঠেকে */
  it('মাস শেষে ঠিক টার্গেট করলে pace শূন্য', () => {
    const m = rollupMonth({
      ...base,
      workedSec: TARGET,
      workdaysElapsed: 27,
      daysWithWork: 27,
    });

    expect(m.expectedSec).toBe(TARGET);
    expect(m.paceSec).toBe(0);
    expect(m.targetMet).toBe(true);
    expect(m.shortfallSec).toBe(0);
  });

  /** ⭐ § ২.১-ঙ — সংশোধন না ধরলে সার্ভারের দোষে হারানো ঘণ্টা সারা মাস পিছিয়ে রাখত */
  it('pace-এ owner-এর সংশোধন ধরা হয়', () => {
    const withoutAdj = rollupMonth({ ...base, workedSec: 60 * HOUR });
    const withAdj = rollupMonth({ ...base, workedSec: 60 * HOUR, adjustmentSec: 8 * HOUR });

    expect(withAdj.creditedSec).toBe(68 * HOUR);
    expect(withAdj.paceSec - withoutAdj.paceSec).toBe(8 * HOUR);
  });

  /**
   * ⭐ সবচেয়ে জরুরি রক্ষাকবচ। `payroll.math.ts` ঋণাত্মক `creditedSec`
   * পেলে `RangeError` ছোড়ে — একজনের অতিরিক্ত কর্তন গোটা মাসের পে-রোল
   * শিটকে ৫০০ বানিয়ে দিত।
   */
  it('কর্তন কাজের চেয়ে বেশি হলে মাসিক credited ঋণাত্মক হয় না', () => {
    const m = rollupMonth({ ...base, workedSec: 10 * HOUR, adjustmentSec: -50 * HOUR });

    expect(m.creditedSec).toBe(0);
    expect(m.shortfallSec).toBe(TARGET);
    expect(m.overtimeSec).toBe(0);
  });

  it('টার্গেট ছাড়িয়ে গেলে overtime, ঘাটতি শূন্য', () => {
    const m = rollupMonth({ ...base, workedSec: TARGET + 10 * HOUR, workdaysElapsed: 27 });

    expect(m.overtimeSec).toBe(10 * HOUR);
    expect(m.shortfallSec).toBe(0);
    expect(m.targetMet).toBe(true);
  });

  it('ঠিক টার্গেটে পৌঁছালেই targetMet (এক সেকেন্ড কমে নয়)', () => {
    expect(rollupMonth({ ...base, workedSec: TARGET }).targetMet).toBe(true);
    expect(rollupMonth({ ...base, workedSec: TARGET - 1 }).targetMet).toBe(false);
  });

  /** ⚠️ ভাগের হর শূন্য — না আটকালে ডাটাবেসে NaN যেত */
  it('মাসে একটাও কর্মদিবস না থাকলে expected শূন্য, NaN নয়', () => {
    const m = rollupMonth({
      ...base,
      workedSec: 5 * HOUR,
      expectedWorkdays: 0,
      workdaysElapsed: 0,
    });

    expect(m.expectedSec).toBe(0);
    expect(m.paceSec).toBe(5 * HOUR);
  });

  /** ⚠️ ০ দিয়ে ভাগ — Infinity বসে যেত */
  it('একদিনও কাজ না করলে গড় শূন্য', () => {
    const m = rollupMonth({ ...base, workedSec: 0, daysWithWork: 0 });

    expect(m.avgDailySec).toBe(0);
    expect(Number.isFinite(m.avgDailySec)).toBe(true);
  });

  it('গত কর্মদিবস মোট কর্মদিবস ছাড়াতে পারে না', () => {
    const m = rollupMonth({ ...base, workedSec: 0, workdaysElapsed: 40 });

    // expected কখনো পুরো টার্গেটের বেশি হবে না, নইলে মাস শেষে সবাই
    // হঠাৎ আরও পিছিয়ে যেত
    expect(m.expectedSec).toBe(TARGET);
  });

  it('টার্গেট শূন্য হলে থেমে যায়', () => {
    expect(() => rollupMonth({ ...base, workedSec: 0, targetSec: 0 })).toThrow(RangeError);
  });

  it('ঘণ্টা → সেকেন্ড', () => {
    expect(hoursToSec(208)).toBe(TARGET);
    expect(hoursToSec(207.5)).toBe(747000);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe('retentionCutoff — K01-এর সবচেয়ে বিপজ্জনক সংখ্যা', () => {
  it('৯০ দিন আগের তারিখ দেয়', () => {
    expect(retentionCutoff(dhaka('2026-08-11T02:00:00'), 90)).toEqual(day('2026-05-13'));
  });

  /** ⚠️ ঠিক ৯০ দিনের পুরোনো ছবিটা **থাকবে** — কাটা পড়ে তার আগেরগুলো */
  it('সীমানার দিনটা রক্ষা পায়', () => {
    const cutoff = retentionCutoff(dhaka('2026-08-11T02:00:00'), 90);

    expect(day('2026-05-13') < cutoff).toBe(false); // থাকবে
    expect(day('2026-05-12') < cutoff).toBe(true); // যাবে
  });

  it('ঢাকার তারিখ ধরে হিসাব হয়, UTC-র নয়', () => {
    // ঢাকায় ১২ তারিখ রাত ২টা = UTC-তে ১১ তারিখ রাত ৮টা
    expect(retentionCutoff(dhaka('2026-08-12T02:00:00'), 90)).toEqual(day('2026-05-14'));
  });

  /**
   * ⭐ কনফিগে ভুলে `0` বসলে cutoff আজকের তারিখে গিয়ে পড়ত, আর রাত ২টার
   * জব নীরবে আজকের ছবিসহ পুরো আর্কাইভ মুছে দিত — ফাইল ও সারি দুটোই।
   */
  it('শূন্য বা ঋণাত্মক দিনে থেমে যায়', () => {
    expect(() => retentionCutoff(new Date(), 0)).toThrow(RangeError);
    expect(() => retentionCutoff(new Date(), -1)).toThrow(RangeError);
    expect(() => retentionCutoff(new Date(), Number.NaN)).toThrow(RangeError);
  });
});

describe('isInsideRoot — ফাইল মোছার আগের পাহারা', () => {
  const root = resolve('storage-root-for-test');

  it('স্বাভাবিক আপেক্ষিক পাথ ভেতরেই', () => {
    expect(isInsideRoot(root, 'screenshots/2026/08/09/emp-003/093147_m0.webp')).toBe(true);
  });

  /** ⭐ `..` — একটা ফাঁকই storage-এর বাইরের ফাইল মোছার জন্য যথেষ্ট */
  it('.. দিয়ে বেরিয়ে যাওয়া পাথ নাকচ', () => {
    expect(isInsideRoot(root, '../../Windows/System32/config')).toBe(false);
    expect(isInsideRoot(root, 'screenshots/../../outside.webp')).toBe(false);
  });

  it('একেবারে বাইরের absolute পাথ নাকচ', () => {
    expect(isInsideRoot(root, resolve(root, '..', 'other.webp'))).toBe(false);
  });

  /** ⚠️ শুধু `startsWith(root)` লিখলে এই প্রতিবেশীটা "ভেতরে" মনে হতো */
  it('নামের শুরু মিলে যাওয়া পাশের ফোল্ডার ভেতরে নয়', () => {
    expect(isInsideRoot(root, `${root}-old${sep}x.webp`)).toBe(false);
  });

  it('রুট নিজেই ভেতরে ধরা হয়', () => {
    expect(isInsideRoot(root, root)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════

describe('RunLock — একই জব দুবার একসাথে নয়', () => {
  it('চলতে থাকা অবস্থায় দ্বিতীয় ডাক null ফেরায়', async () => {
    const lock = new RunLock();
    let release = (): void => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const first = lock.run(async () => {
      await gate;
      return 'প্রথম';
    });
    const second = await lock.run(async () => 'দ্বিতীয়');

    expect(second).toBeNull();

    release();
    expect(await first).toBe('প্রথম');
  });

  it('আগেরটা শেষ হলে পরেরটা চলে', async () => {
    const lock = new RunLock();

    expect(await lock.run(async () => 1)).toBe(1);
    expect(await lock.run(async () => 2)).toBe(2);
  });

  /** ⚠️ finally না থাকলে একবার ব্যতিক্রমেই জবটা চিরতরে আটকে যেত */
  it('ব্যতিক্রম হলেও তালা খুলে যায়', async () => {
    const lock = new RunLock();

    await expect(
      lock.run(() => Promise.reject(new Error('ডাটাবেস নেই'))),
    ).rejects.toThrow('ডাটাবেস নেই');

    expect(await lock.run(async () => 'পরেরবার চলল')).toBe('পরেরবার চলল');
  });
});
