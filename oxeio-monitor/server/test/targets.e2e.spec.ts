import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workDateOf } from '../src/agent/util/dhaka-time';
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
/**
 * কর্মী + পোর্টাল অ্যাকাউন্ট।
 *
 * ⚠️⚠️ `staffType` আর `role` **দুটোই** নেওয়া হয়, আর সেটাই এই
 * হেল্পারের গোটা কথা: ওরা আলাদা জিনিস। `staffType` বলে **কী কাজ
 * করেন**, `role` বলে **কী দেখতে পান**। নিচের টেস্টগুলো ইচ্ছাকৃতভাবে
 * দুটোকে মিলিয়ে-অমিলিয়ে দেখে।
 */
async function staff(
  empCode: string,
  staffType: 'designer' | 'researcher' | 'manager',
  email: string,
  role: 'employee' | 'researcher' = 'employee',
) {
  const employee = await h.prisma.employee.create({
    data: { empCode, fullName: empCode, staffType, status: 'active' },
  });

  await h.prisma.user.create({
    data: {
      email,
      fullName: empCode,
      passwordHash: await hashPassword('staff-password-123'),
      role,
      employeeId: employee.id,
      // ⚠️ `false` না দিলে লগইনের পর "পাসওয়ার্ড বদলান" দেয়ালে আটকে যেত
      mustChangePw: false,
    },
  });

  return employee;
}

const post = (session: Session, path: string, body: object) =>
  session.http.post(path).set('X-CSRF-Token', session.csrf).send(body);

// ════════════════════════════════════════════════════════════════════════════

