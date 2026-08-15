import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmployeeWithCode,
  createHarness,
  enrollDevice,
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
  ) as { hasPortalAccount: boolean; hasDevice: boolean; agentSwitchedOff: boolean };
};

describe('GET /employees/next-code', () => {
  const next = async (): Promise<string> => {
    const res = await owner.http.get('/api/v1/employees/next-code').expect(200);
    return (res.body as { code: string }).code;
  };

  /**
   * ⚠️⚠️ **এই টেস্টটাই সবচেয়ে জরুরি** — রুটের ক্রম।
   *
   * Nest রুট মেলায় উপর থেকে নিচে, তাই `@Get('next-code')` যদি
   * `@Get(':id')`-এর **নিচে** বসত, তবে `next-code` অংশটা `:id` হিসেবে
   * ধরা পড়ত আর `ParseIntPipe` ৪০০ দিত — বার্তা হতো "Validation failed
   * (numeric string is expected)", যেটা পড়ে আসল কারণ বোঝা কঠিন।
   */
  it('রুটটা :id-এর ফাঁদে পড়ে না', async () => {
    const code = await next();
    expect(code).toMatch(/^[A-Za-z_]+-\d+$/);
  });

  it('কেউ না থাকলে OX-001', async () => {
    expect(await next()).toBe('OX-001');
  });

  it('সবচেয়ে বড় কোডের পরেরটা দেয়', async () => {
    await createEmployeeWithCode(h.prisma, 'OX-01');
    await createEmployeeWithCode(h.prisma, 'OX-07');

    expect(await next()).toBe('OX-08');
  });

  /**
   * ⚠️⚠️ inactive কর্মীর কোডও গোনা হয়। না গুনলে ছাঁটাই হওয়া কারো কোড
   * আবার পরামর্শ হতো, আর সেভ করতে গিয়ে ৪০৯ — অথচ পর্দায় (active
   * ফিল্টারে) ওই কোডের কাউকে দেখা যেত না, তাই কারণটা বোঝাই যেত না।
   */
  it('inactive কর্মীর কোডও গোনা হয়', async () => {
    const { employeeId } = await createEmployeeWithCode(h.prisma, 'OX-09');
    await h.prisma.employee.update({
      where: { id: employeeId },
      data: { status: 'inactive' },
    });

    expect(await next()).toBe('OX-10');
  });

  /**
   * ⭐ আগেভাগে দেখানো কোডটাই সত্যিই বসে — এটাই আসল দাবি।
   *
   * ⚠️ কোড **পাঠানো হয় না**; সার্ভার নিজে বসায়। তাই এটা একই সাথে দেখায়
   * যে পূর্বাভাস আর বাস্তবতা এক।
   */
  it('আগেভাগে দেখানো কোডটাই সেভ করলে বসে', async () => {
    await createEmployeeWithCode(h.prisma, 'OX-01');

    const code = await next();
    const res = await owner.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', owner.csrf)
      .send({ fullName: 'Notun Kormi' });

    expect(res.status).toBe(201);
    expect(res.body.empCode).toBe(code);
  });

  /** ⚠️ ম্যানেজারও কর্মী যোগ করার পর্দা দেখেন, তাই তাঁরও লাগে */
  it('ম্যানেজারও পায়', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    await manager.http.get('/api/v1/employees/next-code').expect(200);
  });
});

/**
 * **কর্মী-কোড সিস্টেম বসায়, কেউ বদলাতে পারে না।**
 *
 * ⚠️ কেন এই টেস্টগুলো: কোডটা মানুষের **পরিচয়** — রিপোর্ট, Excel, পে-রোল
 * শিট আর ছাপানো কাগজে ওটাই লেখা থাকে। হাতে বসানোর সুযোগ থাকলে দুটো
 * বিপদ ছিল: টাইপো (`OX-007` বনাম `OX-07`, দুটোই আসল ডেটায় ঘটেছে), আর
 * মাঝপথে বদলে ফেলা — যাতে পুরোনো কাগজ আর নতুন পর্দা দুই কথা বলত।
 *
 * ⭐ পর্দায় ঘরটা `disabled`, কিন্তু আসল পাহারা **এখানে** — DevTools দিয়ে
 * সরাসরি রিকোয়েস্ট পাঠালেও যাতে ঢুকতে না পারে।
 */
