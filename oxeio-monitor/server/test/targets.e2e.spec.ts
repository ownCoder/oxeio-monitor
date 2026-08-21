import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TargetsService } from '../src/targets/targets.service';
import { JOB_NUMBER_START } from '../src/targets/targets.rules';
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
  type Session,
} from './setup/harness';

/**
 * **ডিজাইন-টার্গেট — জমা ও বণ্টন** *(২২ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ এই ফাইলের সবচেয়ে জরুরি দুটো দাবি:
 * ১· **গবেষক জমা দিতে পারেন, সাধারণ ডিজাইনার পারেন না** — আর দুজনেরই
 *    পোর্টাল রোল `employee`, তাই সাধারণ রোল-পাহারা এটা করতে পারত না।
 * ২· **একটা টার্গেট কখনো দুজনের হাতে পড়ে না** — পড়লে দুজন একই ডিজাইন
 *    বানাতেন, আর কেউ ধরতেই পারত না।
 */

let h: Harness;

const URL_OF = (n: number) =>
  `https://www.amazon.com/dp/B${String(n).padStart(9, '0')}`;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
});

/** কর্মী + পোর্টাল অ্যাকাউন্ট — ধরনসহ */
async function staff(
  empCode: string,
  staffType: 'designer' | 'researcher',
  email: string,
) {
  const employee = await h.prisma.employee.create({
    data: { empCode, fullName: empCode, staffType, status: 'active' },
  });

  await h.prisma.user.create({
    data: {
      email,
      fullName: empCode,
      passwordHash: await hashPassword('staff-password-123'),
      role: 'employee',
      employeeId: employee.id,
      // ⚠️ `false` না দিলে লগইনের পর "পাসওয়ার্ড বদলান" দেয়ালে আটকে যেত
      mustChangePw: false,
    },
  });

  return employee;
}

const post = (session: Session, path: string, body: unknown) =>
  session.http.post(path).set('X-CSRF-Token', session.csrf).send(body);

// ════════════════════════════════════════════════════════════════════════════

describe('POST /design-targets/bulk — কে জমা দিতে পারেন', () => {
  /**
   * ⭐⭐ **গোটা ফিচারের সবচেয়ে সূক্ষ্ম পাহারা।** গবেষক ও ডিজাইনার
   * দুজনেরই পোর্টাল রোল `employee` — তাই `@Roles()` দিয়ে একজনকে ঢোকানো
   * আর অন্যজনকে আটকানো **সম্ভবই নয়**। অনুমতিটা কাজের ধরন ধরে।
   */
  it('গবেষক পারেন', async () => {
    await staff('OX-R1', 'researcher', 'r1@test.local');
    const session = await loginReady(h, 'r1@test.local', 'staff-password-123');

    const res = await post(session, '/api/v1/design-targets/bulk', {
      text: [URL_OF(1), URL_OF(2)].join('\n'),
    }).expect(201);

    expect(res.body.added).toBe(2);
    expect(res.body.poolSize).toBe(2);
  });

  /** ⚠️⚠️ একই রোল, আলাদা ধরন — আর ফলটাও আলাদা হতে হবে */
  it('ডিজাইনার পারেন না, যদিও রোল একই', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    const session = await loginReady(h, 'd1@test.local', 'staff-password-123');

    await post(session, '/api/v1/design-targets/bulk', {
      text: URL_OF(1),
    }).expect(403);
  });

  it('মালিক ও ম্যানেজার পারেন', async () => {
    for (const [email, password] of [
      [OWNER_EMAIL, OWNER_PASSWORD],
      [MANAGER_EMAIL, MANAGER_PASSWORD],
    ]) {
      const session = await loginReady(h, email, password);
      await post(session, '/api/v1/design-targets/bulk', {
        text: URL_OF(email === OWNER_EMAIL ? 10 : 20),
      }).expect(201);
    }
  });
});

