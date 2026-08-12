import { randomUUID } from 'node:crypto';

import { UserRole } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
import {
  createHarness,
  hashPassword,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
} from './setup/harness';

/**
 * **J04 · J05 · J08** — কর্মীর নিজের পাতা।
 *
 * ⭐⭐ এই ফাইলের সবচেয়ে জরুরি টেস্টগুলো ডেটা নিয়ে নয়, **সীমানা** নিয়ে:
 * একজন স্টাফ যেন কোনোভাবেই সহকর্মীর সংখ্যা না দেখে। পথে `:id` নেই বলেই
 * সেটা সম্ভব নয় — টেস্টগুলো ঠিক ওই নকশাটার পাহারা।
 */
let h: Harness;
let employeeId: number;
let otherId: number;
let deviceId: number;

const STAFF_EMAIL = 'rakib@test.local';
const STAFF_PASSWORD = 'staff-password-123';

const now = new Date();
const workDate = workDateOf(now);
const MS_PER_DAY = 86_400_000;

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** ওই দিনের একটা ACTIVE খণ্ড */
async function segment(
  forEmployee: number,
  day: Date,
  seconds: number,
): Promise<void> {
  const session = await h.prisma.workSession.create({
    data: {
      employeeId: forEmployee,
      deviceId,
      workDate: day,
      startedAt: day,
      endedAt: new Date(day.getTime() + seconds * 1000),
    },
  });

  await h.prisma.activitySegment.create({
    data: {
      sessionId: session.id,
      employeeId: forEmployee,
      deviceId,
      clientUuid: randomUUID(),
      workDate: day,
      state: 'active',
      startedAt: day,
      endedAt: new Date(day.getTime() + seconds * 1000),
      durationSec: seconds,
      countsAsWork: true,
    },
  });
}

const staffSession = () => loginReady(h, STAFF_EMAIL, STAFF_PASSWORD);

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
    data: {
      empCode: 'OX-001',
      fullName: 'Rakib Hasan',
      designation: 'Developer',
      policyId: policy.id,
      joinedOn: new Date('2026-01-05T00:00:00Z'),
    },
  });
  employeeId = employee.id;

  const other = await h.prisma.employee.create({
    data: { empCode: 'OX-002', fullName: 'Someone Else', policyId: policy.id },
  });
  otherId = other.id;

  const device = await h.prisma.device.create({
    data: {
      hostname: 'PC-07',
      windowsUsername: 'rakib',
      employeeId,
      machineGuid: randomUUID(),
      tokenHash: randomUUID(),
    },
  });
  deviceId = device.id;

  // ⚠️ স্টাফের পোর্টাল অ্যাকাউন্ট — `employeeId` বসানো, ওটাই সীমানা
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

describe('GET /me', () => {
  it('স্টাফ নিজের নাম ও ঘণ্টা দেখে', async () => {
    await segment(employeeId, workDate, 3 * 3600);

    const s = await staffSession();
    const res = await s.http.get('/api/v1/me').expect(200);

    expect(res.body.employee.fullName).toBe('Rakib Hasan');
    expect(res.body.employee.empCode).toBe('OX-001');
    expect(res.body.employee.designation).toBe('Developer');
    expect(res.body.progress.todayActiveSec).toBe(3 * 3600);
    expect(res.body.progress.monthlyTargetHours).toBe(208);
  });

  /**
   * ⭐ **"ছবি ৯০ দিন পর মুছে যায়" — প্রতিশ্রুতিটা কাগজে আছে, পাতাতেও
   * থাকা দরকার।** সংখ্যাটা সার্ভার থেকে আসে (`SCREENSHOT_RETENTION_DAYS`),
   * ওয়েবে হাতে লেখা নয় — নইলে একদিন নীতি বদলালে পাতাটা পুরোনো
   * প্রতিশ্রুতি দেখিয়ে যেত।
   */
  it('ছবি কতদিন থাকে সেটাও বলে', async () => {
    const s = await staffSession();
    const res = await s.http.get('/api/v1/me').expect(200);

    expect(res.body.screenshotRetentionDays).toBe(90);
  });

  it('সইয়ের তারিখ থাকলে দেখায়', async () => {
    await h.prisma.employee.update({
      where: { id: employeeId },
      data: { policySignedAt: new Date('2026-08-01T00:00:00Z') },
    });

    const s = await staffSession();
    const res = await s.http.get('/api/v1/me').expect(200);

    expect(res.body.policySignedAt).toBe('2026-08-01');
  });

  /**
   * ⚠️ owner-এর `users.employee_id` সাধারণত null — তাঁর জন্য এই পাতাটা
   * নেই, আর সেটা ভুল নয়। ৫০০ নয়, পরিষ্কার ৪০৩ আসা দরকার।
   */
  it('কর্মীর সারিতে বাঁধা নয় এমন অ্যাকাউন্টে ৪০৩', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await s.http.get('/api/v1/me').expect(403);
  });

  it('লগইন ছাড়া ৪০১', async () => {
    await h.http().get('/api/v1/me').expect(401);
  });
});