describe('POST /design-targets/bulk — কে জমা দিতে পারেন', () => {
  /**
   * ⭐⭐ **এই describe-টা ২৫ আগস্ট উল্টে গেছে, আর ইতিহাসটা কাজে লাগে।**
   *
   * আগে এখানে লেখা ছিল: *"গবেষক ও ডিজাইনার দুজনেরই পোর্টাল রোল
   * `employee` — তাই `@Roles()` দিয়ে একজনকে ঢোকানো আর অন্যজনকে আটকানো
   * **সম্ভবই নয়**। অনুমতিটা কাজের ধরন ধরে।"*
   *
   * ⭐ মালিক সেই ভিতটাই সরিয়ে দিলেন — *"researcher and designer same kaj
   * kore na, tai eder access o same hobe na"*। এখন গবেষক একটা **ভূমিকা**,
   * আর অনুমতিটা ভূমিকা ধরেই।
   */
  it('গবেষক (রোল) পারেন', async () => {
    await staff('OX-R1', 'researcher', 'r1@test.local', 'researcher');
    const session = await loginReady(h, 'r1@test.local', 'staff-password-123');

    const res = await post(session, '/api/v1/design-targets/bulk', {
      text: [URL_OF(1), URL_OF(2)].join('\n'),
    }).expect(201);

    expect(res.body.added).toBe(2);
    expect(res.body.poolSize).toBe(2);
  });

  it('ডিজাইনার পারেন না', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    const session = await loginReady(h, 'd1@test.local', 'staff-password-123');

    await post(session, '/api/v1/design-targets/bulk', {
      text: URL_OF(1),
    }).expect(403);
  });

  /**
   * ⚠️⚠️ **কাজের ধরন আর অধিকার এক জিনিস নয় — এই টেস্টটাই সেই সীমানা।**
   *
   * কারো `staff_type` "গবেষক" অথচ পোর্টালের ভূমিকা এখনো `employee` হলে
   * তিনি ঢুকতে পারবেন **না**। ⭐ শোনায় কড়া, কিন্তু উল্টোটা আরও খারাপ:
   * তাহলে অধিকার দুই টেবিলে ভাগ হয়ে থাকত, আর ঠিক সেটাই ২৪ আগস্টের
   * গণ্ডগোলটা সম্ভব করেছিল (ADR-038)।
   *
   * ⚠️ মালিক যাতে অন্ধকারে না থাকেন, Settings → Staff-এ দুটো না মিললে
   * একটা বার্তা ওঠে — পর্দা চুপ করে থাকে না।
   */
  it('⭐⭐ ধরন গবেষক অথচ ভূমিকা staff — পারেন না', async () => {
    await staff('OX-R2', 'researcher', 'r2@test.local', 'employee');
    const session = await loginReady(h, 'r2@test.local', 'staff-password-123');

    await post(session, '/api/v1/design-targets/bulk', {
      text: URL_OF(1),
    }).expect(403);
  });

  /** ⭐ উল্টোটাও সত্যি — ভূমিকাই শেষ কথা, ধরন নয় */
  it('ভূমিকা গবেষক অথচ ধরন ডিজাইনার — পারেন', async () => {
    await staff('OX-D2', 'designer', 'd2b@test.local', 'researcher');
    const session = await loginReady(h, 'd2b@test.local', 'staff-password-123');

    await post(session, '/api/v1/design-targets/bulk', {
      text: URL_OF(1),
    }).expect(201);
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

describe('ফাইলের নাম থেকে "কাজ শুরু" ধরা', () => {
  /**
   * ⭐⭐ কোনো বোতাম ছাড়াই — ডিজাইনার বরাদ্দ নম্বরটা ফাইলের নামে বসালেই
   * টার্গেট বন্ধ।
   */
  /**
   * ⚠️⚠️ **এটা "শেষ" নয়, "শুরু"** — আর তফাতটাই এখানকার মূল কথা *(সারানো
   * ২৩ আগস্ট)*। শিরোনামে নম্বরটা দেখা যায় ফাইল **খোলার** মুহূর্তে; আগে
   * ওটাকে "শেষ" ধরায় টার্গেট খোলামাত্র বন্ধ হয়ে যেত।
   */
  it('নিজের নম্বরে নিজের টার্গেটে "শুরু" চিহ্ন বসে, বন্ধ হয় না', async () => {
    const designer = await staff('OX-D1', 'designer', 'd1@test.local');
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', { text: URL_OF(1) }).expect(201);

    const targets = h.app.get(TargetsService);
    await targets.distribute();

    const row = await h.prisma.designTarget.findFirstOrThrow();
    const closed = await targets.markStartedByJobNumbers(
      designer.id,
      [String(row.jobNumber)],
      new Date(),
    );

    expect(closed).toBe(1);
    const after = await h.prisma.designTarget.findFirstOrThrow();
    // ⭐ এখনো ডিজাইনারের হাতেই — শেষ বলেন তিনি নিজে
    expect(after.status).toBe('assigned');
    expect(after.startedAt).not.toBeNull();
    expect(after.completedAt).toBeNull();
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
    const closed = await targets.markStartedByJobNumbers(
      other.id,
      [String(row.jobNumber)],
      new Date(),
    );

    expect(closed).toBe(0);
    // ⚠️ চিহ্নটাই বসেনি — অন্যের ফাইল কিছুই ছুঁতে পারে না
    expect((await h.prisma.designTarget.findFirstOrThrow()).startedAt).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('দিন শেষে পুলে ফেরত', () => {
  async function seed(count: number) {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: Array.from({ length: count }, (_, i) => URL_OF(i + 1)).join(BR),
    }).expect(201);
  }

  const TODAY = new Date();
  /** ⚠️ নতুন লাইন — সরাসরি লিখলে escaping-এ ভুল হয় */
  const BR = String.fromCharCode(10);

  /**
   * ⭐⭐ মালিকের নিয়ম *(২২ আগস্ট)*: *"din sheshe baki design gula amar
   * main list e back asbe"* — ৩০টা দেওয়া, ১৫টা করা, বাকি ১৫ ফেরত।
   */
  it('না-করা টার্গেট পুলে ফেরে', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    await seed(40);

    const targets = h.app.get(TargetsService);
    await targets.distribute();
    expect(await h.prisma.designTarget.count({ where: { status: 'assigned' } })).toBe(30);

    const { returned } = await targets.returnUnworked(workDateOf(TODAY));

    expect(returned).toBe(30);
    expect(await h.prisma.designTarget.count({ where: { status: 'pool' } })).toBe(40);
    // ⚠️ কারো হাতে আর কিছু নেই
    expect(
      await h.prisma.designTarget.count({ where: { assignedToId: { not: null } } }),
    ).toBe(0);
  });

  /**
   * ⚠️⚠️ **এই ফাইলের সবচেয়ে জরুরি টেস্ট।** কেউ একটা ডিজাইন খুলে কাজ শুরু
   * করেছেন কিন্তু আজ শেষ করতে পারেননি — সরল নিয়মে ওটাও ফিরে যেত, আর কাল
   * অন্য কারো হাতে পড়ত। দুজনের শ্রম নষ্ট, আর কেউ বুঝতই না কেন।
   */
  it('আজ ছোঁয়া টার্গেট ফেরত যায় না', async () => {
    const designer = await staff('OX-D1', 'designer', 'd1@test.local');
    await seed(40);

    const targets = h.app.get(TargetsService);
    await targets.distribute();

    const mine = await h.prisma.designTarget.findMany({
      where: { assignedToId: designer.id },
      select: { id: true, jobNumber: true },
      take: 2,
    });

    // ⭐ "ছোঁয়া" = ফাইলটা খোলা হয়েছে, অর্থাৎ নম্বরটা আজকের ক্রেডিটে আছে
    await h.prisma.designCredit.create({
      data: {
        employeeId: designer.id,
        designId: String(mine[0].jobNumber),
        firstWorkDate: workDateOf(TODAY),
      },
    });

    const { returned } = await targets.returnUnworked(workDateOf(TODAY));

    expect(returned).toBe(29);
    const kept = await h.prisma.designTarget.findUniqueOrThrow({
      where: { id: mine[0].id },
    });
    expect(kept.status).toBe('assigned');
    expect(kept.assignedToId).toBe(designer.id);
  });

  /**
   * ⚠️⚠️ **কাজের নম্বর মুছে যায় না।** নম্বরটা ASIN-এর, বরাদ্দের নয় —
   * মুছলে সিরিয়াল অকারণে ফুরাত, আর পুরোনো ফাইলের নাম কোনোদিন কিছুর
   * সাথে মিলত না।
   */
  it('ফেরত এলেও নম্বর একই থাকে, আর পরের বার নতুন নম্বর বসে না', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    await seed(40);

    const targets = h.app.get(TargetsService);
    await targets.distribute();

    const before = await h.prisma.designTarget.findMany({
      where: { status: 'assigned' },
      select: { id: true, jobNumber: true },
      orderBy: { id: 'asc' },
    });

    await targets.returnUnworked(workDateOf(TODAY));
    await targets.distribute();

    const after = await h.prisma.designTarget.findMany({
      where: { id: { in: before.map((b) => b.id) } },
      select: { id: true, jobNumber: true },
      orderBy: { id: 'asc' },
    });

    const byId = new Map(after.map((a) => [a.id, a.jobNumber]));
    for (const b of before) expect(byId.get(b.id)).toBe(b.jobNumber);
  });

  /** ⚠️ শেষ হয়ে যাওয়া টার্গেট ফেরত যায় না — ওটা আর কারো কাজ নয় */
  it('শেষ ও বাদ দেওয়া টার্গেট ছোঁয়া হয় না', async () => {
    const designer = await staff('OX-D1', 'designer', 'd1@test.local');
    await seed(40);

    const targets = h.app.get(TargetsService);
    await targets.distribute();

    const mine = await h.prisma.designTarget.findMany({
      where: { assignedToId: designer.id },
      select: { id: true },
      take: 2,
    });
    /**
     * ⚠️ তৃতীয় প্যারামিটার = **কে চেপেছেন** *(২৩ আগস্ট)*। এই টেস্টের
     * প্রশ্ন "কে" নয়, "কতগুলো ফেরত যায়" — তাই যেকোনো বৈধ user চলবে,
     * কিন্তু FK মানতে হবে বলে ডাটাবেস থেকেই নেওয়া হয়।
     */
    const anyUser = await h.prisma.user.findFirstOrThrow({ select: { id: true } });
    await targets.markDone(designer.id, mine[0].id, anyUser.id);
    await targets.skip(designer.id, mine[1].id, 'not_found');

    const { returned } = await targets.returnUnworked(workDateOf(TODAY));

    expect(returned).toBe(28);
    expect(await h.prisma.designTarget.count({ where: { status: 'done' } })).toBe(1);
    expect(await h.prisma.designTarget.count({ where: { status: 'skipped' } })).toBe(1);
  });
});

describe('শুরু হওয়া টার্গেট', () => {
  /**
   * ⚠️⚠️ **কাজ চলছে এমন টার্গেট রাতে ফেরত যায় না।** "আজ ছোঁয়া" শর্তটা
   * এর চেয়ে সংকীর্ণ ছিল: তিন দিন ধরে চলা কাজ যেদিন কেউ ফাইলটা খোলেনি,
   * সেদিনই ফেরত চলে যেত — আর কাল অন্য কারো হাতে পড়ত।
   */
  it('আগে শুরু হওয়া টার্গেট পরের দিনও হাতে থাকে', async () => {
    const designer = await staff('OX-D1', 'designer', 'd1@test.local');
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: Array.from({ length: 40 }, (_, i) => URL_OF(i + 1)).join(String.fromCharCode(10)),
    }).expect(201);

    const targets = h.app.get(TargetsService);
    await targets.distribute();

    const one = await h.prisma.designTarget.findFirstOrThrow({
      where: { assignedToId: designer.id },
    });
    // ⭐ গতকাল শুরু হয়েছিল, আজ কেউ ফাইলটা খোলেনি
    await h.prisma.designTarget.update({
      where: { id: one.id },
      data: { startedAt: new Date(Date.now() - 86_400_000) },
    });

    await targets.returnUnworked(workDateOf(new Date()));

    const after = await h.prisma.designTarget.findUniqueOrThrow({
      where: { id: one.id },
    });
    expect(after.status).toBe('assigned');
    expect(after.assignedToId).toBe(designer.id);
  });
});

describe('কাজের নম্বর', () => {
  /**
   * ⭐⭐ **প্রতিটা টার্গেটেই নম্বর, জমা দেওয়ার মুহূর্ত থেকেই**
   * *(২৩ আগস্ট, মালিকের চাওয়া)*। আগে নম্বর বসত বরাদ্দের সময়, তাই পুলে
   * পড়ে থাকা সারির কোনো পরিচয় থাকত না।
   */
  it('পুলে বসেই নম্বর পায়, আর সব আলাদা', async () => {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: [URL_OF(1), URL_OF(2), URL_OF(3)].join(String.fromCharCode(10)),
    }).expect(201);

    const rows = await h.prisma.designTarget.findMany({
      select: { status: true, jobNumber: true },
    });

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'pool')).toBe(true);
    expect(rows.every((r) => r.jobNumber !== null)).toBe(true);
    expect(new Set(rows.map((r) => r.jobNumber)).size).toBe(3);
  });

  /** ⚠️ বরাদ্দ হলেও নম্বরটা **বদলায় না** — ওটা ASIN-এর, বরাদ্দের নয় */
  it('বরাদ্দের পরেও নম্বর একই থাকে', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', { text: URL_OF(1) }).expect(201);

    const before = await h.prisma.designTarget.findFirstOrThrow();
    await h.app.get(TargetsService).distribute();
    const after = await h.prisma.designTarget.findFirstOrThrow();

    expect(after.jobNumber).toBe(before.jobNumber);
    expect(after.status).toBe('assigned');
  });
});

