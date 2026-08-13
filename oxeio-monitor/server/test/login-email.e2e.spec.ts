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
} from './setup/harness';

/**
 * **PATCH /users/:id/email** — স্টাফের লগইন ইমেইল ("ইউজারনেম") বদলানো।
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো:** portal অ্যাকাউন্ট খোলার সময় ইমেইলটা হাতে
 * টাইপ করতে হয়। ভুল হলে ওই অ্যাকাউন্ট চিরকাল ভুল ঠিকানায় আটকে থাকত —
 * বদলানোর কোনো পথই ছিল না। ১৫ জনের জন্য একবার করে টাইপ করলে অন্তত একটা
 * টাইপো হওয়াই স্বাভাবিক।
 *
 * ⭐ সাথে ধরা পড়েছে আরেকটা: `resetUserPassword()` ওয়েবের API-তে **লেখাই
 * ছিল, কিন্তু কেউ ডাকত না** — কারণ ডাকার মতো `userId` রেসপন্সেই আসত না।
 * অর্থাৎ স্টাফ পাসওয়ার্ড ভুলে গেলে মালিকের কিছুই করার ছিল না।
 */
let h: Harness;
let owner: Session;
let userId: number;

const START = 'staff-login@test.local';

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

  const { employeeId } = await createEmployeeWithCode(h.prisma, 'LG-001');
  const user = await h.prisma.user.create({
    data: {
      email: START,
      passwordHash: await hashPassword('whatever-123'),
      fullName: 'Rakib Hasan',
      role: 'employee',
      employeeId,
    },
  });
  userId = user.id;
});

const patch = (id: number, email: string) =>
  owner.http
    .patch(`/api/v1/users/${id}/email`)
    .set('X-CSRF-Token', owner.csrf)
    .send({ email });

describe('PATCH /users/:id/email', () => {
  it('ইমেইল বদলায়', async () => {
    const res = await patch(userId, 'rakib@oxeio.local').expect(200);

    expect(res.body.email).toBe('rakib@oxeio.local');
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.email).toBe('rakib@oxeio.local');
  });

  /**
   * ⚠️ লগইন case-insensitive হওয়া উচিত, তাই সংরক্ষণও lowercase-এ। নইলে
   * `Rakib@…` দিয়ে অ্যাকাউন্ট খুললে সে `rakib@…` লিখে ঢুকতে পারত না, আর
   * কারণটা পর্দায় কোথাও লেখা থাকত না।
   */
  it('lowercase করে রাখে', async () => {
    const res = await patch(userId, 'Rakib@OXeio.Local').expect(200);
    expect(res.body.email).toBe('rakib@oxeio.local');
  });

  /**
   * ⚠️ সামনে-পিছনে ফাঁকা জায়গা থাকলে `@IsEmail()` ৪০০ দেয় — রিপোর মোট
   * অন্য সব DTO-র মতোই (কোথাও `@Transform` দিয়ে trim করা নেই)। এই
   * একটা রুটে ব্যতিক্রম করলে পরে কেউ ধরে নিত সবখানেই trim হয়।
   * ⭐ পর্দা থেকে সমস্যা হয় না — ওখানে `email.trim()` করে পাঠানো হয়।
   */
  it('ফাঁকা জায়গাসহ পাঠালে ৪০০ — রিপোর অন্য রুটগুলোর মতোই', async () => {
    await patch(userId, '  rakib@oxeio.local  ').expect(400);
  });

  /**
   * ⚠️⚠️ **পাসওয়ার্ড ছোঁয়া হয় না** — এটাই সবচেয়ে জরুরি শর্ত। ইমেইলের
   * বানান ঠিক করতে গিয়ে কারো পাসওয়ার্ড বদলে গেলে সে পরদিন ঢুকতেই পারত
   * না, আর কেউ বুঝত না কেন। তাই রিসেট আলাদা রুটে, আলাদা বোতামে।
   */
  it('পাসওয়ার্ড অপরিবর্তিত থাকে', async () => {
    const before = await h.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await patch(userId, 'rakib@oxeio.local').expect(200);

    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.mustChangePw).toBe(before.mustChangePw);
  });

  /** ⚠️ অন্যের ইমেইল দিলে ৪০৯ — নইলে Prisma-র P2002 পর্দায় যেত */
  it('অন্য অ্যাকাউন্টের ইমেইল দিলে ৪০৯', async () => {
    await patch(userId, OWNER_EMAIL).expect(409);

    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.email).toBe(START);
  });

  it('একই ইমেইল দিলে কিছুই ভাঙে না', async () => {
    await patch(userId, START).expect(200);
  });

  it('ইমেইল না হলে ৪০০', async () => {
    await patch(userId, 'not-an-email').expect(400);
  });

  it('অচেনা ইউজারে ৪০৪', async () => {
    await patch(999_999, 'x@test.local').expect(404);
  });

  /** ⚠️ লগইন বদলানো owner-এর কাজ — ম্যানেজারের নয় */
  it('ম্যানেজার পারে না', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    await manager.http
      .patch(`/api/v1/users/${userId}/email`)
      .set('X-CSRF-Token', manager.csrf)
      .send({ email: 'x@test.local' })
      .expect(403);
  });

  /** ⭐ কে কার লগইন বদলেছে — পরে মেলানোর একমাত্র উপায় */
  it('audit_log-এ আগের ও নতুন, দুটোই ওঠে', async () => {
    await h.prisma.auditLog.deleteMany({});

    await patch(userId, 'rakib@oxeio.local').expect(200);

    const [row] = await h.prisma.auditLog.findMany({
      where: { action: 'change_login_email' },
    });
    const meta = row.meta as { from: string; to: string };

    expect(meta.from).toBe(START);
    expect(meta.to).toBe('rakib@oxeio.local');
  });

  /** ⭐ বদলের পর নতুন ইমেইল দিয়েই ঢোকা যায় — আসল দাবিটা এটাই */
  it('নতুন ইমেইল দিয়ে সত্যিই লগইন হয়', async () => {
    await patch(userId, 'rakib@oxeio.local').expect(200);

    await h
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'rakib@oxeio.local', password: 'whatever-123' })
      .expect(200);
  });
});

