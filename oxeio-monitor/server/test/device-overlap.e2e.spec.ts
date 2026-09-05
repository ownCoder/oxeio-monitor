import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeviceOverlapCheck } from '../src/alerts/device-overlap.check';
import { workDateOf } from '../src/agent/util/dhaka-time';
import { createHarness, resetDatabase, type Harness,
  dhakaNoon,
  realNow,
} from './setup/harness';

/**
 * **G32** — `device_overlap` অ্যালার্ট সত্যিই ওঠে কি না।
 *
 * ⚠️ ইউনিট টেস্ট (`device-overlap.spec.ts`) হিসাবটা পাহারা দেয়; এই ফাইল
 * পাহারা দেয় **প্রযোজকটাকে** — কারণ G32-র আসল বাগটাই ছিল সেটার অভাব।
 * টাইপ, লেবেল, ফিল্টার সব ছিল, শুধু কেউ অ্যালার্টটা বসাত না।
 */
let h: Harness;
let check: DeviceOverlapCheck;
let employeeId: number;
let deviceA: number;
let deviceB: number;

/**
 * ⭐⭐ **দুটো আলাদা "এখন", আর সেটা ইচ্ছাকৃত (G140)।**
 *
 * - `workDate` আসে `dhakaNoon()` থেকে — ফিক্সচারের কর্মদিবস, দুই সীমানা
 *   থেকেই ১২ ঘণ্টা দূরে, তাই মধ্যরাতে দিন ঘুরে গিয়ে ভাঙে না।
 * - `runOnce()` পায় **আসল ঘড়ি**, কারণ throttle মেলানো হয় অ্যালার্টের
 *   `created_at`-এর সাথে — আর সেটা **ডাটাবেসের** `now()` থেকে আসে।
 *
 * ⚠️⚠️ দুটো এক করে দুপুর পাঠানো হয়েছিল, আর টেস্ট সাথে সাথেই ধরিয়ে দিল:
 * ভোরে চালালে দুপুর আর DB-র `created_at`-এর ফারাক ৬ ঘণ্টার
 * `THROTTLE_HOURS` ছাড়িয়ে যেত, তাই "দ্বিতীয়বার চালালে আর বসে না"
 * দাবিটা ভাঙত। ⭐ অ্যাপের ঘড়ি আর ডাটাবেসের ঘড়ি এক না হলে পিন করা
 * মুহূর্ত বসানো যায় না — এটাই `realNow()`-এর একমাত্র বৈধ কারণ।
 */
const workDate = workDateOf(dhakaNoon());

/** ওই কর্মদিবসের ভেতরে একটা মুহূর্ত (ঢাকার ঘড়িতে ঘণ্টা + মিনিট) */
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

/** ওই ডিভাইসে একটা ACTIVE খণ্ড */
async function segment(deviceId: number, from: Date, to: Date): Promise<void> {
  const session = await h.prisma.workSession.create({
    data: { employeeId, deviceId, workDate, startedAt: from, endedAt: to },
  });

  await h.prisma.activitySegment.create({
    data: {
      sessionId: session.id,
      employeeId,
      deviceId,
      clientUuid: randomUUID(),
      workDate,
      state: 'active',
      startedAt: from,
      endedAt: to,
      durationSec: Math.round((to.getTime() - from.getTime()) / 1000),
      countsAsWork: true,
    },
  });
}

const alerts = () =>
  h.prisma.alert.findMany({ where: { type: 'device_overlap' } });

beforeAll(async () => {
  h = await createHarness();
  check = h.app.get(DeviceOverlapCheck);
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);

  const policy = await h.prisma.workPolicy.findFirstOrThrow();
  const employee = await h.prisma.employee.create({
    data: { empCode: 'OX-32', fullName: 'Rakib Hasan', policyId: policy.id },
  });

  employeeId = employee.id;
  deviceA = await makeDevice('PC-DESK');
  deviceB = await makeDevice('PC-LAP');
});