/**
 * ⭐⭐ **গবেষকের দুটো কিউ** *(G-workflow, ২৪ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ **কেন কাটা-তারিখ:** ২২ আগস্টের ইমপোর্টে ২৭,৫০৯টা পুরোনো `done`
 * সারি ঢুকেছে যেগুলো অনেক আগেই Amazon-এ গেছে, কিন্তু তখন Uploaded
 * বোতামটাই ছিল না। সীমা না দিলে কিউতে দাঁড়াত ২৭,৬৪১ — কিউ নয়, পাহাড়।
 *
 * ⭐ এই describe-টা সেই সীমার পাহারা: চিপের সংখ্যা আর তালিকার সংখ্যা
 * **এক** কি না, আর পুরোনো সারি সত্যিই বাদ পড়ে কি না।
 */
describe('গবেষকের কিউ — আপলোড ও লাইভের অপেক্ষায়', () => {
  const targetsOf = () => h.app.get(TargetsService);

  /** ওই ASIN-এর সারিতে completedAt বসানো — কাটা-তারিখের এদিক বা ওদিক */
  /**
   * ⚠️⚠️ **চাবি ASIN, কাজের নম্বর নয়।** প্রথমে `JOB_NUMBER_START + n`
   * ধরেছিলাম, আর CI ধরিয়ে দিল: নম্বরটা sequence থেকে আসে, আর একই
   * ফাইলের আগের describe-গুলো নম্বর খরচ করে ফেলে। ⭐ ASIN আমরা নিজেরাই
   * বসাই (`URL_OF(n)`), তাই ওটাই একমাত্র নিশ্চিত চাবি।
   */
  const ASIN_OF = (n: number) => `B${String(n).padStart(9, '0')}`;

  async function markDoneAt(n: number, iso: string): Promise<void> {
    await h.prisma.designTarget.update({
      where: { asin: ASIN_OF(n) },
      data: { status: 'done', completedAt: new Date(iso) },
    });
  }

  beforeEach(async () => {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: [URL_OF(1), URL_OF(2), URL_OF(3)].join('\n'),
    }).expect(201);
  });

  it('⚠️⚠️ কাটা-তারিখের আগের "শেষ" কিউতে ওঠে না', async () => {
    // ২২ আগস্ট — সীমার আগে, অর্থাৎ ইমপোর্ট করা পুরোনো কাজ
    await markDoneAt(1, '2026-08-22T10:00:00+06:00');
    // ২৩ আগস্ট — সীমার দিনেই, অর্থাৎ গোনা হবে
    await markDoneAt(2, '2026-08-23T10:00:00+06:00');

    const page = await targetsOf().list({ stage: 'to_upload' });

    expect(page.total).toBe(1);
    expect(page.rows[0].asin).toBe(ASIN_OF(2));
  });

  /**
   * ⭐⭐ **সবচেয়ে জরুরি টেস্ট** — চিপে লেখা সংখ্যা আর ক্লিক করে পাওয়া
   * তালিকা এক না হলে কেউ আর কোনো সংখ্যাই বিশ্বাস করবে না।
   */
  it('চিপের সংখ্যা আর তালিকার সংখ্যা হুবহু এক', async () => {
    await markDoneAt(1, '2026-08-23T10:00:00+06:00');
    await markDoneAt(2, '2026-08-24T10:00:00+06:00');
    await markDoneAt(3, '2026-08-22T10:00:00+06:00');

    const [stats, page] = await Promise.all([
      targetsOf().stats(),
      targetsOf().list({ stage: 'to_upload' }),
    ]);

    expect(stats.toUpload).toBe(2);
    expect(page.total).toBe(stats.toUpload);
  });

  it('আপলোড হয়ে গেলে সারিটা প্রথম কিউ ছেড়ে দ্বিতীয়টায় যায়', async () => {
    await markDoneAt(1, '2026-08-23T10:00:00+06:00');

    const row = await h.prisma.designTarget.findUniqueOrThrow({
      where: { asin: ASIN_OF(1) },
    });
    await targetsOf().markUploaded(row.id, new Date());

    const [stats, toUpload, toLive] = await Promise.all([
      targetsOf().stats(),
      targetsOf().list({ stage: 'to_upload' }),
      targetsOf().list({ stage: 'to_live' }),
    ]);

    expect(toUpload.total).toBe(0);
    expect(toLive.total).toBe(1);
    expect(stats.toUpload).toBe(0);
    expect(stats.toLive).toBe(1);
  });

  /** ⚠️ `to_live`-এ কাটা-তারিখ **নেই** — ওখানে পুরোনো সারির সমস্যা নেই */
  it('লাইভ-কিউতে কাটা-তারিখ খাটে না', async () => {
    await markDoneAt(1, '2025-01-10T10:00:00+06:00');
    const row = await h.prisma.designTarget.findUniqueOrThrow({
      where: { asin: ASIN_OF(1) },
    });
    await targetsOf().markUploaded(row.id, new Date());

    expect((await targetsOf().list({ stage: 'to_upload' })).total).toBe(0);
    expect((await targetsOf().list({ stage: 'to_live' })).total).toBe(1);
  });
});

/**
 * ⭐⭐ **বানান-যাচাইয়ের শেকল** *(ADR-038, ২৫ আগস্ট ২০২৬)*।
 *
 * ডিজাইনার "শেষ" বলার পর কাজ শেষ হয় না — কেউ বানান দেখেন, ভুল পেলে
 * কেউ ঠিক করেন, তারপর ফাইলটা Amazon-এ যায়। মাঠে এটা হয়ই; সিস্টেম
 * এতদিন জানত না, তাই *"কোনগুলো দেখা বাকি"* কেউ বলতে পারত না।
 *
 * ⚠️⚠️ যন্ত্র বানান **পড়ে না** — কেবল হিসাব রাখে।
 */
