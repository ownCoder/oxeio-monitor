import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ProgressService } from '../src/agent/progress.service';
import { workDateOf } from '../src/agent/util/dhaka-time';
import { SummaryService } from '../src/summary/summary.service';
import {
  createHarness,
  dhakaNoon,
  OWNER_EMAIL,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐⭐ **G112 — tray-র "কত ঘণ্টা" আর ড্যাশবোর্ডের "কত ঘণ্টা" এক কি না**
 * *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ **যে ফাঁকটা এই ফাইল বন্ধ করে:** tray (`progress.service.ts`) ঘণ্টা
 * গুনত `Σ activity_segments.duration_sec` দিয়ে — এজেন্টের **monotonic
 * ঘড়ির কাঁচা যোগফল**। আর `daily_summary.worked_sec` আসে দেয়ালঘড়ির
 * `started_at`–`ended_at`-এর **UNION** থেকে (`summarizeDay`)। দুটো
 * ইচ্ছাকৃতভাবে আলাদা মাপকাঠি, আর `summary.math.ts` নিজেই লিখে রেখেছে
 * ওরা হুবহু মেলে না।
 *
 * ⭐⭐ **ফারাকটা সবচেয়ে বড় দুই ডিভাইসওয়ালা কর্মীর বেলায়:** একসাথে দুই
 * মেশিনে কাজ করলে ওই সময়টা কাঁচা যোগফলে **দুবার** গোনা হয়, UNION-এ
 * একবার। অর্থাৎ তাঁর নিজের tray তাঁকে ড্যাশবোর্ডের চেয়ে **বেশি ঘণ্টা**
 * দেখাত — আর কেউ দুটো পাশাপাশি না রাখলে ধরাই পড়ত না। G32-র
 * `device_overlap` অ্যালার্ট ঠিক ওই ফারাকটাই মাপে, অর্থাৎ সংখ্যাটা
 * সিস্টেম নিজেই জানত, শুধু tray জানত না।
 *
 * ⚠️ pace-এর দুই পাশ: **প্রত্যাশার** পাশটা আগেই এক সংজ্ঞায় এসেছে
 * (`elapsedWindow`), **কাজের** পাশটা এই ব্যাচে। তার আগে "tray আর
 * ড্যাশবোর্ড এক বলে" কথাটা অর্ধেক সত্যি ছিল।
 *
 * ⚠️⚠️ **এই ফাইলে কোনো পিন-করা তারিখ নেই** (G140) — সব ফিক্সচার "আজ"-এর
 * সাপেক্ষে, কারণ tray সবসময় চলতি মাস ও আজকের দিন নিয়েই কথা বলে।
 */
let h: Harness;
let progress: ProgressService;
let summary: SummaryService;

const HOUR = 3600;
const MS_PER_DAY = 86_400_000;

beforeAll(async () => {
  h = await createHarness();
  progress = h.app.get(ProgressService);
  summary = h.app.get(SummaryService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

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

async function makeDevice(employeeId: number, tag: string): Promise<number> {
  const d = await h.prisma.device.create({
    data: {
      hostname: `PC-${tag}`,
      windowsUsername: `user-${tag}`,
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
    },
  });
  return d.id;
}

/**
 * একটা active সেগমেন্ট বসায় — ওই কর্মদিবসের `hour`টা থেকে `hours` ঘণ্টা।
 *
 * ⚠️ `durationSec` **দেয়ালঘড়ির দৈর্ঘ্যের সমানই** রাখা হয়, কারণ এই ফাইলের
 *    দাবিটা monotonic-বনাম-দেয়ালঘড়ি নিয়ে নয় — **যোগফল বনাম UNION** নিয়ে।
 *    দুটো একসাথে নাড়ালে কোন কারণে সংখ্যা বদলাল তা আর আলাদা করা যেত না।
 *
 * ⚠️ প্রতিটা সেগমেন্টের নিজের `work_sessions` সারি — schema-য় `sessionId`
 *    বাধ্যতামূলক, আর ওই টেবিলটাই "কবে থেকে দেখছি"-র উৎস (G120)।
 */
async function addSegment(opts: {
  employeeId: number;
  deviceId: number;
  workDate: Date;
  hour: number;
  hours: number;
}): Promise<void> {
  const startedAt = new Date(opts.workDate.getTime() + opts.hour * HOUR * 1000);
  const endedAt = new Date(startedAt.getTime() + opts.hours * HOUR * 1000);

  const session = await h.prisma.workSession.create({
    data: {
      employeeId: opts.employeeId,
      deviceId: opts.deviceId,
      workDate: opts.workDate,
      startedAt,
      endedAt,
    },
  });

  await h.prisma.activitySegment.create({
    data: {
      sessionId: session.id,
      employeeId: opts.employeeId,
      deviceId: opts.deviceId,
      clientUuid: randomUUID(),
      workDate: opts.workDate,
      startedAt,
      endedAt,
      state: 'active',
      countsAsWork: true,
      durationSec: opts.hours * HOUR,
    },
  });
}

const trayOf = (employeeId: number) =>
  progress.forEmployee(employeeId, dhakaNoon());

describe('G112 — দুই ডিভাইসের একসাথে কাজ একবারই গোনা হয়', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের সবচেয়ে জরুরি টেস্ট।**
   *
   * দুটো ডিভাইস, **হুবহু একই চার ঘণ্টা**। কাঁচা যোগফল বলত ৮ ঘণ্টা,
   * দেয়ালঘড়ির UNION বলে ৪ — আর মানুষটা সত্যিই চার ঘণ্টাই বসেছিলেন।
   */
  it('⭐ আজ দুই PC-তে একই ৪ ঘণ্টা — tray ৪ বলে, ৮ নয়', async () => {
    const id = await makeEmployee('G112-OVERLAP');
    const a = await makeDevice(id, 'a');
    const b = await makeDevice(id, 'b');
    const day = today();

    await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 10, hours: 4 });
    await addSegment({ employeeId: id, deviceId: b, workDate: day, hour: 10, hours: 4 });

    const tray = await trayOf(id);

    expect(tray.todayActiveSec).toBe(4 * HOUR);
    expect(tray.monthActiveSec).toBe(4 * HOUR);
  });

  it('ওভারল্যাপ না থাকলে কিছুই বদলায় না — যোগফল আর UNION তখন একই', async () => {
    // ⚠️ এটাই নিরাপত্তা-জাল: একটামাত্র PC-র কর্মীর সংখ্যা এক চুলও নড়েনি।
    const id = await makeEmployee('G112-SINGLE');
    const a = await makeDevice(id, 'solo');
    const day = today();

    await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 9, hours: 3 });
    await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 14, hours: 2 });

    expect((await trayOf(id)).todayActiveSec).toBe(5 * HOUR);
  });
});