describe('device_overlap — প্রযোজক', () => {
  it('আধ ঘণ্টা একসাথে চললে অ্যালার্ট ওঠে', async () => {
    await segment(deviceA, at(9), at(13));
    await segment(deviceB, at(12, 30), at(15));

    expect(await check.runOnce(realNow())).toBe(1);

    const [alert] = await alerts();
    expect(alert.severity).toBe('warning');
    expect(alert.employeeId).toBe(employeeId);
    // ⚠️ ডিভাইস **null** — ঘটনাটা দুটো ডিভাইসের, একটার নয়
    expect(alert.deviceId).toBeNull();
    expect(alert.title).toContain('Rakib Hasan');

    const meta = alert.meta as { overlapSec: number; deviceCount: number };
    expect(meta.overlapSec).toBe(30 * 60);
    expect(meta.deviceCount).toBe(2);
  });

  /**
   * ⭐ সবচেয়ে জরুরি টেস্ট — একটাই ডিভাইস, কিন্তু অনেকগুলো খণ্ড, যাদের
   * `duration_sec` (monotonic ঘড়ি) দেয়ালঘড়ির সময়ের সাথে হুবহু মেলে না।
   * ⚠️ হিসাবটা `active_sec − worked_sec` হলে এখানেই মিথ্যা অ্যালার্ট উঠত,
   * আর সেটা হতো সবচেয়ে খারাপ ধরনের ভুল: কারো কাজের সততা নিয়ে।
   */
  it('একটাই ডিভাইসে দিনভর কাজ — কিছুই ওঠে না', async () => {
    await segment(deviceA, at(9), at(12));
    await segment(deviceA, at(12), at(15));
    await segment(deviceA, at(15), at(18));

    expect(await check.runOnce(realNow())).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });

  it('দুটো ডিভাইস কিন্তু আলাদা সময়ে — কিছুই ওঠে না', async () => {
    await segment(deviceA, at(9), at(13));
    await segment(deviceB, at(14), at(18));

    expect(await check.runOnce(realNow())).toBe(0);
  });

  /** ⚠️ ৫ মিনিট — ল্যাপটপ নিয়ে মিটিংয়ে যাওয়ার স্বাভাবিক ছবি */
  it('অল্প overlap-এ চুপ থাকে', async () => {
    await segment(deviceA, at(9), at(13, 5));
    await segment(deviceB, at(13), at(17));

    expect(await check.runOnce(realNow())).toBe(0);
  });

  /**
   * ⚠️ চেকটা ঘণ্টায় একবার চলে, আর দিনের সব খণ্ড আবার পড়ে — তাই একই দিনে
   * বারবার একই অ্যালার্ট বসার আশঙ্কা এখানে বাস্তব। `AlertsService`-এর
   * ৬ ঘণ্টার throttle-ই সেটা ঠেকায়।
   */
  it('দ্বিতীয়বার চালালে আর বসে না (throttle)', async () => {
    await segment(deviceA, at(9), at(13));
    await segment(deviceB, at(12), at(15));

    expect(await check.runOnce(realNow())).toBe(1);
    expect(await check.runOnce(realNow())).toBe(0);
    expect(await alerts()).toHaveLength(1);
  });

  /** idle খণ্ড দুই মেশিনে একসাথে থাকাটা স্বাভাবিক — একটা মেশিন লক করা পড়ে আছে */
  it('idle খণ্ড গোনা হয় না', async () => {
    await segment(deviceA, at(9), at(17));

    const session = await h.prisma.workSession.create({
      data: {
        employeeId,
        deviceId: deviceB,
        workDate,
        startedAt: at(9),
        endedAt: at(17),
      },
    });
    await h.prisma.activitySegment.create({
      data: {
        sessionId: session.id,
        employeeId,
        deviceId: deviceB,
        clientUuid: randomUUID(),
        workDate,
        state: 'idle',
        startedAt: at(9),
        endedAt: at(17),
        durationSec: 8 * 3600,
        countsAsWork: false,
      },
    });

    expect(await check.runOnce(realNow())).toBe(0);
  });
});