describe('GET /me/days', () => {
  it('প্রতিটা দিনের সারি আসে — কাজ না থাকলেও', async () => {
    const today = iso(workDate);
    const twoDaysAgo = iso(new Date(workDate.getTime() - 2 * MS_PER_DAY));

    // মাঝের দিনটা ইচ্ছাকৃতভাবে খালি
    await segment(employeeId, new Date(workDate.getTime() - 2 * MS_PER_DAY), 3600);
    await segment(employeeId, workDate, 2 * 3600);

    const s = await staffSession();
    const res = await s.http
      .get(`/api/v1/me/days?from=${twoDaysAgo}&to=${today}`)
      .expect(200);

    // ⚠️ তিনটে সারি, দুটো নয় — ফাঁকা দিনটাও থাকতে হবে, নইলে "ওইদিন কী
    //    হয়েছিল" প্রশ্নটাই পাতা থেকে উধাও হয়ে যেত
    expect(res.body).toHaveLength(3);
    // নতুন দিন আগে
    expect(res.body[0].workDate).toBe(today);
    expect(res.body[0].workedSec).toBe(2 * 3600);
    expect(res.body[1].workedSec).toBe(0);
    expect(res.body[2].workedSec).toBe(3600);
  });

  it('সংশোধন আলাদা করে দেখায়, আর credited-এ যোগ হয়', async () => {
    await segment(employeeId, workDate, 3600);

    const owner = await h.prisma.user.findFirstOrThrow({
      where: { role: UserRole.owner },
    });
    await h.prisma.timeAdjustment.create({
      data: {
        employeeId,
        workDate,
        deltaSec: 1800,
        cause: 'agent_down',
        reason: 'এজেন্ট বন্ধ ছিল',
        createdById: owner.id,
      },
    });

    const s = await staffSession();
    const day = iso(workDate);
    const res = await s.http
      .get(`/api/v1/me/days?from=${day}&to=${day}`)
      .expect(200);

    expect(res.body[0].workedSec).toBe(3600);
    expect(res.body[0].adjustmentSec).toBe(1800);
    expect(res.body[0].creditedSec).toBe(5400);
  });

  /**
   * ⭐⭐ **এই টেস্টটাই মডিউলটার কারণ।** পথে `:id` থাকলে স্টাফ সংখ্যাটা
   * বদলে সহকর্মীর দিন দেখে ফেলত। আইডি সেশন থেকে আসে, তাই সহকর্মীর
   * ডেটা চাওয়ার কোনো **উপায়ই নেই** — এখানে সেটাই মিলিয়ে দেখা হচ্ছে:
   * অন্য কর্মীর ঘণ্টা ডাটাবেসে আছে, তবু ফলাফলে আসে না।
   */
  it('সহকর্মীর ঘণ্টা কখনোই মেশে না', async () => {
    await segment(otherId, workDate, 8 * 3600);

    const s = await staffSession();
    const day = iso(workDate);
    const res = await s.http
      .get(`/api/v1/me/days?from=${day}&to=${day}`)
      .expect(200);

    expect(res.body[0].workedSec).toBe(0);
  });

  it('ভবিষ্যতের তারিখ চাইলে আজ পর্যন্তই', async () => {
    const s = await staffSession();
    const day = iso(workDate);
    const later = iso(new Date(workDate.getTime() + 10 * MS_PER_DAY));

    const res = await s.http
      .get(`/api/v1/me/days?from=${day}&to=${later}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].workDate).toBe(day);
  });

  /** ⚠️ ছাদ না থাকলে কেউ `from=2000-01-01` দিয়ে পুরো টেবিল টানত */
  it('৯২ দিনের বেশি চাইলে শেষ ৯২ দিন', async () => {
    const s = await staffSession();
    const res = await s.http
      .get(`/api/v1/me/days?from=2020-01-01&to=${iso(workDate)}`)
      .expect(200);

    expect(res.body).toHaveLength(92);
  });

  /** ⚠️ regex আকৃতি দেখে, ক্যালেন্ডার দেখে `parseWorkDate` — ৫০০ নয়, ৪০০ */
  it('অসম্ভব তারিখে ৪০০', async () => {
    const s = await staffSession();
    await s.http.get('/api/v1/me/days?from=2026-02-31&to=2026-02-31').expect(400);
  });

  it('তারিখ ছাড়া ৪০০', async () => {
    const s = await staffSession();
    await s.http.get('/api/v1/me/days').expect(400);
  });

  it('ম্যানেজারও নিজের পাতা পান না — কর্মীর সারিতে বাঁধা নন', async () => {
    const s = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    await s.http
      .get(`/api/v1/me/days?from=${iso(workDate)}&to=${iso(workDate)}`)
      .expect(403);
  });
});