describe('G112 — শেষ হয়ে যাওয়া দিন rollup থেকেই আসে', () => {
  /**
   * ⭐⭐ **সমতাটাই আসল পাহারা।** কেবল দুটো ধ্রুবক মিলিয়ে দেখলে ভবিষ্যতে
   * সংখ্যা দুটো আবার আলাদা হয়ে গেলেও টেস্ট সবুজ থাকত — তাই এখানে
   * **tray-র সংখ্যা আর ড্যাশবোর্ডের সারিটা সরাসরি মেলানো হয়**।
   */
  it('⭐ tray-র মাসিক ঘণ্টা = Σ daily_summary.worked_sec', async () => {
    const id = await makeEmployee('G112-PAST');
    const a = await makeDevice(id, 'past');

    // ⚠️ গতকাল ও পরশু — আজকের দিনটা ইচ্ছাকৃতভাবে খালি, যাতে দাবিটা
    //    কেবল "শেষ হয়ে যাওয়া দিন"-এর উপরেই দাঁড়ায়
    const yesterday = new Date(today().getTime() - MS_PER_DAY);
    const before = new Date(today().getTime() - 2 * MS_PER_DAY);

    await addSegment({ employeeId: id, deviceId: a, workDate: before, hour: 10, hours: 6 });
    await addSegment({ employeeId: id, deviceId: a, workDate: yesterday, hour: 10, hours: 5 });

    await summary.refreshDate(before, dhakaNoon());
    await summary.refreshDate(yesterday, dhakaNoon());

    const rows = await h.prisma.dailySummary.findMany({
      where: { employeeId: id, workDate: { lt: today() } },
      select: { workedSec: true },
    });
    const fromRollup = rows.reduce((a2, r) => a2 + r.workedSec, 0);

    const tray = await trayOf(id);

    expect(fromRollup).toBe(11 * HOUR);
    expect(tray.monthActiveSec).toBe(fromRollup);
    expect(tray.todayActiveSec).toBe(0);
  });

  /**
   * ⭐⭐ **সীমানার দুই পাশ — আর `lt` বনাম `lte`-র একটামাত্র অক্ষর।**
   *
   * ⚠️⚠️ আজকের দিনটা যদি rollup **আর** লাইভ সেগমেন্ট দুই জায়গা থেকেই
   * আসত, সকালের কাজ দুবার গোনা হতো। এখানে ইচ্ছাকৃতভাবে আজকের দিনের
   * `daily_summary` সারিটাও লেখা হয়, যাতে ভুলটা ঘটলে ধরা পড়ে।
   */
  it('⭐ আজকের দিন দুবার গোনা হয় না — rollup চললেও নয়', async () => {
    const id = await makeEmployee('G112-BOUNDARY');
    const a = await makeDevice(id, 'edge');
    const day = today();

    await addSegment({
        employeeId: id,
        deviceId: a,
        workDate: day,
        hour: 9,
        hours: 3,
      });

    // rollup আজকের সারিটাও লিখে ফেলল
    await summary.refreshDate(day, dhakaNoon());

    const tray = await trayOf(id);

    expect(tray.todayActiveSec).toBe(3 * HOUR);
    // ৬ নয় — একবারই
    expect(tray.monthActiveSec).toBe(3 * HOUR);
  });

  it('গতকাল + আজ — দুই উৎস জোড়া লাগে, একটাও হারায় না', async () => {
    const id = await makeEmployee('G112-BOTH');
    const a = await makeDevice(id, 'both');
    const day = today();
    const yesterday = new Date(day.getTime() - MS_PER_DAY);

    await addSegment({ employeeId: id, deviceId: a, workDate: yesterday, hour: 10, hours: 7 });
    await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 10, hours: 2 });
    await summary.refreshDate(yesterday, dhakaNoon());

    const tray = await trayOf(id);

    expect(tray.todayActiveSec).toBe(2 * HOUR);
    expect(tray.monthActiveSec).toBe(9 * HOUR);
  });

  /**
   * ⚠️ rollup এখনো ওই দিনটা লেখেনি — তখন সংখ্যাটা কম, **বেশি নয়**।
   *
   * ⭐ এটা ইচ্ছাকৃত দাম, আর দামটা এদিকেই দেওয়া হয়েছে: অনুপস্থিত সারি
   *    "শূন্য ঘণ্টা" বলে, "অজানা" নয়। কাঁচা সেগমেন্টে ফিরে গিয়ে ফাঁক
   *    ভরাট করলে দুটো সংজ্ঞা আবার ফিরে আসত — অর্থাৎ G112-ই ফিরে আসত।
   */
  it('গতকালের rollup না চললে সংখ্যাটা কম — কিন্তু ড্যাশবোর্ডও তখন কম', async () => {
    const id = await makeEmployee('G112-NOROLLUP');
    const a = await makeDevice(id, 'stale');
    const yesterday = new Date(today().getTime() - MS_PER_DAY);

    await addSegment({
        employeeId: id,
        deviceId: a,
        workDate: yesterday,
        hour: 10,
        hours: 5,
      });
    // ⚠️ refreshDate ইচ্ছাকৃতভাবে চালানো হয়নি

    const rows = await h.prisma.dailySummary.findMany({ where: { employeeId: id } });
    expect(rows).toHaveLength(0);

    expect((await trayOf(id)).monthActiveSec).toBe(0);
  });
});


