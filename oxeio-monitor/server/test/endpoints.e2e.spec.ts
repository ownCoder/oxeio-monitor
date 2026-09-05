import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmployeeWithCode,
  createHarness,
  hashPassword,
  enrollDevice,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  dhakaNoon,
  dhakaTodayIso,
} from './setup/harness';

/**
 * ⭐ প্রতিটা নতুন endpoint **অন্তত একবার** সত্যিকারের HTTP দিয়ে ডাকা।
 *
 * সাতটা মডিউল সমান্তরালে লেখা হয়েছে, আর তাদের টেস্ট প্রায় সবই খাঁটি
 * ফাংশনের — গণিতটা যাচাই হয়েছে, কিন্তু **একটা endpoint-ও কখনো ডাকা হয়নি**।
 * যা ওতে ধরা পড়ত না:
 *
 * - দুটো কন্ট্রোলার একই পথ দাবি করলে (যেমন `/employees/:id`) — Express
 *   প্রথমটাকেই ডাকে, দ্বিতীয়টা চিরকাল নীরবে অচল থাকত
 * - গার্ড ভুল বসানো — ম্যানেজার owner-only রুটে ঢুকে যেত
 * - Prisma-র কোয়েরি ভুল — টাইপ ঠিক, কিন্তু চালালে ভাঙে
 * - রেসপন্সে BigInt — JSON.stringify ছুড়ে ফেলে, ৫০০ হয়ে যায়
 *
 * ⚠️ এখানে ব্যবসায়িক সঠিকতা যাচাই হচ্ছে না — শুধু "চলে, আর ঠিক লোককে
 * ঠিক উত্তর দেয়"। সংখ্যাগুলো ঠিক কি না সেটা .math স্পেকগুলোর কাজ।
 */

let h: Harness;
let employeeId: number;
let deviceId: number;

/** যেকোনো ২xx/৪xx চলবে, কিন্তু ৫xx মানে endpoint-টা ভাঙা */
const notServerError = (status: number, where: string) => {
  expect(status, `${where} → ${status}`).toBeLessThan(500);
};

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  const { employeeId: id, code } = await createEmployeeWithCode(h.prisma);
  employeeId = id;
  ({ deviceId } = await enrollDevice(h, code));
});

const TODAY = dhakaTodayIso();
const MONTH = TODAY.slice(0, 7);

/** owner ও manager দুজনেই পড়তে পারবে (§ ৪.৩) */
const SHARED_READS = (id: number): string[] => [
  '/api/v1/live',
  `/api/v1/employees/${id}/timeline?date=${TODAY}`,
  `/api/v1/employees/${id}/hourly?date=${TODAY}`,
  `/api/v1/screenshots?employeeId=${id}&date=${TODAY}`,
  `/api/v1/reports/attendance?from=${TODAY}&to=${TODAY}`,
  `/api/v1/reports/productivity?from=${TODAY}&to=${TODAY}`,
  `/api/v1/activity/productivity?employeeId=${id}&from=${TODAY}&to=${TODAY}`,
  `/api/v1/activity/top?employeeId=${id}&from=${TODAY}&to=${TODAY}`,
  `/api/v1/activity/team?from=${TODAY}&to=${TODAY}`,
  // ⭐ ১৫ আগস্ট থেকে ম্যানেজারেরও — মালিকের সিদ্ধান্ত। দুটোই তিনি
  //    **বদলাতেও** পারেন; সেই লেখার দিকটা `staff-setup.e2e.spec.ts`-এ।
  '/api/v1/categories',
  '/api/v1/holidays',
];

/** শুধু owner (§ ৪.৩) */
const OWNER_ONLY_READS = [
  '/api/v1/devices',
  // ⚠️ ছুটি ম্যানেজারের, কিন্তু work policy নয় — মাসিক টার্গেট ও ছবির
  //    উইন্ডো বদলালে প্রতিটা PC-র আচরণ বদলায়, সেটা owner-এরই থাকল।
  '/api/v1/work-policies',
  '/api/v1/audit-log',
  '/api/v1/alerts',
  `/api/v1/payroll?month=${MONTH}`,
];

