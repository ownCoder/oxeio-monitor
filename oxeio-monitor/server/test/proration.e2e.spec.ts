import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

/** পরীক্ষার মাস — আগস্ট ২০২৬: শুক্রবার ৭, ১৪, ২১, ২৮ → ২৭ কর্মদিবস */
const YEAR_MONTH = '2026-08';
const utc = (day: number) => new Date(Date.UTC(2026, 7, day));
const MONTH_WORKDAYS = 27;

const HOUR = 3600;

beforeAll(async () => {
  h = await createHarness();
  summary = h.app.get(SummaryService);
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

/** rollup চালানো — আগস্টের একটা দিন দিয়ে, "এখন" মাসের শেষে */
async function rollup(): Promise<void> {
  await summary.refreshDate(utc(31), new Date(Date.UTC(2026, 7, 31, 12)));
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
   * ⚠️ যোগ দেওয়ার দিন থেকে গোনা হয় বলে সে প্রথম দিনেই "পিছিয়ে" থাকে না।
   * মাসের শুরু থেকে গুনলে ১৭ তারিখে যোগ দেওয়া কর্মী প্রথম দিনেই ১২৮
   * ঘণ্টার ঘাটতি নিয়ে শুরু করত — tray-তে লাল, আর কারণটা অদৃশ্য।
   */
  it('গত কর্মদিবসও তার কর্মকালের ভেতরেই গোনা হয়', async () => {
    const id = await makeEmployee({ empCode: 'PR-ELAPSED', joinedOn: utc(17) });
    await rollup();

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
