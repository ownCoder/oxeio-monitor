import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import {
  createEmployeeWithCode,
  createHarness,
  dhakaNoon,
  loginReady,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
} from './setup/harness';

/**
 * ⭐⭐⭐ **কর্মীপ্রতি আজকের সবচেয়ে নতুন ছবি** *(৬ সেপ্টেম্বর ২০২৬, G159)*।
 *
 * ⚠️⚠️ **যে বাগটা এই ফাইলটা পাহারা দেয়:** বোর্ড ও Worklog-এর কার্ড এতদিন
 * গ্যালারির **শেষ এক-দুটো পাতা** (৬০–১২০টা ছবি) টেনে এনে তার ভেতর থেকে
 * কর্মীপ্রতি নতুনটা বাছত। যাঁর শেষ ছবিটা ওই জানালার বাইরে — যিনি আগে
 * বেরিয়ে গেছেন, বা দল বড় — তাঁর কার্ডে লেখা উঠত
 * *"No screenshot yet today"*।
 *
 * ⚠️ মাঠের হিসাব: ২৫ আগস্ট সন্ধ্যায় OX-05-এর **১১৪টা** ছবি ছিল, তবু কার্ড
 * বলত একটাও নেই। পর্দা একটা মিথ্যা বলত, আর কোনো এররও উঠত না।
 *
 * ⭐ পাতা ঘেঁটে অনুমান করাই ভুল পথ ছিল — প্রশ্নটার নিজের উত্তর দরকার।
 */
let h: Harness;
let owner: Session;

const MINUTE = 60_000;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
});

/** কর্মী + তার ডিভাইস */
async function staffWithDevice(empCode: string): Promise<{
  employeeId: number;
  deviceId: number;
}> {
  const { employeeId } = await createEmployeeWithCode(h.prisma, empCode);
  const device = await h.prisma.device.create({
    data: {
      hostname: `PC-${empCode}`,
      windowsUsername: 'u',
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
      status: 'active',
    },
  });
  return { employeeId, deviceId: device.id };
}

/** আজকের দিনে `minutesAgo` মিনিট আগের একটা ছবি */
async function shot(
  who: { employeeId: number; deviceId: number },
  minutesAgo: number,
  monitorIndex = 0,
): Promise<void> {
  const when = new Date(dhakaNoon().getTime() - minutesAgo * MINUTE);
  const uuid = randomUUID();

  await h.prisma.screenshot.create({
    data: {
      employeeId: who.employeeId,
      deviceId: who.deviceId,
      clientUuid: uuid,
      workDate: workDateOf(when),
      slotStart: when,
      capturedAt: when,
      monitorIndex,
      filePath: `x/${uuid}.webp`,
      thumbPath: `x/${uuid}.thumb.webp`,
    },
  });
}

const latest = async () =>
  (await owner.http.get('/api/v1/screenshots/latest').expect(200)).body as {
    date: string;
    items: { employeeId: number; capturedAt: string; monitorIndex: number }[];
  };

describe('কর্মীপ্রতি আজকের সবচেয়ে নতুন ছবি', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের মূল টেস্ট** — অনেক আগের ছবিওয়ালা কর্মীও বাদ পড়েন না।
   *
   * ⚠️ পুরোনো নিয়মে ৬০টার পাতা ধরে বাছা হতো, তাই এখানে **এক কর্মীর ৭০টা
   * ছবি** বসানো হয়েছে: ওগুলোই শেষ পাতা ভরে ফেলত আর দ্বিতীয় কর্মীর
   * অনেক-আগের ছবিটা কোনো পাতাতেই পড়ত না।
   */
  it('⭐ দিনের শুরুতে কাজ করা কর্মীও বাদ পড়েন না', async () => {
    const busy = await staffWithDevice('OX-B1');
    const early = await staffWithDevice('OX-E1');

    // ব্যস্ত কর্মীর ৭০টা সাম্প্রতিক ছবি
    for (let i = 0; i < 70; i += 1) await shot(busy, i);
    // অন্যজনের একটাই, অনেক আগের
    await shot(early, 300);

    const res = await latest();
    const ids = res.items.map((i) => i.employeeId);

    expect(ids).toContain(early.employeeId);
    expect(ids).toContain(busy.employeeId);
    expect(res.items).toHaveLength(2);
  });

  /** ⚠️ কর্মীপ্রতি ঠিক **একটাই** সারি — নইলে কার্ডে কোনটা বসবে অস্পষ্ট */
  it('⭐ কর্মীপ্রতি একটাই সারি, আর সেটা সবচেয়ে নতুনটা', async () => {
    const who = await staffWithDevice('OX-N1');
    await shot(who, 100);
    await shot(who, 5);
    await shot(who, 50);

    const res = await latest();

    expect(res.items).toHaveLength(1);
    const expected = new Date(dhakaNoon().getTime() - 5 * MINUTE).toISOString();
    expect(res.items[0].capturedAt).toBe(expected);
  });

  /**
   * ⚠️⚠️ **একই মুহূর্তে দুই মনিটরের দুটো ছবি** — সবচেয়ে নতুন `capturedAt`
   * তখন দুটো সারিতে মেলে, তবু কার্ডের জন্য একটাই চাই।
   */
  it('⭐ দুই মনিটরের একই মুহূর্তেও একটাই সারি', async () => {
    const who = await staffWithDevice('OX-M2');
    await shot(who, 5, 0);
    await shot(who, 5, 1);

    const res = await latest();

    expect(res.items).toHaveLength(1);
  });

  /** ⚠️ মুছে ফেলার জন্য চিহ্নিত ছবি গোনা হয় না — গ্যালারির একই নিয়ম */
  it('মুছে ফেলা ছবি বাদ', async () => {
    const who = await staffWithDevice('OX-D2');
    await shot(who, 5);
    await h.prisma.screenshot.updateMany({
      data: { deletedAt: dhakaNoon() },
    });

    expect((await latest()).items).toHaveLength(0);
  });

  it('কোনো ছবি না থাকলে খালি তালিকা', async () => {
    await staffWithDevice('OX-Z1');

    const res = await latest();

    expect(res.items).toEqual([]);
    expect(res.date).not.toBe('');
  });

  /**
   * ⚠️⚠️ **অডিট আগের মতোই একটাই সারি**, কর্মীপ্রতি নয় — নইলে বোর্ড
   * খোলামাত্র ১২টা সারি লিখে *"কে আমার স্ক্রিনশট দেখল"* খাতাটা (I08)
   * আবর্জনায় ভরে যেত, আর আসল ঘটনাগুলো আর খুঁজে পাওয়া যেত না।
   */
  it('⭐ অডিটে একটাই সারি লেখে', async () => {
    const a = await staffWithDevice('OX-A9');
    const b = await staffWithDevice('OX-B9');
    await shot(a, 5);
    await shot(b, 6);

    await latest();

    const rows = await h.prisma.auditLog.count({
      where: { action: 'view_screenshot' },
    });
    expect(rows).toBe(1);
  });
});