describe('সব endpoint সত্যিই সাড়া দেয়', () => {
  it('owner-এর জন্য কোনোটাই ৫০০ দেয় না', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    for (const url of [...SHARED_READS(employeeId), ...OWNER_ONLY_READS]) {
      const res = await s.http.get(url);
      notServerError(res.status, url);
      expect(res.status, `${url} → owner-এর ৪০৩/৪০৪ পাওয়ার কথা নয়`).toBeLessThan(
        400,
      );
    }
  });

  it('manager শেয়ার্ড রুট পড়তে পারে', async () => {
    const s = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    for (const url of SHARED_READS(employeeId)) {
      const res = await s.http.get(url);
      notServerError(res.status, url);
      expect(res.status, `${url} → ম্যানেজারের পড়ার কথা`).toBeLessThan(400);
    }
  });

  /**
   * ⚠️ ক্লাস-লেভেল `@Roles(owner)` ভুলে গেলে বা মেথডে বসালে এটাই ধরবে।
   * পরে কেউ নতুন owner-only endpoint যোগ করলে এই তালিকায় লিখে দিলেই হলো।
   */
  it('manager owner-only রুটে ৪০৩ পায়', async () => {
    const s = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    for (const url of OWNER_ONLY_READS) {
      const res = await s.http.get(url);
      expect(res.status, `${url} → ম্যানেজারের ঢোকার কথা নয়`).toBe(403);
    }
  });

  /**
   * ⭐⭐⭐ **গবেষক গোটা দলের ডেটার ধারেকাছেও যান না** *(২৫ আগস্ট ২০২৬)*।
   *
   * ### ⚠️⚠️ এই তালিকাটা কেন গোটা ফাইলের সবচেয়ে জরুরি জাল
   *
   * `UserRole`-এ একটা নতুন মান বসানো দেখতে নিরীহ — কিন্তু কোডবেসের
   * অনেক শর্ত লেখা ছিল **না-তালিকা** ধাঁচে (`role !== 'employee'`),
   * অর্থাৎ *"স্টাফ না হলে সব দেখতে দাও"*। ⭐ নতুন ভূমিকা তখন নীরবে
   * **ভেতরের দিকে** পড়ে, বাইরে নয়। মাপা গেছে দুটো জায়গায়:
   *
   *   · `screenshots.service` → `resolveEmployeeScope` `null` ফেরত দিত,
   *     আর `null` মানে *ফিল্টার নেই* — সবার ছবি, সব দিনের
   *   · `adjustments.service` → `assertCanSee` পুরো এড়িয়ে যেত
   *
   * ⚠️⚠️ কম্পাইলার কিছুই বলত না — গোটা কোডবেসে নতুন মানটা **মাত্র দুটো**
   * জায়গায় কম্পাইল-এরর দিয়েছিল, আর দুটোই নিছক টাইপ-চওড়া করার ব্যাপার।
   *
   * ⭐ তাই পাহারাটা তালিকা ধরে: owner ও manager-এর জন্য খোলা **প্রতিটা**
   * রুটে গবেষককে ৪০৩ পেতেই হবে। ভবিষ্যতে কেউ নতুন রুট যোগ করলে সেটা
   * এমনিতেই এই তালিকায় চলে আসে।
   */
  it('⭐⭐ গবেষক owner/manager-এর কোনো রুটেই ঢোকেন না', async () => {
    const them = await h.prisma.employee.create({
      data: { empCode: 'OX-79', fullName: 'Researcher', staffType: 'researcher' },
    });
    await h.prisma.user.create({
      data: {
        email: 'r-ep@test.local',
        fullName: 'Researcher',
        passwordHash: await hashPassword('staff-password-123'),
        role: 'researcher',
        employeeId: them.id,
        mustChangePw: false,
      },
    });

    const s = await loginReady(h, 'r-ep@test.local', 'staff-password-123');

    for (const url of [...SHARED_READS(employeeId), ...OWNER_ONLY_READS]) {
      const res = await s.http.get(url);
      expect(res.status, `${url} → গবেষকের ঢোকার কথা নয়`).toBe(403);
    }
  });

  /**
   * ⚠️⚠️ **আর এটাই ওই ফাঁদের সরাসরি পাহারা।** `employeeId` **ছাড়া**
   * `/screenshots` ডাকলে পুরোনো কোড *"ফিল্টার নেই"* ধরে **সবার** ছবি
   * ফেরত দিত। গবেষকেরও নিজের এজেন্ট আছে (মাঠে যাচাই করা), তাই তিনি
   * এই রুটটা রোজই ছোঁন — ⭐ প্রশ্নটা "ঢুকতে পারেন কি না" নয়, **"কতটা
   * দেখতে পান"**।
   */
  it('⭐⭐ গবেষক নিজের ছবিই দেখেন — সবার নয়', async () => {
    const them = await h.prisma.employee.create({
      data: { empCode: 'OX-80', fullName: 'Researcher', staffType: 'researcher' },
    });
    await h.prisma.user.create({
      data: {
        email: 'r-shot@test.local',
        fullName: 'Researcher',
        passwordHash: await hashPassword('staff-password-123'),
        role: 'researcher',
        employeeId: them.id,
        mustChangePw: false,
      },
    });

    const s = await loginReady(h, 'r-shot@test.local', 'staff-password-123');

    // ⭐ নিজের — খোলা
    const mine = await s.http.get(`/api/v1/screenshots?date=${TODAY}`);
    expect(mine.status).toBeLessThan(400);
    for (const row of mine.body.rows ?? []) {
      expect(row.employeeId, 'নিজের ছবি ছাড়া কিছু আসার কথা নয়').toBe(them.id);
    }

    // ⚠️ অন্যেরটা চেয়ে দেখা — চুপচাপ নিজেরটা দেওয়া হয় না, ৪০৩
    const theirs = await s.http.get(
      `/api/v1/screenshots?employeeId=${employeeId}&date=${TODAY}`,
    );
    expect(theirs.status, 'অন্যের ছবি চাইলে ৪০৩').toBe(403);
  });

  it('লগইন ছাড়া সব বন্ধ', async () => {
    for (const url of [...SHARED_READS(employeeId), ...OWNER_ONLY_READS]) {
      const res = await h.http().get(url);
      expect(res.status, `${url} → লগইন ছাড়াই খোলা!`).toBe(401);
    }
  });
});

