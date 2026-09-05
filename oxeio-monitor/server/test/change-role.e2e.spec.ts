import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmployeeWithCode,
  createHarness,
  hashPassword,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
  uniqueSuffix,
} from './setup/harness';

/**
 * **স্টাফ ↔ ম্যানেজার** — portal অ্যাকাউন্টের ভূমিকা বদলানো।
 *
 * ⚠️⚠️ আগে ভূমিকা বসত কেবল অ্যাকাউন্ট **খোলার সময়**। কাউকে ম্যানেজার
 * করতে হলে তাঁর অ্যাকাউন্ট মুছে নতুন করে খুলতে হতো — নতুন পাসওয়ার্ড, আর
 * `user_id`-নির্ভর সব ইতিহাস (audit log) ছিঁড়ে যেত।
 */
let h: Harness;
let owner: Session;

const PASSWORD = 'role-test-password-123';

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

async function staffWithLogin(code: string, role: 'employee' | 'manager' = 'employee') {
  const { employeeId } = await createEmployeeWithCode(h.prisma, code);
  const email = `${code.toLowerCase()}-${uniqueSuffix()}@test.local`;

  const user = await h.prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      fullName: 'Rafiq Alam',
      role,
      employeeId,
      mustChangePw: false,
    },
  });

  return { employeeId, userId: user.id, email };
}

const setRole = (userId: number, role: string) =>
  owner.http
    .patch(`/api/v1/users/${userId}/role`)
    .set('X-CSRF-Token', owner.csrf)
    .send({ role });

describe('PATCH /users/:id/role', () => {
  it('স্টাফকে ম্যানেজার করা যায়', async () => {
    const { userId } = await staffWithLogin('RL-UP');

    const res = await setRole(userId, 'manager').expect(200);

    expect(res.body.role).toBe('manager');
    expect(
      (await h.prisma.user.findUniqueOrThrow({ where: { id: userId } })).role,
    ).toBe('manager');
  });

  it('ম্যানেজারকে আবার স্টাফ করা যায়', async () => {
    const { userId } = await staffWithLogin('RL-DOWN', 'manager');

    await setRole(userId, 'employee').expect(200);

    expect(
      (await h.prisma.user.findUniqueOrThrow({ where: { id: userId } })).role,
    ).toBe('employee');
  });

  /**
   * ⚠️⚠️ **owner এখান থেকে দেওয়াও যায় না।** owner মানে বেতন, audit log আর
   * সেটিংসের চাবি — সেটা একটা ড্রপডাউনের এক ক্লিকে হাতবদল হওয়ার জিনিস নয়।
   * ⭐ DTO-তেই আটকায়, তাই অনুরোধটা ব্যবসায়িক কোড ছোঁয়ারই সুযোগ পায় না।
   */
  it('owner বানানো যায় না', async () => {
    const { userId } = await staffWithLogin('RL-OWNER');

    await setRole(userId, 'owner').expect(400);

    expect(
      (await h.prisma.user.findUniqueOrThrow({ where: { id: userId } })).role,
    ).toBe('employee');
  });

  it('অচেনা ভূমিকা ৪০০', async () => {
    const { userId } = await staffWithLogin('RL-JUNK');

    await setRole(userId, 'superadmin').expect(400);
    await setRole(userId, '').expect(400);
  });

  /**
   * ⚠️⚠️ **owner-এর ভূমিকা কাড়াও যায় না।** এই রুটে ঢুকতে owner হতে হয়,
   * তাই নিজেকে নামিয়ে দিলে কেউ আর ঢুকতেই পারতেন না — ফেরার পথ হতো
   * সার্ভারে `recover-owner` স্ক্রিপ্ট।
   */
  it('owner-কে নামানো যায় না', async () => {
    const ownerUser = await h.prisma.user.findFirstOrThrow({
      where: { email: OWNER_EMAIL },
    });

    const res = await setRole(ownerUser.id, 'employee');

    expect(res.status).toBe(409);
    expect(
      (await h.prisma.user.findUniqueOrThrow({ where: { id: ownerUser.id } })).role,
    ).toBe('owner');
  });

  it('ম্যানেজার এই রুট ছুঁতে পারেন না', async () => {
    const { userId } = await staffWithLogin('RL-NOPE');
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    await manager.http
      .patch(`/api/v1/users/${userId}/role`)
      .set('X-CSRF-Token', manager.csrf)
      .send({ role: 'manager' })
      .expect(403);
  });

  it('অচেনা ইউজার ৪০৪', async () => {
    await setRole(999_999, 'manager').expect(404);
  });

  /** ⚠️ একই ভূমিকা বসালে audit log-এ "বদল" লেখা হয় না */
  it('একই ভূমিকা বসালে ইতিহাসে কিছু জমে না', async () => {
    const { userId } = await staffWithLogin('RL-SAME');
    await h.prisma.auditLog.deleteMany({});

    await setRole(userId, 'employee').expect(200);

    const rows = await h.prisma.auditLog.findMany({
      where: { targetId: String(userId) },
    });
    expect(rows).toHaveLength(0);
  });

  it('আসল বদল ইতিহাসে ওঠে, আগের ভূমিকাসহ', async () => {
    const { userId } = await staffWithLogin('RL-AUDIT');

    await setRole(userId, 'manager').expect(200);

    const row = await h.prisma.auditLog.findFirstOrThrow({
      where: { targetId: String(userId) },
      orderBy: { id: 'desc' },
    });

    // ⭐ আগেরটাও লেখা — শুধু নতুন মান থাকলে "কে কখন ম্যানেজার হলো"
    //    প্রশ্নের উত্তর দেওয়া যেত না
    expect(row.meta).toMatchObject({
      op: 'change_role',
      from: 'employee',
      to: 'manager',
    });
  });

  /** ⭐ পাসওয়ার্ড ছোঁয়া হয় না — ভূমিকা বদলে কারো লগইন ভাঙা উচিত নয় */
  it('পাসওয়ার্ড অক্ষত থাকে', async () => {
    const { userId, email } = await staffWithLogin('RL-PW');

    await setRole(userId, 'manager').expect(200);

    await h
      .http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
  });
});
