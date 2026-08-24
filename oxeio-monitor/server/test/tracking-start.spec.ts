import { describe, expect, it } from 'vitest';

import {
  expectedSecOf as trayExpectedSec,
  paceSecOf as trayPaceSec,
} from '../src/agent/progress.math';
import {
  elapsedWindow,
  elapsedWorkdays,
  proratedExpectedSec,
  rollupMonth,
  type ElapsedInput,
} from '../src/summary/summary.math';

/**
 * ⭐⭐ **প্রত্যাশার জানালা — একটাই সংজ্ঞা, সব পর্দায়।**
 *
 * এই ফাইল দুটো জিনিস পাহারা দেয়:
 *
 * ১· **জানালাটা ঠিক আছে** (`elapsedWindow()` / `elapsedWorkdays()`) —
 *    শুরু হয় ট্র্যাকিং শুরুর দিন থেকে, শেষ হয় গতকাল।
 *
 *    ⚠️ যে ভুলটা এটা ঠেকায়: `expected_sec` গোনা হতো মাসের ১ তারিখ থেকে,
 *    অথচ এই ইনস্টলেশনে এজেন্ট বসেছে **১৩ আগস্ট ২০২৬**। ফলে Monthly পাতা
 *    প্রত্যেককে ~৯৪ ঘণ্টা পিছিয়ে দেখাত — এমন এক সময়ের জন্য যখন মাপার
 *    যন্ত্রটাই ছিল না। **অনুপস্থিত পর্যবেক্ষণ ব্যর্থতা নয়** (নিয়ম ২)।
 *
 * ২· **চার পর্দা একই সংখ্যা বলে** (নিচের ৫ নং অংশ)। এক সময় tray,
 *    Live Board আর মাসিক rollup তিনটে আলাদা সংজ্ঞায় `workdays_elapsed`
 *    গুনত — কর্মী নিজের `/me`-তে যা দেখতেন আর owner ড্যাশবোর্ডে যা
 *    দেখতেন, ফারাক দাঁড়িয়েছিল ~৮৯ ঘণ্টা। দুই পর্দায় দুই উত্তর মানে
 *    কোনটা সত্যি সেই প্রশ্নের উত্তর নেই — এই রিপোর সবচেয়ে বড় পাপ।
 *
 * **পরীক্ষার মাস — আগস্ট ২০২৬:** ১ তারিখ শনিবার, শুক্রবার ৭ · ১৪ · ২১ · ২৮,
 * অর্থাৎ ২৭ কর্মদিবস (`proration.e2e.spec.ts`-এর মাসটাই)।
 */

/** UTC-মধ্যরাত তারিখ — Prisma-র `@db.Date` ও `workDateOf()` দুটোই এই ছাঁদে */
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const HOUR = 3600;

const AUG_START = day('2026-08-01');
const AUG_END = day('2026-08-31');

/** শুক্রবার ছুটি (ISO ৫) — স্পেকের ডিফল্ট পলিসি */
const FRIDAY_OFF = 5;

const NO_HOLIDAYS: ReadonlySet<number> = new Set<number>();

/** ⚠️ `trackingStartedOn` ইচ্ছাকৃতভাবে **অনুপস্থিত** — সেটাই পুরোনো আচরণ */
const BASE: ElapsedInput = {
  periodStart: AUG_START,
  periodEnd: AUG_END,
  today: day('2026-08-20'),
  joinedOn: null,
  leftOn: null,
  weeklyOffDay: FRIDAY_OFF,
  holidays: NO_HOLIDAYS,
};

// ══════════════════════ ১ · ট্র্যাকিং-শুরু ছাড়া — আগের মতোই ══════════════════════

