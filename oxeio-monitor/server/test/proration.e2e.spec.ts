import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { APPROX_HOLIDAY_SUFFIX } from '../src/reports/reports.range';
import { ReportsService } from '../src/reports/reports.service';
import { SummaryService } from '../src/summary/summary.service';
import {
  createHarness,
  loginReady,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
} from './setup/harness';

/**
 * **G37 · ADR-025** — মাঝপথে যোগ দেওয়া কর্মীর টার্গেট ও বেতন, পুরো পথ ধরে।
 *
 * ⭐ **কেন ইউনিট টেস্টই যথেষ্ট নয়:** `prorate()` নিজে ঠিক আছে সেটা
 * `proration.spec.ts` দেখায়। কিন্তু G37-এর আসল ঝুঁকি ওখানে নয় —
 * ঝুঁকিটা **জোড়ার মুখে**: rollup সংখ্যাটা ডাটাবেসে বসায় কি না, পে-রোল
 * সেটা পড়ে কি না, আর `expected_workdays` কলামের মানে বদলানোয় অন্য কেউ
 * ভুল সংখ্যা পড়ছে কি না। ⚠️ এই প্রকল্পে ঠিক এই ছাঁদেই ছয়বার বাগ হয়েছে
 * ("চুক্তি লেখা আছে, কলার লেখা হয়নি")।
 */
let h: Harness;
let owner: Session;
let summary: SummaryService;
let reports: ReportsService;

/** পরীক্ষার মাস — আগস্ট ২০২৬: শুক্রবার ৭, ১৪, ২১, ২৮ → ২৭ কর্মদিবস */
const YEAR_MONTH = '2026-08';
const utc = (day: number) => new Date(Date.UTC(2026, 7, day));
const MONTH_WORKDAYS = 27;

const HOUR = 3600;

