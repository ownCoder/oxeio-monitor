import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import { SyntheticInputCheck } from '../src/alerts/synthetic-input.check';
import { createHarness, resetDatabase, type Harness } from './setup/harness';

/**
 * **G46** — `synthetic_input` অ্যালার্ট সত্যিই ওঠে কি না।
 *
 * ⚠️⚠️ ইউনিট টেস্ট (`synthetic-input.spec.ts`) **নিয়মটা** পাহারা দেয়; এই
 * ফাইল পাহারা দেয় **প্রযোজকটাকে**। এই প্রকল্পে ঠিক এখানেই বারবার ফাঁক
 * থেকেছে — G32-এ টাইপ, লেবেল, ফিল্টার সবই ছিল, শুধু অ্যালার্টটা **কেউ
 * বসাত না**। নিয়ম লিখে ফেলা আর নিয়মটা চলা এক কথা নয়।
 */
let h: Harness;
let check: SyntheticInputCheck;
let employeeId: number;
let deviceId: number;

const now = new Date();
const workDate = workDateOf(now);

/** ওই কর্মদিবসের ভেতরে একটা মুহূর্ত (ঢাকার ঘড়িতে) */
const at = (hour: number, minute = 0): Date =>
  new Date(workDate.getTime() + (hour - 6) * 3_600_000 + minute * 60_000);

async function makeDevice(hostname: string): Promise<number> {
  const device = await h.prisma.device.create({
    data: {
      hostname,
      windowsUsername: 'rakib',
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
    },
  });
  return device.id;
}

/** ৫ মিনিটের ACTIVE খণ্ড, `from` থেকে `to` পর্যন্ত ভরে দেওয়া */
async function activeRun(
  from: Date,
  to: Date,
  score: number | null,
  device = deviceId,
): Promise<void> {
  const session = await h.prisma.workSession.create({
    data: { employeeId, deviceId: device, workDate, startedAt: from, endedAt: to },
  });

  for (let t = from.getTime(); t < to.getTime(); t += 5 * 60_000) {
    const segFrom = new Date(t);
    const segTo = new Date(Math.min(t + 5 * 60_000, to.getTime()));

    await h.prisma.activitySegment.create({
      data: {
        sessionId: session.id,
        employeeId,
        deviceId: device,
        clientUuid: randomUUID(),
        workDate,
        state: 'active',
        startedAt: segFrom,
        endedAt: segTo,
        durationSec: Math.round((segTo.getTime() - segFrom.getTime()) / 1000),
        inputScore: score,
        countsAsWork: true,
      },
    });
  }
}

async function window(
  from: Date,
  to: Date,
  processName: string,
  title: string,
  device = deviceId,
): Promise<void> {
  await h.prisma.appUsage.create({
    data: {
      employeeId,
      deviceId: device,
      clientUuid: randomUUID(),
      workDate,
      startedAt: from,
      endedAt: to,
      durationSec: Math.round((to.getTime() - from.getTime()) / 1000),
      processName,
      windowTitle: title,
    },
  });
}

const alerts = () => h.prisma.alert.findMany({ where: { type: 'synthetic_input' } });

beforeAll(async () => {
  h = await createHarness();
  check = h.app.get(SyntheticInputCheck);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);

  const employee = await h.prisma.employee.create({
    data: { empCode: `SI-${Date.now()}`, fullName: 'Belal Hossain' },
  });
  employeeId = employee.id;
  deviceId = await makeDevice('PC-SI');
});

