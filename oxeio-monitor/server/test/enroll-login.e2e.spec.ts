import { randomUUID } from 'node:crypto';

import { UserRole } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createHarness,
  hashPassword,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * ⭐⭐ **স্টাফ নিজের ইমেইল-পাসওয়ার্ড দিয়ে নিজের PC যোগ করে।**
 *
 * ⚠️ enrollment code-এর ব্যবস্থায় মালিককে প্রতিটা PC-র জন্য আলাদা কোড
 * বানাতে হতো আর **হাতে মেলাতে** হতো কোন কোড কোন মেশিনে। ভুল মিললে কোনো
 * এরর আসত না — একজনের ঘণ্টা আরেকজনের নামে জমা হতো, আর ধরা পড়ত মাস শেষে।
 *
 * ⚠️ কিন্তু এই সরল পথটার দাম আছে: এটা একটা **পাসওয়ার্ড নেওয়ার
 * endpoint**, আর এখানে cookie বা CSRF কিছুই নেই। তাই এই ফাইলের অর্ধেক
 * টেস্ট সুবিধা নিয়ে নয়, **রক্ষাকবচ** নিয়ে — ভুল পাসওয়ার্ড, বন্ধ
 * অ্যাকাউন্ট, 2FA, আর brute-force throttle।
 */
let h: Harness;
let employeeId: number;

const STAFF_EMAIL = 'rakib@test.local';
const STAFF_PASSWORD = 'staff-password-123';

const facts = (overrides: Record<string, unknown> = {}) => ({
  hostname: 'PC-07',
  windowsUsername: 'rakib',
  machineGuid: randomUUID(),
  osVersion: 'Windows 11',
  agentVersion: '0.2.0',
  monitors: 2,
  ...overrides,
});

const enrollLogin = (body: Record<string, unknown>) =>
  h.http().post('/api/v1/agent/enroll-login').send(body);

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);

  const policy = await h.prisma.workPolicy.findFirstOrThrow();
  const employee = await h.prisma.employee.create({
    data: { empCode: 'OX-001', fullName: 'Rakib Hasan', policyId: policy.id },
  });
  employeeId = employee.id;

  await h.prisma.user.create({
    data: {
      email: STAFF_EMAIL,
      passwordHash: await hashPassword(STAFF_PASSWORD),
      fullName: 'Rakib Hasan',
      role: UserRole.employee,
      employeeId,
      mustChangePw: false,
    },
  });
});

