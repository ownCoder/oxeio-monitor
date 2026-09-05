import { describe, expect, it } from 'vitest';

import {
  AGENT_SILENCE_MIN,
  DISK_CRITICAL_PCT,
  DISK_WARN_PCT,
  THROTTLE_HOURS,
} from '../src/alerts/alerts.constants';
import {
  agentDownCandidates,
  dedupeKey,
  dhakaHourOf,
  dhakaIsoWeekday,
  diskUsedPct,
  diskVerdict,
  humanBytes,
  isExpectedSilence,
  isAgentWatchOpen,
  isNoActivityWindow,
  isOfficeOpen,
  isTamperStop,
  isThrottled,
  isWithinStartupGrace,
  nextAllowedAt,
  recoveredAlertIds,
  shouldFlagNoActivity,
  silentMinutes,
  suppressFlood,
  tamperSeverity,
  throttleFloor,
  type AlertKey,
  type DeviceSilence,
  type NoActivityInput,
  type OpenAgentDownAlert,
  type StopEvent,
} from '../src/alerts/alerts.rules';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** ঢাকার একটা নির্দিষ্ট মুহূর্ত বানানো — UTC+6, কোনো DST নেই */
function dhaka(iso: string): Date {
  return new Date(`${iso}+06:00`);
}

// ════════════════════════════════════════════════════════════════════════════
// ⭐ বন্যা ঠেকানো — এই ব্লকটাই সবচেয়ে জরুরি
// ════════════════════════════════════════════════════════════════════════════

describe('throttle — একই ডিভাইসের একই কারণে ৬ ঘণ্টায় একটাই', () => {
  const now = new Date('2026-08-11T10:00:00Z');

  it('ডিভাইস আলাদা হলে key আলাদা, টাইপ আলাদা হলেও', () => {
    expect(dedupeKey({ type: 'agent_down', deviceId: 1 })).not.toBe(
      dedupeKey({ type: 'agent_down', deviceId: 2 }),
    );
    expect(dedupeKey({ type: 'agent_down', deviceId: 1 })).not.toBe(
      dedupeKey({ type: 'agent_killed', deviceId: 1 }),
    );
  });

  it('deviceId null আর deviceId অনুপস্থিত — একই key', () => {
    expect(dedupeKey({ type: 'disk_warning', deviceId: null })).toBe(
      dedupeKey({ type: 'disk_warning' }),
    );
  });

  it('৫ ঘণ্টা ৫৯ মিনিট আগেরটা এখনো আটকায়, ৬ ঘণ্টা ১ মিনিট আগেরটা নয়', () => {
    const almost = new Date(now.getTime() - (THROTTLE_HOURS * HOUR - MIN));
    const past = new Date(now.getTime() - (THROTTLE_HOURS * HOUR + MIN));

    expect(isThrottled(almost, now)).toBe(true);
    expect(isThrottled(past, now)).toBe(false);
  });

  it('আগে কিছুই না থাকলে আটকায় না', () => {
    expect(isThrottled(null, now)).toBe(false);
    expect(isThrottled(undefined, now)).toBe(false);
  });

  /**
   * ⚠️ সার্ভারের ঘড়ি পিছিয়ে গেলে `lastRaisedAt` ভবিষ্যতে পড়ে যায়। তখন ভুলটা
   * চুপ থাকার দিকে হওয়া দরকার — নইলে ঘড়ি ঠিক হওয়া পর্যন্ত প্রতি টিকে
   * অ্যালার্ট বেরোত।
   */
  it('ভবিষ্যতের সময় থাকলেও চুপ থাকে', () => {
    expect(isThrottled(new Date(now.getTime() + HOUR), now)).toBe(true);
  });

  it('throttleFloor আর nextAllowedAt ঠিক ৬ ঘণ্টার দুই পাশে', () => {
    expect(now.getTime() - throttleFloor(now).getTime()).toBe(
      THROTTLE_HOURS * HOUR,
    );
    expect(nextAllowedAt(now).getTime() - now.getTime()).toBe(
      THROTTLE_HOURS * HOUR,
    );
  });
});