beforeAll(async () => {
  h = await createHarness();
  summary = h.app.get(SummaryService);
  reports = h.app.get(ReportsService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
});

/** শুক্রবার ছুটি, ২০৮ঘ ÷ ২৬ দিন = ৮ ঘণ্টা — স্পেকের ডিফল্ট পলিসি */
async function makeEmployee(opts: {
  empCode: string;
  joinedOn?: Date | null;
  leftOn?: Date | null;
  monthlySalary?: number;
}): Promise<number> {
  const policy = await h.prisma.workPolicy.findFirst();

  const e = await h.prisma.employee.create({
    data: {
      empCode: opts.empCode,
      fullName: `Test ${opts.empCode}`,
      designation: 'Developer',
      status: 'active',
      joinedOn: opts.joinedOn ?? null,
      leftOn: opts.leftOn ?? null,
      monthlySalary: opts.monthlySalary ?? 20000,
      policyId: policy?.id ?? null,
    },
  });
  return e.id;
}

/**
 * rollup চালানো — আগস্টের একটা দিন দিয়ে, "এখন" মাসের শেষে।
 *
 * ⚠️ `now` = ৩১ আগস্ট দুপুর UTC → ঢাকায় ওই দিনেরই সন্ধ্যা, তাই
 *    `today` = ৩১ আগস্ট। প্রত্যাশার জানালা তাই **৩০ আগস্টেই থামে**
 *    (আজকের দিনটা গোনা হয় না, `summary.math.ts`-এর `elapsedWindow()`)।
 */
async function rollup(now = new Date(Date.UTC(2026, 7, 31, 12))): Promise<void> {
  await summary.refreshDate(utc(31), now);
}

/**
 * ওই কর্মীর কোনো দিনের `daily_summary` সারি বসানো।
 *
 * ⭐ **কেন এটা দরকার:** প্রত্যাশার জানালা শুরু হয় ওই কর্মীর **সবচেয়ে
 * পুরোনো `daily_summary` সারি** থেকে — অর্থাৎ "তাকে কবে থেকে দেখছি"।
 * সারি না বসালে rollup নিজেই আজকের (৩১ আগস্টের) সারিটা লেখে, আর তখন
 * ট্র্যাকিং-শুরু = আজ, অর্থাৎ শেষ হয়ে যাওয়া একটা দিনও দেখা হয়নি।
 */
function seeDays(employeeId: number, days: number[]): Promise<unknown> {
  return h.prisma.dailySummary.createMany({
    data: days.map((d) => ({ employeeId, workDate: utc(d) })),
  });
}

/**
 * ⭐⭐ **এজেন্ট সত্যিই কিছু পাঠিয়েছে** — `work_sessions`-এর সারিই এখন
 * "তাকে কবে থেকে দেখছি"-র একমাত্র প্রমাণ (G120, ২৪ আগস্ট ২০২৬)।
 *
 * ⚠️ আগে `seeDays()`-ই এই কাজ করত, কারণ ট্র্যাকিং-শুরু আসত `daily_summary`
 * থেকে। কিন্তু ওই টেবিলে `refreshDate()` **সবার** সারি লেখে, ডেটা থাক বা
 * না থাক — তাই ওটা "দেখেছি" নয়, "সার্ভার চলছে" মাপত।
 */
async function seeSessions(employeeId: number, days: number[]): Promise<void> {
  const device = await h.prisma.device.create({
    data: {
      hostname: `PC-${employeeId}`,
      windowsUsername: `user${employeeId}`,
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
    },
  });
  await h.prisma.workSession.createMany({
    data: days.map((d) => ({
      employeeId,
      deviceId: device.id,
      workDate: utc(d),
      startedAt: new Date(Date.UTC(2026, 7, d, 4, 0)),
    })),
  });
}

const monthRow = (employeeId: number) =>
  h.prisma.monthlySummary.findUniqueOrThrow({
    where: { employeeId_yearMonth: { employeeId, yearMonth: YEAR_MONTH } },
  });

describe('rollup — monthly_summary-তে prorated টার্গেট', () => {
  it('পুরো মাস থাকলে টার্গেট = ২৭ × ৮ = ২১৬ ঘণ্টা, ফ্ল্যাট ২০৮ নয়', async () => {
    const id = await makeEmployee({ empCode: 'PR-FULL' });
    await rollup();

    const row = await monthRow(id);

    expect(row.targetSec).toBe(216 * HOUR);
    expect(row.expectedWorkdays).toBe(MONTH_WORKDAYS);
    expect(row.monthWorkdays).toBe(MONTH_WORKDAYS);
  });

  /** ⭐ মালিকের উদাহরণ — "১৫ তারিখ join করলে ১৫ দিনের salary" */
  it('১৭ আগস্ট যোগ দিলে টার্গেট তার নিজের কর্মদিবস × ৮', async () => {
    const id = await makeEmployee({ empCode: 'PR-MID', joinedOn: utc(17) });
    await rollup();

    const row = await monthRow(id);

    // ১৭–৩১ আগস্ট, শুক্রবার ২১ ও ২৮ বাদে = ১৩ দিন
    expect(row.expectedWorkdays).toBe(13);
    expect(row.targetSec).toBe(13 * 8 * HOUR);

    // ⚠️ D আলাদা কলামে — পে-রোলের ভগ্নাংশের হর
    expect(row.monthWorkdays).toBe(MONTH_WORKDAYS);
  });

  it('মাসের পরে যোগ দিলে টার্গেট শূন্য, আর "টার্গেট পূরণ" নয়', async () => {
    const id = await makeEmployee({ empCode: 'PR-LATE', joinedOn: new Date(Date.UTC(2026, 8, 10)) });
    await rollup();

    const row = await monthRow(id);

    expect(row.expectedWorkdays).toBe(0);
    expect(row.targetSec).toBe(0);
    /**
     * ⚠️⚠️ এটাই এখানকার সূক্ষ্ম শর্ত: `credited >= target` মানে `0 >= 0`,
     * অর্থাৎ যে ওই মাসে ছিলই না সে-ও "✅ টার্গেট পূরণ" দেখাত আর
     * `target_met_at`-এ একটা সময় বসে যেত। অর্জন বলার মতো কিছু ঘটেনি।
     */
    expect(row.targetMet).toBe(false);
    expect(row.targetMetAt).toBeNull();
  });

  /**
   * ⭐⭐ **সংখ্যাটা বদলেছে — ১৩ থেকে ০ — আর সেটাই এখন সঠিক।**
   *
   * এই টেস্ট আগে দাবি করত `workdaysElapsed === 13` ও
   * `expectedSec === targetSec`, অর্থাৎ ১৭ তারিখে যোগ দেওয়া কর্মীর কাছে
   * ৩১ আগস্টেই পুরো ১০৪ ঘণ্টা দাবি করা হচ্ছে। কিন্তু এই দৃশ্যে তার
   * **একটাও `daily_summary` সারি নেই** — `rollup()` নিজেই ৩১ তারিখের
   * সারিটা প্রথমবার বসায়। অর্থাৎ ওই ১৩ দিনে আমরা তাকে দেখিইনি।
   *
   * ⚠️ **অনুপস্থিত পর্যবেক্ষণকে ব্যর্থতা বলে গোনা যাবে না** (এই প্রকল্পের
   * কেন্দ্রীয় নীতি)। না-দেখা দিনের প্রত্যাশা ০, আর তাই pace-ও ০ — "সে
   * পিছিয়ে" নয়, "আমরা জানি না"।
   *
   * ⚠️ টার্গেট (`target_sec`) কিন্তু **অটুট** — ওটা চুক্তির সংখ্যা, আর
   * পে-রোলের কর্তন ওখান থেকেই হয়। এই বদল কেবল pace/expected-কে ছোঁয়।
   */
  it('যাকে এখনো একটা শেষ-হওয়া দিনেও দেখা হয়নি, তার প্রত্যাশা ০', async () => {
    const id = await makeEmployee({ empCode: 'PR-ELAPSED', joinedOn: utc(17) });
    await rollup();

    const row = await monthRow(id);

    expect(row.workdaysElapsed).toBe(0);
    expect(row.expectedSec).toBe(0);
    expect(row.paceSec).toBe(0);
    // ⭐ অথচ টার্গেট আগের মতোই তার নিজের ১৩ কর্মদিবসের
    expect(row.targetSec).toBe(13 * 8 * HOUR);
  });

  /**
   * ⭐ ট্র্যাকিং শুরুর পর থেকে গোনা হয়, **আজকের দিনটা বাদে**।
   *
   * ⚠️ একটামাত্র সারি (১৭ আগস্ট) বসানোই যথেষ্ট — জানালার শুরু ঠিক করে
   * তার **সবচেয়ে পুরোনো** সারিটা, কতগুলো সারি আছে তা নয়। ১৮–৩০-এর
   * অনুপস্থিত সারিগুলো "না-দেখা দিন" নয়: এজেন্ট তো বসেই গেছে, ওগুলো
   * সত্যিকারের শূন্য দিন।
   */
  it('ট্র্যাকিং শুরুর পরের কর্মদিবস গোনা হয়, আজকের দিন বাদে', async () => {
    const id = await makeEmployee({ empCode: 'PR-SEEN', joinedOn: utc(17) });
    await seeDays(id, [17]);
    // ⭐ G120 — ট্র্যাকিং-শুরু এখন সেশন থেকে, খালি দৈনিক সারি থেকে নয়
    await seeSessions(id, [17]);
    await rollup();

    const row = await monthRow(id);

    // ১৭–৩০ আগস্ট (৩১ = আজ, বাদ), শুক্রবার ২১ ও ২৮ বাদে = ১২ দিন
    expect(row.workdaysElapsed).toBe(12);
    expect(row.expectedSec).toBe(96 * HOUR);
    // ⚠️ ১৩ দিনের টার্গেটের ঠিক ১২/১৩ — শেষ দিনটা এখনো শেষ হয়নি
    expect(row.expectedSec).toBe(Math.round((row.targetSec * 12) / 13));
  });

  /**
   * ⭐⭐ **মাস শেষ হয়ে গেলে প্রত্যাশা ঠিক টার্গেটে গিয়ে ঠেকে** — তার
   * বেশিও নয়, কমও নয়। না মিললে যে কর্মী পুরো মাস নিখুঁত কাজ করেছেন
   * তিনিও শেষে "পিছিয়ে" দেখতেন, আর এই ফিচারটার পুরো উদ্দেশ্যই আস্থা।
   */
  it('মাস ফুরিয়ে গেলে প্রত্যাশা = পুরো টার্গেট', async () => {
    const id = await makeEmployee({ empCode: 'PR-CLOSED', joinedOn: utc(17) });
    await seeDays(id, [17]);
    await seeSessions(id, [17]);

    // "এখন" ১ সেপ্টেম্বর — আগস্টের শেষ দিনটাও এখন গতকালের আগে
    await rollup(new Date(Date.UTC(2026, 8, 1, 12)));

    const row = await monthRow(id);

    expect(row.workdaysElapsed).toBe(13);
    expect(row.expectedSec).toBe(row.targetSec);
  });
});

describe('পে-রোল — বেতনও prorate হয়', () => {
  const payroll = () =>
    owner.http.get(`/api/v1/payroll?month=${YEAR_MONTH}`).expect(200);

  const rowFor = (body: { rows: { empCode: string }[] }, code: string) =>
    body.rows.find((r) => r.empCode === code) as unknown as Record<string, string>;

  /**
   * ⚠️ একটাও ঘণ্টা কাজ না করলে **পুরো prorated বেতনটাই** কাটা যায়, তাই
   * প্রদেয় ০। কর্তনের অঙ্কটাই তাই prorated ভিত্তিটা সরাসরি দেখায় —
   * ২০,০০০ নয়, ৯,৬২৯.৬৩।
   */
  it('prorated ভিত্তি = বেতন × d ÷ D', async () => {
    await makeEmployee({ empCode: 'PR-PAY', joinedOn: utc(17), monthlySalary: 20000 });
    await rollup();

    const row = rowFor((await payroll()).body, 'PR-PAY');

    // ২০,০০০ × ১৩ ÷ ২৭ = ৯,৬২৯.৬৩
    expect(row.deduction).toBe('9629.63');
    expect(row.payable).toBe('0.00');
  });

  /**
   * ⭐⭐ **মালিকের উদাহরণের সরাসরি রূপ** — "১৫ তারিখ join করলে ১৫ দিনের
   * salary"। নিজের পুরো টার্গেট (১৩ × ৮ = ১০৪ঘ) করলে কোনো কর্তন নয়, আর
   * প্রদেয় ঠিক prorated বেতন।
   */
  it('নিজের পুরো টার্গেট করলে prorated বেতন পুরোটাই পায়', async () => {
    const id = await makeEmployee({
      empCode: 'PR-WORKED',
      joinedOn: utc(17),
      monthlySalary: 20000,
    });

    // ⚠️ ৩১ তারিখ বাদ — `refreshDate(31)` ওই দিনের সারিটা segments থেকে
    //    নতুন করে বসায়, তাই এখানে লিখলে মুছে যেত।
    const workdays = [17, 18, 19, 20, 24, 25, 26, 27, 30];
    await h.prisma.dailySummary.createMany({
      data: workdays.map((day) => ({
        employeeId: id,
        workDate: utc(day),
        workedSec: 8 * HOUR,
        creditedSec: 8 * HOUR,
      })),
    });

    // ৯ দিন × ৮ঘ = ৭২ঘ; বাকি ৪ দিনের ৩২ঘ owner-এর সংশোধনে
    await h.prisma.dailySummary.update({
      where: { employeeId_workDate: { employeeId: id, workDate: utc(17) } },
      data: { adjustmentSec: 32 * HOUR },
    });

    await rollup();

    const month = await monthRow(id);
    expect(month.creditedSec).toBe(104 * HOUR);
    expect(month.targetSec).toBe(104 * HOUR);

    const row = rowFor((await payroll()).body, 'PR-WORKED');
    expect(row.deduction).toBe('0.00');
    expect(row.payable).toBe('9629.63');
  });

  /**
   * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট — পুরো পথ ধরে।**
   *
   * ADR-025-এর ন্যায্যতার দাবিটা এই সমতা: বেতন ও টার্গেট দুটোই prorate
   * করায় ঘণ্টাপ্রতি হার d-নিরপেক্ষ। ⚠️ শুধু টার্গেট prorate করলে ১৭
   * তারিখে যোগ দেওয়া কর্মীর হার দ্বিগুণ হয়ে যেত — আর সেটা একটামাত্র
   * সংখ্যা দেখে ধরা পড়ত না, দুজনের হার পাশাপাশি না রাখলে।
   */
  it('⭐ ঘণ্টাপ্রতি হার — যে ১৭ তারিখে এলো আর যে পুরো মাস ছিল, দুজনেরই এক', async () => {
    await makeEmployee({ empCode: 'PR-A', monthlySalary: 20000 });
    await makeEmployee({ empCode: 'PR-B', joinedOn: utc(17), monthlySalary: 20000 });
    await rollup();

    const res = await payroll();

    expect(rowFor(res.body, 'PR-B').hourlyRate).toBe(rowFor(res.body, 'PR-A').hourlyRate);
    // ২০০০০ ÷ (২৭ × ৮) = ৯২.৫৯
    expect(rowFor(res.body, 'PR-A').hourlyRate).toBe('92.59');
  });

  it('মাসের পরে যোগ দিলে ওই মাসে প্রদেয় শূন্য', async () => {
    await makeEmployee({
      empCode: 'PR-NONE',
      joinedOn: new Date(Date.UTC(2026, 8, 10)),
      monthlySalary: 20000,
    });
    await rollup();

    const res = await payroll();
    expect(rowFor(res.body, 'PR-NONE').payable).toBe('0.00');
  });
});

/**
 * ⭐⭐ **G117 — রিপোর্টের টার্গেটও অফিস-ডে ধরে** *(২৩ আগস্ট ২০২৬)*।
 *
 * মালিকের নিয়ম: *"daily 8 ghonta kore, without holiday and friday"*, আর
 * *"maser hisab na kore office day hisab koro"*।
 *
 * ⚠️⚠️ **কেন এই টেস্টগুলো আলাদা করে দরকার:** এই সংখ্যাটার উপর গোটা রেপোতে
 * আগে **একটাও assertion ছিল না** — তিন জায়গায় কেবল খালি `{}` ফিক্সচার।
 * অর্থাৎ `meta` ফ্ল্যাট ২০৮ ফেরালেও সব সবুজ থাকত, আর ঠিক তাই থাকত।
 *
 * ⭐ প্রতিটা দাবিতে ধ্রুবকের **সাথে সাথে** `monthly_summary.target_sec`-ও
 * মেলানো হয় — কেবল ধ্রুবক মেলালে দুটো আবার আলাদা হয়ে গেলেও টেস্ট সবুজ
 * থাকত, আর G117 নীরবে ফিরে আসত।
 */
describe('G117 — রিপোর্টের টার্গেট অফিস-ডে ধরে, ফ্ল্যাট ২০৮ নয়', () => {
  const monthTarget = async (employeeId: number): Promise<number> => {
    const r = await reports.attendance({ from: '2026-08-01', to: '2026-08-31' });
    return r.meta.targetHoursInRange[employeeId];
  };

  it('পুরো মাস থাকলে ২১৬ ঘণ্টা — আর সংখ্যাটা monthly_summary-র সাথে হুবহু এক', async () => {
    const id = await makeEmployee({ empCode: 'G117-FULL' });
    await rollup();

    // ২৭ অফিস-ডে × ৮ঘ। ⚠️ পলিসির ফ্ল্যাট ২০৮ হলে এই দাবিটাই ভাঙবে।
    expect(await monthTarget(id)).toBe(216);

    // ⭐⭐ আসল পাহারা — দুই পথে গোনা দুটো সংখ্যা এক কি না
    expect(await monthTarget(id)).toBe((await monthRow(id)).targetSec / HOUR);
  });

  it('১৭ আগস্ট যোগ দিলে কেবল তার নিজের ১৩ অফিস-ডে গোনা হয়', async () => {
    const id = await makeEmployee({ empCode: 'G117-MID', joinedOn: utc(17) });
    await rollup();

    expect(await monthTarget(id)).toBe(13 * 8);
    expect(await monthTarget(id)).toBe((await monthRow(id)).targetSec / HOUR);
  });

  /**
   * ⭐⭐ **এটাই "মাস ধরে নয়, অফিস-ডে ধরে"-র আসল প্রমাণ।**
   *
   * ১–১০ আগস্ট = ১০ দিন, তার মধ্যে ৭ তারিখ শুক্রবার → **৯ অফিস-ডে = ৭২ঘ**।
   * ⚠️ পুরোনো কোড এখানেও ২০৮ বলত, কারণ সংখ্যাটা পরিসর দেখত না।
   */
  it('আধা মাস চাইলে আধা মাসেরই টার্গেট — ৯ অফিস-ডে = ৭২ ঘণ্টা', async () => {
    const id = await makeEmployee({ empCode: 'G117-HALF' });
    await rollup();

    const r = await reports.attendance({ from: '2026-08-01', to: '2026-08-10' });
    expect(r.meta.targetHoursInRange[id]).toBe(72);
  });

  /**
   * ⚠️ R2 — সবেতন ছুটির দিন টার্গেট থেকে বাদ, নইলে ছুটিটাই ঘাটতি হয়ে দাঁড়াত।
   * ⭐ ৩ ও ৪ আগস্ট (সোম, মঙ্গল) — দুটোই অফিস-ডে, তাই ২১৬ − ১৬ = ২০০।
   */
  it('ছুটির দিনও বাদ যায়, আর tray-র সংখ্যার সাথেই মেলে', async () => {
    const id = await makeEmployee({ empCode: 'G117-LEAVE' });
    // ⚠️ `created_by` বাধ্যতামূলক — কে ছুটি বসাল সেটা খাতায় থাকতেই হবে
    await h.prisma.leave.createMany({
      data: [
        { employeeId: id, leaveDate: utc(3), type: 'casual', createdBy: OWNER_EMAIL },
        { employeeId: id, leaveDate: utc(4), type: 'casual', createdBy: OWNER_EMAIL },
      ],
    });
    await rollup();

    expect(await monthTarget(id)).toBe(200);
    expect(await monthTarget(id)).toBe((await monthRow(id)).targetSec / HOUR);
  });

  /**
   * ⚠️ যিনি ওই পরিসরে কর্মীই ছিলেন না, তিনি রিপোর্টে **থাকেনই না** — তাই
   * ঘরটা `undefined`, ০ নয়। ⭐ পার্থক্যটা আসল: ০ মানে *"অফিস-ডে নেই"*,
   * আর `undefined` মানে *"এই কাগজে তাঁর কোনো সারিই নেই"*।
   *
   * ⚠️⚠️ তবু ০ **পৌঁছনীয়** — পুরো পরিসরটা ছুটিতে কাটালে। আগে ছিল না
   * (ফ্ল্যাট ২০৮ কখনো ০ হতো না), তাই ওয়েবে সেটা "0h 0m, ০%" না দেখিয়ে
   * "No target" দেখানো হয় (`HeatGrid.tsx`)।
   */
  it('পরের মাসে যোগ দিলে তিনি এই কাগজেই নেই — ০ নয়, অনুপস্থিত', async () => {
    const id = await makeEmployee({
      empCode: 'G117-LATE',
      joinedOn: new Date(Date.UTC(2026, 8, 10)),
    });
    await rollup();

    const r = await reports.attendance({ from: '2026-08-01', to: '2026-08-31' });
    expect(r.meta.targetHoursInRange[id]).toBeUndefined();
    expect(r.rows.some((row) => row.employeeId === id)).toBe(false);
  });
});

/**
 * ⭐⭐ **G120 — "কবে থেকে দেখছি" এখন `work_sessions` ধরে** *(২৪ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ **যে বাগটা এটা ধরে:** `refreshDate()` প্রতিটি active কর্মীর
 * `daily_summary` সারি লেখে, ডেটা থাক বা না থাক। তাই ১ তারিখে কর্মী তৈরি
 * হলে ওই দিন থেকেই "দেখছি" ধরা হতো, আর এজেন্ট ১৭ তারিখে বসলেও মাঝের
 * দিনগুলো **পুরো ঘাটতি** হয়ে থাকত।
 *
 * ⭐ ইউনিট টেস্ট এটা ধরতে পারে না — ওখানে `trackingStartedOn` হাতে বসানো
 * হয়। ফাঁকটা ছিল **কোন টেবিল থেকে সংখ্যাটা আসে** তাতে, আর সেটা কেবল
 * ডাটাবেসসহ পরীক্ষা করা যায়।
 */
describe('G120 — ট্র্যাকিং-শুরু: খালি সারি নয়, আসল সেশন', () => {
  /**
   * ⚠️⚠️ **`workdaysElapsed`, `expectedWorkdays` নয়** — দুটো আলাদা জিনিস,
   * আর প্রথমবার আমি ভুলটাই পড়েছিলাম (CI ধরিয়ে দিয়েছে)।
   *
   * `expectedWorkdays` = `prorate()`-এর **d**, অর্থাৎ তার নিজের কর্মদিবস —
   * ট্র্যাকিং-শুরুর সাথে এর কোনো সম্পর্ক নেই। জানালাটা যায়
   * `workdaysElapsed`-এ, আর সেখান থেকেই `expectedSec`।
   */
  const elapsed = async (employeeId: number): Promise<number> =>
    (await monthRow(employeeId)).workdaysElapsed;

  /**
   * ⭐⭐ **আসল পুনরুৎপাদন।** ১–১৬ আগস্টের খালি `daily_summary` সারি আছে
   * (ঠিক যা `refreshDate()` লেখে), কিন্তু এজেন্টের প্রথম সেশন ১৭ তারিখে।
   *
   * ⚠️ পুরোনো কোডে ট্র্যাকিং-শুরু হতো **১ আগস্ট**, তাই প্রত্যাশার জানালা
   * পুরো মাস জুড়ে খুলত। এখন খোলে ১৭ তারিখ থেকে।
   */
  it('খালি সারি জমা থাকলেও এজেন্ট বসার আগের দিন গোনা হয় না', async () => {
    const id = await makeEmployee({ empCode: 'G120-LATE' });
    await seeDays(id, Array.from({ length: 16 }, (_, i) => i + 1));
    await seeSessions(id, [17]);
    await rollup();

    // ১৭–৩০ আগস্ট (আজকের ৩১ বাদ), শুক্রবার ২১ ও ২৮ বাদে = ১২ দিন
    expect(await elapsed(id)).toBe(12);
  });

  /**
   * ⚠️⚠️ **উল্টো দিকের পাহারা।** কারো একটাও সেশন না থাকলে হেল্পার কিছুই
   * ফেরত দেয় না, আর কলার তখন `today` পাঠায় — জানালা খালি, প্রত্যাশা ০।
   *
   * ⭐ কেউ ভুল করে `?? null` লিখলে এই টেস্টটাই ভাঙবে: `null` মানে
   * "সীমা নেই", তাই প্রত্যাশা পুরো মাসের হয়ে যেত।
   */
  it('এজেন্ট কখনো কিছু পাঠায়নি — প্রত্যাশা ০, পুরো মাস নয়', async () => {
    const id = await makeEmployee({ empCode: 'G120-NEVER' });
    await seeDays(id, [1, 2, 3, 4, 5]);
    await rollup();

    expect(await elapsed(id)).toBe(0);

    // ⚠️ টার্গেট অটুট — এই ফিক্স টাকার কোনো হিসাব ছোঁয় না
    expect((await monthRow(id)).targetSec).toBe(216 * HOUR);
  });

  /** ⭐ সেশন থাকলে সংখ্যাটা স্থির — rollup দুবার চালালেও নড়ে না */
  it('rollup দুবার চালালেও ট্র্যাকিং-শুরু নড়ে না', async () => {
    const id = await makeEmployee({ empCode: 'G120-STABLE' });
    await seeSessions(id, [17, 18, 19]);

    await rollup();
    const first = await elapsed(id);
    await rollup();

    expect(await elapsed(id)).toBe(first);
  });
});

/**
 * ⭐⭐ **G108 — যে অনুমানের উপর `d ÷ D` দাঁড়ানো, সেটা পে-রোলের গায়েই লেখা
 * থাকে** *(৪ সেপ্টেম্বর ২০২৬)*।
 *
 * চান্দ্র ছুটির তারিখ চাঁদ দেখার পর নড়ে। নড়লে ওই মাসের কর্মদিবস বদলায়,
 * অর্থাৎ **হর D বদলায়** — আর তাতে প্রতিটা কর্মীর prorated বেতন বদলায়।
 * এতদিন এই অনিশ্চয়তাটা কেবল ছুটির *নামে* ছিল (`(সম্ভাব্য)`); যিনি পে-রোল
 * খুলে বেতন ছাড়তেন তিনি জানতেনই না সংখ্যাটা এখনো নড়তে পারে।
 *
 * ⚠️ এখানে e2e লাগে কারণ ঝুঁকিটা অঙ্কে নয়, **জোড়ার মুখে**: `sheet()`
 * মাসের ছুটির সারিগুলো আদৌ পড়ে কি না, আর পড়ে সেটা রেসপন্সে তোলে কি না।
 */
describe('G108 — পে-রোল বলে দেয় কোন তারিখ এখনো পাকা নয়', () => {
  const payrollBody = async () =>
    (await owner.http.get(`/api/v1/payroll?month=${YEAR_MONTH}`).expect(200))
      .body as { approximateHolidayDates: string[] };

  /** ২৬ আগস্ট বুধবার — শুক্রবার নয়, তাই এটা সত্যিই একটা কর্মদিবস কাড়ে */
  const addHoliday = (day: number, name: string) =>
    h.prisma.holiday.create({ data: { holidayDate: utc(day), name } });

  it('সম্ভাব্য ছুটি থাকলে তারিখটা রেসপন্সে ওঠে', async () => {
    await makeEmployee({ empCode: 'G108-PAY' });
    await addHoliday(26, `Eid-e-Miladunnabi${APPROX_HOLIDAY_SUFFIX}`);
    await rollup();

    expect((await payrollBody()).approximateHolidayDates).toEqual(['2026-08-26']);
  });

  it('পাকা ছুটি চুপ থাকে — সব ছুটি নিয়ে সতর্ক করলে সতর্কবার্তার দাম থাকত না', async () => {
    await makeEmployee({ empCode: 'G108-FIXED' });
    await addHoliday(26, 'National Day');
    await rollup();

    expect((await payrollBody()).approximateHolidayDates).toEqual([]);
  });

  it('কোনো ছুটিই না থাকলে খালি — `undefined` নয়', async () => {
    // ⚠️ `undefined` হলে ওয়েবে `.length` পড়তে গিয়ে পাতাটাই ভাঙত, আর
    //    ভাঙত ঠিক সেই মাসে যেটায় কোনো ছুটি নেই — অর্থাৎ পরীক্ষায় নয়।
    await makeEmployee({ empCode: 'G108-NONE' });
    await rollup();

    expect((await payrollBody()).approximateHolidayDates).toEqual([]);
  });

  /**
   * ⭐⭐ **সতর্কবার্তাটা সত্যিই ওই টাকাটার কথা বলছে কি না।**
   *
   * ⚠️ শুধু "তারিখটা তালিকায় আছে" দেখলে টেস্টটা সবুজ থাকত এমনকি যদি
   * ছুটিটা হিসাবেই না ধরা হতো। তাই এখানে **একই মাসে** দুটো জিনিস একসাথে
   * দেখা হয়: তারিখটা সতর্কবার্তায় উঠেছে, **আর** ওই তারিখটা সত্যিই একটা
   * কর্মদিবস কেড়ে নিয়েছে (২৭ → ২৬), যার ফলে prorated ভিত্তি বদলেছে।
   * এক সারি থেকেই দুটো আসছে — এটাই "এক সংখ্যা, এক সংজ্ঞা"।
   */
  it('⭐ যে ছুটির কথা সতর্কবার্তায়, সেই ছুটিই D কমায়', async () => {
    await makeEmployee({ empCode: 'G108-D', monthlySalary: 20000 });
    await addHoliday(26, `Eid-e-Miladunnabi${APPROX_HOLIDAY_SUFFIX}`);
    await rollup();

    const body = (await owner.http
      .get(`/api/v1/payroll?month=${YEAR_MONTH}`)
      .expect(200)).body as {
      approximateHolidayDates: string[];
      rows: { empCode: string; hourlyRate: string }[];
    };

    expect(body.approximateHolidayDates).toEqual(['2026-08-26']);

    // ২৭ নয়, ২৬ কর্মদিবস → ২০০০০ ÷ (২৬ × ৮) = ৯৬.১৫ (২৭ হলে হতো ৯২.৫৯)
    const row = body.rows.find((r) => r.empCode === 'G108-D')!;
    expect(row.hourlyRate).toBe('96.15');
  });

  /**
   * ⚠️ মাসের বাইরের ছুটি টানলে আগস্টের কাগজে সেপ্টেম্বরের অনিশ্চয়তা
   * দেখাত — অথচ ওটা আগস্টের D-কে ছোঁয়ই না।
   */
  it('অন্য মাসের সম্ভাব্য ছুটি এই মাসের কাগজে আসে না', async () => {
    await makeEmployee({ empCode: 'G108-OTHER' });
    await h.prisma.holiday.create({
      data: {
        holidayDate: new Date(Date.UTC(2026, 8, 15)),
        name: `Next month${APPROX_HOLIDAY_SUFFIX}`,
      },
    });
    await rollup();

    expect((await payrollBody()).approximateHolidayDates).toEqual([]);
  });
});

/**
 * ⭐⭐ **G110 · G111 — রিপোর্টের `meta` দুটো অবস্থা আলাদা করে বলে**
 * *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ দুটোই এক জাতের ত্রুটি: **কোনো সংখ্যা ভুল নয়**, শুধু একটা অবস্থা
 * অন্যটার ছদ্মবেশে যায়।
 *   · G111 — যাঁকে এখনো একটা শেষ-হওয়া কর্মদিবসেও দেখা হয়নি, তাঁর প্রত্যাশা
 *     ০, তাই ঘাটতিও ০ — পর্দায় হুবহু "টার্গেট পূরণ"-এর মতো।
 *   · G110 — ট্র্যাকিং শুরুর আগের দিনগুলো হিটম্যাপে "কর্মদিবসে কিছুই
 *     হয়নি"-র লালচে ছোঁয়া পেত।
 *
 * ⚠️ e2e লাগে কারণ ঝুঁকিটা অঙ্কে নয়, **জোড়ার মুখে** — `context()` ঘরদুটো
 * ভরে কি না, আর `meta` সেগুলো তোলে কি না।
 */
describe('G110 · G111 — meta-তে "দেখা হয়েছে" ও "কবে থেকে"', () => {
  const metaOf = async () =>
    (await reports.attendance({ from: '2026-08-01', to: '2026-08-31' })).meta;

  it('একটাও শেষ-হওয়া দিন দেখা হয়নি — `observed` মিথ্যা', async () => {
    // ⚠️ কোনো সেশন নেই, তাই ট্র্যাকিং-শুরু = আজ (৩১ আগস্ট), আর জানালা খালি
    const id = await makeEmployee({ empCode: 'G111-NEW' });
    await rollup();

    expect((await metaOf()).observed[id]).toBe(false);
  });

  it('শেষ-হওয়া দিন দেখা হয়েছে — `observed` সত্যি', async () => {
    const id = await makeEmployee({ empCode: 'G111-SEEN' });
    await seeSessions(id, [17, 18, 19]);
    await rollup();

    expect((await metaOf()).observed[id]).toBe(true);
  });

  /**
   * ⭐⭐⭐ **এই ফাইলের G111-অংশের সবচেয়ে জরুরি টেস্ট — দুটো এক সূত্রে বাঁধা।**
   *
   * ⚠️⚠️ পতাকা আর প্রত্যাশা **কখনো দুই কথা বলতে পারে না**, আর সেটা কাকতালীয়
   * নয়: দুটোই একই জানালা (`elapsedWindow`) থেকে বেরোয়। আলাদা কোনো কোয়েরি
   * বা আলাদা নিয়মে গুনলে একদিন পাতাটা "এখনো দেখা হয়নি" লিখত অথচ পাশে
   * ১২০ ঘণ্টার ঘাটতি দেখাত — অর্থাৎ একই সারি নিজের সাথেই বিরোধ করত।
   *
   * ⭐ ভবিষ্যতে কেউ পতাকাটা অন্য কোথাও থেকে (যেমন `daily_summary`-র সারি
   * গুনে) বানাতে গেলে এই সমতাটাই ভাঙবে।
   */
  it('⭐ `observed` মিথ্যা ⟺ প্রত্যাশা ০ — দুটোই একই জানালার', async () => {
    const seen = await makeEmployee({ empCode: 'G111-A' });
    await seeSessions(seen, [17, 18]);

    // এজেন্ট কোনোদিন কিছু পাঠায়নি
    const unseen = await makeEmployee({ empCode: 'G111-B' });
    await rollup();

    const meta = await metaOf();

    expect(meta.observed[seen]).toBe(true);
    expect(meta.expectedHours[seen]).toBeGreaterThan(0);

    expect(meta.observed[unseen]).toBe(false);
    expect(meta.expectedHours[unseen]).toBe(0);

    // ⚠️ কিন্তু টার্গেট দুজনেরই অটুট — জানালা টার্গেট ছোঁয় না, আর ঠিক
    //    সেজন্যই না-দেখা মানুষের পুরো টার্গেটটা দলের যোগফল থেকে বাদ পড়ে।
    expect(meta.targetHoursInRange[unseen]).toBe(216);
  });

  it('G110 — ট্র্যাকিং-শুরুর তারিখটা meta-তে যায়', async () => {
    const id = await makeEmployee({ empCode: 'G110-DATE' });
    await seeSessions(id, [13, 14, 17]);
    await rollup();

    // ⚠️ সবচেয়ে পুরোনো সেশনের দিন — ১৩ আগস্ট, ঠিক যেমন এই ইনস্টলেশনে হয়েছিল
    expect((await metaOf()).trackedFrom[id]).toBe('2026-08-13');
  });

  it('G110 — কখনো কিছু পাঠায়নি হলে তারিখটা `null`', async () => {
    // ⚠️ ০ বা আজকের তারিখ নয় — `null` মানে "খবর নেই", আর পাতাটা তখন
    //    মাসের সব কর্মদিবসকেই না-দেখা আঁকে। আজকের তারিখ বসালে পাতাটা
    //    দাবি করত আমরা আজ থেকে দেখছি, অথচ একটাও সেশন নেই।
    const id = await makeEmployee({ empCode: 'G110-NEVER' });
    await rollup();

    expect((await metaOf()).trackedFrom[id]).toBeNull();
  });

  /**
   * ⭐⭐ **তারিখটা প্রত্যাশা বদলায় না** — G110-র গোটা ঝুঁকিটাই এখানে।
   *
   * ⚠️⚠️ তারিখটা পাঠানোর একমাত্র উদ্দেশ্য **আঁকা**। কেউ যদি একদিন এটা
   * দিয়ে আবার প্রত্যাশা গোনেন, তখন "আজকের দিন বাদ" নিয়মটাও দ্বিতীয়বার
   * লেখা হবে — আর ঠিক ওভাবেই আগের বাগটা জন্মেছিল। এখানে দেখা হয়:
   * তারিখ ও প্রত্যাশা দুটোই আছে, আর প্রত্যাশা **জানালার** সংখ্যা,
   * তারিখ থেকে গোনা নয়।
   */
  it('⭐ ১৩ আগস্ট থেকে দেখা — প্রত্যাশা ১৩ তারিখ থেকে ৩০ পর্যন্ত, ১ থেকে নয়', async () => {
    const id = await makeEmployee({ empCode: 'G110-EXP' });
    await seeSessions(id, [13]);
    await rollup();

    const meta = await metaOf();

    expect(meta.trackedFrom[id]).toBe('2026-08-13');
    /**
     * ১৩–৩১ আগস্টে কর্মদিবস ১৬ (শুক্রবার ১৪ · ২১ · ২৮ বাদ) × ৮ঘ = ১২৮।
     *
     * ⚠️ জানালার ডান প্রান্ত **গতকাল**, আর আগস্ট ২০২৬ এখন সম্পূর্ণ অতীত —
     *    তাই মাসটা পুরোটাই ভেতরে পড়ে আর সংখ্যাটা আর কখনো নড়বে না
     *    (G140: স্পেকের সংখ্যা ক্যালেন্ডারের সাথে বদলাতে পারে না)।
     * ⭐ আসল দাবিটা সংখ্যাটা নয় — **১ আগস্ট থেকে গোনা হয়নি**: পুরো মাস
     *    গুনলে হতো ২১৬, অর্থাৎ ৮৮ ঘণ্টার ভুতুড়ে ঘাটতি।
     */
    expect(meta.expectedHours[id]).toBe(128);
    expect(meta.expectedHours[id]).toBeLessThan(216);
    // ⚠️ পুরো মাসের টার্গেট অটুট — জানালা টার্গেট ছোঁয় না
    expect(meta.targetHoursInRange[id]).toBe(216);
  });
});

/**
 * ⭐⭐ **G130 (R2) — ছুটি রিপোর্টের সারিতেও লেখা থাকে** *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ ছুটি সংখ্যায় অনেক আগেই পৌঁছেছে (উপরের `leave.spec.ts` ও এই ফাইলের
 * টার্গেট-টেস্টগুলো দেখুন) — কেউ আর ছুটির জন্য "পিছিয়ে" দেখায় না। কিন্তু
 * সারিটা দেখতে হুবহু **শূন্য-ঘণ্টার একটা কর্মদিবসের** মতো ছিল, আর কারণটা
 * জানতে Settings → Leave-এ যেতে হতো।
 *
 * ⚠️ e2e লাগে কারণ ঝুঁকিটা **জোড়ার মুখে**: `context()` পতাকাটা ভরে কি না,
 * আর সারিটা সেটা তোলে কি না।
 */
describe('G130 — রিপোর্টের সারিতে "On leave"', () => {
  const rowsOf = async (empId: number) =>
    (await reports.attendance({ from: '2026-08-01', to: '2026-08-31' })).rows
      .filter((r) => r.employeeId === empId);

  /** ২০ আগস্ট বৃহস্পতিবার — কর্মদিবস, তাই ছুটিটা সত্যিই একটা টার্গেট কাড়ে */
  const takeLeave = (employeeId: number, day: number) =>
    h.prisma.leave.create({
      data: { employeeId, leaveDate: utc(day), createdBy: 'test@oxeio' },
    });

  it('ছুটির দিনের সারিতে পতাকা ওঠে, অন্য দিনে ওঠে না', async () => {
    const id = await makeEmployee({ empCode: 'G130-ROW' });
    await takeLeave(id, 20);
    await rollup();

    const rows = await rowsOf(id);
    const onLeaveDay = rows.find((r) => r.date === '2026-08-20')!;
    const normalDay = rows.find((r) => r.date === '2026-08-19')!;

    expect(onLeaveDay.onLeave).toBe(true);
    expect(normalDay.onLeave).toBe(false);
  });

  /**
   * ⭐⭐ **এক সেট, দুই ব্যবহার — এটাই আসল পাহারা।**
   *
   * ⚠️⚠️ ব্যাজটা যদি আলাদা একটা কোয়েরি থেকে আসত, একদিন সারিতে "On leave"
   * লেখা থাকত অথচ টার্গেট কাটা যেত না (বা উল্টোটা) — অর্থাৎ কাগজটা
   * নিজের সাথেই বিরোধ করত। এখানে দেখা হয় দুটো **একই সারি** থেকে আসছে:
   * পতাকা উঠেছে **আর** ওই দিনের টার্গেট ০।
   */
  it('⭐ যে দিনে পতাকা, সেই দিনেই টার্গেট ০', async () => {
    const id = await makeEmployee({ empCode: 'G130-TARGET' });
    await takeLeave(id, 20);
    await rollup();

    const rows = await rowsOf(id);

    expect(rows.find((r) => r.date === '2026-08-20')).toMatchObject({
      onLeave: true,
      targetHours: 0,
      dayType: 'workday',
    });
    // ⚠️ পাশের দিনটা অক্ষত — ছুটি ছড়িয়ে পড়েনি
    expect(rows.find((r) => r.date === '2026-08-19')).toMatchObject({
      onLeave: false,
      targetHours: 8,
    });
  });

  /**
   * ⚠️ `daily_summary`-তে কিছু লেখা হয় না, `leaves` টেবিল সরাসরি পড়া হয় —
   *    আর ওটাই ঠিক: ছুটি মুছে দিলে ব্যাজ **সাথে সাথেই** যায়, পরের
   *    rollup-এর অপেক্ষায় থাকে না। rollup না চালিয়েই সেটা দেখা হচ্ছে।
   */
  it('⭐ ছুটি মুছে দিলে ব্যাজ সাথে সাথে যায় — rollup ছাড়াই', async () => {
    const id = await makeEmployee({ empCode: 'G130-DELETE' });
    const leave = await takeLeave(id, 20);
    await rollup();

    expect((await rowsOf(id)).find((r) => r.date === '2026-08-20')!.onLeave).toBe(
      true,
    );

    await h.prisma.leave.delete({ where: { id: leave.id } });

    expect((await rowsOf(id)).find((r) => r.date === '2026-08-20')!.onLeave).toBe(
      false,
    );
  });
});