describe('POST /agent/enroll-login — সফল পথ', () => {
  it('স্টাফের লগইনে ডিভাইস টোকেন আসে', async () => {
    const res = await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toBeTruthy();
    expect(res.body.employee.empCode).toBe('OX-001');
    expect(res.body.config).toBeTruthy();

    const device = await h.prisma.device.findUniqueOrThrow({
      where: { id: res.body.deviceId },
    });
    // ⭐ যে লগইন করল, ডিভাইসটা তারই নামে — এটাই গোটা বদলটার কারণ
    expect(device.employeeId).toBe(employeeId);
    expect(device.monitors).toBe(2);
  });

  /**
   * ⚠️ **টোকেনটা শুধু একবারই যায়** — সার্ভারে কেবল sha256। এখানে সেটা
   * মিলিয়ে দেখা: রেসপন্সের প্লেইন টোকেনটা ডাটাবেসের কলামে নেই।
   */
  it('প্লেইন টোকেন ডাটাবেসে জমা হয় না', async () => {
    const res = await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });

    const device = await h.prisma.device.findUniqueOrThrow({
      where: { id: res.body.deviceId },
    });
    expect(device.tokenHash).not.toBe(res.body.deviceToken);
    expect(device.tokenHash).toHaveLength(64); // sha256 hex
  });

  it('টোকেনটা সত্যিই কাজ করে — heartbeat ২০০', async () => {
    const enrolled = await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });

    const beat = await h
      .http()
      .post('/api/v1/agent/heartbeat')
      .set('Authorization', `Bearer ${enrolled.body.deviceToken}`)
      .send({ state: 'active', activeSecToday: 60 });

    expect(beat.status).toBe(200);
  });

  /**
   * ⚠️ একই PC-তে আবার সাইন ইন করলে **নতুন সারি নয়**, আগেরটাই হালনাগাদ
   * (`machineGuid` দিয়ে upsert)। নইলে প্রতিবার এজেন্ট রিইনস্টলে ডিভাইসের
   * তালিকা ফুলে যেত, আর "কোনটা আসল" বলা যেত না।
   */
  it('একই মেশিনে দ্বিতীয়বার — একই ডিভাইস, নতুন টোকেন', async () => {
    const guid = randomUUID();
    const first = await enrollLogin({
      ...facts({ machineGuid: guid }),
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });
    const second = await enrollLogin({
      ...facts({ machineGuid: guid }),
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });

    expect(second.body.deviceId).toBe(first.body.deviceId);
    expect(second.body.deviceToken).not.toBe(first.body.deviceToken);

    // ⚠️ পুরোনো টোকেনটা এখন অচল — নইলে PC হাতবদল হলেও পুরোনো টোকেন
    //    দিয়ে ডেটা পাঠানো যেত
    const stale = await h
      .http()
      .post('/api/v1/agent/heartbeat')
      .set('Authorization', `Bearer ${first.body.deviceToken}`)
      .send({ state: 'active', activeSecToday: 60 });
    expect(stale.status).toBe(401);
  });

  /** ছ-মাস পরে "এই মেশিনটা কীভাবে যোগ হয়েছিল" — উত্তরটা ইভেন্টেই থাকে */
  it('agent_start ইভেন্টে লেখা থাকে কোন পথে বসল', async () => {
    await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });

    const [event] = await h.prisma.event.findMany({
      where: { type: 'agent_start' },
    });
    expect((event.meta as { via: string }).via).toBe('login');
  });
});