describe('elapsedWorkdays — trackingStartedOn না দিলে জানালা পর্বের শুরু থেকেই', () => {
  /**
   * ⚠️ এটাই এই ফিচারের নিরাপত্তা-জাল: নতুন ধারণাটা **ঐচ্ছিক**। না দিলে
   * শুরুর সীমা আগের মতোই `periodStart` (বা যোগ দেওয়ার দিন), তাই যে সব
   * হিসাব ট্র্যাকিং-শুরু জানে না সেগুলোর ফল বদলায় না।
   */
  it('১ আগস্ট থেকে গতকাল পর্যন্ত — ১৭ কর্মদিবস', () => {
    expect(elapsedWorkdays(BASE)).toBe(17);
    expect(elapsedWindow(BASE)).toEqual({
      from: AUG_START,
      to: day('2026-08-19'),
    });
  });

  it('`null` আর অনুপস্থিত — দুটো একই কথা', () => {
    expect(elapsedWorkdays({ ...BASE, trackingStartedOn: null })).toBe(
      elapsedWorkdays(BASE),
    );
  });

  /**
   * ⚠️⚠️ **হাতে গোনা তালিকা, `countWorkdays()` নয়।**
   *
   * এখানে আগে লেখা ছিল `expect(elapsedWorkdays(BASE)).toBe(countWorkdays(…))`
   * আর দাবি করা হতো "পুরোনো সূত্রের সাথে মেলে"। কিন্তু `elapsedWorkdays()`
   * নিজেই ভেতরে `countWorkdays()` ডাকে — অর্থাৎ টেস্টটা একই সূত্র দুবার
   * লিখে নিজের সাথে নিজেই মেলাত। সূত্রটা ভুল হলে দুদিকেই সমান ভুল হতো
   * আর টেস্ট নিশ্চিন্তে সবুজ থাকত। **যা মাপার কথা তা মাপাই হতো না।**
   */
  it('জানালার দিনগুলো হাতে গোনা তালিকার সাথে মেলে', () => {
    // ১–১৯ আগস্ট, শুক্রবার ৭ ও ১৪ বাদে
    const byHand = [
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
      '2026-08-05', '2026-08-06', '2026-08-08', '2026-08-09',
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
      '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18',
      '2026-08-19',
    ];

    expect(byHand).toHaveLength(17);
    expect(elapsedWorkdays(BASE)).toBe(byHand.length);

    // আর জানালার দুই প্রান্তও ওই তালিকার দুই প্রান্ত
    const window = elapsedWindow(BASE);
    expect(window?.from).toEqual(day(byHand[0]));
    expect(window?.to).toEqual(day(byHand[byHand.length - 1]));
  });

  /** ⚠️ যোগ দেওয়ার দিনের নিয়মটা (G37) অক্ষত — নইলে ১৭ তারিখে যোগ দেওয়া কর্মী প্রথম দিনেই পিছিয়ে */
  it('joinedOn মাসের মাঝখানে হলে সেখান থেকেই — আগের মতোই', () => {
    expect(elapsedWorkdays({ ...BASE, joinedOn: day('2026-08-17') })).toBe(3);
  });

  it('leftOn জানালার শেষ সীমা টেনে নামায় — আগের মতোই', () => {
    expect(elapsedWorkdays({ ...BASE, leftOn: day('2026-08-10') })).toBe(9);
  });

  /**
   * ⚠️ পুরোনো মাস হালনাগাদ করলে জানালা পর্বের শেষ দিনেই থামে। না থামলে
   * গত মাসের `workdays_elapsed` চিরকাল পুরো মাস ছাড়িয়ে বাড়ত।
   */
  it('গত মাস হালনাগাদ করলে পুরো মাসটাই গোনা হয়', () => {
    expect(elapsedWorkdays({ ...BASE, today: day('2026-09-10') })).toBe(27);
  });

  it('ভবিষ্যতের মাসে কিছুই গোনা হয়নি', () => {
    const future = { ...BASE, today: day('2026-07-20') };
    expect(elapsedWindow(future)).toBeNull();
    expect(elapsedWorkdays(future)).toBe(0);
  });
});

// ═══════════════════ ২ · ট্র্যাকিং শুরুর আগের দিন গোনা হয় না ═══════════════════

