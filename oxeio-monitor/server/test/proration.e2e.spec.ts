import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
