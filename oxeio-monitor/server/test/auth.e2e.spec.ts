import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createHarness,
  login,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
} from './setup/harness';
import { resolveThrottle } from '../src/auth/login-throttle.config';

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

describe('পাবলিক রুট', () => {
  it('health লগইন ছাড়াই খোলে', async () => {
    const res = await h.http().get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('up');
  });
});

describe('লগইন ছাড়া সুরক্ষিত রুট', () => {
  it('GET /auth/me → 401', async () => {
    await h.http().get('/api/v1/auth/me').expect(401);
  });

  // গার্ডের ক্রম JWT → CSRF, তাই এখানে 403 নয় 401 আসা উচিত
  it('POST reset-password → 401, CSRF-এর 403 নয়', async () => {
    await h.http().post('/api/v1/users/1/reset-password').expect(401);
  });
});

describe('লগইন', () => {
  it('ভুল পাসওয়ার্ডে 401', async () => {
    await h
      .http()
      .post('/api/v1/auth/login')
      .send({ email: OWNER_EMAIL, password: 'totally-wrong' })
      .expect(401);
  });

  it('অচেনা ইমেইলেও একই বার্তা — user enumeration ঠেকাতে', async () => {
    const unknown = await h
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'whatever' })
      .expect(401);

    const wrongPw = await h
      .http()
      .post('/api/v1/auth/login')
      .send({ email: OWNER_EMAIL, password: 'totally-wrong' })
      .expect(401);

    expect(unknown.body.message).toBe(wrongPw.body.message);
  });

  it('সঠিক পাসওয়ার্ডে cookie বসে, session cookie httpOnly', async () => {
    const res = await h
      .http()
      .post('/api/v1/auth/login')
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
      .expect(200);

    expect(res.body.mustChangePassword).toBe(true);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((c) => c.startsWith('oxeio_session='));
    const csrf = cookies.find((c) => c.startsWith('oxeio_csrf='));

    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Strict/i);
    // CSRF টোকেন ফ্রন্টএন্ডকে পড়তে হয় — তাই এটা httpOnly হওয়া চলবে না
    expect(csrf).toBeDefined();
    expect(csrf).not.toMatch(/HttpOnly/i);
  });
});

describe('mustChangePw অবস্থায়', () => {
  it('/auth/me খোলা থাকে কিন্তু বাকি সব 403', async () => {
    const s = await login(h, OWNER_EMAIL, OWNER_PASSWORD);

    const me = await s.http.get('/api/v1/auth/me').expect(200);
    expect(me.body.mustChangePassword).toBe(true);

    const blocked = await s.http
      .post('/api/v1/users/1/reset-password')
      .set('X-CSRF-Token', s.csrf)
      .expect(403);
    expect(blocked.body.mustChangePassword).toBe(true);
  });
});

describe('CSRF', () => {
  it('হেডার ছাড়া 403', async () => {
    const s = await login(h, OWNER_EMAIL, OWNER_PASSWORD);
    await s.http
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: OWNER_PASSWORD, newPassword: 'brand-new-pass-1' })
      .expect(403);
  });

  it('ভুল টোকেনে 403', async () => {
    const s = await login(h, OWNER_EMAIL, OWNER_PASSWORD);
    await s.http
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', 'bogus')
      .send({ currentPassword: OWNER_PASSWORD, newPassword: 'brand-new-pass-1' })
      .expect(403);
  });
});

describe('পাসওয়ার্ড বদল', () => {
  it('১০ অক্ষরের কম হলে 400', async () => {
    const s = await login(h, OWNER_EMAIL, OWNER_PASSWORD);
    await s.http
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', s.csrf)
      .send({ currentPassword: OWNER_PASSWORD, newPassword: 'short' })
      .expect(400);
  });

  it('বর্তমান পাসওয়ার্ড ভুল হলে 401', async () => {
    const s = await login(h, OWNER_EMAIL, OWNER_PASSWORD);
    await s.http
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', s.csrf)
      .send({ currentPassword: 'nope-nope', newPassword: 'brand-new-pass-1' })
      .expect(401);
  });

  it('আগেরটার মতোই দিলে 400', async () => {
    const s = await login(h, OWNER_EMAIL, OWNER_PASSWORD);
    await s.http
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', s.csrf)
      .send({ currentPassword: OWNER_PASSWORD, newPassword: OWNER_PASSWORD })
      .expect(400);
  });

  it('সফল বদলের পর mustChangePassword মিথ্যা হয়ে যায়', async () => {
    const s = await login(h, OWNER_EMAIL, OWNER_PASSWORD);
    const res = await s.http
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', s.csrf)
      .send({ currentPassword: OWNER_PASSWORD, newPassword: 'brand-new-pass-1' })
      .expect(204);

    // cookie নতুন করে ইস্যু হয়, নইলে টোকেনে পুরোনো mustChangePw থেকে যেত
    expect(res.headers['set-cookie']).toBeDefined();

    const me = await s.http.get('/api/v1/auth/me').expect(200);
    expect(me.body.mustChangePassword).toBe(false);
  });
});

describe('role guard', () => {
  it('owner owner-only রুটে পৌঁছায়', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    // স্টাফটি নেই — অর্থাৎ গার্ড পেরিয়ে সার্ভিস পর্যন্ত পৌঁছেছে
    await s.http
      .post('/api/v1/employees/999/portal-account')
      .set('X-CSRF-Token', s.csrf)
      .send({ email: 'nobody@test.local' })
      .expect(404);
  });

  it('manager owner-only রুটে 403', async () => {
    const s = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    await s.http
      .post('/api/v1/users/1/reset-password')
      .set('X-CSRF-Token', s.csrf)
      .expect(403);
  });
});

