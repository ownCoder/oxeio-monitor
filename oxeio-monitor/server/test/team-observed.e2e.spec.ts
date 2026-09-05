import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { SummaryService } from '../src/summary/summary.service';
import {
  createHarness,
  dhakaNoon,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐ **G111 — Live Board-এর দলগত যোগফলটা আসলে কতজনের** *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ কার্ডের pace হলো `Σ credited − Σ expected`, আর দুটো যোগফলই
 * `monthly_summary` থেকে। যাঁর একটাও **শেষ হয়ে যাওয়া** কর্মদিবস এখনো দেখা
 * হয়নি তাঁর `expected_sec` ০ — অর্থাৎ তাঁর **পুরো টার্গেটটাই হর থেকে নীরবে
 * বাদ**। ফলে ভুলটা সবসময় একই দিকে হেলে: **দল যত পিছিয়ে, বোর্ড তার চেয়ে কম
 * দেখায়**। নতুন কেউ যোগ দিলে বা কারো এজেন্ট বসাতে দেরি হলে ঠিক তখনই এটা
 * ঘটে, আর তখনই কেউ খেয়াল করে না।
 *
 * ⚠️ ওঁদের টার্গেট যোগফলে ঢুকিয়ে দেওয়া হয়নি — তাতে বোর্ড এমন ঘাটতির দাবি
 * করত যেটা কেউ করেইনি, অর্থাৎ একটা মিথ্যা সারিয়ে ঠিক উল্টো মিথ্যা।
 * **সংখ্যাটা বাদ দেওয়া হয়নি, বলা হয়েছে।**
 *
 * ⚠️ e2e লাগে কারণ ঝুঁকিটা অঙ্কে নয় — `isObserved()` নিজে
 * `tracking-start.spec.ts`-এ পরীক্ষিত। ঝুঁকিটা **জোড়ার মুখে**: কোয়েরিটা
 * `workdays_elapsed` কলামটা আদৌ টানে কি না, আর টানলে কার্ডে তোলে কি না।
 * ⚠️ এই প্রকল্পে ঠিক এই ছাঁদে দশবারের বেশি বাগ হয়েছে ("চুক্তি লেখা আছে,
 * কলার লেখা হয়নি")।
 *
 * ⚠️⚠️ **এই ফাইলে কোনো পিন-করা তারিখ নেই** (G140): `teamTrend()` চলতি মাস
 * নিজেই বেছে নেয়, তাই সব ফিক্সচার "আজ"-এর সাপেক্ষে। জানালাটা **গতকালেই**
 * থামে, আর গতকাল শুক্রবার বা ঈদ হতে পারে — তাই "দেখা হয়েছে" প্রমাণ করতে
 * শেষ ২০ দিনের সেশন বসানো হয়, একটা নয়। একটা দিনে ভরসা করলে টেস্টটা
 * সপ্তাহে একদিন লাল হতো, আর কারণটা কেউ ধরতে পারত না।
 */
let h: Harness;
let summary: SummaryService;
let dashboard: DashboardService;

const HOUR = 3600;
const MS_PER_DAY = 86_400_000;

beforeAll(async () => {
  h = await createHarness();
  summary = h.app.get(SummaryService);
  dashboard = h.app.get(DashboardService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

/** ঢাকার আজকের কর্মদিবস — সব ফিক্সচার এর সাপেক্ষে */
const today = () => workDateOf(dhakaNoon());

async function makeEmployee(empCode: string): Promise<number> {
  const policy = await h.prisma.workPolicy.findFirst();
  const e = await h.prisma.employee.create({
    data: {
      empCode,
      fullName: `Test ${empCode}`,
      designation: 'Developer',
      status: 'active',
      monthlySalary: 20000,
      policyId: policy?.id ?? null,
    },
  });
  return e.id;
}

/**
 * শেষ ২০ দিন ধরে সেশন — অর্থাৎ "তাঁকে অনেক আগে থেকেই দেখছি"।
 *
 * ⚠️ মাসের ১ তারিখের আগেও যায়, ইচ্ছাকৃতভাবে: ট্র্যাকিং-শুরু মাস ধরে
 *    ছাঁকা হয় না, নইলে প্রতি মাসের ১ তারিখে সবাই আবার "না-দেখা" হয়ে যেত।
 */
async function seeSessions(employeeId: number): Promise<void> {
  const device = await h.prisma.device.create({
    data: {
      hostname: `PC-${employeeId}`,
      windowsUsername: `user${employeeId}`,
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
    },
  });

  const base = today().getTime();
  await h.prisma.workSession.createMany({
    data: Array.from({ length: 20 }, (_, i) => {
      const workDate = new Date(base - (i + 1) * MS_PER_DAY);
      return {
        employeeId,
        deviceId: device.id,
        workDate,
        startedAt: new Date(workDate.getTime() + 4 * HOUR * 1000),
      };
    }),
  });
}

const rollup = () => summary.refreshDate(today(), dhakaNoon());

describe('G111 — বোর্ডের কার্ড বলে যোগফলটা কতজনের', () => {
  it('সবাইকে দেখা হয়েছে — কেউ বাইরে নেই', async () => {
    const id = await makeEmployee('OBS-ALL');
    await seeSessions(id);
    await rollup();

    const { month } = await dashboard.teamTrend();

    expect(month.observedStaff).toBe(1);
    expect(month.notObservedStaff).toBe(0);
  });

  it('এজেন্ট কোনোদিন কিছু পাঠায়নি — তিনি যোগফলের বাইরে, আর সেটা বলা হয়', async () => {
    await makeEmployee('OBS-NONE');
    await rollup();

    const { month } = await dashboard.teamTrend();

    expect(month.observedStaff).toBe(0);
    expect(month.notObservedStaff).toBe(1);
  });

  /**
   * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট — নীরব বিয়োগটা এখানেই দেখা যায়।**
   *
   * ⚠️⚠️ দুজনের টার্গেট সমান, কিন্তু প্রত্যাশার যোগফলে **একজনেরই** আছে।
   * অর্থাৎ কার্ডের হর অর্ধেক, আর pace সেই অনুপাতেই ভালো দেখায়। সংখ্যাটা
   * ভুল নয় — অসম্পূর্ণ, আর অসম্পূর্ণতাটা না বললে সেটা মিথ্যার সমান।
   */
  it('⭐ না-দেখা মানুষের টার্গেট আছে, প্রত্যাশা নেই — যোগফলটাই অসম্পূর্ণ', async () => {
    const seen = await makeEmployee('OBS-SEEN');
    await seeSessions(seen);
    await makeEmployee('OBS-UNSEEN');
    await rollup();

    const rows = await h.prisma.monthlySummary.findMany({
      select: { targetSec: true, expectedSec: true, workdaysElapsed: true },
    });
    expect(rows).toHaveLength(2);

    const withExpectation = rows.filter((r) => r.expectedSec > 0);
    expect(withExpectation).toHaveLength(1);

    // ⭐ অথচ টার্গেট দুজনেরই — জানালা টার্গেট ছোঁয় না
    expect(rows.every((r) => r.targetSec > 0)).toBe(true);

    const { month } = await dashboard.teamTrend();
    expect(month.notObservedStaff).toBe(1);
    expect(month.observedStaff).toBe(1);
  });

  /**
   * ⭐ যোগফলটা সবসময় সবাইকে ধরে — একজনও যেন দুই ঘরের মাঝখানে হারিয়ে না যান।
   *
   * ⚠️ কেউ যদি একদিন `observedStaff`-কে "যাঁদের ঘণ্টা আছে" বানিয়ে ফেলেন,
   *    তখন যিনি দেখা-হওয়া অথচ শূন্য-ঘণ্টার, তিনি কোনো ঘরেই পড়তেন না — আর
   *    কার্ডে "১১ জনের হিসাব" লেখা থাকত যেখানে কর্মী ১২।
   */
  it('⭐ দেখা + না-দেখা = সবাই', async () => {
    const a = await makeEmployee('OBS-A');
    await seeSessions(a);
    await makeEmployee('OBS-B');
    await makeEmployee('OBS-C');
    await rollup();

    const { month } = await dashboard.teamTrend();

    expect(month.observedStaff + month.notObservedStaff).toBe(3);
  });
});

/**
 * ⭐⭐ **G130 (R2) — কার্ডে "on leave"** *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ `LiveCard.todayIsWorkday` বলে দিনটা **অফিসের** ক্যালেন্ডারে কর্মদিবস
 * কি না — শুক্রবার ও সরকারি ছুটি। **ব্যক্তিগত ছুটি ওতে নেই**, তাই ছুটিতে
 * থাকা কর্মীর কার্ডে ফুটত "0h / 8h" আর একটা খালি মিটার: দেখতে হুবহু ফাঁকি
 * দেওয়া মানুষের মতো। অথচ তাঁর টার্গেট ও pace তাঁকে অনেক আগেই ছাড় দিয়েছে।
 *
 * ⚠️ পর্দার নিয়মটা `web/src/pages/live/roster.ts`-এর `dayDuty()`-তে,
 * টেস্টসহ। এখানে দেখা হয় কেবল **সত্যিটা কার্ড পর্যন্ত পৌঁছায় কি না**।
 */
describe('G130 — কার্ড বলে তিনি আজ ছুটিতে', () => {
  const cardFor = async (empCode: string) => {
    const board = await dashboard.live(dhakaNoon());
    return board.cards.find((c) => c.empCode === empCode)!;
  };

  it('ছুটি লেখা থাকলে কার্ডে পতাকা ওঠে', async () => {
    const id = await makeEmployee('G130-CARD');
    await h.prisma.leave.create({
      data: { employeeId: id, leaveDate: today(), createdBy: 'test@oxeio' },
    });

    expect((await cardFor('G130-CARD')).onLeaveToday).toBe(true);
  });

  it('ছুটি না থাকলে ওঠে না', async () => {
    await makeEmployee('G130-NOCARD');
    expect((await cardFor('G130-NOCARD')).onLeaveToday).toBe(false);
  });

  /**
   * ⚠️⚠️ **অন্য দিনের ছুটি আজকের কার্ডে ওঠা যাবে না** — নইলে একবার ছুটি
   * নিলে ব্যাজটা মাসজুড়ে ঝুলে থাকত, আর তখন কেউ ওটা পড়াই বন্ধ করে দিত।
   */
  it('⭐ গতকালের ছুটি আজকের কার্ডে ওঠে না', async () => {
    const id = await makeEmployee('G130-YDAY');
    await h.prisma.leave.create({
      data: {
        employeeId: id,
        leaveDate: new Date(today().getTime() - MS_PER_DAY),
        createdBy: 'test@oxeio',
      },
    });

    expect((await cardFor('G130-YDAY')).onLeaveToday).toBe(false);
  });

  /**
   * ⭐⭐ **ছুটির পতাকা আর টার্গেট — এক সেট থেকেই।**
   *
   * ⚠️ ব্যাজটা আলাদা কোয়েরি থেকে এলে একদিন কার্ডে "on leave" লেখা থাকত
   * অথচ মাসিক টার্গেট কাটা যেত না — কার্ডটা নিজের সাথেই বিরোধ করত।
   */
  it('⭐ ছুটি নিলে কার্ডের মাসিক টার্গেটও কমে', async () => {
    const withLeave = await makeEmployee('G130-T-YES');
    await makeEmployee('G130-T-NO');

    // ⚠️ একগাদা দিন, যাতে অন্তত কয়েকটা কর্মদিবসে পড়ে — গতকাল শুক্রবার
    //    কি না তার উপর ভরসা করলে টেস্টটা সপ্তাহে একদিন লাল হতো (G140)
    const base = today().getTime();
    await h.prisma.leave.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        employeeId: withLeave,
        leaveDate: new Date(base + i * MS_PER_DAY),
        createdBy: 'test@oxeio',
      })),
    });

    const a = await cardFor('G130-T-YES');
    const b = await cardFor('G130-T-NO');

    expect(a.onLeaveToday).toBe(true);
    expect(a.monthTargetSec).toBeLessThan(b.monthTargetSec);
  });
});