describe('elapsedWorkdays — ট্র্যাকিং শুরুর আগের কর্মদিবস বাদ', () => {
  /** ⭐ আসল ঘটনা: এজেন্ট বসেছে ১৩ আগস্ট, তার আগের ১২ দিন আমরা দেখিনি */
  it('শুরু মাসের মাঝখানে হলে আগের দিনগুলো বাদ পড়ে', () => {
    const withStart = { ...BASE, trackingStartedOn: day('2026-08-13') };

    expect(elapsedWorkdays(withStart)).toBe(6);
    expect(elapsedWindow(withStart)).toEqual({
      from: day('2026-08-13'),
      to: day('2026-08-19'),
    });

    // ⚠️ আর ওই ১১টা দিনই আগে নীরবে "০ ঘণ্টা কাজ" হয়ে যেত
    expect(elapsedWorkdays(BASE) - elapsedWorkdays(withStart)).toBe(11);
  });

  it('শুরু পর্বের আগে হলে কোনো প্রভাব নেই', () => {
    expect(
      elapsedWorkdays({ ...BASE, trackingStartedOn: day('2026-07-20') }),
    ).toBe(elapsedWorkdays(BASE));
  });

  it('শুরু ঠিক মাসের ১ তারিখ হলেও প্রভাব নেই', () => {
    expect(elapsedWorkdays({ ...BASE, trackingStartedOn: AUG_START })).toBe(17);
  });

  /**
   * ⚠️ দুটো শুরুর সীমার মধ্যে **পরেরটা** জেতে। ট্র্যাকিং ১৩ তারিখে শুরু
   * হলেও ১৭ তারিখে যোগ দেওয়া কর্মীর প্রত্যাশা ১৭ থেকেই — নইলে সে যোগ
   * দেওয়ার আগের চারটে দিনের ঘাটতি নিয়ে শুরু করত।
   */
  it('joinedOn ট্র্যাকিং-শুরুর পরে হলে joinedOn-ই জেতে', () => {
    expect(
      elapsedWorkdays({
        ...BASE,
        joinedOn: day('2026-08-17'),
        trackingStartedOn: day('2026-08-13'),
      }),
    ).toBe(3);
  });

  /**
   * ⭐⭐ **আর এটাই কর্মী-স্তরের ট্র্যাকিং-শুরুর পুরো কারণ।**
   *
   * ⚠️ সংখ্যাটা যদি **সংস্থার** প্রথম দিন হতো (আগে তাই ছিল, `where` ছাড়া
   * একটা `findFirst`), তাহলে সংস্থা পুরোনো অথচ কর্মী নতুন — এই খুব
   * সাধারণ অবস্থায় জানালা সংস্থার প্রথম দিন থেকে শুরু হতো, অর্থাৎ সে
   * সিস্টেমে আসার আগের মাসগুলোও তার ঘাটতিতে ঢুকত। `joined_on` ঠিকঠাক
   * বসানো থাকলে সেটাও আটকাত, কিন্তু ওই কলামটা মালিকের হাতে লেখা আর
   * খালিও থাকতে পারে; **এই সীমাটা ডেটা থেকেই আসে**, তাই আলাদা করে
   * ভরসা করা যায়।
   *
   * ⚠️⚠️ **যা এটা করে না, সেটাও লিখে রাখা দরকার।** `trackingStartedOn`
   * আসে `min(daily_summary.work_date)` থেকে, আর `refreshDate()` প্রতিটি
   * active কর্মীর সারি লেখে — ডেটা থাক বা না থাক। তাই এটা মাপে
   * **"সার্ভার কবে থেকে এই কর্মীকে নিয়ে চলছে"**, "এজেন্ট কবে বসেছে" নয়।
   * ১ অক্টোবর সক্রিয় হয়ে ৮ অক্টোবর এজেন্ট পাওয়া কর্মীর ৫টা এজেন্টহীন
   * দিন এখনো পুরো ঘাটতি — আগে এই ফাইলে ঠিক ওই কেসটাই "সারানো হয়েছে" বলে
   * লেখা ছিল, আর দাবিটা মিথ্যা ছিল।
   */
  it('joinedOn ট্র্যাকিং-শুরুর আগে হলে ট্র্যাকিং-শুরুই জেতে', () => {
    expect(
      elapsedWorkdays({
        ...BASE,
        joinedOn: day('2026-08-03'),
        trackingStartedOn: day('2026-08-13'),
      }),
    ).toBe(6);
  });

  /**
   * ⭐⭐ **G120 সারানো হয়েছে** *(২৪ আগস্ট ২০২৬)* — আগে এই টেস্টটাই সেই
   * ফাঁকের ক্যানারি ছিল, আর এখন সেটা উল্টে দেওয়া হয়েছে।
   *
   * ⚠️⚠️ **যে ফাঁকটা ছিল:** `trackingStartedOn` আসত `min(daily_summary
   * .work_date)` থেকে, অথচ `refreshDate()` প্রতিটি **active** কর্মীর সারি
   * লেখে (ডেটা থাক বা না থাক)। তাই ৩ আগস্ট সক্রিয় হওয়া কর্মীর ট্র্যাকিং
   * ৩ আগস্ট থেকেই ধরা হতো — এজেন্ট ১৩ তারিখে বসলেও — আর মাঝের এজেন্টহীন
   * আটটা দিন তার **পুরো ঘাটতি** হয়ে থাকত।
   *
   * ⭐ **এখন উৎস `work_sessions`** (`src/summary/tracking-start.ts`), যার
   * সারি কেবল এজেন্ট সত্যিই কিছু পাঠালে জন্মায়। অর্থাৎ সংখ্যাটা এখন
   * সত্যিই *"তার এজেন্ট কবে বসেছে"* মাপে।
   *
   * ⚠️ অঙ্কটা (`elapsedWorkdays`) এই ব্যাচে **এক লাইনও বদলায়নি** — বদলেছে
   * কেবল তাকে যে খোরাক দেওয়া হয়। তাই এই টেস্ট দেখায় খোরাকটা ঠিক হলে
   * ফলটাও ঠিক; আসল উৎস-বদলের পাহারা `proration.e2e.spec.ts`-এ।
   */
  it('এজেন্ট দেরিতে বসলে আগের দিনগুলো আর গোনা হয় না', () => {
    const activatedAug3 = {
      ...BASE,
      joinedOn: day('2026-08-03'),
      // ⭐ এজেন্ট বসেছে ১৩ তারিখে — `work_sessions`-এর প্রথম সারিও তখনই
      trackingStartedOn: day('2026-08-13'),
    };

    // ১৩–১৯ আগস্ট, শুক্রবার ১৪ বাদে = ৬ দিন
    expect(elapsedWorkdays(activatedAug3)).toBe(6);

    /**
     * ⚠️⚠️ পুরোনো আচরণের সাথে ফারাকটা **৯ কর্মদিবস** — অর্থাৎ ৭২ ঘণ্টা,
     * যা আগে ওই কর্মীর ঘাটতি হিসেবে গোনা হতো অথচ তাঁকে দেখাই হয়নি।
     */
    const asBefore = { ...activatedAug3, trackingStartedOn: day('2026-08-03') };
    expect(elapsedWorkdays(asBefore) - elapsedWorkdays(activatedAug3)).toBe(9);
  });

  /**
   * ⭐⭐ **কাউকে কখনো দেখা হয়নি** — কলার তখন `today` পাঠায়, `null` নয়।
   *
   * ⚠️⚠️ `null` পাঠালে `maxDate()`-এ ওটা "সীমা নেই" হয়ে যেত, জানালা পুরো
   * মাস জুড়ে খুলত, আর যার এজেন্ট কোনোদিন কিছু পাঠায়নি তার **পুরো মাসের
   * ঘাটতি** দাঁড়াত — অর্থাৎ ফিক্সের উল্টো ফল। এই জোড়া টেস্টটাই সেই
   * সিদ্ধান্তের পাহারা।
   */
  it('কখনো দেখা হয়নি — today পাঠালে প্রত্যাশা ০, null পাঠালে পুরো মাস', () => {
    const neverSeen = { ...BASE, trackingStartedOn: BASE.today };
    expect(elapsedWorkdays(neverSeen)).toBe(0);

    // ⚠️ ভুলটা দেখতে কেমন — কেউ `?? null` লিখে ফেললে এটাই ঘটবে
    const withNull = { ...BASE, trackingStartedOn: null };
    expect(elapsedWorkdays(withNull)).toBeGreaterThan(0);
  });

  /** ⚠️ ট্র্যাকিং আজই শুরু — শেষ হয়ে যাওয়া একটা দিনও দেখা হয়নি, তাই প্রত্যাশা ০ */
  it('ট্র্যাকিং আজ শুরু হলে জানালা খালি', () => {
    const fresh = { ...BASE, trackingStartedOn: BASE.today };
    expect(elapsedWindow(fresh)).toBeNull();
    expect(elapsedWorkdays(fresh)).toBe(0);
  });

  it('ট্র্যাকিং-শুরু ক্যালেন্ডার ছুটির সাথেও মেলে', () => {
    expect(
      elapsedWorkdays({
        ...BASE,
        trackingStartedOn: day('2026-08-13'),
        holidays: new Set([day('2026-08-17').getTime()]),
      }),
    ).toBe(5);
  });
});