/**
 * ⭐⭐⭐ **G162 — এক মাস, এক সংখ্যা** *(৬ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ **যে বাগটা এই ব্লকটা পাহারা দেয়:** My data পাতার নিচের সারিতে
 * *"This month so far"* সংখ্যাটা **ব্রাউজারে যোগ করা** হতো — তালিকার
 * সারিগুলোর `creditedSec` মিলিয়ে। উপরের *"This month"* টাইল আসত
 * সার্ভারের `monthActiveSec` থেকে। একই পর্দায় দুটো সংখ্যা, আর তিনটে
 * আলাদা কারণে তারা মিলত না:
 *
 * ১· **জানালা** — তালিকাটা রোলিং ৩০ দিনের, তাই মাসের ৩১ তারিখে ১
 *    তারিখটা আনাই হতো না। বছরে সাত দিন, নীরবে, প্রায় এক কর্মদিবস কম।
 * ২· **রাশি** — নিচেরটা `credited` (সংশোধনসহ), উপরেরটা `worked`।
 *    একটাও সংশোধন হলেই ফারাক ঠিক সংশোধনের সমান।
 * ৩· **সংজ্ঞা** — নিচেরটা কাঁচা `duration_sec`-এর যোগ, উপরেরটা UNION।
 *    দুই PC-তে একসাথে কাজ করলে নিচেরটা সময়টা দুবার গুনত (G112-রই ফাঁক,
 *    কেবল অন্য পাতায়)।
 *
 * ⭐ তাই সংখ্যাটা আর ব্রাউজারে বানানো হয় না — সার্ভার যেটা দিয়ে `paceSec`
 * কষে, `monthCreditedSec` হয়ে পর্দাও ঠিক সেটাই দেখায়।
 */
