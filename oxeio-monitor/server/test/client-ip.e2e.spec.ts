import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createHarness,
  loginReady,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
} from './setup/harness';

/**
 * ⭐⭐⭐ **প্রক্সির পেছনে আসল IP** *(৬ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ **যে বাগটা এই ফাইল পাহারা দেয়, আর সেটা দুটো:**
 *
 * ১· **লগইনের তালা একটাই বালতি হয়ে গিয়েছিল।** থ্রটল প্রতি-IP গোনে
 *    (G116), কিন্তু Express প্রক্সিকে বিশ্বাস না করায় `req.ip` হতো
 *    **Caddy কন্টেইনারের** ঠিকানা — সবার জন্য একই। ফলে যেকোনো জায়গা
 *    থেকে ৫০টা ভুল লগইন করলে **মালিকসহ গোটা অফিস** তালাবন্ধ হতো।
 *
 * ২· **অডিট লগের IP অর্থহীন ছিল।** *"আমার স্ক্রিনশট কে দেখল"* (I08)
 *    প্রশ্নের উত্তরে প্রতিটা সারিতে একই ভেতরের ঠিকানা বসত। মাঠে গুনে
 *    দেখা: ৭ দিনের **৪৯৪টা সারির সবগুলোতেই** `172.18.0.4`।
 *
 * ⚠️⚠️ **কেন ইউনিট টেস্ট যথেষ্ট ছিল না:** `LoginThrottleService` নিজে
 * বরাবরই ঠিক ছিল আর `login-throttle-ip.spec.ts` সেটা প্রমাণ করত। ফাঁকটা
 * ছিল **জোড়ার মুখে** — Express কোন সংখ্যাটা `req.ip`-এ বসায়। ঠিক এই
 * ছাঁদেই এই রেপোতে বারবার বাগ হয়েছে: নিয়ম ঠিক, প্লাম্বিং ভুল।
 */
let h: Harness;
let owner: Session;

/** পরীক্ষার জন্য দুটো আলাদা পাবলিক IP (RFC 5737, ডকুমেন্টেশন-রেঞ্জ) */
const ALICE = '203.0.113.9';
const BOB = '198.51.100.4';

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
 * পে-রোল দেখা একটা **অডিটেড** ঘটনা (`payroll_view`) — তাই এটাই সবচেয়ে
 * সহজ পথ "সার্ভার কোন IP লিখল" জানার।
 */
async function viewPayrollFrom(ip: string): Promise<void> {
  await owner.http
    .get('/api/v1/payroll?month=2026-08')
    .set('X-Forwarded-For', ip)
    .expect(200);
}

const lastAuditIp = async (): Promise<string | null> => {
  const row = await h.prisma.auditLog.findFirst({
    where: { action: 'payroll_view' },
    orderBy: { occurredAt: 'desc' },
    select: { ipAddress: true },
  });
  return row?.ipAddress ?? null;
};

describe('প্রক্সির পেছনে আসল IP', () => {
  /**
   * ⭐⭐⭐ **এই ফাইলের মূল টেস্ট।** প্রক্সি যে IP পাঠায়, অডিটে সেটাই বসে —
   * প্রক্সির নিজের ঠিকানা নয়।
   */
  it('⭐ `X-Forwarded-For`-এর IP অডিটে বসে', async () => {
    await viewPayrollFrom(ALICE);

    expect(await lastAuditIp()).toBe(ALICE);
  });

  /**
   * ⚠️⚠️ **দ্বিতীয় টেস্টটাই আসল পাহারা।** প্রথমটা একা থাকলে একটা ধ্রুবক
   * ফেরত দিয়েও সবুজ থাকা যেত। দুটো আলাদা IP আলাদা সারি লেখে কি না —
   * সেটাই প্রমাণ করে সংখ্যাটা সত্যিই ক্লায়েন্টের।
   */
  it('⭐ আলাদা ক্লায়েন্ট আলাদা IP লেখে', async () => {
    await viewPayrollFrom(ALICE);
    const first = await lastAuditIp();

    await viewPayrollFrom(BOB);
    const second = await lastAuditIp();

    expect(first).toBe(ALICE);
    expect(second).toBe(BOB);
    expect(first).not.toBe(second);
  });

  /**
   * ⚠️⚠️ **একটার বেশি হপ বিশ্বাস করা হয় না** — আর এটাই নিরাপত্তার
   * সীমারেখা। `trust proxy` যত হপ বিশ্বাস করে, ক্লায়েন্ট তত গভীরে
   * `X-Forwarded-For` জাল করতে পারে; তখন সে নিজের IP নিজেই বেছে নিয়ে
   * লগইনের তালা এড়াত।
   *
   * ⭐ ক্লায়েন্ট নিজে একটা ভুয়া হপ যোগ করলে Express **ডান দিক থেকে
   * একটাই** ধাপ পিছিয়ে পড়ে — অর্থাৎ ক্লায়েন্টের নিজের বসানো প্রথম
   * নামটা নয়, আসল সংযোগের ঠিক আগেরটা।
   */
  it('⭐ জাল করা বাড়তি হপ বিশ্বাস করা হয় না', async () => {
    await owner.http
      .get('/api/v1/payroll?month=2026-08')
      // ক্লায়েন্ট দাবি করছে সে ১০.০.০.১, আর প্রক্সি লিখেছে তার আসল IP
      .set('X-Forwarded-For', `10.0.0.1, ${ALICE}`)
      .expect(200);

    expect(await lastAuditIp()).toBe(ALICE);
  });

  /**
   * ⚠️ হেডার না থাকলে সরাসরি সংযোগের ঠিকানাই — ডেভেলপমেন্টে আর টেস্টে
   *    ঠিক এটাই ঘটে, আর সেখানে কিছু ভাঙা উচিত নয়।
   */
  it('হেডার না থাকলে সরাসরি সংযোগের ঠিকানা', async () => {
    await owner.http.get('/api/v1/payroll?month=2026-08').expect(200);

    const ip = await lastAuditIp();
    expect(ip).not.toBeNull();
    expect(ip).not.toBe(ALICE);
  });
});
