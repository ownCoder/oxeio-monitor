import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmployeeWithCode,
  createHarness,
  enrollDevice,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
} from './setup/harness';

/**
 * **বন্ধ হয়ে যাওয়া এজেন্ট আবার চালু** — কর্মী ধরে, ডিভাইস ধরে নয়।
 *
 * ⚠️⚠️ এটা দরকার হয় কারণ `deactivate()` কর্মীর সব ডিভাইস revoke করে, আর
 * `reactivate()` সেগুলো **ইচ্ছাকৃতভাবে ফেরায় না** (ফিরে আসা কর্মীর পুরোনো
 * টোকেন আপনাআপনি জেগে ওঠা উচিত নয়)। ফলে বোর্ডে তিনি চিরকাল "Offline"
 * থাকতেন, অথচ এজেন্ট তাঁর PC-তে দিব্যি চলছে — আর ফেরার পথ ছিল একমাত্র
 * আলাদা Devices পর্দায়, যেটা মালিক তুলে দিতে বলেছেন।
 */
let h: Harness;
let owner: Session;

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

const turnOn = (employeeId: number) =>
  owner.http
    .post(`/api/v1/employees/${employeeId}/agent/turn-on`)
    .set('X-CSRF-Token', owner.csrf);

const deactivate = (employeeId: number) =>
  owner.http
    .post(`/api/v1/employees/${employeeId}/deactivate`)
    .set('X-CSRF-Token', owner.csrf)
    .send({ leftOn: '2026-08-01', reason: 'turn-agent-on test' });

const reactivate = (employeeId: number) =>
  owner.http
    .post(`/api/v1/employees/${employeeId}/reactivate`)
    .set('X-CSRF-Token', owner.csrf);