describe('G162 — মাসের credited সংখ্যাটা সার্ভারেরই', () => {
  /** owner-এর ইউজার আইডি — সংশোধনের সারি লিখতে লাগে */
  const ownerId = async () =>
    (await h.prisma.user.findFirstOrThrow({ where: { email: OWNER_EMAIL } })).id;

  async function adjust(employeeId: number, workDate: Date, deltaSec: number) {
    await h.prisma.timeAdjustment.create({
      data: {
        employeeId,
        workDate,
        deltaSec,
        cause: 'agent_down',
        reason: 'G162 test',
        createdById: await ownerId(),
      },
    });
  }

  /**
   * ⭐⭐⭐ **এই ব্লকের মূল টেস্ট** — সংশোধন `monthCreditedSec`-এ ঢোকে,
   * `monthActiveSec`-এ নয়।
   *
   * ⚠️ দুটোই দরকার, আর দুটো আলাদাই থাকবে: টাইল ও tray দেখায় **কত কাজ
   *    হয়েছে**, আর নিচের যোগফল দেখায় **কত গোনা হয়েছে**। আগের বাগটা
   *    ছিল একটাকে অন্যটার জায়গায় বসিয়ে ফেলা, দুটো থাকা নয়।
   */
  it('⭐ সংশোধন credited-এ ঢোকে, worked-এ নয়', async () => {
    const id = await makeEmployee('G162-ADJ');
    const a = await makeDevice(id, 'adj');
    const day = today();

    await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 10, hours: 5 });
    await adjust(id, day, 2 * HOUR);

    const tray = await trayOf(id);

    expect(tray.monthActiveSec).toBe(5 * HOUR);
    expect(tray.monthCreditedSec).toBe(7 * HOUR);
  });

  /** ⚠️ বাতিল করা সংশোধন ঘণ্টা ফেরত দেয় না — `/me/days`-এর একই নিয়ম */
  it('বাতিল করা সংশোধন গোনা হয় না', async () => {
    const id = await makeEmployee('G162-REVOKED');
    const a = await makeDevice(id, 'rev');
    const day = today();

    await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 10, hours: 4 });
    await adjust(id, day, 3 * HOUR);
    await h.prisma.timeAdjustment.updateMany({
      data: { revokedAt: dhakaNoon(), revokeReason: 'G162 test' },
    });

    expect((await trayOf(id)).monthCreditedSec).toBe(4 * HOUR);
  });

  /**
   * ⚠️⚠️ **সংশোধন না থাকলে দুটো সংখ্যা হুবহু এক** — মাঠে আজ ঠিক এই
   * অবস্থাটাই (`time_adjustments` খালি), তাই বাগটা এতদিন **দেখা যায়নি**।
   * ⭐ এই টেস্টটা সেই নীরবতাটাকেই লিখে রাখে: মিল থাকাটা কাকতালীয় নয়।
   */
  it('সংশোধন না থাকলে credited আর worked এক', async () => {
    const id = await makeEmployee('G162-NOADJ');
    const a = await makeDevice(id, 'plain');

    await addSegment({
      employeeId: id,
      deviceId: a,
      workDate: today(),
      hour: 9,
      hours: 6,
    });

    const tray = await trayOf(id);

    expect(tray.monthCreditedSec).toBe(tray.monthActiveSec);
    expect(tray.monthCreditedSec).toBe(6 * HOUR);
  });

  /**
   * ⚠️⚠️ **দুই PC-র ওভারল্যাপ credited-এও একবারই।** পুরোনো ব্রাউজার-যোগফল
   * কাঁচা `duration_sec` মেলাত, তাই এই কর্মীর নিচের সংখ্যাটা উপরের
   * টাইলের **দ্বিগুণ** দেখাত — আর দুটোই একই পর্দায়।
   */
  it('⭐ দুই PC-তে একই ৪ ঘণ্টা — credited-ও ৪, ৮ নয়', async () => {
    const id = await makeEmployee('G162-OVERLAP');
    const a = await makeDevice(id, 'ov-a');
    const b = await makeDevice(id, 'ov-b');
    const day = today();

    await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 10, hours: 4 });
    await addSegment({ employeeId: id, deviceId: b, workDate: day, hour: 10, hours: 4 });

    expect((await trayOf(id)).monthCreditedSec).toBe(4 * HOUR);
  });

  /**
   * ⭐⭐ **মাসের ১ তারিখটাও ধরা পড়ে।** পুরোনো নিয়মে তালিকা আসত
   * `today − 29` থেকে, তাই ৩১ তারিখে ১ তারিখটা কোনো সারিতেই থাকত না —
   * অথচ মাসের যোগফলে সেটা থাকার কথা।
   *
   * ⚠️ এখানে ৩১ তারিখ পিন করা হয়নি (G140): মাসের **প্রথম** দিনে ঘণ্টা
   *    বসিয়ে দেখা হয় সেটা যোগফলে আছে কি না — জানালা যত ছোটই হোক।
   */
  it('⭐ মাসের প্রথম দিনের ঘণ্টাও যোগফলে থাকে', async () => {
    const id = await makeEmployee('G162-FIRSTDAY');
    const a = await makeDevice(id, 'first');
    const day = today();
    const firstOfMonth = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1),
    );

    if (firstOfMonth.getTime() === day.getTime()) {
      // ⚠️ আজই ১ তারিখ হলে "আগের দিন" বলে কিছু নেই — তখন আজকেরটাই যথেষ্ট
      await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 10, hours: 3 });
      expect((await trayOf(id)).monthCreditedSec).toBe(3 * HOUR);
      return;
    }

    await addSegment({
      employeeId: id,
      deviceId: a,
      workDate: firstOfMonth,
      hour: 10,
      hours: 3,
    });
    await summary.refreshDate(firstOfMonth, dhakaNoon());
    await addSegment({ employeeId: id, deviceId: a, workDate: day, hour: 10, hours: 1 });

    expect((await trayOf(id)).monthCreditedSec).toBe(4 * HOUR);
  });
});