describe('POST /design-targets/bulk — ডুপ্লিকেট', () => {
  /**
   * ⚠️⚠️ **৫০০টার মধ্যে একটা পুরোনো ASIN থাকলেই গোটা ব্যাচ বাতিল** —
   * `skipDuplicates` ছাড়া ঠিক সেটাই হতো, আর গবেষকের দিনের কাজ জমা
   * হতো না।
   */
  it('আগের ব্যাচে থাকা ASIN আবার দিলে ব্যাচ বাঁচে', async () => {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    await post(owner, '/api/v1/design-targets/bulk', {
      text: [URL_OF(1), URL_OF(2)].join('\n'),
    }).expect(201);

    const res = await post(owner, '/api/v1/design-targets/bulk', {
      text: [URL_OF(2), URL_OF(3)].join('\n'),
    }).expect(201);

    expect(res.body.added).toBe(1);
    expect(res.body.alreadyKnown).toBe(1);
    expect(res.body.poolSize).toBe(3);
  });

  /** ⭐ একই পণ্যের আলাদা URL — ডুপ্লিকেট হিসেবেই ধরা পড়ে */
  it('একই ASIN-এর অন্য রূপ দিলেও নতুন সারি নয়', async () => {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    await post(owner, '/api/v1/design-targets/bulk', {
      text: 'https://www.amazon.com/dp/B0DJBD22LW',
    }).expect(201);

    const res = await post(owner, '/api/v1/design-targets/bulk', {
      text: 'https://www.amazon.co.uk/Funny-Cat/dp/B0DJBD22LW/ref=sr_1_3?th=1',
    }).expect(201);

    expect(res.body.added).toBe(0);
    expect(await h.prisma.designTarget.count()).toBe(1);
  });

  /** ⚠️ বাতিল লাইনগুলো কারণসহ ফেরত — নইলে কোনগুলো হারাল কেউ জানত না */
  it('বাতিল লাইন কারণসহ ফেরত আসে', async () => {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await post(owner, '/api/v1/design-targets/bulk', {
      text: [URL_OF(1), 'https://etsy.com/listing/9', 'https://amzn.to/x'].join('\n'),
    }).expect(201);

    expect(res.body.added).toBe(1);
    expect(res.body.rejected).toHaveLength(2);
    expect(res.body.rejected[0].reason).toBe('not_amazon');
    expect(res.body.rejected[1].reason).toBe('short_link');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('বণ্টন', () => {
  async function seedPool(count: number) {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: Array.from({ length: count }, (_, i) => URL_OF(i + 1)).join('\n'),
    }).expect(201);
  }

  /**
   * ⚠️⚠️ **একটা টার্গেট কখনো দুজনের হাতে পড়ে না।** পড়লে দুজন একই ডিজাইন
   * বানাতেন — আর সেটা ধরা পড়ত কেবল ডেলিভারির সময়।
   */
  it('প্রত্যেকে ৩০টা, আর কোনো টার্গেট দুবার নয়', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    await staff('OX-D2', 'designer', 'd2@test.local');
    await seedPool(100);

    await h.app.get(TargetsService).distribute();

    const rows = await h.prisma.designTarget.findMany({
      where: { status: 'assigned' },
      select: { id: true, assignedToId: true, jobNumber: true },
    });

    expect(rows).toHaveLength(60);
    // ⚠️ প্রতিটা সারি ঠিক একজনের — `id` অনন্য, তাই সংখ্যাটাই দাবি
    expect(new Set(rows.map((r) => r.id)).size).toBe(60);

    const perDesigner = new Map<number | null, number>();
    for (const r of rows) {
      perDesigner.set(r.assignedToId, (perDesigner.get(r.assignedToId) ?? 0) + 1);
    }
    expect([...perDesigner.values()]).toEqual([30, 30]);
  });

  /**
   * ⚠️⚠️ **কাজের নম্বর ১০ লাখের উপরে, আর কখনো দুবার নয়।** নিচে নামলে
   * ডিজাইনারদের পুরোনো ফাইল (সবচেয়ে বড় ৯,৭৩,০৬৫) ভুল করে টার্গেট
   * বন্ধ করে দিত।
   */
  it('কাজের নম্বর অনন্য আর ১০ লাখের উপরে', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    await seedPool(40);

    await h.app.get(TargetsService).distribute();

    const numbers = (
      await h.prisma.designTarget.findMany({
        where: { status: 'assigned' },
        select: { jobNumber: true },
      })
    ).map((r) => r.jobNumber!);

    expect(numbers).toHaveLength(30);
    expect(new Set(numbers).size).toBe(30);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(JOB_NUMBER_START);
  });

  /** ⚠️ হাত ভরা থাকলে আর দেওয়া হয় না — নইলে সপ্তাহে দুশো জমত */
  it('দ্বিতীয়বার চালালে কিছুই যোগ হয় না', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    await seedPool(100);

    const targets = h.app.get(TargetsService);
    await targets.distribute();
    const second = await targets.distribute();

    expect(second.assigned).toBe(0);
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned' } })).toBe(30);
  });

  /** ⚠️ পুল খালি হলেও ক্র্যাশ নয় — গবেষক ছুটিতে থাকলে এটাই ঘটে */
  it('পুল খালি হলে চুপচাপ কিছুই হয় না', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');

    expect((await h.app.get(TargetsService).distribute()).assigned).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('ফাইলের নাম থেকে শেষ হওয়া', () => {
  /**
   * ⭐⭐ কোনো বোতাম ছাড়াই — ডিজাইনার বরাদ্দ নম্বরটা ফাইলের নামে বসালেই
   * টার্গেট বন্ধ।
   */
  it('নিজের নম্বরে নিজের টার্গেট বন্ধ হয়', async () => {
    const designer = await staff('OX-D1', 'designer', 'd1@test.local');
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', { text: URL_OF(1) }).expect(201);

    const targets = h.app.get(TargetsService);
    await targets.distribute();

    const row = await h.prisma.designTarget.findFirstOrThrow();
    const closed = await targets.closeByJobNumbers(
      designer.id,
      [String(row.jobNumber)],
      new Date(),
    );

    expect(closed).toBe(1);
    const after = await h.prisma.designTarget.findFirstOrThrow();
    expect(after.status).toBe('done');
    expect(after.completedVia).toBe('filename');
  });

  /**
   * ⚠️⚠️ **একজনের ফাইল আরেকজনের টার্গেট বন্ধ করতে পারে না।** নম্বর
   * দুজনের কাছে থাকার কথা নয়, কিন্তু "কথা নয়" আর "পারবে না" এক নয়।
   */
  it('অন্যের নম্বর দিয়ে কিছু বন্ধ হয় না', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    const other = await staff('OX-D2', 'designer', 'd2@test.local');
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', { text: URL_OF(1) }).expect(201);

    const targets = h.app.get(TargetsService);
    await targets.distribute();

    const row = await h.prisma.designTarget.findFirstOrThrow();
    // ⚠️ সারিটা OX-D1-এর (কর্মী-কোডের ক্রমে প্রথম), কিন্তু বন্ধ করার
    //    চেষ্টা করছেন OX-D2
    const closed = await targets.closeByJobNumbers(
      other.id,
      [String(row.jobNumber)],
      new Date(),
    );

    expect(closed).toBe(0);
    expect((await h.prisma.designTarget.findFirstOrThrow()).status).toBe('assigned');
  });
});