describe('GET /employees — portal অ্যাকাউন্টের id ও ইমেইল', () => {
  /**
   * ⚠️ এই দুটো ফিল্ড ছাড়া পর্দা থেকে রিসেট বা ইমেইল বদলানো **করাই যেত না**
   * (`/users/:id/…` দুটোই id চায়)। ঠিক এই কারণেই `resetUserPassword()`
   * লেখা থাকা সত্ত্বেও কোনোদিন ডাকা হয়নি।
   */
  it('portalUserId ও portalEmail আসে', async () => {
    const res = await owner.http.get('/api/v1/employees?status=all').expect(200);
    const row = (res.body.rows as Record<string, unknown>[]).find(
      (r) => r.empCode === 'LG-001',
    ) as { portalUserId: number; portalEmail: string };

    expect(row.portalUserId).toBe(userId);
    expect(row.portalEmail).toBe(START);
  });

  it('অ্যাকাউন্ট না থাকলে দুটোই null', async () => {
    await createEmployeeWithCode(h.prisma, 'LG-NONE');

    const res = await owner.http.get('/api/v1/employees?status=all').expect(200);
    const row = (res.body.rows as Record<string, unknown>[]).find(
      (r) => r.empCode === 'LG-NONE',
    ) as { portalUserId: number | null; portalEmail: string | null };

    expect(row.portalUserId).toBeNull();
    expect(row.portalEmail).toBeNull();
  });

  /** ⚠️ পাসওয়ার্ডের হ্যাশ বা TOTP গোপন কখনো রেসপন্সে নয় */
  it('গোপন কিছু রেসপন্সে যায় না', async () => {
    const res = await owner.http.get('/api/v1/employees?status=all').expect(200);
    const raw = JSON.stringify(res.body);

    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('totpSecret');
  });
});
