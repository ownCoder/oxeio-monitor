import { SignJWT } from 'jose';
// ⚠️ vitest-এর `expect` এখানে লাগে না — এই ফাইলের সব যাচাই supertest-এর
// চেইন করা `.expect(200)` দিয়ে, যেটা আলাদা জিনিস। import করে রাখায় lint
// লাল ছিল (`no-unused-vars`), আর CI-ও।
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

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
} from './setup/harness';

/**
 * **চলতি সেশন কি ডাটাবেসের বদল মানে?**
 *
 * ⚠️⚠️ এই ফাইলটা লেখা হয়েছে একটা আসল ফাঁক থেকে। `JwtAuthGuard`-এ
 * sliding window আছে — প্রতি ৫ মিনিট পর টোকেন নতুন করে দেওয়া হয়, যাতে
 * কাজ করতে থাকা কেউ হঠাৎ লগআউট না হন। কিন্তু নতুন টোকেনটা বানানো হতো
 * **পুরোনো টোকেনের দাবি নকল করে**:
 *
 * ```ts
 * await this.tokens.issue(res, user);   // ← `user` পুরোনো টোকেন থেকে
 * ```
 *
 * ফলে যিনি ট্যাব খোলা রেখে কাজ করে যেতেন, তাঁর ভূমিকা **কোনোদিন**
 * হালনাগাদ হতো না:
 *
 *   · ম্যানেজারকে স্টাফ করা হলো → তিনি চিরকাল ম্যানেজারই থাকতেন
 *   · কর্মীকে নিষ্ক্রিয় করা হলো → তাঁর সেশন কখনো মরত না
 *
 * ⭐ টেস্টে সময় এগিয়ে নেওয়ার দরকার নেই — পুরোনো `iat` বসানো একটা টোকেন
 * নিজেরাই সই করে নিলেই sliding window-র শাখাটা চলে।
 */
let h: Harness;
let owner: Session;

const PASSWORD = 'freshness-password-123';

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

/**
 * ⚠️ ১০ মিনিট পুরোনো `iat` — `SESSION_REFRESH_AFTER_MIN` (৫) পেরিয়ে গেছে
 * বলে গার্ড টোকেন নতুন করে দেবে, কিন্তু ৩০ মিনিটের মেয়াদ এখনো বাকি।
 * ঠিক এই জানালাটাতেই বাগটা বাস করত।
 */
async function staleCookie(user: {
  id: number;
  email: string;
  role: string;
  employeeId: number | null;
}): Promise<string> {
  const key = new TextEncoder().encode(process.env.JWT_SECRET ?? '');
  const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;

  const token = await new SignJWT({
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    mustChangePw: false,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt(tenMinutesAgo)
    .setExpirationTime(tenMinutesAgo + 30 * 60)
    .sign(key);

  return `oxeio_session=${token}`;
}

async function staffWithLogin(code: string, role: 'employee' | 'manager') {
  const { employeeId } = await createEmployeeWithCode(h.prisma, code);
  const email = `${code.toLowerCase()}-${Date.now()}@test.local`;

  const user = await h.prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      fullName: 'Session Person',
      role,
      employeeId,
      mustChangePw: false,
    },
  });

  return { employeeId, user };
}

/** ⭐ `@Roles(owner, manager)` — স্টাফ এখানে ঢুকতে পারেন না */
const MANAGER_ONLY = '/api/v1/employees';

describe('চলতি সেশনে ভূমিকার বদল', () => {
  it('ম্যানেজারের পুরোনো টোকেন কাজ করে, যতক্ষণ তিনি ম্যানেজার', async () => {
    const { user } = await staffWithLogin('SF-OK', 'manager');
    const cookie = await staleCookie(user);

    await h.http().get(MANAGER_ONLY).set('Cookie', cookie).expect(200);
  });

  /**
   * ⭐⭐ **এই ফাইলের মূল টেস্ট।** সংশোধনের আগে এটা ২০০ পেত — অর্থাৎ
   * নামিয়ে দেওয়া ম্যানেজার ট্যাব খোলা রেখে কাজ করে গেলে ক্ষমতাটা
   * ধরে রাখতেন, আর কেউ টেরও পেত না।
   */
  it('স্টাফ করে দিলে পুরোনো টোকেনেও ক্ষমতা থাকে না', async () => {
    const { user } = await staffWithLogin('SF-DOWN', 'manager');
    const cookie = await staleCookie(user);

    await h.http().get(MANAGER_ONLY).set('Cookie', cookie).expect(200);

    await owner.http
      .patch(`/api/v1/users/${user.id}/role`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ role: 'employee' })
      .expect(200);

    await h.http().get(MANAGER_ONLY).set('Cookie', cookie).expect(403);
  });

  /** ⭐ উল্টোটাও — ম্যানেজার বানালে নতুন করে লগইন করতে হয় না */
  it('ম্যানেজার বানালে চলতি সেশনেই ক্ষমতা আসে', async () => {
    const { user } = await staffWithLogin('SF-UP', 'employee');
    const cookie = await staleCookie(user);

    await h.http().get(MANAGER_ONLY).set('Cookie', cookie).expect(403);

    await owner.http
      .patch(`/api/v1/users/${user.id}/role`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ role: 'manager' })
      .expect(200);

    await h.http().get(MANAGER_ONLY).set('Cookie', cookie).expect(200);
  });
});

describe('চলতি সেশনে অ্যাকাউন্ট বন্ধ', () => {
  /**
   * ⚠️⚠️ ছাঁটাই হওয়া কেউ ট্যাব খোলা রাখলে ড্যাশবোর্ড তাঁর কাছে **খোলাই**
   * থেকে যেত — sliding window প্রতি ৫ মিনিটে সেশনটা বাড়িয়ে দিত, আর
   * `is_active` কেউ দেখত না।
   */
  it('নিষ্ক্রিয় করলে চলতি সেশন মরে যায়', async () => {
    const { employeeId, user } = await staffWithLogin('SF-OFF', 'manager');
    const cookie = await staleCookie(user);

    await h.http().get(MANAGER_ONLY).set('Cookie', cookie).expect(200);

    await owner.http
      .post(`/api/v1/employees/${employeeId}/deactivate`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ leftOn: '2026-08-01', reason: 'session freshness test' })
      .expect(200);

    await h.http().get(MANAGER_ONLY).set('Cookie', cookie).expect(401);
  });

  it('ইউজার মুছে গেলেও সেশন মরে', async () => {
    const { user } = await staffWithLogin('SF-GONE', 'manager');
    const cookie = await staleCookie(user);

    await h.prisma.user.delete({ where: { id: user.id } });

    await h.http().get(MANAGER_ONLY).set('Cookie', cookie).expect(401);
  });
});