// ════════════════════════════ ৩ · আজকের দিনটা বাদ ════════════════════════════

describe('elapsedWorkdays — আজকের দিন প্রত্যাশায় ধরা হয় না', () => {
  /**
   * ⚠️⚠️ Live Board-এ ঠিক এই ভুলটাই ধরা পড়েছিল: আজকের পুরো ৮ ঘণ্টা
   * প্রত্যাশায় ধরলে ভোর ৬টায় দল "১১৪ ঘণ্টা পিছিয়ে" দেখাত, আর সন্ধ্যা
   * নাগাদ সংখ্যাটা নিজে থেকেই ঠিক হয়ে যেত। একই দল দিনে দুবার দুই রকম
   * রায় পেত, কেবল ঘড়ির কাঁটার কারণে।
   */
  it('জানালা গতকালেই থামে, আজ নয়', () => {
    // আজ (২০ আগস্ট, বৃহস্পতিবার) ধরলে হতো ১৮ — হাতে গোনা
    expect(elapsedWorkdays(BASE)).toBe(17);
    expect(elapsedWindow(BASE)?.to).toEqual(day('2026-08-19'));
  });

  /** পর্বের প্রথম দিনে এখনো একটা দিনও শেষ হয়নি — প্রত্যাশা ০-ই সৎ */
  it('আজ মাসের ১ তারিখ হলে জানালা খালি', () => {
    const first = { ...BASE, today: AUG_START };
    expect(elapsedWindow(first)).toBeNull();
    expect(elapsedWorkdays(first)).toBe(0);
  });

  /** ⚠️ আজ সাপ্তাহিক ছুটি হলে বাদ দেওয়া-না-দেওয়ায় তফাত নেই — সংখ্যাটা তবু স্থির থাকা চাই */
  it('আজ শুক্রবার হলেও গতকাল পর্যন্তই', () => {
    // ১–২০ আগস্ট, শুক্রবার ৭ ও ১৪ বাদে = ১৮
    expect(elapsedWorkdays({ ...BASE, today: day('2026-08-21') })).toBe(18);
  });
});