describe('বেতন কখনো ম্যানেজারের কাছে যায় না', () => {
  /**
   * ⭐ সিস্টেমের সবচেয়ে সংবেদনশীল ফিল্ড। ⚠️ `null` করে পাঠানোও যথেষ্ট নয় —
   * ফিল্ডটা রেসপন্সে **থাকবেই না**, নইলে একদিন কেউ `?? 0` লিখে দিত আর
   * ফিল্ডটা ফিরে আসত।
   */
  it('employees তালিকায় monthlySalary নেই', async () => {
    const s = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    const res = await s.http.get('/api/v1/employees');
    expect(res.status).toBeLessThan(400);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('monthlySalary');
    expect(body).not.toContain('monthly_salary');
  });

  it('owner তালিকায় monthlySalary পায়', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http.get('/api/v1/employees');
    expect(res.status).toBeLessThan(400);
    expect(JSON.stringify(res.body)).toContain('monthlySalary');
  });
});

describe('ফুল URL বা উইন্ডো টাইটেল কখনো রিপোর্টে ওঠে না', () => {
  /**
   * ADR-013 — ডোমেইনের বাইরে কিছু জমাই হয় না, কিন্তু `windowTitle` জমা হয়।
   * অ্যাক্টিভিটি রিপোর্টে সেটা ফেরত গেলে "কে কোন ফাইল খুলেছে" ফাঁস হতো।
   */
  it('activity রিপোর্টে windowTitle থাকে না', async () => {
    const now = dhakaNoon();
    await h.prisma.appUsage.create({
      data: {
        employeeId,
        deviceId,
        clientUuid: crypto.randomUUID(),
        workDate: new Date(`${TODAY}T00:00:00.000Z`),
        startedAt: new Date(now.getTime() - 60_000),
        endedAt: now,
        durationSec: 60,
        processName: 'chrome.exe',
        windowTitle: 'গোপন-ফাইলের-নাম.xlsx',
        domain: 'github.com',
        isBrowser: true,
      },
    });

    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    for (const url of [
      `/api/v1/activity/top?employeeId=${employeeId}&from=${TODAY}&to=${TODAY}`,
      `/api/v1/reports/productivity?from=${TODAY}&to=${TODAY}`,
    ]) {
      const res = await s.http.get(url);
      expect(res.status, url).toBeLessThan(400);
      expect(JSON.stringify(res.body), url).not.toContain('গোপন-ফাইলের-নাম');
    }
  });
});