describe('বানান-যাচাই — দেখা, ভুল পাওয়া, ঠিক করা', () => {
  const svc = () => h.app.get(TargetsService);
  const ASIN_OF = (n: number) => `B${String(n).padStart(9, '0')}`;

  /** ওই সারিতে `completedAt` বসানো — কাটা-তারিখের পরে */
  async function finished(n: number): Promise<number> {
    const row = await h.prisma.designTarget.update({
      where: { asin: ASIN_OF(n) },
      data: { status: 'done', completedAt: new Date('2026-08-23T10:00:00+06:00') },
    });
    return row.id;
  }

  /**
   * যিনি বোতাম চাপবেন — owner-ই যথেষ্ট।
   *
   * ⚠️ এই describe-টা **সার্ভিস সরাসরি** ডাকে, তাই HTTP-র পাহারা
   * (`assertCanProofread`) এখানে চলেই না — কে পারেন সেটা নিচের আলাদা
   * describe-এ দেখা হয়েছে। এখানকার প্রশ্ন কেবল *নিয়ম* ঠিক আছে কি না।
   */
  let actorId: number;

  beforeEach(async () => {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: [URL_OF(1), URL_OF(2), URL_OF(3)].join('\n'),
    }).expect(201);
    const u = await h.prisma.user.findFirstOrThrow({
      where: { role: 'owner' },
    });
    actorId = u.id;
  });

  it('শেষ হওয়া ডিজাইন যাচাইয়ের কিউতে বসে', async () => {
    await finished(1);

    const [stats, page] = await Promise.all([
      svc().stats(),
      svc().list({ stage: 'to_check' }),
    ]);

    expect(stats.toCheck).toBe(1);
    expect(page.total).toBe(stats.toCheck);
    expect(page.rows[0].asin).toBe(ASIN_OF(1));
  });

  it('বানান ঠিক থাকলে কিউ ছাড়ে, ঠিক-করার কিউতে যায় না', async () => {
    const id = await finished(1);

    await svc().markChecked(id, true, actorId, new Date());

    const stats = await svc().stats();
    expect(stats.toCheck).toBe(0);
    expect(stats.toFix).toBe(0);
    // ⭐ ঠিক ছিল, তাই আপলোডের কিউতে থাকে
    expect(stats.toUpload).toBe(1);
  });

  /**
   * ⭐⭐ **মালিকের সিদ্ধান্তের পাহারা** *(২৫ আগস্ট)* — ভুল পাওয়া অথচ
   * ঠিক-না-হওয়া ডিজাইন **আপলোডের কিউ থেকে বাদ**। জানা-ভাঙা জিনিস
   * Amazon-এ যাবে না।
   */
  it('⚠️⚠️ ভুল পাওয়া ডিজাইন আপলোডের কিউ থেকে বাদ থাকে', async () => {
    const id = await finished(1);
    await finished(2);

    await svc().markChecked(id, false, actorId, new Date());

    const [stats, toFix, toUpload] = await Promise.all([
      svc().stats(),
      svc().list({ stage: 'to_fix' }),
      svc().list({ stage: 'to_upload' }),
    ]);

    expect(stats.toFix).toBe(1);
    expect(toFix.rows[0].asin).toBe(ASIN_OF(1));

    // ⭐ ২ নম্বরটা এখনো দেখাই হয়নি — তবু আপলোডের কিউতে আছে
    expect(stats.toUpload).toBe(1);
    expect(toUpload.rows[0].asin).toBe(ASIN_OF(2));
  });

  it('ঠিক করার পর আবার আপলোডের কিউতে ফেরে', async () => {
    const id = await finished(1);
    await svc().markChecked(id, false, actorId, new Date());
    expect((await svc().stats()).toUpload).toBe(0);

    await svc().markFixed(id, actorId, new Date());

    const stats = await svc().stats();
    expect(stats.toFix).toBe(0);
    expect(stats.toUpload).toBe(1);
  });

  /**
   * ⚠️⚠️ **ডিজাইনের মালিকানা কখনো বদলায় না** — এই টেস্টটাই সেই
   * সিদ্ধান্তের পাহারা। বেলাল ঠিক করলে কাজটা তাঁর নামে চলে গেলে
   * তাঁর সংখ্যা ফুলে যেত — ২৩ আগস্টের গোটা তদন্তটা শুরুই হয়েছিল
   * ঠিক এমন একটা সংখ্যা দেখে।
   */
  it('⭐⭐ ঠিক করলেও ডিজাইন মূল ডিজাইনারেরই থাকে', async () => {
    const designer = await staff('OX-D9', 'designer', 'd9@test.local');
    const id = await finished(1);
    await h.prisma.designTarget.update({
      where: { id },
      data: { assignedToId: designer.id },
    });

    await svc().markChecked(id, false, actorId, new Date());
    await svc().markFixed(id, actorId, new Date());

    const row = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(row.assignedToId).toBe(designer.id);
    expect(row.fixedById).toBe(actorId);
  });

  /** ⚠️ দুবার চাপলে তারিখ সরে না — নইলে "কবে দেখা হয়েছিল" লাফ দিত */
  it('আবার চাপলে তারিখ বদলায় না', async () => {
    const id = await finished(1);
    await svc().markChecked(id, true, actorId, new Date('2026-08-24T10:00:00+06:00'));
    await svc().markChecked(id, false, actorId, new Date('2026-08-25T10:00:00+06:00'));

    const row = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(row.checkedAt?.toISOString()).toBe(new Date('2026-08-24T10:00:00+06:00').toISOString());
    // ⭐ দ্বিতীয় চাপে "ভুল" বসেনি — প্রথম রায়ই থাকে
    expect(row.errorFoundAt).toBeNull();
  });

  it('শেষ না হওয়া ডিজাইন যাচাই করা যায় না', async () => {
    const row = await h.prisma.designTarget.findUniqueOrThrow({
      where: { asin: ASIN_OF(1) },
    });
    await expect(
      svc().markChecked(row.id, true, actorId, new Date()),
    ).rejects.toThrow();
  });

  it('ভুল না থাকলে "ঠিক করেছি" বলা যায় না', async () => {
    const id = await finished(1);
    await svc().markChecked(id, true, actorId, new Date());

    await expect(svc().markFixed(id, actorId, new Date())).rejects.toThrow();
  });
});


/**
 * ⭐⭐ **কে বানান দেখতে পারেন** *(২৫ আগস্ট ২০২৬)*।
 *
 * ### ⚠️⚠️ এই describe-টা এক দিনে দুবার লেখা হয়েছে
 *
 * **সকালে** মালিক বললেন *"ami chai ei access ami manager and sumaiya
 * pak"* — তাই পাহারাটা ছিল `employees.can_proofread` টিক-ঘর ধরে, অর্থাৎ
 * **ব্যক্তি ধরে**, আর তখন এখানকার টেস্টগুলো ঠিক সেটাই মাপত।
 *
 * **পরে** বললেন *"sob researcher ra sei access gula pabe... researcher
 * and designer same kaj kore na, tai eder access o same hobe na"*।
 * ⭐ অর্থাৎ প্রশ্নটা কখনোই *"কোন মানুষ"* ছিল না, ছিল *"কোন কাজ"* —
 * আর সেটা ভূমিকার প্রশ্ন। টিক-ঘরটা এক দিন বেঁচে মুছে গেছে।
 */
describe('বানান-যাচাইয়ের অধিকার — HTTP পাহারা', () => {
  const ASIN_OF = (n: number) => `B${String(n).padStart(9, '0')}`;

  /** যাচাইয়ের জন্য তৈরি একটা সারি — শেষ হওয়া, না-দেখা */
  async function ready(): Promise<number> {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: URL_OF(1),
    }).expect(201);

    const row = await h.prisma.designTarget.update({
      where: { asin: ASIN_OF(1) },
      data: { status: 'done', completedAt: new Date('2026-08-23T10:00:00+06:00') },
    });
    return row.id;
  }

  it('⭐ গবেষক দেখতে ও ঠিক করতে পারেন', async () => {
    const id = await ready();
    await staff('OX-R8', 'researcher', 'r8@test.local', 'researcher');
    const session = await loginReady(h, 'r8@test.local', 'staff-password-123');

    await post(session, `/api/v1/design-targets/${id}/checked`, {
      ok: false,
    }).expect(201);
    await post(session, `/api/v1/design-targets/${id}/fixed`, {}).expect(201);

    const row = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(row.errorFoundAt).not.toBeNull();
    expect(row.fixedAt).not.toBeNull();
  });

  /**
   * ⚠️⚠️ **দ্বিতীয় গবেষকও পারেন — এটাই ২৫ আগস্টের বদলটা।**
   *
   * সকালে ঠিক এই টেস্টটার উল্টোটা লেখা ছিল (`.expect(403)`), কারণ তখন
   * অধিকার ছিল টিক-ঘরে আর টিক ছিল একজনের। মালিক নিয়মটা বদলেছেন, তাই
   * টেস্টটাও উল্টেছে — ⭐ কোডের সাথে টেস্ট মেলানো হয়নি, **সিদ্ধান্তের**
   * সাথে মেলানো হয়েছে।
   */
  it('⭐⭐ দ্বিতীয় গবেষকও পারেন — কারো টিকের অপেক্ষা নেই', async () => {
    const id = await ready();
    await staff('OX-R9', 'researcher', 'r9@test.local', 'researcher');
    const session = await loginReady(h, 'r9@test.local', 'staff-password-123');

    await post(session, `/api/v1/design-targets/${id}/checked`, {
      ok: true,
    }).expect(201);
  });

  /** ⚠️ ম্যানেজারের কোনো `employees` সারিই নেই — রোল দিয়েই পান */
  it('ম্যানেজার পারেন', async () => {
    const id = await ready();
    const session = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    await post(session, `/api/v1/design-targets/${id}/checked`, {
      ok: true,
    }).expect(201);

    const row = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(row.checkedAt).not.toBeNull();
  });

  it('⚠️ ডিজাইনার পারেন না', async () => {
    const id = await ready();
    await staff('OX-D7', 'designer', 'd7@test.local');
    const session = await loginReady(h, 'd7@test.local', 'staff-password-123');

    await session.http.get('/api/v1/design-targets').expect(403);
    await post(session, `/api/v1/design-targets/${id}/checked`, {
      ok: true,
    }).expect(403);

    const row = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(row.checkedAt).toBeNull();
  });

  /** ⭐ সেশনেও পতাকা দুটো যায় — পর্দা বোতাম লুকোয় ওগুলো দেখে */
  it('সেশনে canAddTargets ও canProofread ঠিক আসে', async () => {
    await staff('OX-RA', 'researcher', 'ra@test.local', 'researcher');
    await staff('OX-D8', 'designer', 'd8@test.local');

    const researcher = await loginReady(h, 'ra@test.local', 'staff-password-123');
    const designer = await loginReady(h, 'd8@test.local', 'staff-password-123');

    const a = await researcher.http.get('/api/v1/auth/me').expect(200);
    const b = await designer.http.get('/api/v1/auth/me').expect(200);

    expect(a.body.role).toBe('researcher');
    expect(a.body.canAddTargets).toBe(true);
    expect(a.body.canProofread).toBe(true);

    expect(b.body.canAddTargets).toBe(false);
    expect(b.body.canProofread).toBe(false);
  });
});