// ═════════════════ ৪ · আসল ঘটনার regression — ১৪ আগস্ট ২০২৬ ═════════════════

describe('১৪ আগস্ট ২০২৬ — ~৯৪ ঘণ্টার ভুয়া ঘাটতি আর ফিরবে না', () => {
  /** ২৭ কর্মদিবস × ৮ ঘণ্টা — আগস্টের prorated টার্গেট */
  const AUG_TARGET = 27 * 8 * HOUR;

  const monthBase = {
    workedSec: 0,
    adjustmentSec: 0,
    targetSec: AUG_TARGET,
    expectedWorkdays: 27,
    monthWorkdays: 27,
    daysWithWork: 0,
  };

  const elapsedOn = (trackingStartedOn: Date | null): number =>
    elapsedWorkdays({
      ...BASE,
      today: day('2026-08-14'),
      trackingStartedOn,
    });

  it('ট্র্যাকিং শুরুর আগে গুনলে ১২ কর্মদিবস, অর্থাৎ ৯৬ ঘণ্টার প্রত্যাশা', () => {
    const before = rollupMonth({ ...monthBase, workdaysElapsed: elapsedOn(null) });

    expect(elapsedOn(null)).toBe(12);
    expect(before.expectedSec).toBe(96 * HOUR);
  });

  /**
   * ⭐ ১৩ আগস্ট থেকে দেখা শুরু, আজ ১৪ — শেষ হওয়া কর্মদিবস মোটে একটা।
   * ⚠️ কেউ এক ঘণ্টাও কাজ না করলে ঘাটতি ৮ ঘণ্টা, ৯৬ নয়। বাকি ৮৮ ঘণ্টা
   *    কোনো ব্যর্থতা নয় — ওটা কেবল **আমাদের না-দেখা**।
   */
  it('১৩ আগস্ট থেকে গুনলে ১ কর্মদিবস, প্রত্যাশা ৮ ঘণ্টা', () => {
    const started = day('2026-08-13');
    const after = rollupMonth({
      ...monthBase,
      workdaysElapsed: elapsedOn(started),
    });

    expect(elapsedOn(started)).toBe(1);
    expect(after.expectedSec).toBe(8 * HOUR);
    expect(after.paceSec).toBe(-8 * HOUR);
  });

  /**
   * ⚠️ টার্গেট ও ঘাটতি (`shortfall_sec`) **বদলায় না** — পে-রোলের কর্তন
   * ওই দুটো থেকেই হয় (`payroll.math.ts`: `targetSec − creditedSec`)।
   * এই বদল কেবল pace/expected-কে ছোঁয়, কারো বেতনের অঙ্ক নয়।
   */
  it('টার্গেট ও ঘাটতি অপরিবর্তিত — কর্তনের হিসাব এই বদলের বাইরে', () => {
    const before = rollupMonth({ ...monthBase, workdaysElapsed: elapsedOn(null) });
    const after = rollupMonth({
      ...monthBase,
      workdaysElapsed: elapsedOn(day('2026-08-13')),
    });

    expect(after.targetSec).toBe(before.targetSec);
    expect(after.shortfallSec).toBe(before.shortfallSec);
    expect(after.creditedSec).toBe(before.creditedSec);
  });
});