const statusOf = async (deviceId: number) =>
  (await h.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status;

describe('POST /employees/:id/agent/turn-on', () => {
  /**
   * ⭐⭐ **এই ফাইলের মূল টেস্ট — মালিকের আসল যাত্রাপথ।**
   * নিষ্ক্রিয় → আবার সক্রিয় → এজেন্ট চালু → সব আগের মতো।
   */
  it('নিষ্ক্রিয় করে ফেরালে এজেন্ট আবার চালু করা যায়', async () => {
    const { code, employeeId } = await createEmployeeWithCode(h.prisma, 'TA-BACK');
    const device = await enrollDevice(h, code);

    await deactivate(employeeId).expect(200);
    expect(await statusOf(device.deviceId)).toBe('revoked');

    // ⚠️ শুধু reactivate ডিভাইস ফেরায় না — ইচ্ছাকৃত
    await reactivate(employeeId).expect(200);
    expect(await statusOf(device.deviceId)).toBe('revoked');

    const res = await turnOn(employeeId).expect(200);

    expect(res.body.restored).toBe(1);
    expect(await statusOf(device.deviceId)).toBe('active');
  });

  /**
   * ⚠️⚠️ নিষ্ক্রিয় কর্মীর ডিভাইস ফেরানো যায় না — নইলে ছাঁটাই হওয়া কারো
   * মেশিন আবার ঘণ্টা পাঠাতে শুরু করত, অথচ Staff পর্দায় তিনি "Inactive"।
   */
  it('কর্মী নিষ্ক্রিয় থাকলে আটকায়, আর কারণ বলে', async () => {
    const { code, employeeId } = await createEmployeeWithCode(h.prisma, 'TA-OFF');
    const device = await enrollDevice(h, code);
    await deactivate(employeeId).expect(200);

    const res = await turnOn(employeeId);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/reactivate/i);
    expect(await statusOf(device.deviceId)).toBe('revoked');
  });

  it('বন্ধ কিছু না থাকলে কিছুই বদলায় না', async () => {
    const { code, employeeId } = await createEmployeeWithCode(h.prisma, 'TA-NOOP');
    const device = await enrollDevice(h, code);

    const res = await turnOn(employeeId).expect(200);

    expect(res.body.restored).toBe(0);
    expect(await statusOf(device.deviceId)).toBe('active');
  });

  /** ⚠️ কিছু না বদলালে audit-এ ঘটনা লেখা হয় না */
  it('কিছু না বদলালে ইতিহাসে সারি জমে না', async () => {
    const { code, employeeId } = await createEmployeeWithCode(h.prisma, 'TA-QUIET');
    await enrollDevice(h, code);
    await h.prisma.auditLog.deleteMany({});

    await turnOn(employeeId).expect(200);

    const rows = await h.prisma.auditLog.findMany({
      where: { targetId: String(employeeId) },
    });
    expect(rows).toHaveLength(0);
  });

  it('আসল বদল ইতিহাসে ওঠে, কতগুলো ফিরল সেটাসহ', async () => {
    const { code, employeeId } = await createEmployeeWithCode(h.prisma, 'TA-AUDIT');
    await enrollDevice(h, code);
    await deactivate(employeeId).expect(200);
    await reactivate(employeeId).expect(200);

    await turnOn(employeeId).expect(200);

    const row = await h.prisma.auditLog.findFirstOrThrow({
      where: { targetId: String(employeeId), action: 'change_setting' },
      orderBy: { id: 'desc' },
    });
    expect(row.meta).toMatchObject({ op: 'turn_agent_on', restored: 1 });
  });

  /**
   * ⚠️ অন্য কর্মীর ডিভাইস ছোঁয়া যাবে না — `updateMany`-র `where` ভুল
   *    হলে একজনকে ফেরাতে গিয়ে **সবার** বন্ধ মেশিন জেগে উঠত।
   */
  it('অন্য কারো ডিভাইস ছোঁয়া হয় না', async () => {
    const a = await createEmployeeWithCode(h.prisma, 'TA-A');
    const b = await createEmployeeWithCode(h.prisma, 'TA-B');
    /**
     * ⚠️⚠️ আলাদা `machineGuid` দিতেই হবে। enroll `machineGuid` ধরে upsert
     *    করে, তাই একই GUID-এ দ্বিতীয়বার enroll করলে **নতুন সারি হয় না** —
     *    প্রথম সারিটাই দ্বিতীয় কর্মীর নামে সরে যায়, আর টেস্টটা তখন
     *    যা মাপতে চাইছে তা আর মাপেই না।
     */
    const deviceA = await enrollDevice(h, a.code, {
      machineGuid: 'ta-a-guid',
      hostname: 'PC-TA-A',
    });
    // ⚠️ hostname-ও আলাদা — (hostname, windowsUsername) জোড়াটাও unique,
    //    আর একই জোড়ায় দ্বিতীয়বার enroll করলে ৪০৯।
    const deviceB = await enrollDevice(h, b.code, {
      machineGuid: 'ta-b-guid',
      hostname: 'PC-TA-B',
    });

    await deactivate(a.employeeId).expect(200);
    await deactivate(b.employeeId).expect(200);
    await reactivate(a.employeeId).expect(200);

    await turnOn(a.employeeId).expect(200);

    expect(await statusOf(deviceA.deviceId)).toBe('active');
    expect(await statusOf(deviceB.deviceId)).toBe('revoked');
  });

  it('অচেনা কর্মী ৪০৪', async () => {
    await turnOn(999_999).expect(404);
  });

  /**
   * ⚠️⚠️ **ম্যানেজার পারেন না — ইচ্ছাকৃত।** ম্যানেজার Staff পর্দা দেখেন,
   * তাই বোতামটাও তাঁর চোখে পড়ে। কিন্তু এজেন্ট ফেরানো মানে **পুরোনো
   * টোকেন আবার জাগানো** — হারিয়ে যাওয়া ল্যাপটপ হলে যে ধরে আছে সে-ও
   * ফিরে আসে। ওটা owner-এর সিদ্ধান্ত, আর সেজন্যই রুটটা owner-only
   * কন্ট্রোলারে রাখা হয়েছে।
   */
  it('ম্যানেজার পারেন না — পুরোনো টোকেন জাগানো owner-এর সিদ্ধান্ত', async () => {
    const { code, employeeId } = await createEmployeeWithCode(h.prisma, 'TA-MGR');
    await enrollDevice(h, code);
    await deactivate(employeeId).expect(200);
    await reactivate(employeeId).expect(200);

    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    await manager.http
      .post(`/api/v1/employees/${employeeId}/agent/turn-on`)
      .set('X-CSRF-Token', manager.csrf)
      .expect(403);
  });
});