/**
 * ⭐⭐ **কে টার্গেটটা এনেছেন** *(মালিকের চাওয়া, ২৫ আগস্ট ২০২৬:
 * "Design Pool e ke target list add koreche seta ami dekhote cai")*।
 *
 * ⚠️⚠️ এখানকার সবচেয়ে সূক্ষ্ম দাবিটা **দুটো আলাদা id-র জগৎ** নিয়ে:
 * `assignedToId → employees`, `addedById → users`। সংখ্যাগুলো ছোট আর
 * পাশাপাশি, তাই একটার জায়গায় অন্যটা বসানো সহজ — আর তখন কোনো এরর হয়
 * না, কেবল **ভুল মানুষের সারি** আসে।
 */
describe('কে এনেছেন — তালিকা, ছাঁকনি ও গণনা', () => {
  const svc = () => h.app.get(TargetsService);

  it('সারিতে কে এনেছেন সেটা থাকে, ভূমিকাসহ', async () => {
    await staff('OX-RB', 'researcher', 'rb@test.local', 'researcher');
    const session = await loginReady(h, 'rb@test.local', 'staff-password-123');

    await post(session, '/api/v1/design-targets/bulk', {
      text: URL_OF(1),
    }).expect(201);

    const page = await svc().list({});
    expect(page.rows[0].addedBy.fullName).toBe('OX-RB');
    expect(page.rows[0].addedBy.role).toBe('researcher');
    expect(page.rows[0].addedAt).not.toBeNull();
  });

  /**
   * ⚠️⚠️ **এই টেস্টটাই দুই id-র জগতের পাহারা।** গবেষকের `users.id` আর
   * ডিজাইনারের `employees.id` আলাদা সংখ্যা; ছাঁকনিতে ভুলটা বসালে
   * এখানেই ধরা পড়বে।
   */
  it('⭐⭐ কে এনেছেন ধরে ছাঁকা যায়', async () => {
    await staff('OX-RC', 'researcher', 'rc@test.local', 'researcher');
    const them = await loginReady(h, 'rc@test.local', 'staff-password-123');
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    await post(them, '/api/v1/design-targets/bulk', {
      text: [URL_OF(1), URL_OF(2)].join('\n'),
    }).expect(201);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: URL_OF(3),
    }).expect(201);

    const adders = await svc().adders();
    expect(adders).toHaveLength(2);

    const researcher = adders.find((a) => a.role === 'researcher');
    expect(researcher?.count).toBe(2);
    expect(adders.find((a) => a.role === 'owner')?.count).toBe(1);

    // ⭐ সবচেয়ে বেশি যিনি এনেছেন তিনি আগে
    expect(adders[0].count).toBe(2);

    const only = await svc().list({ addedById: researcher!.id });
    expect(only.total).toBe(2);
    for (const row of only.rows) {
      expect(row.addedBy.role).toBe('researcher');
    }
  });

  /** ⚠️ কেউ কিছু না আনলে তালিকাটা খালি — ড্রপডাউন খালিই থাকে, ভাঙে না */
  it('কিছু না থাকলে খালি তালিকা', async () => {
    expect(await svc().adders()).toEqual([]);
  });

  /** ⭐ ডিজাইনার এই রুটটাও ছুঁতে পারেন না — `assertCanUse`-এর নিচেই */
  it('ডিজাইনার adders দেখতে পান না', async () => {
    await staff('OX-D9B', 'designer', 'd9b@test.local');
    const session = await loginReady(h, 'd9b@test.local', 'staff-password-123');

    await session.http.get('/api/v1/design-targets/adders').expect(403);
  });
});


/**
 * ⭐⭐ **"ভুল করে Complete চেপে ফেলেছি"** *(মালিকের রিপোর্ট, ২৫ আগস্ট:
 * "onek somoy vule kew colplete press kore felole byak anote paren na")*।
 *
 * ⚠️⚠️ মূল কারণটা ছিল **দেখতেই না পাওয়া**: `mine()` কেবল `assigned`
 * সারি পাঠাত, তাই Complete চাপার সাথে সাথে জিনিসটা পর্দা থেকে উধাও।
 * ফেরানোর বোতাম দূরে থাক — সারিটাই আর খুঁজে পাওয়া যেত না।
 */
