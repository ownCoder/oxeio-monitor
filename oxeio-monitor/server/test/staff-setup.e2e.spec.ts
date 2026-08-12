import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmployeeWithCode,
  createHarness,
  enrollDevice,
  hashPassword,
  loginReady,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
} from './setup/harness';

/**
 * **Staff পর্দার "Setup" কলাম** — কে এজেন্ট বসানোর জন্য তৈরি।
 *
 * ⭐ **কেন এটা দরকার হলো:** ১৫ জনের রোলআউটের আগে মালিকের জানা দরকার কার
 * portal account খোলা হয়েছে আর কার হয়নি। আগে ওই তথ্যটা রেসপন্সেই আসত না,
 * তাই জানার একমাত্র উপায় ছিল প্রতিটা সারিতে ক্লিক করে দেখা। ⚠️ কেউ বাদ
 * পড়লে সেটা ধরা পড়ত **ওই PC-র সামনে দাঁড়িয়ে**, যখন স্টাফ সাইন ইন করতে
 * পারত না — অর্থাৎ সবচেয়ে খারাপ সময়ে।
 *
 * ⚠️ এই টেস্টগুলো ইচ্ছাকৃতভাবে **সত্যিকারের সারি** বানায় (ইউজার, ডিভাইস) —
 * দুটো `_count` ঠিক জায়গা থেকে আসছে কি না, সেটাই আসল প্রশ্ন।
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

const rowFor = async (empCode: string) => {
  const res = await owner.http.get('/api/v1/employees?status=all').expect(200);
  return (res.body.rows as Record<string, unknown>[]).find(
    (r) => r.empCode === empCode,
  ) as { hasPortalAccount: boolean; hasDevice: boolean };
};

describe('GET /employees — সেটআপের অবস্থা', () => {
  it('সদ্য যোগ করা কর্মীর দুটোই false', async () => {
    await createEmployeeWithCode(h.prisma, 'SU-NEW');

    const row = await rowFor('SU-NEW');

    expect(row.hasPortalAccount).toBe(false);
    expect(row.hasDevice).toBe(false);
  });

  it('portal account খোলার পর প্রথমটা true', async () => {
    const { employeeId } = await createEmployeeWithCode(h.prisma, 'SU-LOGIN');

    await h.prisma.user.create({
      data: {
        email: 'su-login@test.local',
        passwordHash: await hashPassword('whatever-123'),
        fullName: 'Rakib Hasan',
        role: 'employee',
        employeeId,
      },
    });

    const row = await rowFor('SU-LOGIN');

    expect(row.hasPortalAccount).toBe(true);
    // ⚠️ এখনো এজেন্ট বসেনি — পর্দায় "Ready to install"
    expect(row.hasDevice).toBe(false);
  });

  it('এজেন্ট enroll হলে দ্বিতীয়টাও true', async () => {
    const { code } = await createEmployeeWithCode(h.prisma, 'SU-RUN');
    await enrollDevice(h, code);

    expect((await rowFor('SU-RUN')).hasDevice).toBe(true);
  });

  /**
   * ⚠️⚠️ **revoke করা ডিভাইস গোনা হয় না।** নইলে ছাঁটাই হওয়া বা বদলে ফেলা
   * PC-র পুরোনো সারিটা চিরকাল "Running" দেখাত, অথচ ওই মেশিন থেকে আর
   * একটাও ঘণ্টা আসছে না — আর মালিক ভাবতেন সব ঠিক চলছে।
   */
  it('বাতিল করা ডিভাইস আর গোনা হয় না', async () => {
    const { code } = await createEmployeeWithCode(h.prisma, 'SU-REVOKED');
    const device = await enrollDevice(h, code);

    await h.prisma.device.update({
      where: { id: device.deviceId },
      data: { status: 'revoked' },
    });

    expect((await rowFor('SU-REVOKED')).hasDevice).toBe(false);
  });

  /**
   * ⚠️ ম্যানেজারও এই কলামটা দেখে — এজেন্ট বসানোর কাজটা তাঁরও। ⭐ কিন্তু
   * `_count` থেকে শুধু **হ্যাঁ/না** যায়, ইউজারের ইমেইল বা ডিভাইসের টোকেন
   * নয়, তাই বাড়তি কিছু ফাঁস হয় না।
   */
  it('রেসপন্সে ইউজার বা ডিভাইসের ভেতরের কিছু যায় না', async () => {
    const { code } = await createEmployeeWithCode(h.prisma, 'SU-LEAK');
    await enrollDevice(h, code);

    const res = await owner.http.get('/api/v1/employees?status=all').expect(200);
    const raw = JSON.stringify(res.body);

    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('tokenHash');
    expect(raw).not.toContain('_count');
  });
});
