import { createHash, randomBytes } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';

import { AppCategoryService } from '../../src/activity/app-category.service';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { workDateOf } from '../../src/agent/util/dhaka-time';
import { PrismaService } from '../../src/prisma/prisma.service';

export const OWNER_EMAIL = 'owner@test.local';
export const OWNER_PASSWORD = 'owner-password-123';
export const MANAGER_EMAIL = 'manager@test.local';
export const MANAGER_PASSWORD = 'manager-password-123';

/** supertest-এর cookie-জার সহ agent */
export type HttpAgent = ReturnType<typeof request.agent>;

export interface Harness {
  app: INestApplication;
  prisma: PrismaClient;
  http: () => HttpAgent;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    // agent() cookie জারে রাখে — লগইনের পর পরের রিকোয়েস্টে নিজেই পাঠায়
    http: () => request.agent(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

/**
 * প্রতিটি টেস্টের আগে ডাটাবেস পরিষ্কার করে ন্যূনতম fixture বসায়।
 * টেবিলগুলো নির্ভরতার ক্রমে TRUNCATE হয় (CASCADE দিয়ে একবারেই)।
 */
export async function resetDatabase(
  prisma: PrismaClient,
  app?: INestApplication,
): Promise<void> {
  /**
   * ⚠️⚠️ **R21-এর তিনটে টেবিল এখানে ছিল না, আর ব্যর্থতাটা আসত সম্পূর্ণ
   * অন্য জায়গা থেকে।** deposit_policy-তে employees-এর কোনো FK নেই, তাই
   * CASCADE-এও সেটা বেঁচে যেত — এক টেস্টের বসানো নিয়ম পরের টেস্টে রয়ে
   * যেত, ensureLedger আবার খাতা ভরত, আর ফল হতো order-নির্ভর ব্যর্থতা:
   * একই কোডে একবার ১২টা পাস, পরেরবার ৪টা।
   *
   * ⭐ নতুন টেবিল যোগ করলে এই তালিকাতেও বসাতে হয়। ভুলে গেলে ধরা পড়ে
   * অনেক দূরে, অন্য কারো টেস্টে — আর কারণটা খুঁজে পাওয়া কঠিন।
   *
   * ⚠️⚠️ **যেসব টেবিলে employees-এর FK নেই, সেগুলোই আসল ঝুঁকি** —
   * CASCADE ওদের ছোঁয় না, তাই তালিকা থেকে বাদ পড়লে ওরা টেস্টের পর
   * টেস্ট বেঁচে থাকে। এখন পর্যন্ত এমন দুটো: deposit_policy আর
   * month_closures (একটা বন্ধ মাস পরের টেস্টে সম্পাদনা আটকে দিত)।
   *
   * মিলিয়ে দেখার উপায় — schema-র @@map-গুলোর সাথে এই তালিকা:
   *   grep -o '@@map("[a-z_]*")' prisma/schema.prisma
   */
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      time_adjustments, audit_log, alerts, screenshots, app_usage, events,
      activity_segments, work_sessions, enrollment_codes, devices,
      daily_summary, monthly_summary, users, employees, work_policies,
      app_categories, holidays, agent_versions, settings,
      deposit_policy, security_deposits, deposit_settlements,
      leaves, month_closures
    RESTART IDENTITY CASCADE
  `);

  // ⚠️ `app_categories` TRUNCATE ... RESTART IDENTITY-তে id-ও রিসেট হয়।
  //    ক্যাশে পুরোনো id বসে থাকলে পরের ingest foreign key ভাঙত — টেস্টে
  //    সেটা '৫০০' হয়ে আসত, আর কারণ খোঁজা কঠিন হতো।
  app?.get(AppCategoryService).invalidate();

  const policy = await prisma.workPolicy.create({
    data: {
      name: 'Standard',
      monthlyTargetHours: 208,
      expectedWorkdays: 26,
      weeklyOffDay: 5,
      screenshotFrom: '07:00',
      screenshotTo: '23:00',
      idleThresholdSec: 60,
      slotMinutes: 5,
      timezone: 'Asia/Dhaka',
    },
  });

  await prisma.user.create({
    data: {
      email: OWNER_EMAIL,
      passwordHash: await hashPassword(OWNER_PASSWORD),
      fullName: 'Test Owner',
      role: UserRole.owner,
      mustChangePw: true,
    },
  });

  await prisma.user.create({
    data: {
      email: MANAGER_EMAIL,
      passwordHash: await hashPassword(MANAGER_PASSWORD),
      fullName: 'Test Manager',
      role: UserRole.manager,
      mustChangePw: false,
    },
  });

  return void policy;
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

// ── auth helpers ────────────────────────────────────────────────────────────

export interface Session {
  http: HttpAgent;
  /** double-submit CSRF টোকেন — প্রতিটি state-বদলানো রিকোয়েস্টে হেডারে লাগে */
  csrf: string;
}

/** cookie হেডার থেকে একটা নির্দিষ্ট cookie-র মান তুলে আনে */
export function readCookie(
  setCookie: string[] | undefined,
  name: string,
): string | undefined {
  const line = (setCookie ?? []).find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0]?.split('=')[1];
}

export async function login(
  harness: Harness,
  email: string,
  password: string,
): Promise<Session> {
  const http = harness.http();
  const res = await http
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);

  const csrf = readCookie(
    res.headers['set-cookie'] as unknown as string[],
    'oxeio_csrf',
  );
  if (!csrf) throw new Error('লগইনের পরেও CSRF cookie আসেনি');

  return { http, csrf };
}

/** পাসওয়ার্ড বদলে `mustChangePw` ছাড়িয়ে সম্পূর্ণ ব্যবহারযোগ্য সেশন */
export async function loginReady(
  harness: Harness,
  email: string,
  password: string,
): Promise<Session> {
  const session = await login(harness, email, password);

  const me = await session.http.get('/api/v1/auth/me').expect(200);
  if (me.body.mustChangePassword !== true) return session;

  const changed = await session.http
    .post('/api/v1/auth/change-password')
    .set('X-CSRF-Token', session.csrf)
    .send({ currentPassword: password, newPassword: `${password}-changed` })
    .expect(204);

  const csrf =
    readCookie(
      changed.headers['set-cookie'] as unknown as string[],
      'oxeio_csrf',
    ) ?? session.csrf;

  return { http: session.http, csrf };
}

// ── agent helpers ───────────────────────────────────────────────────────────

export interface EnrolledDevice {
  token: string;
  deviceId: number;
  employeeId: number;
  configVersion: string;
}

export async function createEmployeeWithCode(
  prisma: PrismaClient,
  empCode = 'OX-001',
): Promise<{ employeeId: number; code: string }> {
  const policy = await prisma.workPolicy.findFirstOrThrow();
  const owner = await prisma.user.findFirstOrThrow({
    where: { role: UserRole.owner },
  });

  const employee = await prisma.employee.create({
    data: {
      empCode,
      fullName: 'Rakib Hasan',
      policyId: policy.id,
      joinedOn: new Date('2026-01-05T00:00:00Z'),
    },
  });

  const code = randomBytes(6).toString('hex').toUpperCase();
  await prisma.enrollmentCode.create({
    data: {
      codeHash: createHash('sha256').update(code).digest('hex'),
      employeeId: employee.id,
      createdById: owner.id,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });

  return { employeeId: employee.id, code };
}

export async function enrollDevice(
  harness: Harness,
  code: string,
  overrides: Record<string, unknown> = {},
): Promise<EnrolledDevice> {
  const res = await harness
    .http()
    .post('/api/v1/agent/enroll')
    .send({
      enrollmentCode: code,
      hostname: 'PC-07',
      windowsUsername: 'rakib',
      machineGuid: 'guid-test-001',
      osVersion: 'Windows 11',
      agentVersion: '1.0.0',
      monitors: 2,
      ...overrides,
    })
    .expect(201);

  return {
    token: res.body.deviceToken,
    deviceId: res.body.deviceId,
    employeeId: res.body.employee.id,
    configVersion: res.body.configVersion,
  };
}

export const iso = (d: Date): string => d.toISOString();
export const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);

/**
 * আজকের **ঢাকা-দিনের ভেতরে** থাকা একটা সাম্প্রতিক জানালা।
 *
 * ⚠️ `minutesAgo(30)` দিয়ে টেস্ট লেখা যায় না, কারণ ঢাকার মধ্যরাতের পরপর
 * "৩০ মিনিট আগে" মানে **গতকাল**। তখন তিনটে টেস্ট ভাঙত, আর কারণটা কোডে
 * নয় — ঘড়িতে:
 *
 * - আজকের হিসাব ০ আসত (সেগমেন্টটা গতকালের)
 * - সেশন `logoff` নয়, `day_rollover` হয়ে বন্ধ হতো
 * - সেগমেন্ট মধ্যরাতে **দু-ভাগ** হতো, আর `findFirstOrThrow` প্রথম ভাগটা
 *   ফেরত দিত — যার শেষ ঠিক ০০:০০
 *
 * রোজ রাত ১২টার পর আধঘণ্টা CI লাল থাকা মানে আসল ভাঙন আর ঘড়ির ভাঙন আলাদা
 * করা যেত না। তাই জানালাটা মধ্যরাতে **ছেঁটে** দেওয়া হয়, আর টেস্ট
 * হার্ডকোড করা ৬০০ নয়, ফেরত আসা `durationSec`-ই মেলায়।
 */
export function todayWindow(seconds: number): {
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
} {
  // ১ সেকেন্ড মার্জিন — endedAt "এখন"-এর ঠিক পরে হয়ে গেলে সার্ভার
  // ভবিষ্যতের টাইমস্ট্যাম্প দেখত
  const endedAt = new Date(Date.now() - 1_000);
  const dhakaMidnight = workDateOf(endedAt).getTime() - 6 * 3_600_000;

  const startedAt = new Date(
    Math.max(endedAt.getTime() - seconds * 1_000, dhakaMidnight + 1_000),
  );

  return {
    startedAt,
    endedAt,
    durationSec: Math.round((endedAt.getTime() - startedAt.getTime()) / 1_000),
  };
}