describe('Complete ফিরিয়ে নেওয়া', () => {
  const svc = () => h.app.get(TargetsService);
  const ASIN_OF = (n: number) => `B${String(n).padStart(9, '0')}`;

  /**
   * একজন ডিজাইনার, তাঁর হাতে একটা টার্গেট।
   *
   * ⚠️⚠️ **মালিকের সেশনটা ফেরত দেওয়া হয়, আর সেটাই এখানকার আসল ফাঁদ।**
   * harness-এ owner-এর `mustChangePw: true`, তাই `loginReady` প্রথম
   * লগইনেই পাসওয়ার্ড বদলে `…-changed` করে দেয়। ⭐ এক টেস্টে দ্বিতীয়বার
   * `loginReady(OWNER_PASSWORD)` ডাকলে তাই **৪০১** — আর বার্তাটা
   * ("expected 200, got 401") টেস্টের আসল দাবির সাথে কোনো সম্পর্কই
   * রাখে না, তাই কারণ খুঁজতে সময় যায়।
   */
  async function assigned(n: number, reuse?: Session) {
    const owner = reuse ?? (await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD));
    await post(owner, '/api/v1/design-targets/bulk', {
      text: URL_OF(n),
    }).expect(201);

    const designer = await staff(`OX-U${n}`, 'designer', `u${n}@test.local`);
    const row = await h.prisma.designTarget.update({
      where: { asin: ASIN_OF(n) },
      data: {
        status: 'assigned',
        assignedToId: designer.id,
        assignedAt: new Date(),
      },
    });

    const session = await loginReady(h, `u${n}@test.local`, 'staff-password-123');
    return { id: row.id, designer, session, owner };
  }

  it('⭐ শেষ করার পরেও সারিটা নিজের তালিকায় থাকে', async () => {
    const { id, designer, session } = await assigned(1);

    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);

    const mine = await svc().mine(designer.id);
    expect(mine).toHaveLength(1);
    // ⭐ কিন্তু এখন "হাতে আছে" নয় — শেষ করা
    expect(mine[0].completedAt).not.toBeNull();
  });

  it('⭐⭐ Undo চাপলে আবার হাতে ফেরে', async () => {
    const { id, designer, session } = await assigned(1);
    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);

    await post(session, `/api/v1/me/targets/${id}/undone`, {}).expect(201);

    const row = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('assigned');
    /**
     * ⚠️⚠️ **তিনটেই মুছতে হয়।** কিউগুলো `status` ধরে নয়, `completedAt`
     * ধরে চলে — শুধু অবস্থা ফেরালে সারিটা "হাতে আছে" দেখাত অথচ
     * আপলোডের কিউতে বসেই থাকত।
     */
    expect(row.completedAt).toBeNull();
    expect(row.completedVia).toBeNull();
    expect(row.completedById).toBeNull();

    // ⭐ কাজটা তাঁরই থাকে — পুলে ফিরে যায় না
    expect(row.assignedToId).toBe(designer.id);
  });

  it('⚠️ কিউ থেকেও বেরিয়ে যায়', async () => {
    const { id, session } = await assigned(1);
    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);
    expect((await svc().stats()).toUpload).toBe(1);

    await post(session, `/api/v1/me/targets/${id}/undone`, {}).expect(201);

    const stats = await svc().stats();
    expect(stats.toUpload).toBe(0);
    expect(stats.toCheck).toBe(0);
  });

  /**
   * ⚠️⚠️ **এই টেস্টটাই সবচেয়ে জরুরি।** বানান দেখা হয়ে গেলে ওটা আর
   * "ভুলে চাপা" নয় — ফেরালে বানান-কিউ আর আপলোডের সংখ্যা একসাথে
   * মিথ্যে হয়ে যেত।
   */
  it('⭐⭐ বানান দেখা হয়ে গেলে আর ফেরানো যায় না', async () => {
    const { id, session, owner } = await assigned(1);
    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);

    await post(owner, `/api/v1/design-targets/${id}/checked`, { ok: true }).expect(201);

    await post(session, `/api/v1/me/targets/${id}/undone`, {}).expect(409);

    const row = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('done');
  });

  /** ⚠️ গতকালেরটা ফেরালে গতকালের সংখ্যাও বদলে যেত */
  it('গতকালের কাজ ডিজাইনার ফেরাতে পারেন না', async () => {
    const { id, session } = await assigned(1);
    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);
    await h.prisma.designTarget.update({
      where: { id },
      data: { completedAt: new Date(Date.now() - 3 * 86_400_000) },
    });

    await post(session, `/api/v1/me/targets/${id}/undone`, {}).expect(409);
  });

  /** ⭐ কিন্তু মালিক পারেন — পুরোনো ভুল শোধরানোই ওই রুটটার কাজ */
  it('⭐ মালিক পুরোনো Complete-ও ফেরাতে পারেন', async () => {
    const { id, designer, session, owner } = await assigned(1);
    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);
    await h.prisma.designTarget.update({
      where: { id },
      data: { completedAt: new Date(Date.now() - 3 * 86_400_000) },
    });

    await post(owner, `/api/v1/design-targets/${id}/undone`, {}).expect(201);

    const row = await h.prisma.designTarget.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('assigned');
    expect(row.completedAt).toBeNull();
    expect(row.assignedToId).toBe(designer.id);
  });

  /** ⚠️⚠️ অন্যের সারি ছোঁয়া যায় না — id অনুমান করেও নয় */
  it('অন্যের টার্গেট ফেরানো যায় না', async () => {
    const first = await assigned(1);
    // ⚠️ মালিকের সেশনটা পুনর্ব্যবহার — উপরের টীকা দেখুন
    const mine = await assigned(2, first.owner);
    const id = first.id;
    await post(mine.session, `/api/v1/me/targets/${mine.id}/done`, {}).expect(201);

    await post(mine.session, `/api/v1/me/targets/${id}/undone`, {}).expect(403);
  });

  /**
   * ⭐⭐⭐ **Undo audit log-এ বসে** *(মালিকের প্রশ্নে যোগ হয়েছে, ২৫ আগস্ট:
   * "ei access ta ki designer der pawa uchit?")*।
   *
   * ⚠️⚠️ এটাই একমাত্র কাজ যা **নিজের চিহ্ন মুছে দেয়** — `completedAt`,
   * `completedVia`, `completedById` তিনটেই `null` হয়ে যায়, অর্থাৎ কাজটা
   * কখনো শেষ হয়েছিল সেই প্রমাণটাই সারি থেকে উধাও। ⭐ লগ না থাকলে কেউ
   * রোজ Complete → Undo → Complete করলেও কেউ দেখতে পেত না।
   *
   * ⚠️ meta-তে **মুছে ফেলা মানগুলোই** থাকতে হয়, নইলে লগটা শুধু বলত
   * "কিছু একটা ফেরানো হয়েছে" — কী, সেটা নয়।
   */
  it('⭐⭐ Undo audit log-এ বসে, মুছে ফেলা মানসহ', async () => {
    const { id, session, designer } = await assigned(1);
    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);

    const doneRow = await h.prisma.designTarget.findUniqueOrThrow({
      where: { id },
    });

    await post(session, `/api/v1/me/targets/${id}/undone`, {}).expect(201);

    const entry = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'design_undone' },
      orderBy: { id: 'desc' },
    });

    expect(entry.targetType).toBe('design_target');
    expect(entry.targetId).toBe(String(id));

    const meta = entry.meta as Record<string, unknown>;
    expect(meta.asin).toBe(ASIN_OF(1));
    expect(meta.assignedToId).toBe(designer.id);
    // ⭐ যা মুছে গেছে — সারিতে এগুলো আর নেই, লগই একমাত্র জায়গা
    expect(meta.completedVia).toBe('manual');
    expect(meta.completedById).toBe(doneRow.completedById);
    expect(meta.completedAt).toBe(doneRow.completedAt?.toISOString());
  });

  /** ⚠️ ব্যর্থ Undo লগে বসে না — নইলে লগটা চেষ্টায় ভরে যেত */
  it('আটকে যাওয়া Undo লগে বসে না', async () => {
    const { id, session, owner } = await assigned(1);
    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);
    await post(owner, `/api/v1/design-targets/${id}/checked`, { ok: true }).expect(201);

    await post(session, `/api/v1/me/targets/${id}/undone`, {}).expect(409);

    expect(
      await h.prisma.auditLog.count({ where: { action: 'design_undone' } }),
    ).toBe(0);
  });

  /** ⭐ দুবার চাপলে ভাঙে না — দ্বিতীয়বারেও "ঠিক আছে" */
  it('দুবার Undo চাপলে ভাঙে না', async () => {
    const { id, session } = await assigned(1);
    await post(session, `/api/v1/me/targets/${id}/done`, {}).expect(201);

    await post(session, `/api/v1/me/targets/${id}/undone`, {}).expect(201);
    await post(session, `/api/v1/me/targets/${id}/undone`, {}).expect(201);
  });
});


/**
 * ⭐⭐ **ম্যানেজারও রোজ ৩০টা পান** *(মালিকের নির্দেশ, ২৬ আগস্ট:
 * "belal er jonoo daily 30 ta design distribute korba")*।
 *
 * ⚠️⚠️ এখানকার আসল দাবি দুটো, আর দুটো **আলাদা** প্রশ্ন:
 *   ১· কাজ **পান** কি না      → হ্যাঁ, ডিজাইনারদের মতোই ৩০টা
 *   ২· কাজের **মাপকাঠিতে** বাঁধা কি না → না, তাঁর দৈনিক টার্গেট নেই
 *
 * ⭐ তিনি সপ্তাহে ১-২ দিন ডিজাইন করেন, তাই বাকি দিনগুলোয় "পিছিয়ে"
 * দেখানো মিথ্যা হতো। দুটো এক করে ফেলাই এখানকার সবচেয়ে সহজ ভুল।
 */
