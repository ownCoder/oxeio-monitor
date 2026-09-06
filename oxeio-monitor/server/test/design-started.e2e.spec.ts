import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import { SummaryService } from '../src/summary/summary.service';
import {
  createEmployeeWithCode,
  createHarness,
  dhakaNoon,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐⭐ **"কাজ শুরু" চিহ্নটা আসল মুহূর্তেই বসে** *(৬ সেপ্টেম্বর ২০২৬, G163)*।
 *
 * ⚠️⚠️ **যে বাগটা এই ফাইলটা পাহারা দেয়:** `claimDesigns()` টার্গেটে
 * "কাজ শুরু" বসাতে গিয়ে `markStartedByJobNumbers(..., workDate)` ডাকত —
 * অর্থাৎ `now: Date` ঘরে **কর্মদিবসের লেবেল**। লেবেলটা UTC-মধ্যরাত,
 * যেটা আসলে **ঢাকার ভোর ৬টা**। ফলে প্রতিটা টার্গেটের `started_at` বসত
 * ওই এক মুহূর্তে।
 *
 * ⚠️⚠️ মাঠের হিসাব: `started_at` আছে এমন **৭১১টা সারির ৭১১টাতেই** ঘড়ি
 * ঠিক `০৬:০০:০০` — সব মিলিয়ে **একটাই** আলাদা সময়। আর প্রত্যেকটাই তার
 * নিজের `assigned_at`-এর **আগে**, কারণ বণ্টন চলে সকাল ৮টায়। পর্দায়
 * সেটা দেখাত *"Started 5 hours ago"* — জব খোলার ঠিক সেকেন্ডেই।
 *
 * ⭐ সংখ্যাটা অনুমান করার দরকারই ছিল না: `app_usage.started_at` ঠিক ওই
 * মুহূর্তটা ধরে রাখে যখন শিরোনামে নম্বরটা প্রথম দেখা গেছে।
 *
 * ⚠️ **এই ফাইলে কোনো পিন-করা তারিখ নেই** (G140) — সব ফিক্সচার "আজ"-এর
 * সাপেক্ষে, আর দিনের ভেতরের ঘণ্টাগুলো `atDhakaHour()` দিয়ে বসানো।
 */
let h: Harness;
let summary: SummaryService;

const HOUR_MS = 3600_000;
/** ⚠️ ঢাকা UTC+৬ — লেবেল থেকে আসল মুহূর্তে যেতে এটুকু বাদ */
const DHAKA_OFFSET_MS = 6 * HOUR_MS;

const JOB = 1_000_042;

beforeAll(async () => {
  h = await createHarness();
  summary = h.app.get(SummaryService);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

const today = () => workDateOf(dhakaNoon());

/**
 * ঢাকার ওই দিনের নির্দিষ্ট ঘণ্টার **আসল মুহূর্ত**।
 *
 * ⚠️⚠️ `dayLabel` একটা লেবেল — ঢাকার দিনটাকে UTC-মধ্যরাত হিসেবে লেখা।
 * ওই দিনের ঢাকা-মধ্যরাত শুরু হয় লেবেলের **৬ ঘণ্টা আগে**। এটাই সেই
 * পার্থক্য যেটা গুলিয়ে গিয়ে G163 হয়েছিল।
 */
const atDhakaHour = (dayLabel: Date, hour: number): Date =>
  new Date(dayLabel.getTime() - DHAKA_OFFSET_MS + hour * HOUR_MS);

async function designerWithDevice(): Promise<{
  employeeId: number;
  deviceId: number;
}> {
  const { employeeId } = await createEmployeeWithCode(h.prisma, 'OX-DS1');

  await h.prisma.employee.update({
    where: { id: employeeId },
    data: { staffType: 'designer' },
  });

  const device = await h.prisma.device.create({
    data: {
      hostname: 'PC-DS1',
      windowsUsername: 'ds1',
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
      status: 'active',
    },
  });

  return { employeeId, deviceId: device.id };
}

/** ওই ডিজাইনারের নামে বরাদ্দ একটা টার্গেট */
async function assignedTarget(employeeId: number, assignedAt: Date): Promise<void> {
  const owner = await h.prisma.user.findFirstOrThrow();

  await h.prisma.designTarget.create({
    data: {
      asin: 'B000000042',
      jobNumber: JOB,
      status: 'assigned',
      assignedToId: employeeId,
      assignedAt,
      addedById: owner.id,
    },
  });
}

/** শিরোনামে নম্বরটা নিয়ে একটা `app_usage` সারি */
async function sawFile(
  who: { employeeId: number; deviceId: number },
  workDate: Date,
  startedAt: Date,
  minutes = 30,
): Promise<void> {
  await h.prisma.appUsage.create({
    data: {
      employeeId: who.employeeId,
      deviceId: who.deviceId,
      clientUuid: randomUUID(),
      workDate,
      startedAt,
      endedAt: new Date(startedAt.getTime() + minutes * 60_000),
      durationSec: minutes * 60,
      processName: 'Illustrator.exe',
      windowTitle: `${JOB}-Funny Cat T-Shirt.ai @ 54 %`,
    },
  });
}

const targetRow = () => h.prisma.designTarget.findFirstOrThrow();

describe('G163 — "কাজ শুরু" আসল মুহূর্তেই বসে', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের মূল টেস্ট।**
   *
   * ⚠️ পুরোনো কোডে এখানে বসত `day` (লেবেল) — অর্থাৎ ঢাকার ভোর ৬টা,
   *    অথচ ফাইলটা খোলা হয়েছে বেলা ১১টায়।
   */
  it('⭐ ফাইলটা যখন প্রথম খোলা হয়েছে, সেই মুহূর্তটাই বসে', async () => {
    const who = await designerWithDevice();
    const day = today();
    const openedAt = atDhakaHour(day, 11);

    await assignedTarget(who.employeeId, atDhakaHour(day, 8));
    await sawFile(who, day, openedAt);

    await summary.refreshDate(day, dhakaNoon());

    const after = await targetRow();
    expect(after.startedAt?.toISOString()).toBe(openedAt.toISOString());
  });

  /**
   * ⭐⭐⭐ **বাগটার নিজের আঙুলের ছাপ** — "শুরু" কখনো "বরাদ্দ"-এর আগে নয়।
   *
   * ⚠️⚠️ মাঠে ৭১১টার ৭১১টাই এই নিয়মটা ভাঙত: বণ্টন সকাল ৮টায়, আর চিহ্ন
   * বসত ভোর ৬টায়। এই একটা দাবি ওই পুরো শ্রেণির ভুলটা ধরে।
   */
  it('⭐ "শুরু" কখনো "বরাদ্দ"-এর আগে নয়', async () => {
    const who = await designerWithDevice();
    const day = today();
    const assignedAt = atDhakaHour(day, 8);

    await assignedTarget(who.employeeId, assignedAt);
    await sawFile(who, day, atDhakaHour(day, 9.5));

    await summary.refreshDate(day, dhakaNoon());

    const after = await targetRow();
    expect(after.startedAt).not.toBeNull();
    expect(after.startedAt!.getTime()).toBeGreaterThanOrEqual(assignedAt.getTime());
  });

  /**
   * ⚠️⚠️ **ঢাকার ভোর ৬টা নয়** — বাগটার হুবহু আঙুলের ছাপ। এই দাবিটা
   * আলাদা করে লেখা, কারণ উপরের দুটো ঠিক থাকলেও কেউ একদিন আবার লেবেল
   * পাঠালে ওই মানটাই ফিরে আসত।
   */
  it('⭐ কর্মদিবসের লেবেলটা (ঢাকার ভোর ৬টা) বসে না', async () => {
    const who = await designerWithDevice();
    const day = today();

    await assignedTarget(who.employeeId, atDhakaHour(day, 8));
    await sawFile(who, day, atDhakaHour(day, 14));

    await summary.refreshDate(day, dhakaNoon());

    const after = await targetRow();
    expect(after.startedAt?.getTime()).not.toBe(day.getTime());
  });

  /**
   * ⚠️ একই ফাইলে সারাদিনে বহুবার ফেরা হয় — চিহ্নটা **প্রথমবারের**
   *    মুহূর্তে বসে, শেষবারের নয়।
   */
  it('⭐ দিনে বহুবার খোলা হলেও প্রথমবারের মুহূর্ত', async () => {
    const who = await designerWithDevice();
    const day = today();
    const first = atDhakaHour(day, 10);

    await assignedTarget(who.employeeId, atDhakaHour(day, 8));
    // ⚠️ ইচ্ছাকৃতভাবে উল্টো ক্রমে বসানো — "শেষেরটা রাখো" লিখলে লাল হতো
    await sawFile(who, day, atDhakaHour(day, 16));
    await sawFile(who, day, first);
    await sawFile(who, day, atDhakaHour(day, 13));

    await summary.refreshDate(day, dhakaNoon());

    expect((await targetRow()).startedAt?.toISOString()).toBe(first.toISOString());
  });

  /**
   * ⭐⭐ **পুরোনো দিন নতুন করে হিসাব করালেও সংখ্যাটা ওই দিনেরই।**
   *
   * ⚠️⚠️ এটাই সেই ফাঁদ যেটা সরল ফিক্স (`workDate`-এর বদলে `now`) মিস
   * করত: `drainDirty()` গতকালের দিন **আজকের** ঘড়ি নিয়ে চালায়, তাই
   * `now` বসালে ২ তারিখের ডিজাইনে ৬ তারিখের সময় বসত — অর্থাৎ
   * `started_at > completed_at`, নতুন একটা অসম্ভব সারি।
   */
  it('⭐ গতকালের দিন আজ হিসাব করালেও সময়টা গতকালেরই', async () => {
    const who = await designerWithDevice();
    const yesterday = new Date(today().getTime() - 24 * HOUR_MS);
    const openedAt = atDhakaHour(yesterday, 15);

    await assignedTarget(who.employeeId, atDhakaHour(yesterday, 8));
    await sawFile(who, yesterday, openedAt);

    // ⚠️ `now` আজকের — ঠিক যেভাবে `drainDirty()` ডাকে
    await summary.refreshDate(yesterday, dhakaNoon());

    const after = await targetRow();
    expect(after.startedAt?.toISOString()).toBe(openedAt.toISOString());
    expect(workDateOf(after.startedAt!).getTime()).toBe(yesterday.getTime());
  });

  /** ⚠️ একবার চিহ্ন বসলে সেটা আর নড়ে না — "কবে শুরু" রোজ সরত না */
  it('দ্বিতীয়বার হিসাব করালে চিহ্নটা নড়ে না', async () => {
    const who = await designerWithDevice();
    const day = today();
    const openedAt = atDhakaHour(day, 10);

    await assignedTarget(who.employeeId, atDhakaHour(day, 8));
    await sawFile(who, day, openedAt);

    await summary.refreshDate(day, dhakaNoon());
    await sawFile(who, day, atDhakaHour(day, 9));
    await summary.refreshDate(day, dhakaNoon());

    expect((await targetRow()).startedAt?.toISOString()).toBe(openedAt.toISOString());
  });
});