describe('owner-এর পাসওয়ার্ড রিসেট (G33)', () => {
  /**
   * ⚠️⚠️ **রিসেট আর বাধ্যতামূলক বদল বসায় না** *(২৩ আগস্ট, ADR-033)*।
   * মালিক দুবার বলেছেন ওই দেয়ালটা চান না, আর দ্বিতীয়বার তিনি নিজেই
   * ওতে আটকেছিলেন — Reset চেপে, পাসওয়ার্ডের ঘর খালি রেখে।
   * ⭐ এলোমেলো পাসওয়ার্ড এখনো দেওয়া হয়, শুধু বদলাতে বলা হয় না।
   */
  it('অস্থায়ী পাসওয়ার্ড দেয়, কিন্তু বদলাতে বলে না', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    const manager = await h.prisma.user.findFirstOrThrow({
      where: { email: MANAGER_EMAIL },
    });

    const res = await s.http
      .post(`/api/v1/users/${manager.id}/reset-password`)
      .set('X-CSRF-Token', s.csrf)
      .expect(200);

    expect(res.body.tempPassword).toBeTruthy();

    const after = await h.prisma.user.findFirstOrThrow({
      where: { id: manager.id },
    });
    expect(after.mustChangePw).toBe(false);

    // নতুন পাসওয়ার্ড সত্যিই কাজ করে
    await h
      .http()
      .post('/api/v1/auth/login')
      .send({ email: MANAGER_EMAIL, password: res.body.tempPassword })
      .expect(200);
  });

  it('audit_log-এ রেকর্ড হয়', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    const manager = await h.prisma.user.findFirstOrThrow({
      where: { email: MANAGER_EMAIL },
    });

    await s.http
      .post(`/api/v1/users/${manager.id}/reset-password`)
      .set('X-CSRF-Token', s.csrf)
      .expect(200);

    const entries = await h.prisma.auditLog.findMany({
      where: { action: 'reset_password' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].targetId).toBe(String(manager.id));
  });
});

describe('স্টাফের self-view অ্যাকাউন্ট', () => {
  it('owner অ্যাকাউন্ট খুললে role = employee হয়', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    const policy = await h.prisma.workPolicy.findFirstOrThrow();
    const employee = await h.prisma.employee.create({
      data: { empCode: 'OX-009', fullName: 'Test Staff', policyId: policy.id },
    });

    const res = await s.http
      .post(`/api/v1/employees/${employee.id}/portal-account`)
      .set('X-CSRF-Token', s.csrf)
      .send({ email: 'staff@test.local' })
      .expect(201);

    expect(res.body.tempPassword).toBeTruthy();

    const created = await h.prisma.user.findFirstOrThrow({
      where: { email: 'staff@test.local' },
    });
    expect(created.role).toBe('employee');
    expect(created.employeeId).toBe(employee.id);
    // ⚠️ নতুন অ্যাকাউন্টেও নয় — ADR-033
    expect(created.mustChangePw).toBe(false);
  });
});

describe('logout', () => {
  it('cookie মুছে যায়, পরের রিকোয়েস্ট 401', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await s.http
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Token', s.csrf)
      .expect(204);
    await s.http.get('/api/v1/auth/me').expect(401);
  });
});

describe('ব্রুট-ফোর্স (I11)', () => {
  /**
   * ⚠️⚠️ সংখ্যাটা আর হার্ডকোড করা হয় না — এটা এখন `.env`-এর সেটিং
   * (`LOGIN_MAX_FAILS`)। আগে টেস্টে "৫" বসানো ছিল, তাই ডিফল্ট নরম করার
   * সাথে সাথেই টেস্ট ভেঙেছে — অথচ আচরণটা ঠিকই ছিল। টেস্ট যেন **নিয়ম**
   * পাহারা দেয়, একটা নির্দিষ্ট সংখ্যা নয়।
   */
  const { maxFails, enabled } = resolveThrottle({
    maxFails: process.env.LOGIN_MAX_FAILS,
    lockMinutes: process.env.LOGIN_LOCK_MINUTES,
  });

  it.skipIf(!enabled)('সীমা ছাড়ালে 429', async () => {
    const email = `attacker-${Date.now()}@test.local`;
    const codes: number[] = [];

    // সীমা পর্যন্ত সবগুলোই 401, তার পরেরটা 429
    for (let i = 0; i <= maxFails; i++) {
      const res = await h
        .http()
        .post('/api/v1/auth/login')
        .send({ email, password: `guess-${i}` });
      codes.push(res.status);
    }

    expect(codes.slice(0, maxFails)).toEqual(Array(maxFails).fill(401));
    expect(codes[maxFails]).toBe(429);
  });

  it('আক্রমণের পরেও আসল অ্যাকাউন্ট খোলা থাকে', async () => {
    const email = `attacker2-${Date.now()}@test.local`;
    for (let i = 0; i <= maxFails; i++) {
      await h.http().post('/api/v1/auth/login').send({ email, password: 'x' });
    }

    await h
      .http()
      .post('/api/v1/auth/login')
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
      .expect(200);
  });
});