describe('POST /agent/enroll-login — রক্ষাকবচ', () => {
  it('ভুল পাসওয়ার্ডে ৪০১, আর কোনো ডিভাইস বসে না', async () => {
    const res = await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: 'wrong-password',
    });

    expect(res.status).toBe(401);
    expect(await h.prisma.device.count()).toBe(0);
  });

  /** ⚠️ "ইউজার নেই" আর "পাসওয়ার্ড ভুল" — একই বার্তা, নইলে কোন ইমেইলগুলো
   *  আসল তা বাইরে থেকে গুনে বের করা যেত */
  it('অচেনা ইমেইলেও একই ৪০১', async () => {
    const unknown = await enrollLogin({
      ...facts(),
      email: 'nobody@test.local',
      password: STAFF_PASSWORD,
    });
    const wrong = await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: 'wrong-password',
    });

    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('নিষ্ক্রিয় অ্যাকাউন্টে ৪০১', async () => {
    await h.prisma.user.update({
      where: { email: STAFF_EMAIL },
      data: { isActive: false },
    });

    const res = await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });
    expect(res.status).toBe(401);
  });

  /**
   * ⭐ owner ও manager-এর `users.employee_id` null — তাঁদের নামে কর্মীর
   * সারি নেই, তাই ঘণ্টা জমা করার জায়গাও নেই। ৪০১ নয় **৪০৩**, আর
   * বার্তাটা কাজের: "এই PC-র স্টাফ অ্যাকাউন্ট দিয়ে সাইন ইন করুন"।
   */
  it('owner বা manager-এর অ্যাকাউন্টে ৪০৩', async () => {
    for (const [email, password] of [
      [OWNER_EMAIL, OWNER_PASSWORD],
      [MANAGER_EMAIL, MANAGER_PASSWORD],
    ]) {
      const res = await enrollLogin({ ...facts(), email, password });
      expect(res.status, email).toBe(403);
    }

    expect(await h.prisma.device.count()).toBe(0);
  });

  /**
   * ⭐⭐ **brute force।** endpoint-টায় cookie নেই, CSRF নেই — অর্থাৎ
   * পাসওয়ার্ড অনুমান করার সবচেয়ে সহজ দরজা এটাই হতে পারত। যাচাইটা
   * `AuthService.login()`-এ হওয়ায় লগইনের throttle-টাও আপনাআপনি প্রযোজ্য।
   */
  it('বারবার ভুল দিলে অ্যাকাউন্ট তালাবন্ধ হয়', async () => {
    /**
     * ⚠️ এই টেস্টের জন্য **আলাদা ও অনন্য** একটা ইমেইল। throttle-এর
     * কাউন্টার ইন-মেমরিতে (`email|ip`), আর `resetDatabase()` সেটা মোছে না
     * — তাই সাধারণ স্টাফ অ্যাকাউন্টটা তালাবন্ধ করে দিলে **পরের প্রতিটা
     * টেস্ট** ৪২৯ পেত। `auth.e2e.spec.ts`-ও ঠিক এই কৌশলেই চলে।
     */
    const email = `locked-${Date.now()}@test.local`;
    const password = 'another-password-123';

    await h.prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        fullName: 'Locked Out',
        role: UserRole.employee,
        employeeId,
        mustChangePw: false,
      },
    });

    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await enrollLogin({ ...facts(), email, password: `guess-${i}` });
      codes.push(res.status);
    }

    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);

    // ⚠️ তালা পড়ার পর **ঠিক পাসওয়ার্ডও** আটকায় — নইলে তালাটার মানেই থাকত না
    const right = await enrollLogin({ ...facts(), email, password });
    expect(right.status).toBe(429);

    expect(await h.prisma.device.count()).toBe(0);
  });

  it('ব্যর্থ চেষ্টা audit_log-এ ওঠে', async () => {
    await h.prisma.auditLog.deleteMany({});

    await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: 'wrong-password',
    });

    const rows = await h.prisma.auditLog.findMany({
      where: { action: 'login_failed' },
    });
    expect(rows).toHaveLength(1);
  });

  it('ঘর বাদ দিলে ৪০০', async () => {
    const res = await enrollLogin({ email: STAFF_EMAIL, password: STAFF_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('ইমেইল না হলে ৪০০', async () => {
    const res = await enrollLogin({
      ...facts(),
      email: 'rakib',
      password: STAFF_PASSWORD,
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /agent/enroll-login — 2FA', () => {
  /**
   * ⚠️ 2FA চালু থাকলে প্রথম উত্তরে ডিভাইস তৈরি হয় **না**, শুধু
   * `needs_totp` — এজেন্ট তখন ছ-অঙ্কের ঘরটা দেখায়। ৪০১ দিলে স্টাফ
   * "পাসওয়ার্ড ভুল" পড়ে বারবার ঠিক পাসওয়ার্ডই টাইপ করে যেত।
   */
  it('2FA চালু থাকলে কোড চায়, ডিভাইস বসে না', async () => {
    await h.prisma.user.update({
      where: { email: STAFF_EMAIL },
      data: {
        // ⚠️ খামের আকৃতি `src/auth/totp.ts`-এর `TotpEnvelope` — ভুল
        //    আকৃতি দিলে `decodeEnvelope` ছোড়ে (fail-closed), আর টেস্টটা
        //    ৫০০ পেয়ে "2FA কাজ করছে" বলে ভুল আশ্বাস দিত
        totpSecret: JSON.stringify({
          v: 1,
          secret: 'JBSWY3DPEHPK3PXP',
          enabled: true,
          recoveryHashes: [],
          lastCounter: 0,
        }),
      },
    });

    const res = await enrollLogin({
      ...facts(),
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('needs_totp');
    expect(res.body.deviceToken).toBeUndefined();
    expect(await h.prisma.device.count()).toBe(0);
  });
});