// ═══════════════ ৫ · এক নিয়ম, সব পর্দা — একই ইনপুটে একই উত্তর ═══════════════

/**
 * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি অংশ।**
 *
 * ⚠️ যে ভুলটা এটা ঠেকায়, সেটা কোনো একটা সংখ্যার ভুল নয় — **দুটো সংখ্যার
 * অমিল**। এক সময় `workdays_elapsed`-এর তিনটে সংজ্ঞা চালু ছিল:
 *
 * | কোথায়            | শুরু                          | শেষ    | কী গোনে           |
 * |------------------|-------------------------------|--------|-------------------|
 * | মাসিক rollup      | max(মাস, joined, ট্র্যাকিং)    | গতকাল  | ক্যালেন্ডার কর্মদিবস |
 * | tray / `/me`      | max(মাস, joined)              | **আজ** | ক্যালেন্ডার কর্মদিবস |
 * | Live Board        | max(মাস, **org** ট্র্যাকিং)    | গতকাল  | **daily_summary সারি** |
 *
 * ফল: কর্মী নিজের tray-তে যা দেখতেন আর owner Monthly পাতায় যা দেখতেন,
 * ফারাক ~৮৯ ঘণ্টা। এখন চারটে পথই একই দুটো ফাংশন ডাকে — `elapsedWorkdays()`
 * আর `proratedExpectedSec()` — তাই সংখ্যাটা আর আলাদা হতেই পারে না।
 */