describe('suppressFlood — এক দফার প্রার্থীদের ছেঁকে নেওয়া', () => {
  const now = new Date('2026-08-11T10:00:00Z');

  const candidate = (deviceId: number): AlertKey => ({
    type: 'agent_down',
    deviceId,
  });

  it('DB-তে টাটকা অ্যালার্ট থাকলে ওই ডিভাইসেরটা বাদ যায়', () => {
    const last = new Map([
      [dedupeKey(candidate(1)), new Date(now.getTime() - HOUR)],
    ]);

    const kept = suppressFlood([candidate(1), candidate(2)], last, now);

    expect(kept.map((k) => k.deviceId)).toEqual([2]);
  });

  /**
   * ⭐ সবচেয়ে গুরুত্বপূর্ণ টেস্ট। ১৫ মিনিটের জানালায় একই PC-র তিনটে
   * agent_stop ইভেন্ট থাকলে DB-তে তখনো কিছুই বসেনি, তাই DB-ভিত্তিক
   * throttle তিনটেকেই ছেড়ে দিত — আর একই সেকেন্ডে তিনটে অ্যালার্ট বসত।
   */
  it('একই দফার ভেতরে একই key বারবার এলে একটাই থাকে', () => {
    const kept = suppressFlood(
      [candidate(7), candidate(7), candidate(7)],
      new Map(),
      now,
    );

    expect(kept).toHaveLength(1);
  });

  it('খালি তালিকায় খালি ফল', () => {
    expect(suppressFlood([], new Map(), now)).toEqual([]);
  });

  it('একজন কর্মীর দুই ডিভাইস আলাদা করে গোনা হয়', () => {
    const kept = suppressFlood(
      [
        { type: 'agent_down', deviceId: 1, employeeId: 3 },
        { type: 'agent_down', deviceId: 2, employeeId: 3 },
      ],
      new Map(),
      now,
    );

    expect(kept).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ঢাকার সময়
// ════════════════════════════════════════════════════════════════════════════

describe('ঢাকার সময়', () => {
  it('স্থানীয় ঘণ্টা UTC নয়', () => {
    // ২০:৩০ ঢাকা = ১৪:৩০ UTC
    expect(dhakaHourOf(new Date('2026-08-11T14:30:00Z'))).toBe(20);
  });

  it('মধ্যরাতের পরপর ঘণ্টা ০', () => {
    expect(dhakaHourOf(dhaka('2026-08-11T00:05:00'))).toBe(0);
  });

  /**
   * ⚠️ ২০২৬-০৮-১১ মঙ্গলবার → ISO ২। `weekly_off_day`-তে শুক্র = ৫, কিন্তু
   * `getUTCDay()` শুক্রবারকে ৫-ই বলে অথচ রবিবারকে ০ — শুধু রবিবারেই ভুলটা
   * ধরা পড়ত, তাই দুটোই মিলিয়ে দেখা হচ্ছে।
   */
  it('ISO দিন — সোম ১ … রবি ৭', () => {
    expect(dhakaIsoWeekday(dhaka('2026-08-11T12:00:00'))).toBe(2); // মঙ্গল
    expect(dhakaIsoWeekday(dhaka('2026-08-14T12:00:00'))).toBe(5); // শুক্র
    expect(dhakaIsoWeekday(dhaka('2026-08-16T12:00:00'))).toBe(7); // রবি
  });

  it('UTC-তে আগের দিন হলেও ঢাকার দিনই গোনা হয়', () => {
    // ঢাকায় শুক্রবার ভোর ৫টা = UTC-তে বৃহস্পতিবার ২৩:০০
    expect(dhakaIsoWeekday(new Date('2026-08-13T23:00:00Z'))).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G01 — এজেন্ট চুপ
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⭐⭐ **অফিস খোলা আছে কি না** — `agent_down` কখন চুপ থাকবে (২২ আগস্ট ২০২৬)।
 *
 * ⚠️ ২০২৬-০৮-২৪ সোমবার (ISO ১), ২০২৬-০৮-২৮ শুক্রবার (ISO ৫)।
 */
describe('অফিস সময়ের বাইরে agent_down চুপ', () => {
  const OFFICE = { officeFrom: '09:00', officeTo: '18:00' };
  const open = (iso: string, extra = {}) =>
    isOfficeOpen({
      now: dhaka(iso),
      ...OFFICE,
      weeklyOffDay: 5,
      isHoliday: false,
      ...extra,
    });

  it('অফিস সময়ে খোলা', () => {
    expect(open('2026-08-24T09:00:00')).toBe(true);
    expect(open('2026-08-24T13:30:00')).toBe(true);
    expect(open('2026-08-24T17:59:00')).toBe(true);
  });

  /** ⭐ ঠিক ৬টা **বন্ধ** — জানালাটা `[from, to)`, নইলে ১৮:০০-এ একটা অ্যালার্ট গলত */
  it('ঠিক শেষ মুহূর্তে বন্ধ', () => {
    expect(open('2026-08-24T18:00:00')).toBe(false);
  });

  it('সকাল ৯টার আগে ও সন্ধ্যার পরে বন্ধ', () => {
    expect(open('2026-08-24T08:59:00')).toBe(false);
    expect(open('2026-08-24T18:01:00')).toBe(false);
    expect(open('2026-08-24T23:30:00')).toBe(false);
    expect(open('2026-08-24T03:00:00')).toBe(false);
  });

  /** ⚠️ মাঠে যে তিনটে গুচ্ছ মাপা হয়েছিল — ১৮টা, ০০টা, ০৬টা — তিনটেই বন্ধ */
  it('মাঠে মাপা তিনটে গুচ্ছই এখন চুপ', () => {
    expect(open('2026-08-24T18:00:00')).toBe(false);
    expect(open('2026-08-25T00:00:00')).toBe(false);
    expect(open('2026-08-25T06:00:00')).toBe(false);
  });

  it('সাপ্তাহিক ছুটির দিনে সারাদিনই বন্ধ', () => {
    expect(open('2026-08-28T11:00:00')).toBe(false);
  });

  it('ক্যালেন্ডারের ছুটিতেও বন্ধ', () => {
    expect(open('2026-08-24T11:00:00', { isHoliday: true })).toBe(false);
  });

  /**
   * ⚠️⚠️ এই তিনটেই একই কথা বলে: **সময় জানা না থাকলে খোলা ধরা হয়**।
   * ভুলের দুটো দিকই খারাপ, কিন্তু সমান নয় — বেশি অ্যালার্ট বিরক্তিকর,
   * নীরবে বন্ধ হয়ে যাওয়া পাহারা বিপজ্জনক।
   */
  it('সময় না বসানো থাকলে সারাদিন খোলা', () => {
    expect(open('2026-08-24T23:00:00', { officeFrom: null, officeTo: null }))
      .toBe(true);
    expect(open('2026-08-24T23:00:00', { officeFrom: '09:00', officeTo: null }))
      .toBe(true);
  });

  it('বেঠিক লেখা সময়ও খোলা ধরা হয়', () => {
    expect(open('2026-08-24T23:00:00', { officeFrom: '9am', officeTo: '6pm' }))
      .toBe(true);
    expect(open('2026-08-24T23:00:00', { officeFrom: '25:00', officeTo: '18:00' }))
      .toBe(true);
  });

  /** ⚠️ উল্টো জানালা (শেষ ≤ শুরু) — বন্ধ নয়, খোলা */
  it('উল্টো জানালা খোলা ধরা হয়', () => {
    expect(open('2026-08-24T03:00:00', { officeFrom: '18:00', officeTo: '09:00' }))
      .toBe(true);
    expect(open('2026-08-24T03:00:00', { officeFrom: '09:00', officeTo: '09:00' }))
      .toBe(true);
  });

  /** ⭐ সাপ্তাহিক ছুটি না থাকলে (null) শুক্রবারও কর্মদিবস */
  it('সাপ্তাহিক ছুটি null হলে শুক্রবারও খোলা', () => {
    expect(open('2026-08-28T11:00:00', { weeklyOffDay: null })).toBe(true);
  });
});

/**
 * ⭐⭐ **অফিস খোলার পর ১৫ মিনিট ছাড়** *(২৩ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ মাঠে মাপা: আজ সবাই কাজ শুরু করেছেন ০৮:৪৮–০৯:০৩-এর মধ্যে, অথচ ঠিক
 * ৯:০০-এ **ছটা** অ্যালার্ট উঠেছিল — আর ছটার সবাই ৯:০৯-এর মধ্যে ফিরে
 * এসেছিলেন। একটাও আসল ছিল না।
 */
describe('অফিস খোলার পর ছাড় — সবার হাজির থাকার সময়', () => {
  const OFFICE = { officeFrom: '09:00', officeTo: '18:00' };
  const watch = (iso: string, extra = {}) =>
    isAgentWatchOpen({
      now: dhaka(iso),
      ...OFFICE,
      weeklyOffDay: 5,
      isHoliday: false,
      ...extra,
    });

  /** ⚠️⚠️ ঠিক ৯:০০ — অফিস খোলা, কিন্তু এখনো কারো হাজির থাকার কথা নয় */
  it('৯:০০-এ অফিস খোলা, তবু পাহারা শুরু হয় না', () => {
    expect(isOfficeOpen({ now: dhaka('2026-08-24T09:00:00'), ...OFFICE,
      weeklyOffDay: 5, isHoliday: false })).toBe(true);
    expect(watch('2026-08-24T09:00:00')).toBe(false);
  });

  it('১৪ মিনিট পরেও নয়, ১৫ মিনিটে হ্যাঁ', () => {
    expect(watch('2026-08-24T09:14:00')).toBe(false);
    expect(watch('2026-08-24T09:15:00')).toBe(true);
  });

  /**
   * ⚠️⚠️ **ছাড় কেবল শুরুতে, শেষে নয়** — বিকেলে কারো PC হঠাৎ বন্ধ হয়ে
   * যাওয়া সত্যিকারের খবর, আর ছুটির আগে সেটা চাপা পড়া উচিত নয়।
   */
  it('বিকেলে পাহারা পুরোদমে, শেষ মুহূর্ত পর্যন্ত', () => {
    expect(watch('2026-08-24T13:00:00')).toBe(true);
    expect(watch('2026-08-24T17:59:00')).toBe(true);
    expect(watch('2026-08-24T18:00:00')).toBe(false);
  });

  it('অফিস বন্ধ থাকলে ছাড়ের প্রশ্নই ওঠে না', () => {
    expect(watch('2026-08-24T22:00:00')).toBe(false);
    expect(watch('2026-08-28T10:00:00')).toBe(false); // শুক্রবার
    expect(watch('2026-08-24T10:00:00', { isHoliday: true })).toBe(false);
  });

  /** ⭐ সময় বসানো না থাকলে "খোলার পর" বলে কোনো মুহূর্তই নেই, তাই ছাড়ও নেই */
  it('অফিসের সময় না থাকলে সারাদিনই পাহারা', () => {
    expect(watch('2026-08-24T03:00:00', { officeFrom: null, officeTo: null }))
      .toBe(true);
  });

  /** ⚠️ ছাড় বদলানো যায় — টেস্টে ০ দিলে আচরণ `isOfficeOpen`-এর সমান */
  it('ছাড় ০ হলে অফিস খোলার সাথে সাথেই পাহারা', () => {
    expect(
      isAgentWatchOpen(
        { now: dhaka('2026-08-24T09:00:00'), ...OFFICE, weeklyOffDay: 5, isHoliday: false },
        0,
      ),
    ).toBe(true);
  });
});

describe('G01 — নীরবতার ব্যাখ্যা আছে কি না', () => {
  const now = new Date('2026-08-11T14:00:00Z');
  const silentSince = new Date(now.getTime() - 30 * MIN);

  const device = (over: Partial<DeviceSilence> = {}): DeviceSilence => ({
    deviceId: 1,
    lastSeenAt: silentSince,
    lastCleanStopAt: null,
    ...over,
  });

  it('বিদায়ী ইভেন্ট ছাড়া ৩০ মিনিটের নীরবতা = অ্যালার্ট', () => {
    expect(agentDownCandidates([device()], now)).toHaveLength(1);
  });

  /**
   * ⭐ এটা না থাকলে প্রতিদিন সন্ধ্যায় প্রত্যেকের PC বন্ধ হওয়ামাত্র
   * বারোটা অ্যালার্ট যেত — চেকটা সবসময় সত্যি বলেও অকেজো হয়ে যেত।
   */
  it('শেষ খবরটাই যদি logoff হয়, নীরবতা স্বাভাবিক', () => {
    const d = device({ lastCleanStopAt: silentSince });
    expect(isExpectedSilence(d)).toBe(true);
    expect(agentDownCandidates([d], now)).toHaveLength(0);
  });

  it('logoff-এর পর এজেন্ট ফিরে এসে আবার চুপ হলে অ্যালার্ট হয়', () => {
    // দুপুরে logoff, বিকেলে আবার ডেটা এসেছে, তারপর নীরবতা
    const d = device({
      lastCleanStopAt: new Date(now.getTime() - 5 * HOUR),
      lastSeenAt: silentSince,
    });
    expect(isExpectedSilence(d)).toBe(false);
    expect(agentDownCandidates([d], now)).toHaveLength(1);
  });

  it('১০ মিনিটের কম চুপ থাকলে কিছুই হয় না', () => {
    const d = device({ lastSeenAt: new Date(now.getTime() - 9 * MIN) });
    expect(agentDownCandidates([d], now)).toHaveLength(0);
  });

  /**
   * ⚠️ কখনো কিছু পাঠায়নি এমন ডিভাইস এনরোলমেন্টের সমস্যা, "এজেন্ট বন্ধ" নয়।
   * অ্যালার্ট দিলে ইনস্টল না করা প্রতিটা ডিভাইস চিরকাল অভিযোগ করত।
   */
  it('lastSeenAt নেই এমন ডিভাইস বাদ', () => {
    expect(agentDownCandidates([device({ lastSeenAt: null })], now)).toEqual([]);
  });

  it('silentMinutes মিনিট গোনে, lastSeenAt না থাকলে null', () => {
    expect(silentMinutes(silentSince, now)).toBe(30);
    expect(silentMinutes(null, now)).toBeNull();
  });

  it('সার্ভার সবে উঠলে চেকটাই করা হয় না', () => {
    const booted = new Date(now.getTime() - 5 * MIN);
    expect(isWithinStartupGrace(booted, now)).toBe(true);
    expect(
      isWithinStartupGrace(new Date(now.getTime() - 20 * MIN), now),
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G01 (ফেরত) — ফিরে এলে alert নিজে বন্ধ
// ════════════════════════════════════════════════════════════════════════════

describe('recoveredAlertIds — ফিরে আসা এজেন্টের খোলা alert বন্ধযোগ্য', () => {
  const now = new Date('2026-08-11T14:00:00Z');
  const cameBack = new Date(now.getTime() - 2 * MIN); // ১০ মিনিটের কম → ফিরেছে
  const stillSilent = new Date(now.getTime() - 30 * MIN);

  const open = (
    over: Partial<OpenAgentDownAlert> = {},
  ): OpenAgentDownAlert => ({
    alertId: 1n,
    deviceActive: true,
    lastSeenAt: cameBack,
    ...over,
  });

  it('আবার কথা-বলা active ডিভাইসের alert বন্ধযোগ্য', () => {
    expect(recoveredAlertIds([open()], now)).toEqual([1n]);
  });

  /** ⭐ agentDownCandidates()-এর ঠিক আয়না: এখনো চুপ থাকলে বন্ধ নয় */
  it('এখনো চুপ থাকলে বন্ধ করা হয় না', () => {
    expect(recoveredAlertIds([open({ lastSeenAt: stillSilent })], now)).toEqual(
      [],
    );
  });

  /** ⚠️ revoke করা ডিভাইসের চুপ থাকাটাই উদ্দেশ্য — সাম্প্রতিক হলেও বন্ধ নয় */
  it('revoke করা ডিভাইস বাদ', () => {
    expect(recoveredAlertIds([open({ deviceActive: false })], now)).toEqual([]);
  });

  it('lastSeenAt নেই এমন কিছু বন্ধ হয় না', () => {
    expect(recoveredAlertIds([open({ lastSeenAt: null })], now)).toEqual([]);
  });

  /** ⚠️ সীমানা ঠিক silence-floor-এ — raise আর resolve যেন একই দাগে না লাগে */
  it('ঠিক silence-floor-এ থাকলেও ফিরে এসেছে ধরা হয়', () => {
    const atFloor = new Date(now.getTime() - AGENT_SILENCE_MIN * MIN);
    expect(recoveredAlertIds([open({ lastSeenAt: atFloor })], now)).toEqual([
      1n,
    ]);
  });

  it('মিশ্র তালিকায় শুধু ফিরে-আসাগুলোর id ফেরে', () => {
    const ids = recoveredAlertIds(
      [
        open({ alertId: 10n, lastSeenAt: cameBack }),
        open({ alertId: 11n, lastSeenAt: stillSilent }),
        open({ alertId: 12n, deviceActive: false }),
        open({ alertId: 13n, lastSeenAt: cameBack }),
      ],
      now,
    );
    expect(ids).toEqual([10n, 13n]);
  });

  it('খালি তালিকায় খালি ফল', () => {
    expect(recoveredAlertIds([], now)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G02 — হস্তক্ষেপ
// ════════════════════════════════════════════════════════════════════════════

describe('G02 — agent_stop স্বাভাবিক নাকি হস্তক্ষেপ', () => {
  const at = new Date('2026-08-11T12:00:00Z');

  const stop = (over: Partial<StopEvent> = {}): StopEvent => ({
    deviceId: 1,
    type: 'agent_stop',
    occurredAt: at,
    ...over,
  });

  it('পাশে logoff থাকলে স্বাভাবিক', () => {
    const context = [
      stop({ type: 'logoff', occurredAt: new Date(at.getTime() + 30_000) }),
    ];
    expect(isTamperStop(stop(), context)).toBe(false);
  });

  it('আশেপাশে কিছু না থাকলে হস্তক্ষেপ', () => {
    expect(isTamperStop(stop(), [])).toBe(true);
  });

  /** ⚠️ অন্য PC-র shutdown দিয়ে এই PC-র agent_stop ব্যাখ্যা করা যাবে না */
  it('অন্য ডিভাইসের shutdown কোনো ছাড় দেয় না', () => {
    const context = [stop({ deviceId: 2, type: 'shutdown' })];
    expect(isTamperStop(stop(), context)).toBe(true);
  });

  it('১০ মিনিট আগের shutdown জানালার বাইরে', () => {
    const context = [
      stop({ type: 'shutdown', occurredAt: new Date(at.getTime() - 10 * MIN) }),
    ];
    expect(isTamperStop(stop(), context)).toBe(true);
  });

  it('আনইনস্টল কখনোই স্বাভাবিক নয় — shutdown পাশে থাকলেও', () => {
    const context = [stop({ type: 'shutdown' })];
    expect(isTamperStop(stop({ type: 'uninstall' }), context)).toBe(true);
    expect(isTamperStop(stop({ type: 'agent_uninstall' }), context)).toBe(true);
  });

  it('আনইনস্টল critical, শুধু বন্ধ করা warning', () => {
    expect(tamperSeverity('uninstall')).toBe('critical');
    expect(tamperSeverity('agent_stop')).toBe('warning');
  });

  /**
   * ⭐⭐⭐ **এজেন্ট নিজের আপডেট বসানোও একটা স্বাভাবিক বন্ধ**
   * *(৫ সেপ্টেম্বর ২০২৬)*।
   *
   * ⚠️⚠️ **এতদিন এটা একটা নীরব মিথ্যা অ্যালার্ট ছিল।** MSI আপডেটের সময়
   * Windows-এর Restart Manager এজেন্টকে বন্ধ করায় (`ENDSESSION_CLOSEAPP`)।
   * তখন `agent_stop` ঠিকই যেত, কিন্তু পাশে `logoff`/`shutdown` কিছুই
   * থাকত না — কারণ PC বন্ধ হচ্ছিল না। ফলে **প্রতিটা আপডেট একটা
   * `agent_killed` warning তুলত**, অর্থাৎ কেউ আপডেট বসালেই তাকে
   * হস্তক্ষেপকারী বলে দাগানো হতো।
   *
   * ⭐ হাতে একটা-দুটো PC আপডেট করলে সেটা চোখে পড়ত না। কিন্তু রোলআউট নিজে
   * থেকে এগোতে শুরু করার পর একসাথে ১২টা মিথ্যা অ্যালার্ট — আর তার পরেই
   * কেউ আর অ্যালার্ট পড়ত না, অর্থাৎ G02 কার্যত অকেজো হয়ে যেত।
   */
  it('⭐ পাশে agent_update থাকলে স্বাভাবিক — আপডেট হস্তক্ষেপ নয়', () => {
    const context = [
      stop({ type: 'agent_update', occurredAt: new Date(at.getTime() + 5_000) }),
    ];
    expect(isTamperStop(stop(), context)).toBe(false);
  });

  /**
   * ⚠️⚠️ **ছাড়টা সংকীর্ণ, আর সেটাই নকশা।** `agent_update` কেবল তখনই যায়
   * যখন Windows নিজে আমাদের বন্ধ করাচ্ছে। কেউ Task Manager থেকে প্রসেসটা
   * মেরে দিলে ওটা যায় না — তাই আসল হস্তক্ষেপ আগের মতোই ধরা পড়ে।
   *
   * ⭐ এই টেস্টটাই বলে দেয় ছাড়টা কতটুকু: একটা নাম যোগ করা হয়েছে,
   *    পাহারাটা আলগা করা হয়নি।
   */
  it('⭐ আপডেট ছাড়া বন্ধ এখনো হস্তক্ষেপই', () => {
    expect(isTamperStop(stop(), [])).toBe(true);
  });

  /** ⚠️ অন্য PC-র আপডেট এই PC-র agent_stop ব্যাখ্যা করে না */
  it('অন্য ডিভাইসের agent_update কোনো ছাড় দেয় না', () => {
    const context = [stop({ deviceId: 2, type: 'agent_update' })];
    expect(isTamperStop(stop(), context)).toBe(true);
  });

  /** ⚠️ আনইনস্টলের কোনো ছাড় নেই — আপডেট পাশে থাকলেও */
  it('আপডেটের পাশেও আনইনস্টল হস্তক্ষেপই', () => {
    const context = [stop({ type: 'agent_update' })];
    expect(isTamperStop(stop({ type: 'agent_uninstall' }), context)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G03 — ডিস্ক
// ════════════════════════════════════════════════════════════════════════════

describe('G03 — ডিস্কের শতাংশ ও স্তর', () => {
  /**
   * ⭐ হর হিসেবে মোট ব্লক নয়, `used + bavail`।
   * ১০০০ ব্লকের ৫০ root-এর জন্য সরানো, ৮০০ ব্যবহৃত, ১৫০ সাধারণ ব্যবহারকারীর
   * জন্য খালি → `df` বলে ৮৪.২%, অথচ মোট দিয়ে ভাগ করলে ৮০%। দ্বিতীয়টা ধরলে
   * ডিস্ক আসলে ভরে যাওয়ার পরেও আমাদের হিসাব ৯৫% পেরোত না।
   */
  it('root-এর জন্য সরিয়ে রাখা ব্লক বাদ দিয়ে হিসাব হয়', () => {
    const pct = diskUsedPct({ blocks: 1000, bfree: 200, bavail: 150, bsize: 4096 });
    expect(pct).toBeCloseTo(84.2, 1);

    const naive = ((1000 - 200) / 1000) * 100;
    expect(naive).toBe(80); // যা হতো
  });

  it('একদম খালি আর একদম ভরা', () => {
    expect(diskUsedPct({ blocks: 100, bfree: 100, bavail: 100, bsize: 512 })).toBe(0);
    expect(diskUsedPct({ blocks: 100, bfree: 0, bavail: 0, bsize: 512 })).toBe(100);
  });

  it('শূন্য আকারের ভলিউমে ভাগ করে NaN আসে না', () => {
    expect(diskUsedPct({ blocks: 0, bfree: 0, bavail: 0, bsize: 4096 })).toBe(0);
  });

  it('স্তরের সীমানা — ঠিক ৮০ ও ঠিক ৯৫ ধরা পড়ে', () => {
    expect(diskVerdict(DISK_WARN_PCT - 0.1)).toBeNull();
    expect(diskVerdict(DISK_WARN_PCT)?.type).toBe('disk_warning');
    expect(diskVerdict(94.9)?.type).toBe('disk_warning');
    expect(diskVerdict(DISK_CRITICAL_PCT)?.type).toBe('disk_critical');
    expect(diskVerdict(99.9)?.severity).toBe('critical');
  });

  /**
   * ⭐ ৮০% আর ৯৫%-এর type আলাদা বলেই throttle-এর key আলাদা — তাই গুরুতর
   * খবরটা আগের সতর্কতার ছায়ায় ৬ ঘণ্টা চাপা পড়ে থাকে না।
   */
  it('warning আর critical আলাদা throttle key পায়', () => {
    expect(dedupeKey({ type: 'disk_warning' })).not.toBe(
      dedupeKey({ type: 'disk_critical' }),
    );
  });

  it('বাইট মানুষের পড়ার মতো হয়', () => {
    expect(humanBytes(0)).toBe('0 B');
    expect(humanBytes(1024)).toBe('1.0 KB');
    expect(humanBytes(1024 ** 3 * 1.5)).toBe('1.5 GB');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G06 — সারাদিন কোনো কাজ নেই
// ════════════════════════════════════════════════════════════════════════════

describe('G06 — কখন "আজ কেউ কাজ করেনি" বলা হবে', () => {
  const evening = dhaka('2026-08-11T19:00:00'); // মঙ্গলবার সন্ধ্যা ৭টা

  const input = (over: Partial<NoActivityInput> = {}): NoActivityInput => ({
    workedSegments: 0,
    weeklyOffDay: 5,
    isHoliday: false,
    joinedOn: null,
    leftOn: null,
    now: evening,
    ...over,
  });

  it('সন্ধ্যায়, কর্মদিবসে, কোনো কাজ নেই → অ্যালার্ট', () => {
    expect(shouldFlagNoActivity(input())).toBe(true);
  });

  it('একটা সেগমেন্ট থাকলেও অ্যালার্ট নয়', () => {
    expect(shouldFlagNoActivity(input({ workedSegments: 1 }))).toBe(false);
  });

  /**
   * ⭐ ছুটির দিন বাদ না দিলে প্রতি শুক্রবার বারোটা মিথ্যা অ্যালার্ট — মাসে
   * চারবার। ওই অভ্যাসেই মানুষ অ্যালার্ট পড়া বন্ধ করে দেয়।
   */
  it('সাপ্তাহিক ছুটির দিনে চুপ', () => {
    const friday = dhaka('2026-08-14T19:00:00');
    expect(shouldFlagNoActivity(input({ now: friday }))).toBe(false);
  });

  it('পলিসিতে সাপ্তাহিক ছুটি না থাকলে শুক্রবারেও অ্যালার্ট হয়', () => {
    const friday = dhaka('2026-08-14T19:00:00');
    expect(
      shouldFlagNoActivity(input({ now: friday, weeklyOffDay: null })),
    ).toBe(true);
  });

  it('ক্যালেন্ডারের ছুটিতে চুপ', () => {
    expect(shouldFlagNoActivity(input({ isHoliday: true }))).toBe(false);
  });

  /**
   * ⚠️ জানালা না থাকলে মধ্যরাতের পরপরই নতুন দিনের হিসাবে সবাইকে
   * "কাজ করেনি" পাওয়া যেত — অর্থাৎ প্রতি রাতে বারোটা অ্যালার্ট।
   */
  it('সকালে বা মধ্যরাতে প্রশ্নটাই করা হয় না', () => {
    expect(shouldFlagNoActivity(input({ now: dhaka('2026-08-11T09:00:00') }))).toBe(false);
    expect(shouldFlagNoActivity(input({ now: dhaka('2026-08-11T00:30:00') }))).toBe(false);
    expect(shouldFlagNoActivity(input({ now: dhaka('2026-08-11T22:30:00') }))).toBe(false);
  });

  it('জানালার সীমানা — ১৮:০০ ভেতরে, ২২:০০ বাইরে', () => {
    expect(isNoActivityWindow(dhaka('2026-08-11T18:00:00'))).toBe(true);
    expect(isNoActivityWindow(dhaka('2026-08-11T21:59:00'))).toBe(true);
    expect(isNoActivityWindow(dhaka('2026-08-11T22:00:00'))).toBe(false);
  });

  /**
   * ⚠️ জানালা (৪ ঘণ্টা) throttle-এর (৬ ঘণ্টা) চেয়ে ছোট — এতে একজনের জন্য
   * দিনে একটার বেশি অ্যালার্ট গাণিতিকভাবেই অসম্ভব।
   */
  it('জানালা throttle জানালার চেয়ে ছোট', () => {
    const windowHours = 22 - 18;
    expect(windowHours).toBeLessThan(THROTTLE_HOURS);
  });

  it('আগামীকাল যোগ দেওয়া কর্মীর জন্য অ্যালার্ট নয়', () => {
    expect(
      shouldFlagNoActivity(input({ joinedOn: new Date('2026-08-20T00:00:00Z') })),
    ).toBe(false);
  });

  it('গতকাল চলে যাওয়া কর্মীর জন্য অ্যালার্ট নয়, শেষ দিনটায় হয়', () => {
    expect(
      shouldFlagNoActivity(input({ leftOn: new Date('2026-08-10T00:00:00Z') })),
    ).toBe(false);
    expect(
      shouldFlagNoActivity(input({ leftOn: new Date('2026-08-11T00:00:00Z') })),
    ).toBe(true);
  });
});