describe('কর্মী-কোড — সিস্টেমের হাতে', () => {
  // ⚠️ উপরের গ্লোবাল `beforeEach`-ই ডাটাবেস ধুয়ে owner-কে লগইন করায়

  it('কোড না পাঠালেও কর্মী তৈরি হয়, আর কোড বসে', async () => {
    const res = await owner.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', owner.csrf)
      .send({ fullName: 'Kono Code Chara' });

    expect(res.status).toBe(201);
    expect(res.body.empCode).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.body.empCode.length).toBeGreaterThan(0);
  });

  /**
   * ⚠️ ৪০০, নীরবে উপেক্ষা **নয়** — `forbidNonWhitelisted`। "পাঠালাম অথচ
   * বসল না" অবস্থাটা এই ফিল্ডে সবচেয়ে বিপজ্জনক, কারণ কোডটা মানুষ চোখে
   * চেনে আর ধরে নিত সেটাই বসেছে।
   */
  it('তৈরির সময় কোড পাঠালে ৪০০', async () => {
    const res = await owner.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', owner.csrf)
      .send({ empCode: 'MY-OWN-99', fullName: 'Nijer Code' });

    expect(res.status).toBe(400);
  });

  it('সম্পাদনায় কোড বদলাতে চাইলে ৪০০, আর কোড অটুট থাকে', async () => {
    const created = await owner.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', owner.csrf)
      .send({ fullName: 'Age Jini Chilen' })
      .expect(201);

    const before: string = created.body.empCode;

    await owner.http
      .patch(`/api/v1/employees/${created.body.id}`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ empCode: 'BODLE-DILAM' })
      .expect(400);

    const after = await owner.http
      .get(`/api/v1/employees/${created.body.id}`)
      .expect(200);

    expect(after.body.empCode).toBe(before);
  });

  /** ⭐ পরপর যোগ করলে কোড এগোয় — একই কোড দুবার বসে না */
  it('পরপর তিনজন যোগ করলে তিনটে আলাদা কোড', async () => {
    const codes: string[] = [];

    for (const name of ['Ek', 'Dui', 'Tin']) {
      const res = await owner.http
        .post('/api/v1/employees')
        .set('X-CSRF-Token', owner.csrf)
        .send({ fullName: name })
        .expect(201);
      codes.push(res.body.empCode);
    }

    expect(new Set(codes).size).toBe(3);
  });
});

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
   * ⭐⭐ **"কখনো বসেনি" আর "বন্ধ করে দেওয়া" — দুটো আলাদা অবস্থা।**
   *
   * ⚠️ দুটোতেই `hasDevice` মিথ্যা, কিন্তু করণীয় সম্পূর্ণ ভিন্ন: একটায়
   * PC-তে গিয়ে MSI বসাতে হয়, অন্যটায় সারিতেই এক ক্লিক। আলাদা না করলে
   * মালিক বন্ধ হয়ে যাওয়া এজেন্টের জন্য আবার ইনস্টল করতে যেতেন।
   */
  it('বাতিল ডিভাইস থাকলে agentSwitchedOff সত্যি', async () => {
    const { code } = await createEmployeeWithCode(h.prisma, 'SU-OFF');
    const device = await enrollDevice(h, code);

    await h.prisma.device.update({
      where: { id: device.deviceId },
      data: { status: 'revoked' },
    });

    const row = await rowFor('SU-OFF');
    expect(row.hasDevice).toBe(false);
    expect(row.agentSwitchedOff).toBe(true);
  });

  it('কখনো ডিভাইস না থাকলে agentSwitchedOff মিথ্যা', async () => {
    await createEmployeeWithCode(h.prisma, 'SU-NEVER');

    expect((await rowFor('SU-NEVER')).agentSwitchedOff).toBe(false);
  });

  /**
   * ⚠️ একটাও সচল থাকলে "বন্ধ" নয় — ডেস্কটপ বাতিল, ল্যাপটপ চালু।
   *
   * ⚠️ দ্বিতীয় ডিভাইসটা সরাসরি বসানো হয়, `enrollDevice` দিয়ে নয় —
   *    enrollment কোড **একবার-ব্যবহার্য**, দ্বিতীয়বার ৪০১ দেয়।
   */
  it('সচল ডিভাইস থাকলে agentSwitchedOff মিথ্যা', async () => {
    const { code, employeeId } = await createEmployeeWithCode(h.prisma, 'SU-MIX');
    await enrollDevice(h, code);

    await h.prisma.device.create({
      data: {
        hostname: 'OLD-DESKTOP',
        windowsUsername: 'someone',
        employeeId,
        machineGuid: `mix-${Date.now()}`,
        tokenHash: 'not-a-real-token',
        status: 'revoked',
      },
    });

    const row = await rowFor('SU-MIX');
    expect(row.hasDevice).toBe(true);
    expect(row.agentSwitchedOff).toBe(false);
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

/**
 * ⭐⭐ **ম্যানেজারের অ্যাক্সেস** *(মালিকের সিদ্ধান্ত, ১৫ আগস্ট)।*
 *
 * ম্যানেজার কর্মী **যোগ ও এডিট** করতে পারেন, আর Holidays ও Categories
 * পুরোপুরি চালাতে পারেন। ⚠️ কিন্তু **বেতন নয়** ([ADR-023](../../../docs/05-Options-Decisions.md))।
 *
 * ⚠️⚠️ শেষ দুটো টেস্টই আসল: `redact.ts` ম্যানেজারের **রেসপন্স থেকে**
 * বেতন ছেঁকে ফেলে, কিন্তু সেটা তাঁকে বেতন **পাঠানো** থেকে আটকায় না।
 * ওই ফাঁকটা বন্ধ না করলে ম্যানেজার এমন একটা ঘরে লিখতে পারতেন যেটা তিনি
 * পড়তেও পারেন না — আর ভুল বসালে নিজে দেখেও ধরতে পারতেন না।
 */
describe('ম্যানেজারের অ্যাক্সেস', () => {
  let manager: Session;

  beforeEach(async () => {
    manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
  });

  it('কর্মী যোগ করতে পারেন', async () => {
    const res = await manager.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', manager.csrf)
      .send({ fullName: 'Manager Joge Korlen' });

    expect(res.status).toBe(201);
    // ⭐ বেতনের ঘরটা রেসপন্সেই নেই — redact.ts
    expect(res.body.monthlySalary).toBeUndefined();
  });

  it('কর্মী এডিট করতে পারেন', async () => {
    const created = await manager.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', manager.csrf)
      .send({ fullName: 'Age Naam' })
      .expect(201);

    await manager.http
      .patch(`/api/v1/employees/${created.body.id}`)
      .set('X-CSRF-Token', manager.csrf)
      .send({ fullName: 'Pore Naam', department: 'Design' })
      .expect(200);
  });

  it('holidays ও categories দুটোই পড়তে ও লিখতে পারেন', async () => {
    await manager.http.get('/api/v1/holidays').expect(200);
    await manager.http.get('/api/v1/categories').expect(200);

    await manager.http
      .post('/api/v1/holidays')
      .set('X-CSRF-Token', manager.csrf)
      .send({ date: '2026-12-25', name: 'Boro Din' })
      .expect(201);
  });

  /** ⚠️ deactivate · portal account · audit — এগুলো owner-এরই */
  it('deactivate করতে পারেন না', async () => {
    const created = await manager.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', manager.csrf)
      .send({ fullName: 'Keu Ekjon' })
      .expect(201);

    await manager.http
      .post(`/api/v1/employees/${created.body.id}/deactivate`)
      .set('X-CSRF-Token', manager.csrf)
      .send({ reason: 'cheshta korchi' })
      .expect(403);

    await manager.http.get('/api/v1/audit-log').expect(403);
  });

  it('⭐ কর্মী যোগ করার সময় বেতন পাঠালে ৪০৩', async () => {
    const res = await manager.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', manager.csrf)
      .send({ fullName: 'Beton Soho', monthlySalary: '99000' });

    expect(res.status).toBe(403);
    // ⚠️ কর্মীটাও তৈরি হয়নি — নীরবে বেতন বাদ দিয়ে সেভ করা হয় না
    const list = await owner.http.get('/api/v1/employees').expect(200);
    expect(
      (list.body.rows as { fullName: string }[]).some(
        (r) => r.fullName === 'Beton Soho',
      ),
    ).toBe(false);
  });

  it('⭐ এডিটে বেতন পাঠালে ৪০৩, আর বেতন অটুট থাকে', async () => {
    const created = await owner.http
      .post('/api/v1/employees')
      .set('X-CSRF-Token', owner.csrf)
      .send({ fullName: 'Beton Ache', monthlySalary: '15000' })
      .expect(201);

    await manager.http
      .patch(`/api/v1/employees/${created.body.id}`)
      .set('X-CSRF-Token', manager.csrf)
      .send({ monthlySalary: '99000' })
      .expect(403);

    // ⚠️ `null` পাঠিয়ে মুছে ফেলাও বেতনে হাত দেওয়া — সেটাও নিষিদ্ধ
    await manager.http
      .patch(`/api/v1/employees/${created.body.id}`)
      .set('X-CSRF-Token', manager.csrf)
      .send({ monthlySalary: null })
      .expect(403);

    const after = await owner.http
      .get(`/api/v1/employees/${created.body.id}`)
      .expect(200);
    expect(after.body.monthlySalary).toBe('15000.00');
  });
});