describe('একই ইনপুট → tray · Monthly · Live Board সবাই একই সংখ্যা', () => {
  /** ১৭ তারিখে যোগ দেওয়া কর্মী, ট্র্যাকিং ১৩ থেকে, আজ ২০ আগস্ট */
  const input: ElapsedInput = {
    ...BASE,
    joinedOn: day('2026-08-17'),
    trackingStartedOn: day('2026-08-13'),
  };

  /** ১৭–৩১ আগস্ট, শুক্রবার ২১ ও ২৮ বাদে = ১৩ কর্মদিবস (`prorate()`-এর d) */
  const EMPLOYEE_WORKDAYS = 13;
  const TARGET_SEC = EMPLOYEE_WORKDAYS * 8 * HOUR;

  const workdaysElapsed = elapsedWorkdays(input);

  /** মাসিক rollup — `monthly_summary.expected_sec`/`pace_sec` কলাম দুটোই এখান থেকে */
  const monthly = rollupMonth({
    workedSec: 40 * HOUR,
    adjustmentSec: 0,
    targetSec: TARGET_SEC,
    expectedWorkdays: EMPLOYEE_WORKDAYS,
    monthWorkdays: 27,
    workdaysElapsed,
    daysWithWork: 5,
  });

  it('জানালাটা যোগ দেওয়ার দিন থেকে গতকাল — ৩ কর্মদিবস', () => {
    expect(elapsedWindow(input)).toEqual({
      from: day('2026-08-17'),
      to: day('2026-08-19'),
    });
    expect(workdaysElapsed).toBe(3);
  });

  /**
   * ⭐ tray (`/me`, এজেন্টের tray) → `progress.math.ts`
   *   Monthly পাতা ও Live Board → `monthly_summary.expected_sec` কলাম
   *   দুটোই নিচের একই `proratedExpectedSec()`-এ গিয়ে ঠেকে।
   */
  it('tray আর মাসিক rollup হুবহু এক সেকেন্ডে মেলে', () => {
    const tray = trayExpectedSec({
      creditedSec: 40 * HOUR,
      monthlyTargetHours: TARGET_SEC / HOUR,
      expectedWorkdays: EMPLOYEE_WORKDAYS,
      workdaysElapsed,
    });

    expect(tray).toBe(monthly.expectedSec);
    expect(monthly.expectedSec).toBe(24 * HOUR); // ৩ দিন × ৮ ঘণ্টা
  });

  it('গতিও (pace) এক — কর্মী ও owner একই কথা পড়েন', () => {
    const tray = trayPaceSec({
      creditedSec: 40 * HOUR,
      monthlyTargetHours: TARGET_SEC / HOUR,
      expectedWorkdays: EMPLOYEE_WORKDAYS,
      workdaysElapsed,
    });

    expect(tray).toBe(monthly.paceSec);
    expect(monthly.paceSec).toBe(16 * HOUR);
  });

  /** ⚠️ সূত্রটা সত্যিই একটাই — দুটো পথই এই একই ফাংশনে গিয়ে ঠেকে */
  it('দুটো পথই `proratedExpectedSec()`-এই গিয়ে ঠেকে', () => {
    expect(
      proratedExpectedSec({
        targetSec: TARGET_SEC,
        expectedWorkdays: EMPLOYEE_WORKDAYS,
        workdaysElapsed,
      }),
    ).toBe(monthly.expectedSec);
  });

  /**
   * ⭐ রিপোর্ট (F01/F02 → Monthly পাতার হিটম্যাপ ও দৈনিক ইমেইল) দিনগুলোর
   * টার্গেট যোগ করে, কিন্তু **ঠিক এই জানালার** ভেতরেই। তাই যোগফলটা
   * সবসময় "জানালার কর্মদিবস × দৈনিক টার্গেট"-এই দাঁড়ায়।
   *
   * ⚠️ `reports.service.ts` জানালাটা নিজে বানায় না, `elapsedWindow()`
   * ডাকে — এখানে সেই যোগফলটাই নকল করে দেখানো হচ্ছে।
   */
  it('রিপোর্টের দিন-ধরে-যোগও একই জানালা, একই কর্মদিবস', () => {
    const window = elapsedWindow(input);
    expect(window).not.toBeNull();

    let workdaysSeen = 0;
    for (
      let t = window!.from.getTime();
      t <= window!.to.getTime();
      t += 86_400_000
    ) {
      // রিপোর্টের `targetSecOf()` ছুটির দিনে ০ দেয়, তাই কর্মদিবসই গোনা হয়।
      // ⚠️ শুক্রবার = `getUTCDay() === 5` (JS-এর রবি = ০ ছাঁদে)
      if (new Date(t).getUTCDay() !== 5) workdaysSeen += 1;
    }

    expect(workdaysSeen).toBe(workdaysElapsed);
  });

  /**
   * ⚠️⚠️ **পুরোনো tray-র সূত্র ফিরে এলে এই টেস্ট ভাঙবে।**
   * সেটা ছিল: মাসের ১ (বা joined) থেকে **আজ ধরে**, ট্র্যাকিং-শুরু ছাড়াই।
   */
  it('পুরোনো tray-সূত্রে ফিরে গেলে ফারাকটা আবার দেখা যেত', () => {
    const oldTrayElapsed = elapsedWorkdays({
      ...input,
      trackingStartedOn: null,
      // পুরোনো কোড আজকের দিনটাও গুনত — এক দিন পিছিয়ে দিলে সেটাই হয়
      today: day('2026-08-21'),
    });

    expect(oldTrayElapsed).toBe(4);
    expect(oldTrayElapsed).not.toBe(workdaysElapsed);
  });
});
