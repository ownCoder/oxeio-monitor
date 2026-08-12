import { verify } from '@node-rs/argon2';
import { UserRole } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { listOwners, recoverOwner } from '../src/auth/owner-recovery';
import {
  createHarness,
  hashPassword,
  login,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐ **owner-lockout।**
 *
 * ⚠️ এই সিস্টেমে "পাসওয়ার্ড ভুলে গেছি" বলে কোনো ইমেইল-লিংক নেই
 * (ইচ্ছাকৃত — অফিসের ভেতরের সার্ভার)। ফলে একমাত্র owner পাসওয়ার্ড বা
 * 2FA-র ফোন হারালে **গোটা সিস্টেমে ঢোকার আর কোনো উপায় ছিল না** — ঘণ্টা
 * জমা হতেই থাকত, কেউ দেখতে পারত না, বেতনের হিসাবও বেরোত না।
 *
 * টেস্টগুলোর সবচেয়ে জরুরি অংশ শেষেরটা: রিসেটের পর নতুন পাসওয়ার্ডে
 * **সত্যিই লগইন হয়** কি না। হ্যাশ বসানো আর লগইন করতে পারা এক কথা নয়।
 */
let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

describe('owner রিকভারি', () => {
  it('একমাত্র owner হলে ইমেইল না দিলেও চলে', async () => {
    const result = await recoverOwner(h.prisma);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.kind).toBe('reset');
    expect(result.email).toBe(OWNER_EMAIL);
    expect(result.password.length).toBeGreaterThanOrEqual(20);

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { email: OWNER_EMAIL },
    });
    // ⚠️ পাসওয়ার্ড পর্দায় দেখা গেছে — প্রথম লগইনেই বদলাতেই হবে
    expect(user.mustChangePw).toBe(true);
    expect(await verify(user.passwordHash, result.password)).toBe(true);
  });

  /**
   * ⭐ lockout-এর **দ্বিতীয় অর্ধেক**। ফোন হারানো পাসওয়ার্ড ভোলার চেয়ে কম
   * সাধারণ নয়; শুধু পাসওয়ার্ড রিসেট করলে ওই অবস্থায় লগইনের পরের ধাপেই
   * আবার আটকে যেত।
   */
  it('2FA থাকলে সেটাও সরিয়ে দেয়, আর বলে দেয় সরিয়েছে', async () => {
    await h.prisma.user.update({
      where: { email: OWNER_EMAIL },
      data: { totpSecret: 'v1:whatever-envelope' },
    });

    const result = await recoverOwner(h.prisma);

    expect(result.ok && result.clearedTwoFactor).toBe(true);

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { email: OWNER_EMAIL },
    });
    expect(user.totpSecret).toBeNull();
  });

  /** ⚠️ নিষ্ক্রিয় থাকলে পাসওয়ার্ড ঠিক করেও লগইন আটকে থাকত */
  it('নিষ্ক্রিয় করা owner-কে ফিরিয়ে আনে', async () => {
    await h.prisma.user.update({
      where: { email: OWNER_EMAIL },
      data: { isActive: false },
    });

    await recoverOwner(h.prisma);

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { email: OWNER_EMAIL },
    });
    expect(user.isActive).toBe(true);
  });

  /**
   * ⚠️ "প্রথমটা নিয়ে নাও" লিখলে ভুল অ্যাকাউন্টের পাসওয়ার্ড বদলে যেত —
   * অর্থাৎ যিনি ঠিকঠাক ঢুকছিলেন তিনিও আটকে যেতেন, আর আসল সমস্যাটা
   * থেকেই যেত।
   */
  it('একাধিক owner থাকলে নিজে থেকে বেছে নেয় না', async () => {
    await h.prisma.user.create({
      data: {
        email: 'second-owner@test.local',
        passwordHash: await hashPassword('whatever-123456'),
        fullName: 'Second Owner',
        role: UserRole.owner,
      },
    });

    const blind = await recoverOwner(h.prisma);
    expect(blind.ok).toBe(false);
    if (!blind.ok) expect(blind.reason).toBe('ambiguous');

    // ইমেইল বলে দিলে ঠিক ওইটাই
    const picked = await recoverOwner(h.prisma, {
      email: 'second-owner@test.local',
    });
    expect(picked.ok && picked.email).toBe('second-owner@test.local');

    // ⚠️ আসল owner-এর পাসওয়ার্ড অক্ষত — নইলে একজনকে ফেরাতে গিয়ে
    //    আরেকজনকে বের করে দেওয়া হতো
    const untouched = await h.prisma.user.findUniqueOrThrow({
      where: { email: OWNER_EMAIL },
    });
    expect(await verify(untouched.passwordHash, OWNER_PASSWORD)).toBe(true);
  });

  it('ভুল ইমেইল দিলে কিছুই বদলায় না', async () => {
    const result = await recoverOwner(h.prisma, { email: 'nobody@test.local' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');

    const user = await h.prisma.user.findUniqueOrThrow({
      where: { email: OWNER_EMAIL },
    });
    expect(await verify(user.passwordHash, OWNER_PASSWORD)).toBe(true);
  });

  /** ⭐ ডাটাবেস ফেরানোর পর, বা কেউ ভুল করে একমাত্র অ্যাকাউন্টটা মুছে ফেললে */
  it('একটাও owner না থাকলে নতুন একটা বানায়', async () => {
    await h.prisma.auditLog.deleteMany({});
    await h.prisma.user.deleteMany({ where: { role: UserRole.owner } });

    const blind = await recoverOwner(h.prisma);
    expect(blind.ok).toBe(false);
    if (!blind.ok) expect(blind.reason).toBe('no-owner-no-email');

    const made = await recoverOwner(h.prisma, {
      email: 'fresh@test.local',
      fullName: 'Fresh Start',
    });

    expect(made.ok && made.kind).toBe('created');
    expect(await listOwners(h.prisma)).toHaveLength(1);
  });

  /**
   * ⚠️ চিহ্ন না রেখে owner-এর পাসওয়ার্ড বদলে ফেলা যাবে না। ওয়েব থেকে
   * হয়নি বলেই বরং লেখাটা বেশি জরুরি — `meta.via = 'cli'` দেখেই তদন্তে
   * বোঝা যাবে কেউ সার্ভারের শেলে গিয়েছিল।
   */
  it('অডিট লগে চিহ্ন রেখে যায়', async () => {
    await h.prisma.auditLog.deleteMany({});

    await recoverOwner(h.prisma);

    const [row] = await h.prisma.auditLog.findMany({
      where: { action: 'reset_password' },
    });

    expect(row).toBeDefined();
    expect(row.targetType).toBe('user');
    expect((row.meta as { via: string }).via).toBe('cli');
  });

  /**
   * ⭐⭐ **আসল প্রশ্নটা এটাই** — হ্যাশ বসানো আর সত্যিই লগইন করতে পারা এক
   * কথা নয়। argon2-র প্যারামিটার আলাদা হলে, বা `isActive`/`mustChangePw`
   * নিয়ে লগইনের কোনো শর্ত থাকলে, উপরের সব টেস্ট পাস করেও owner তালাবন্ধই
   * থাকতেন।
   */
  it('নতুন পাসওয়ার্ড দিয়ে সত্যিই লগইন হয়', async () => {
    const result = await recoverOwner(h.prisma);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // ⚠️ `login()` নিজেই ২০০ আশা করে — ব্যর্থ হলে এখানেই ছুড়বে
    const session = await login(h, OWNER_EMAIL, result.password);

    const me = await session.http.get('/api/v1/auth/me').expect(200);
    expect(me.body.mustChangePassword).toBe(true);
  });
});