describe('বণ্টন — ম্যানেজারও পান', () => {
  const svc = () => h.app.get(TargetsService);

  /** ⚠️ উপরের describe-এর `seedPool` এখানে পৌঁছায় না — ওটা ওর ভেতরে */
  async function fillPool(count: number) {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: Array.from({ length: count }, (_, i) => URL_OF(i + 1)).join('\n'),
    }).expect(201);
  }

  it('⭐⭐ ম্যানেজার ডিজাইনারদের সমান ৩০টা পান', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    await staff('OX-M1', 'manager', 'm1@test.local');
    await fillPool(100);

    await svc().distribute();

    const rows = await h.prisma.designTarget.findMany({
      where: { status: 'assigned' },
      select: { assignedToId: true },
    });
    expect(rows).toHaveLength(60);

    const per = new Map<number | null, number>();
    for (const r of rows) per.set(r.assignedToId, (per.get(r.assignedToId) ?? 0) + 1);
    expect([...per.values()]).toEqual([30, 30]);
  });

  /** ⚠️ গবেষক পান না — তিনি টার্গেট **আনেন**, করেন না */
  it('গবেষক বণ্টনে নেই', async () => {
    await staff('OX-R1', 'researcher', 'r1@test.local');
    await fillPool(100);

    expect((await svc().distribute()).assigned).toBe(0);
  });

  /**
   * ⭐⭐ **রোজ কাজ না করলেও স্তূপ জমে না** — এটাই মালিকের দ্বিতীয়
   * বাক্যটার ("weekly 1-2 din design kore") উত্তর।
   *
   * ⚠️ শর্তটা **খোলা হয়েছে কি না**, "শেষ হয়েছে কি না" নয় — যে ফাইলটা
   * তিনি আজ ধরেছেন অথচ শেষ করতে পারেননি, সেটা তাঁর হাতেই থাকে।
   */
  it('⭐⭐ না-ছোঁয়া ডিজাইন রাতে পুলে ফেরে', async () => {
    const manager = await staff('OX-M2', 'manager', 'm2@test.local');
    await fillPool(100);
    await svc().distribute();
    expect(
      await h.prisma.designTarget.count({ where: { assignedToId: manager.id } }),
    ).toBe(30);

    await svc().returnUnworked(workDateOf(new Date()));

    expect(
      await h.prisma.designTarget.count({ where: { assignedToId: manager.id } }),
    ).toBe(0);
    expect(
      await h.prisma.designTarget.count({ where: { status: 'pool' } }),
    ).toBe(100);
  });

  /** ⭐ কিন্তু যেটা তিনি খুলেছেন সেটা তাঁর হাতেই থাকে */
  it('খোলা ডিজাইন ফেরত যায় না', async () => {
    const manager = await staff('OX-M3', 'manager', 'm3@test.local');
    await fillPool(100);
    await svc().distribute();

    const one = await h.prisma.designTarget.findFirstOrThrow({
      where: { assignedToId: manager.id },
    });
    await h.prisma.designTarget.update({
      where: { id: one.id },
      data: { startedAt: new Date() },
    });

    await svc().returnUnworked(workDateOf(new Date()));

    const still = await h.prisma.designTarget.findUniqueOrThrow({
      where: { id: one.id },
    });
    expect(still.assignedToId).toBe(manager.id);
  });
});
// ════════════════════════════════════════════════════════════════════════════

/**
 * **মরা ASIN মুছে ফেলা** *(২৯ আগস্ট ২০২৬, মালিকের রিপোর্ট: "pool er kiso
 * asin amazon e page nei… sei page gula sorry not found on amazon")*।
 *
 * ⚠️⚠️ **এই describe-এর আসল দাবি একটাই: মোছা মানে ভুলে যাওয়া নয়।**
 * আগে Delete ছিল সত্যিকারের `DELETE`, আর তাতে সারির সাথে `asin` UNIQUE
 * প্রহরীটাও চলে যেত — কাল কেউ ওই মরা ASIN আবার পেস্ট করলে সেটা নতুন কাজ
 * হিসেবে ঢুকত, বণ্টনে যেত, আর ডিজাইনার আবার গিয়ে দেখতেন "Sorry, not
 * found"। ⭐ নিচের দ্বিতীয় টেস্টটাই সেই চক্রের পাহারা।
 */
describe('মরা ASIN মুছে ফেলা', () => {
  /**
   * ⚠️⚠️ **সেশনটা ফেরত দেওয়া হয়, আর সেটা ইচ্ছাকৃত** — একই টেস্টে
   * দ্বিতীয়বার `loginReady()` ডাকলে ৪০১ আসে (২৫ আগস্টের শিক্ষা,
   * `0a96d75`)। ⭐ তাই পুল ভরার সময় যে সেশনটা তৈরি হলো, টেস্ট সেটাই
   * ব্যবহার করে।
   */
  async function seedPool(count: number): Promise<Session> {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: Array.from({ length: count }, (_, i) => URL_OF(i + 1)).join('\n'),
    }).expect(201);
    return owner;
  }

  const ids = async (): Promise<number[]> =>
    (
      await h.prisma.designTarget.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    ).map((r) => r.id);

  it('সারিটা থেকে যায়, কিন্তু আর বণ্টনে যায় না', async () => {
    await staff('OX-D1', 'designer', 'd1@test.local');
    const owner = await seedPool(5);

    const res = await post(owner, '/api/v1/design-targets/delete', {
      ids: (await ids()).slice(0, 2),
      reason: 'not_found',
    }).expect(201);

    expect(res.body).toEqual({ deleted: 2, keptDone: 0 });

    // ⭐ পাঁচটাই টেবিলে — মোছা হয়নি, দাগানো হয়েছে
    expect(await h.prisma.designTarget.count()).toBe(5);
    expect(
      await h.prisma.designTarget.count({ where: { status: 'deleted' } }),
    ).toBe(2);

    await h.app.get(TargetsService).distribute();

    expect(
      await h.prisma.designTarget.count({ where: { status: 'assigned' } }),
    ).toBe(3);
  });

  /**
   * ⚠️⚠️ **গোটা বদলের কারণ এই একটা টেস্ট।** সারিটা না থাকলে
   * `ON CONFLICT (asin) DO NOTHING` কিছুই ঠেকাত না।
   */
  it('মোছা ASIN আবার পেস্ট করলে পুলে ফেরে না', async () => {
    const owner = await seedPool(1);

    await post(owner, '/api/v1/design-targets/delete', {
      ids: await ids(),
      reason: 'not_found',
    }).expect(201);

    const again = await post(owner, '/api/v1/design-targets/bulk', {
      text: URL_OF(1),
    }).expect(201);

    expect(again.body.added).toBe(0);
    expect(again.body.alreadyKnown).toBe(1);
    expect(
      await h.prisma.designTarget.count({ where: { status: 'pool' } }),
    ).toBe(0);
  });

  /**
   * ⚠️⚠️ শেষ হয়ে যাওয়া কাজ মুছলে ডিজাইনারের দিনের গোনা কমে যেত, আর
   * আপলোডের কিউ থেকেও জিনিসটা নীরবে হারাত।
   */
  it('শেষ হয়ে যাওয়া সারি ছোঁয়া হয় না, আর সেটা গুনে বলা হয়', async () => {
    const owner = await seedPool(2);
    const [first, second] = await ids();

    await h.prisma.designTarget.update({
      where: { id: first },
      data: { status: 'done', completedAt: new Date(), completedVia: 'manual' },
    });

    const res = await post(owner, '/api/v1/design-targets/delete', {
      ids: [first, second],
      reason: 'copyright',
    }).expect(201);

    expect(res.body).toEqual({ deleted: 1, keptDone: 1 });
    expect(
      (await h.prisma.designTarget.findUniqueOrThrow({ where: { id: first } }))
        .status,
    ).toBe('done');
  });

  /**
   * ⭐⭐ **সবচেয়ে দরকারি ক্ষেত্র** — ডিজাইনার লিঙ্কটা খুলে তবেই বোঝেন
   * পাতাটা নেই, অর্থাৎ সারিটা তখন তাঁর **হাতে**।
   */
  it('হাতে থাকা সারি মুছলে তালিকা থেকে সরে, আর পরের বণ্টনে বদলি আসে', async () => {
    const designer = await staff('OX-D1', 'designer', 'd1@test.local');
    const owner = await seedPool(31);
    const targets = h.app.get(TargetsService);
    await targets.distribute();

    const mine = await targets.mine(designer.id);
    expect(mine).toHaveLength(30);

    await post(owner, '/api/v1/design-targets/delete', {
      ids: [mine[0].id],
      reason: 'not_found',
    }).expect(201);

    expect(await targets.mine(designer.id)).toHaveLength(29);

    // ⭐ হাতের গোনা ২৯, পুলে পড়ে আছে ১ — তাই বদলিটা এমনিতেই আসে
    await targets.distribute();
    expect(await targets.mine(designer.id)).toHaveLength(30);
  });

  /** ⚠️ একই id দুবার এলে সংখ্যাটা বাড়িয়ে দেখাত */
  it('একই id দুবার দিলে একবারই গোনা হয়', async () => {
    const owner = await seedPool(1);
    const [only] = await ids();

    const res = await post(owner, '/api/v1/design-targets/delete', {
      ids: [only, only],
      reason: 'events',
    }).expect(201);

    expect(res.body.deleted).toBe(1);
  });

  /** ⚠️ দ্বিতীয়বার মুছলে audit-এ দ্বিতীয় সারি বসত, অথচ কিছুই ঘটেনি */
  it('আগে মোছা সারি আবার মুছলে কিছুই ঘটে না', async () => {
    const owner = await seedPool(1);
    const only = await ids();

    await post(owner, '/api/v1/design-targets/delete', {
      ids: only,
      reason: 'not_found',
    }).expect(201);
    const twice = await post(owner, '/api/v1/design-targets/delete', {
      ids: only,
      reason: 'not_found',
    }).expect(201);

    expect(twice.body).toEqual({ deleted: 0, keptDone: 0 });
    expect(
      await h.prisma.auditLog.count({ where: { action: 'design_deleted' } }),
    ).toBe(1);
  });

  /** ⭐ একক পথটাও একই কাজ করে — দুটো আলাদা আচরণ থাকলে একদিন একটা ভুল হতো */
  it('একক DELETE-ও সারি মোছে না, দাগায়', async () => {
    const owner = await seedPool(1);
    const [only] = await ids();

    await owner.http
      .delete(`/api/v1/design-targets/${only}?reason=copyright`)
      .set('X-CSRF-Token', owner.csrf)
      .expect(200);

    expect(
      (await h.prisma.designTarget.findUniqueOrThrow({ where: { id: only } }))
        .status,
    ).toBe('deleted');
  });
});
// ════════════════════════════════════════════════════════════════════════════

