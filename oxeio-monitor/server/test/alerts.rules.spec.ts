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
  isNoActivityWindow,
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
