import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmployeeWithCode,
  createHarness,
  hashPassword,
  loginReady,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
  uniqueSuffix,
} from './setup/harness';

/**
 * **কর্মী নিষ্ক্রিয় → আবার সক্রিয় → তিনি কি ঢুকতে পারেন?**
 *
 * ⚠️⚠️ এই ফাইলটা লেখা হয়েছে একটা মাঠের বাগ থেকে, আর বাগটা ছিল **সম্পূর্ণ
 * নীরব**: `deactivate()` কর্মীর `users` সারিতে `is_active = false` বসাত,
 * কিন্তু `reactivate()` সেটা ফেরাত না। ফলে —
 *
 *   ১· Staff পর্দায় কর্মী **Active** দেখাতেন
 *   ২· "Reset password" **সফল** হতো, নতুন পাসওয়ার্ডও দেখাত
 *   ৩· লগইনে সবসময় *"Email or password is incorrect"*
 *
 * ⭐ আর লগইনের বার্তা ইচ্ছাকৃতভাবে সবসময় একই (user enumeration ঠেকাতে),
 * তাই কারণটা বোঝার **কোনো উপায়ই ছিল না** — মালিক বারবার রিসেট করতেন আর
 * প্রতিবার একই বার্তা পেতেন।
 */
let h: Harness;
let owner: Session;

const PASSWORD = 'staff-password-123';

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

/** কর্মী + তার portal অ্যাকাউন্ট — অনন্য ইমেইল, throttle-এর কাউন্টার এড়াতে */
async function staffWithLogin(code: string) {
  const { employeeId } = await createEmployeeWithCode(h.prisma, code);
  const email = `${code.toLowerCase()}-${uniqueSuffix()}@test.local`;

  const user = await h.prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      fullName: 'Rafiq Alam',
      role: 'employee',
      employeeId,
      mustChangePw: false,
    },
  });

  return { employeeId, userId: user.id, email };
}

const signIn = (email: string, password: string) =>
  h.http().post('/api/v1/auth/login').send({ email, password });

const deactivate = (employeeId: number) =>
  owner.http
    .post(`/api/v1/employees/${employeeId}/deactivate`)
    .set('X-CSRF-Token', owner.csrf)
    .send({ leftOn: '2026-08-01', reason: 'lifecycle test' });

const reactivate = (employeeId: number) =>
  owner.http
    .post(`/api/v1/employees/${employeeId}/reactivate`)
    .set('X-CSRF-Token', owner.csrf);

describe('নিষ্ক্রিয় → সক্রিয়: লগইন ফিরে আসে', () => {
  it('নিষ্ক্রিয় করলে লগইন বন্ধ হয়', async () => {
    const { employeeId, email } = await staffWithLogin('LC-OFF');

    await signIn(email, PASSWORD).expect(200);
    await deactivate(employeeId).expect(200);

    await signIn(email, PASSWORD).expect(401);
  });

  /** ⭐⭐ এই ফাইলের মূল টেস্ট — যেটা আগে ছিল না, তাই বাগটা বেরোয়নি */
  it('আবার সক্রিয় করলে আগের পাসওয়ার্ডেই ঢোকা যায়', async () => {
    const { employeeId, email } = await staffWithLogin('LC-BACK');

    await deactivate(employeeId).expect(200);
    await reactivate(employeeId).expect(200);

    await signIn(email, PASSWORD).expect(200);
  });

  it('ডাটাবেসেও is_active ফিরে আসে', async () => {
    const { employeeId, userId } = await staffWithLogin('LC-DB');

    await deactivate(employeeId).expect(200);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(
      false,
    );

    await reactivate(employeeId).expect(200);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(
      true,
    );
  });

  /**
   * ⚠️ কর্মীর নিজের সাথে যাঁদের সম্পর্ক নেই, তাঁদের অ্যাকাউন্ট ছোঁয়া
   *    যাবে না — `updateMany`-র `where` ভুল হলে একজনকে ফেরাতে গিয়ে
   *    **সবার** লগইন খুলে যেত, ছেড়ে-যাওয়া কর্মীদেরও।
   */
  it('অন্য কারো লগইন ছোঁয়া হয় না', async () => {
    const a = await staffWithLogin('LC-A');
    const b = await staffWithLogin('LC-B');

    await deactivate(a.employeeId).expect(200);
    await deactivate(b.employeeId).expect(200);
    await reactivate(a.employeeId).expect(200);

    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).isActive).toBe(
      false,
    );
  });

  it('audit-এ কতগুলো লগইন ফিরল সেটাও থাকে', async () => {
    const { employeeId } = await staffWithLogin('LC-AUDIT');

    await deactivate(employeeId).expect(200);
    await reactivate(employeeId).expect(200);

    const row = await h.prisma.auditLog.findFirstOrThrow({
      // ⚠️ `target_id` কলামটা স্ট্রিং, সংখ্যা দিলে কিছুই মেলে না
      where: { targetId: String(employeeId), action: 'change_setting' },
      orderBy: { id: 'desc' },
    });

    expect(row.meta).toMatchObject({ op: 'reactivate', portalRestored: 1 });
  });
});

describe('নিষ্ক্রিয় অ্যাকাউন্টে পাসওয়ার্ড রিসেট', () => {
  /**
   * ⚠️⚠️ **এটাই সেই নীরবতা যা বাগটাকে অদৃশ্য রেখেছিল।** রিসেট সফল হতো,
   * পাসওয়ার্ড দেখাত, অথচ ওটা কোনোদিন কাজ করত না।
   */
  it('আটকায়, আর কারণটা বলে', async () => {
    const { employeeId, userId } = await staffWithLogin('LC-RESET');
    await deactivate(employeeId).expect(200);

    const res = await owner.http
      .post(`/api/v1/users/${userId}/reset-password`)
      .set('X-CSRF-Token', owner.csrf);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/inactive/i);
    // ⭐ বার্তাটা **কী করতে হবে** বলে, শুধু কী ভুল তা নয়
    expect(res.body.message).toMatch(/Reactivate/i);
  });

  it('সক্রিয় করার পর রিসেট চলে, আর নতুন পাসওয়ার্ড কাজ করে', async () => {
    const { employeeId, userId, email } = await staffWithLogin('LC-FIXED');

    await deactivate(employeeId).expect(200);
    await reactivate(employeeId).expect(200);

    const res = await owner.http
      .post(`/api/v1/users/${userId}/reset-password`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(200);

    await signIn(email, res.body.tempPassword).expect(200);
  });

  /**
   * ⭐ রিসেট নিজে থেকে অ্যাকাউন্ট **সক্রিয় করে দেয় না** — নইলে পাসওয়ার্ড
   * ঠিক করতে গিয়ে কেউ অজান্তে ছেড়ে-যাওয়া কর্মীর লগইন খুলে ফেলত।
   */
  it('রিসেট নিজে থেকে অ্যাকাউন্ট খুলে দেয় না', async () => {
    const { employeeId, userId } = await staffWithLogin('LC-NOAUTO');
    await deactivate(employeeId).expect(200);

    await owner.http
      .post(`/api/v1/users/${userId}/reset-password`)
      .set('X-CSRF-Token', owner.csrf);

    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: userId } })).isActive).toBe(
      false,
    );
  });
});