/**
 * **"কেন বাদ দিলেন" — তিনটে কারণ, দুই পথে এক** *(৩১ আগস্ট ২০২৬, মালিকের
 * চাওয়া: "'Not Found, Copyright, Events' eigula add kore dao… kono designer
 * skip press korleO tar kache same 3 ta option dibe")*।
 *
 * ⚠️⚠️ সবচেয়ে জরুরি দাবি: **কারণ ছাড়া কোনো পথ নেই**। আগে ঘরটা ঐচ্ছিক ছিল,
 * আর ফল — মাঠে ৯৩টা skipped সারির একটাতেও কারণ লেখা ছিল না।
 */
describe('বাদ দেওয়ার কারণ', () => {
  async function seedPool(count: number): Promise<Session> {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await post(owner, '/api/v1/design-targets/bulk', {
      text: Array.from({ length: count }, (_, i) => URL_OF(i + 1)).join('\n'),
    }).expect(201);
    return owner;
  }

  it('Delete-এ কারণ সারিতে বসে', async () => {
    const owner = await seedPool(1);
    const row = await h.prisma.designTarget.findFirstOrThrow();

    await post(owner, '/api/v1/design-targets/delete', {
      ids: [row.id],
      reason: 'copyright',
    }).expect(201);

    const after = await h.prisma.designTarget.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.status).toBe('deleted');
    expect(after.dropReason).toBe('copyright');
  });

  /** ⚠️⚠️ কারণ ছাড়া মোছার পথ থাকলে ঘরটা আবার খালি পড়ে থাকত */
  it('কারণ ছাড়া Delete আটকে যায়', async () => {
    const owner = await seedPool(1);
    const row = await h.prisma.designTarget.findFirstOrThrow();

    await post(owner, '/api/v1/design-targets/delete', {
      ids: [row.id],
    }).expect(400);

    expect(
      (await h.prisma.designTarget.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe('pool');
  });

  /** ⚠️ তালিকার বাইরের কারণ নেওয়া যাবে না — নইলে গোনা অর্থহীন হতো */
  it('অচেনা কারণ আটকে যায়', async () => {
    const owner = await seedPool(1);
    const row = await h.prisma.designTarget.findFirstOrThrow();

    await post(owner, '/api/v1/design-targets/delete', {
      ids: [row.id],
      reason: 'boring',
    }).expect(400);
  });

  /** ⭐⭐ ডিজাইনারের Skip — একই তিনটে কারণ, একই ঘর */
  it('Skip-এ কারণ একই ঘরে বসে', async () => {
    const designer = await staff('OX-D1', 'designer', 'd1@test.local');
    await seedPool(1);
    await h.app.get(TargetsService).distribute();

    const staffSession = await loginReady(
      h,
      'd1@test.local',
      'staff-password-123',
    );
    const mine = await h.app.get(TargetsService).mine(designer.id);

    await post(staffSession, `/api/v1/me/targets/${mine[0].id}/skip`, {
      reason: 'events',
    }).expect(201);

    const after = await h.prisma.designTarget.findUniqueOrThrow({
      where: { id: mine[0].id },
    });
    expect(after.status).toBe('skipped');
    expect(after.dropReason).toBe('events');
  });

  it('কারণ ছাড়া Skip আটকে যায়', async () => {
    const designer = await staff('OX-D1', 'designer', 'd1@test.local');
    await seedPool(1);
    await h.app.get(TargetsService).distribute();

    const staffSession = await loginReady(
      h,
      'd1@test.local',
      'staff-password-123',
    );
    const mine = await h.app.get(TargetsService).mine(designer.id);

    await post(staffSession, `/api/v1/me/targets/${mine[0].id}/skip`, {}).expect(
      400,
    );

    expect(
      (
        await h.prisma.designTarget.findUniqueOrThrow({
          where: { id: mine[0].id },
        })
      ).status,
    ).toBe('assigned');
  });

  /** ⭐ কারণটা তালিকাতেও যায় — নইলে পর্দায় দেখানোর উপায় থাকত না */
  it('তালিকার সারিতে কারণটা ফেরত আসে', async () => {
    const owner = await seedPool(1);
    const row = await h.prisma.designTarget.findFirstOrThrow();

    await post(owner, '/api/v1/design-targets/delete', {
      ids: [row.id],
      reason: 'not_found',
    }).expect(201);

    const list = await owner.http
      .get('/api/v1/design-targets?status=deleted')
      .expect(200);

    expect(list.body.rows).toHaveLength(1);
    expect(list.body.rows[0].dropReason).toBe('not_found');
  });
});