describe('G46 — নকল ইনপুট ধরা', () => {
  /**
   * ⭐⭐ **মালিকের পাঠানো স্ক্রিপ্টটার হুবহু নকল:** প্রতি মিনিটে
   * `SendKeys("{F15}")`, PowerShell খোলা, কোনো বিরতি নেই।
   */
  it('তিন ঘণ্টা একটানা, এক উইন্ডো — অ্যালার্ট ওঠে', async () => {
    await activeRun(at(10), at(13), 98);
    await window(at(10), at(13), 'powershell.exe', 'Windows PowerShell');

    expect(await check.runOnce(now)).toBe(1);

    const [row] = await alerts();
    expect(row.employeeId).toBe(employeeId);
    expect(row.deviceId).toBe(deviceId);
    expect(row.severity).toBe('warning');
    expect(row.title).toContain('Belal Hossain');
  });

  /** ⭐ ঘটনাটা যাচাই করার মতো তথ্য `meta`-তে থাকে */
  it('meta-তে কখন থেকে কখন, আর কোন সীমায়', async () => {
    await activeRun(at(9), at(12), 100);
    await window(at(9), at(12), 'powershell.exe', 'Windows PowerShell');

    await check.runOnce(now);

    const [row] = await alerts();
    expect(row.meta).toMatchObject({
      durationSec: 3 * 3600,
      windows: 1,
      scoreSpread: 0,
      minStretchSec: 60 * 60,
    });
  });

  /**
   * ⚠️⚠️ **মানুষ থামে।** একটা বিরতিই স্ট্রেচ ভেঙে দেয় — আর এই টেস্টটাই
   * ঠিক করে দেয় নির্দোষ কেউ সন্দেহে পড়বেন কি না।
   */
  it('মাঝে বিরতি থাকলে অ্যালার্ট ওঠে না', async () => {
    // ⚠️ দুটো টুকরোই সীমার (১ ঘণ্টা) নিচে — একটা বিরতিই যথেষ্ট
    await activeRun(at(10), at(10, 50), 98);
    await activeRun(at(11, 10), at(12), 98);
    await window(at(10), at(12), 'powershell.exe', 'Windows PowerShell');

    expect(await check.runOnce(now)).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });

  it('উইন্ডো বদলালে অ্যালার্ট ওঠে না', async () => {
    await activeRun(at(10), at(13), 98);
    await window(at(10), at(11, 30), 'chrome.exe', 'Inbox');
    await window(at(11, 30), at(13), 'chrome.exe', 'Docs');

    expect(await check.runOnce(now)).toBe(0);
  });

  it('হাত অসমান হলে অ্যালার্ট ওঠে না', async () => {
    // ⚠️ প্রতি খণ্ডে আলাদা স্কোর দিতে হবে, তাই এক ঘণ্টা করে দুই দফা
    await activeRun(at(10), at(11), 62);
    await activeRun(at(11), at(13), 97);
    await window(at(10), at(13), 'illustrator.exe', 'poster.ai');

    expect(await check.runOnce(now)).toBe(0);
  });

  /**
   * ⚠️⚠️ **দুই ডিভাইস আলাদা করে দেখা হয়।** না করলে একজনের দুটো PC-র খণ্ড
   * মিশে গিয়ে একটা লম্বা "একটানা" স্ট্রেচ বানাত, আর দুই মেশিনে কাজ করা
   * সৎ কর্মীই সন্দেহে পড়তেন (G32-এর সাথে সরাসরি সংঘর্ষ)।
   */
  it('দুই ডিভাইসের সময় মিলিয়ে ফেলা হয় না', async () => {
    const second = await makeDevice('PC-SI-2');

    // ⚠️ আলাদা করে দেখলে দুটোই সীমার নিচে; মিলিয়ে ফেললে ১ ঘণ্টা ছাড়াত
    await activeRun(at(10), at(10, 50), 98);
    await window(at(10), at(10, 50), 'powershell.exe', 'Windows PowerShell');
    await activeRun(at(10, 50), at(11, 40), 98, second);
    await window(at(10, 50), at(11, 40), 'powershell.exe', 'Windows PowerShell', second);

    expect(await check.runOnce(now)).toBe(0);
  });

  /** ⚠️ `app_usage` না এলে সন্দেহ করা হয় না — না-জানা প্রমাণ নয় */
  it('foreground তথ্য না থাকলে অ্যালার্ট ওঠে না', async () => {
    await activeRun(at(10), at(13), 98);

    expect(await check.runOnce(now)).toBe(0);
  });

  it('কিছুই না থাকলে চুপচাপ শূন্য', async () => {
    expect(await check.runOnce(now)).toBe(0);
  });

  /**
   * ⚠️ একই ঘটনায় বারবার অ্যালার্ট নয় — throttle। নইলে ঘণ্টায় একটা করে
   * অ্যালার্ট আসত, আর কিছুদিনেই কেউ আর অ্যালার্ট পড়ত না।
   */
  it('দুবার চালালেও একটাই অ্যালার্ট', async () => {
    await activeRun(at(10), at(13), 98);
    await window(at(10), at(13), 'powershell.exe', 'Windows PowerShell');

    await check.runOnce(now);
    await check.runOnce(now);

    expect(await alerts()).toHaveLength(1);
  });
});
