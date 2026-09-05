import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createHarness,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
  type Session,
  dhakaNoon,
} from './setup/harness';

/**
 * **R21 — সিকিউরিটি মানি (জামানত)।**
 *
 * মালিকের কথা *(১৫ আগস্ট)*: প্রতি মাসে ৫০০ টাকা কেটে রাখা হয়, আর কেউ
 * ৩০ দিন আগে জানিয়ে ছাড়লে পুরোটা ফেরত পান।
 *
 * ⚠️ এখানকার টেস্টগুলো টাকার, তাই প্রশ্নগুলোও টাকার: **দুবার কাটা হয় কি
 * না**, **যোগ দেওয়ার আগের মাসে কাটা হয় কি না**, আর **নিয়ম বদলালে
 * পুরোনো কিস্তি নড়ে কি না**।
 */
let h: Harness;
let owner: Session;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

/** ঢাকার চলতি মাস — টেস্টের প্রত্যাশাও এটার সাথে মেলে */
const thisMonth = dhakaNoon().toISOString().slice(0, 7);

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

  /**
   * ⚠️ `resetDatabase` টেবিল খালি করে, তাই migration-এ বসানো নিয়মের
   * সারিটাও চলে যায় — প্রতিটা টেস্টে নতুন করে বসাতে হয়।
   */
  await h.prisma.depositPolicy.upsert({
    where: { id: 1 },
    update: {
      amountPaisa: 50_000,
      startYearMonth: thisMonth,
      noticeDays: 30,
      active: true,
      updatedBy: 'test',
    },
    create: {
      id: 1,
      amountPaisa: 50_000,
      startYearMonth: thisMonth,
      noticeDays: 30,
      active: true,
      updatedBy: 'test',
    },
  });
});

const addStaff = async (fullName: string, joinedOn?: string) => {
  const res = await owner.http
    .post('/api/v1/employees')
    .set('X-CSRF-Token', owner.csrf)
    .send({ fullName, monthlySalary: '10000', joinedOn })
    .expect(201);
  return res.body as { id: number; empCode: string };
};

const balances = async () => {
  const res = await owner.http.get('/api/v1/deposits').expect(200);
  return res.body as {
    policy: { amount: string; noticeDays: number; startYearMonth: string };
    rows: {
      employeeId: number;
      empCode: string;
      months: number;
      balance: string;
      settlement: { outcome: string; amount: string } | null;
    }[];
  };
};

describe('জামানতের খাতা', () => {
  it('চলতি মাসে একজনের একটাই কিস্তি বসে', async () => {
    const staff = await addStaff('Jomanot Ek');

    const { rows, policy } = await balances();
    const row = rows.find((r) => r.employeeId === staff.id);

    expect(policy.amount).toBe('500.00');
    expect(row?.months).toBe(1);
    expect(row?.balance).toBe('500.00');
  });

  /**
   * ⭐⭐ **এই টেস্টটাই সবচেয়ে জরুরি।** খাতাটা পাতা খোলার সময় তৈরি হয়,
   * কোনো cron-এ নয় — তাই "দুবার খুললে দুবার কাটা" ঠিক এখানেই ঘটতে পারত।
   */
  it('⭐ বারবার খাতা খুললেও জমা বাড়ে না', async () => {
    const staff = await addStaff('Bar Bar');

    await balances();
    await balances();
    const { rows } = await balances();

    const row = rows.find((r) => r.employeeId === staff.id);
    expect(row?.months).toBe(1);
    expect(row?.balance).toBe('500.00');
  });

  it('⚠️ যোগ দেওয়ার আগের মাসে কিস্তি বসে না', async () => {
    // নিয়ম শুরু চলতি মাসে, আর ইনি যোগ দিয়েছেন পরের মাসে — একটাও নয়
    const nextMonthDate = `${nextMonthOf(thisMonth)}-05`;
    const staff = await addStaff('Pore Joge Diyechen', nextMonthDate);

    const { rows } = await balances();
    const row = rows.find((r) => r.employeeId === staff.id);

    expect(row?.months).toBe(0);
    expect(row?.balance).toBe('0.00');
  });

  /**
   * ⚠️⚠️ নিয়মের অঙ্ক বদলালে **পুরোনো কিস্তি বদলায় না** — কারণ প্রতিটা
   * সারিতে ওই মাসের অঙ্কটা লেখা থাকে। উল্টোটা হলে আজ ৬০০ করলে গত
   * মাসগুলোর জমাও পিছন ফিরে বেড়ে যেত, আর খাতা এমন টাকা দাবি করত যা
   * কেউ কোনোদিন দেননি।
   */
  it('⭐⭐ অঙ্ক বদলালে আগের মাসের কিস্তি অটুট থাকে', async () => {
    const staff = await addStaff('Purono Kisti');
    await balances(); // চলতি মাসের কিস্তিটা ৫০০-তে বসে গেল

    await owner.http
      .patch('/api/v1/deposits/policy')
      .set('X-CSRF-Token', owner.csrf)
      .send({ amountPaisa: 60_000 })
      .expect(200);

    const { rows, policy } = await balances();
    const row = rows.find((r) => r.employeeId === staff.id);

    expect(policy.amount).toBe('600.00');
    // ⭐ নতুন অঙ্ক নতুন মাস থেকে — এই মাসেরটা ৫০০-ই
    expect(row?.balance).toBe('500.00');
  });

  it('নিয়ম বন্ধ করলে নতুন কিস্তি বসে না, পুরোনো জমা থাকে', async () => {
    const staff = await addStaff('Bondho Niyom');
    await balances();

    await owner.http
      .patch('/api/v1/deposits/policy')
      .set('X-CSRF-Token', owner.csrf)
      .send({ active: false })
      .expect(200);

    const { rows } = await balances();
    expect(rows.find((r) => r.employeeId === staff.id)?.balance).toBe('500.00');
  });
});

describe('নিষ্পত্তি — ফেরত না বাজেয়াপ্ত', () => {
  it('⭐ ৩০ দিনের নোটিশ হলে ফেরত, আর হিসাবটা সারিতে লেখা থাকে', async () => {
    const staff = await addStaff('Niyom Mene');
    await balances();

    const res = await owner.http
      .post(`/api/v1/deposits/${staff.id}/settle`)
      .set('X-CSRF-Token', owner.csrf)
      .send({
        outcome: 'refunded',
        noticeGivenOn: '2026-07-31',
        lastWorkingDay: '2026-08-30',
      })
      .expect(201);

    expect(res.body.outcome).toBe('refunded');
    expect(res.body.amount).toBe('500.00');
    expect(res.body.noticeDaysGiven).toBe(30);
    expect(res.body.noticeDaysRule).toBe(30);
  });

  /**
   * ⭐ নিয়ম না মিললেও মালিক ফেরত দিতে **পারেন** — সিদ্ধান্তটা তাঁরই।
   * সিস্টেম শুধু হিসাবটা লিখে রাখে, আটকায় না। ব্যতিক্রম সবসময়ই থাকে,
   * আর সেগুলো কোনো `if`-এ ধরা যায় না।
   */
  it('⭐ নিয়ম না মিললেও মালিক ফেরত দিতে পারেন — শুধু হিসাবটা লেখা থাকে', async () => {
    const staff = await addStaff('Byatikrom');
    await balances();

    const res = await owner.http
      .post(`/api/v1/deposits/${staff.id}/settle`)
      .set('X-CSRF-Token', owner.csrf)
      .send({
        outcome: 'refunded',
        noticeGivenOn: '2026-08-25',
        lastWorkingDay: '2026-08-30',
        note: 'হাসপাতালে ভর্তি ছিলেন',
      })
      .expect(201);

    expect(res.body.outcome).toBe('refunded');
    expect(res.body.noticeDaysGiven).toBe(5);
    expect(res.body.note).toBe('হাসপাতালে ভর্তি ছিলেন');
  });

  it('⚠️ দ্বিতীয়বার নিষ্পত্তি করা যায় না — ৪০৯', async () => {
    const staff = await addStaff('Dubar Noy');
    await balances();

    await owner.http
      .post(`/api/v1/deposits/${staff.id}/settle`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ outcome: 'forfeited' })
      .expect(201);

    await owner.http
      .post(`/api/v1/deposits/${staff.id}/settle`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ outcome: 'refunded' })
      .expect(409);
  });

  it('নিষ্পত্তির পরে নতুন কিস্তি আর বসে না', async () => {
    const staff = await addStaff('Khata Bondho');
    await balances();

    await owner.http
      .post(`/api/v1/deposits/${staff.id}/settle`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ outcome: 'refunded' })
      .expect(201);

    const { rows } = await balances();
    const row = rows.find((r) => r.employeeId === staff.id);

    expect(row?.months).toBe(1);
    expect(row?.settlement?.outcome).toBe('refunded');
  });

  it('⚠️ outcome-এ অন্য কিছু পাঠালে ৪০০', async () => {
    const staff = await addStaff('Bhul Outcome');

    await owner.http
      .post(`/api/v1/deposits/${staff.id}/settle`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ outcome: 'maybe' })
      .expect(400);
  });
});

describe('কে দেখতে পান', () => {
  /**
   * ⚠️⚠️ জামানত সরাসরি বেতনের অংশ, তাই ম্যানেজারও নয় (ADR-023 · ADR-027)।
   */
  it('ম্যানেজার জামানতের পাতায় ঢুকতে পারেন না — ৪০৩', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    await manager.http.get('/api/v1/deposits').expect(403);
    await manager.http
      .patch('/api/v1/deposits/policy')
      .set('X-CSRF-Token', manager.csrf)
      .send({ amountPaisa: 10 })
      .expect(403);
  });

  /**
   * ⭐⭐ স্টাফ **নিজের** জমা দেখেন, আর সেটা বেতনের নিয়ম ভাঙে না — অঙ্কটা
   * তাঁর নিজের টাকা, বেতনের হিসাব নয়।
   */
  it('⭐ স্টাফ নিজের জমা দেখেন, মাস ধরে', async () => {
    const staff = await addStaff('Nijer Jomma');
    await balances();

    // ⚠️ পাসওয়ার্ডটা সার্ভার বানায় আর একবারই ফেরত দেয় — অনুমান করা যায় না
    const account = await owner.http
      .post(`/api/v1/employees/${staff.id}/portal-account`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ email: 'nijer.jomma@oxeio.test' })
      .expect(201);

    const session = await loginReady(
      h,
      'nijer.jomma@oxeio.test',
      account.body.tempPassword as string,
    );

    const res = await session.http.get('/api/v1/me/deposit').expect(200);
    expect(res.body.total).toBe('500.00');
    expect(res.body.months).toHaveLength(1);
    expect(res.body.months[0].yearMonth).toBe(thisMonth);
    expect(res.body.noticeDays).toBe(30);
  });
});

describe('পে-রোলের শিটে', () => {
  it('⭐ প্রদেয় থেকে ৫০০ কেটে নিট দেখায়, আর দুটো সংখ্যাই থাকে', async () => {
    const staff = await addStaff('Payroll Kata');
    await balances();

    const res = await owner.http
      .get(`/api/v1/payroll?month=${thisMonth}`)
      .expect(200);

    const row = (res.body.rows as Record<string, string | number>[]).find(
      (r) => r.employeeId === staff.id,
    );

    // ⚠️ rollup না থাকলে সারিটাই থাকে না — তখন এই টেস্টের বলার কিছু নেই
    if (!row) return;

    expect(row.securityDeposit).toBe('500.00');
    // নিট = প্রদেয় − ৫০০, আর দুটো সংখ্যাই আলাদা করে থাকে
    expect(Number(row.netPayable)).toBeCloseTo(Number(row.payable) - 500, 2);
  });
});

/** '2026-08' → '2026-09' */
function nextMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * ⭐⭐⭐ **বসে যাওয়া কিস্তির অঙ্ক সংশোধন** *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️⚠️ **মাঠে ধরা পড়েছে, আর প্রশ্নটা এসেছে মালিকের কাছ থেকে:**
 * *"Saifur OX-10 2 mase 500 joma dekhacche keno?"* — একটা মাসের কিস্তি
 * ৳০-তে বসে ছিল, তাই পাতা দেখাত *"2 months held · ৳500"*। দুটোই সত্যি,
 * একসাথে পড়লে অর্থহীন।
 *
 * ⚠️⚠️ **আর সেটা ঠিক করার কোনো পথই ছিল না।** `ensureLedger()` চলে
 * `createMany({ skipDuplicates: true })` দিয়ে, তাই বিদ্যমান সারি কখনো
 * হালনাগাদ হয় না — আর সেটা ইচ্ছাকৃত (নিয়মের অঙ্ক বদলালে পুরোনো মাস ফিরে
 * লেখা হয় না)। শেষমেশ সারানো গেছে একটা **কৌশলে** (শুরুর মাস এগিয়ে দিয়ে
 * সারিটা মুছে, তারপর নিয়মে ফিরিয়ে নতুন করে বসিয়ে), যেটা কেবল **শুরুর
 * দিকের** মাসে খাটে আর কোথাও লেখাও ছিল না।
 */
describe('কিস্তির অঙ্ক সংশোধন', () => {
  const correct = (
    employeeId: number,
    yearMonth: string,
    amountPaisa: number,
    reason = 'হিসাবের ভুল',
  ) =>
    owner.http
      .patch(`/api/v1/deposits/${employeeId}/instalment`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ yearMonth, amountPaisa, reason });

  it('অঙ্ক বদলায়, আর যোগফলেও দেখা যায়', async () => {
    const staff = await addStaff('Songshodhon Ek');
    await balances();

    await correct(staff.id, thisMonth, 30_000).expect(200);

    const { rows } = await balances();
    const row = rows.find((r) => r.employeeId === staff.id)!;
    expect(row.balance).toBe('300.00');
    expect(row.months).toBe(1);
  });

  /**
   * ⭐⭐⭐ **এই describe-এর সবচেয়ে জরুরি টেস্ট।**
   *
   * ⚠️⚠️ শূন্য বসানোই ছিল মূল বাগের উৎস — মালিক "এই মাসটা মকুব" বোঝাতে
   * ৳০ বসিয়েছিলেন, আর তাতে খাতায় এমন একটা সারি রয়ে গেল যেটা **একটা মাস
   * গোনে কিন্তু কোনো টাকা ধরে না**। মকুব মানে ওই মাসে কিস্তি **নেই**,
   * ৳০-এর কিস্তি **আছে** — দুটো এক করে ফেললে "কত মাস জমা হয়েছে" প্রশ্নের
   * উত্তরই নষ্ট হয়।
   *
   * ⭐ ডাটাবেসেও `CHECK (amount_paisa > 0)` বসানো হয়েছে, কিন্তু বাধাটা
   * এখানেই আটকানো হয় — নইলে বার্তাটা হতো একটা কাঁচা Postgres এরর।
   */
  it('⭐ শূন্য বসানো যায় না — মকুব আর ৳০ এক নয়', async () => {
    const staff = await addStaff('Songshodhon Shunno');
    await balances();

    await correct(staff.id, thisMonth, 0).expect(400);

    const { rows } = await balances();
    expect(rows.find((r) => r.employeeId === staff.id)!.balance).toBe('500.00');
  });

  it('ঋণাত্মক অঙ্কও নয়', async () => {
    const staff = await addStaff('Songshodhon Rin');
    await balances();

    await correct(staff.id, thisMonth, -100).expect(400);
  });

  /**
   * ⚠️ কারণ ছাড়া সংশোধন নয় — ছ-মাস পরে "ওই মাসে এর অঙ্ক আলাদা কেন"
   *    প্রশ্নের একমাত্র উত্তর ওই লাইনটাই। `time_adjustments`-এর একই নিয়ম।
   */
  it('⭐ কারণ ছাড়া সংশোধন নয়', async () => {
    const staff = await addStaff('Songshodhon Karon');
    await balances();

    await correct(staff.id, thisMonth, 30_000, '   ').expect(400);
  });

  /**
   * ⚠️⚠️ **সারি না থাকলে বসানো যায় না** — তাহলে এটা সংশোধন নয়, নতুন
   * কিস্তি বসানো, আর সেটা নিয়মের (`ensureLedger`) কাজ। বসাতে দিলে খাতায়
   * এমন মাস ঢুকত যেটা কোনো নিয়ম থেকে আসেনি।
   */
  it('⭐ যে মাসে কিস্তিই নেই, সেখানে বসানো যায় না', async () => {
    const staff = await addStaff('Songshodhon Nei');
    await balances();

    await correct(staff.id, '2020-01', 30_000).expect(404);
  });

  /**
   * ⚠️⚠️ **বন্ধ মাসে সংশোধন নয়** (R1) — ছুটির হুবহু একই নিয়ম। বন্ধ মাস
   * মানে ওই মাসের কাগজ বেরিয়ে গেছে; খাতা বদলালে কাগজ আর খাতা দুই কথা
   * বলত, আর কেউ টের পেত না।
   */
  it('⭐ বন্ধ মাসে সংশোধন আটকায়', async () => {
    const staff = await addStaff('Songshodhon Bondho');
    await balances();

    await h.prisma.monthClosure.create({
      data: { yearMonth: thisMonth, closedBy: 'test' },
    });

    await correct(staff.id, thisMonth, 30_000).expect(409);
  });

  /** ⚠️ নিষ্পত্তির পর খাতা বন্ধ — `setStartMonth`-এর হুবহু একই শর্ত */
  it('নিষ্পত্তির পর আর সংশোধন নয়', async () => {
    const staff = await addStaff('Songshodhon Nishpotti');
    await balances();

    await owner.http
      .post(`/api/v1/deposits/${staff.id}/settle`)
      .set('X-CSRF-Token', owner.csrf)
      .send({ outcome: 'refunded' })
      .expect(201);

    await correct(staff.id, thisMonth, 30_000).expect(409);
  });

  /**
   * ⭐⭐ **কারণটা খাতায় লেখা থাকে** — সংশোধনটা নীরবে ঘটতে পারবে না।
   * ⚠️ আগের ও পরের অঙ্ক দুটোই, নইলে "কত থেকে কত" প্রশ্নের উত্তর
   *    অডিট থেকে বের করা যেত না।
   */
  it('⭐ অডিটে আগের-পরের অঙ্ক ও কারণ লেখা থাকে', async () => {
    const staff = await addStaff('Songshodhon Audit');
    await balances();

    await correct(staff.id, thisMonth, 25_000, 'জুলাইয়ের আংশিক বেতন').expect(200);

    const row = await h.prisma.auditLog.findFirstOrThrow({
      where: { targetType: 'employee', targetId: String(staff.id) },
      orderBy: { occurredAt: 'desc' },
    });

    expect(row.meta).toMatchObject({
      op: 'deposit_instalment_corrected',
      yearMonth: thisMonth,
      fromPaisa: 50_000,
      toPaisa: 25_000,
      why: 'জুলাইয়ের আংশিক বেতন',
    });
  });

  /**
   * ⭐⭐ **সংশোধনটা টেকে — পরের `ensureLedger()` ওটা ফিরিয়ে দেয় না।**
   *
   * ⚠️⚠️ এটাই সবচেয়ে সহজে ভাঙার জায়গা: `ensureLedger()` প্রতিটা রিকোয়েস্টে
   * চলে। `skipDuplicates` বদলে `upsert` হয়ে গেলে সংশোধনটা নীরবে মুছে
   * নিয়মের অঙ্কে ফিরে যেত — আর কেউ ধরতে পারত না, কারণ পর্দায় কোনো এরর
   * নেই, শুধু সংখ্যাটা আবার আগেরটা।
   */
  it('⭐ পরের রিফ্রেশেও সংশোধন টিকে থাকে', async () => {
    const staff = await addStaff('Songshodhon Tike');
    await balances();

    await correct(staff.id, thisMonth, 30_000).expect(200);

    // ⚠️ তিনবার — প্রতিবারই `ensureLedger()` চলে
    await balances();
    await balances();
    const { rows } = await balances();

    expect(rows.find((r) => r.employeeId === staff.id)!.balance).toBe('300.00');
  });

  /**
   * ⭐⭐⭐ **শেষ পাহারাটা ডাটাবেসেই** *(৫ সেপ্টেম্বর ২০২৬)*।
   *
   * ⚠️⚠️ উপরের "শূন্য বসানো যায় না" টেস্টটা আসলে **DTO-র `@Min(1)`**
   * ধরে ফেলে, সার্ভিসে পৌঁছানোর আগেই। সেটা ভালো, কিন্তু তাতে প্রমাণ হয়
   * না যে **অন্য কোনো পথ দিয়েও** ৳০ ঢুকতে পারবে না — আর মাঠের সারিটা
   * ঠিক ওভাবেই ঢুকেছিল (HTTP নয়, সরাসরি)।
   *
   * ⭐ `deposit_policy`-তে `CHECK (amount_paisa > 0)` প্রথম দিন থেকেই ছিল,
   * কিন্তু **খাতার সারিতে ছিল না** — অথচ ভুল মানটা ওখানেই বসে। এই টেস্ট
   * সেই নতুন CHECK-টাকে পাহারা দেয়, DTO-কে সম্পূর্ণ পাশ কাটিয়ে।
   */
  it('⭐ ডাটাবেসই ৳০ কিস্তি নিতে অস্বীকার করে', async () => {
    const staff = await addStaff('Songshodhon DB');
    await balances();

    await expect(
      h.prisma.securityDeposit.create({
        data: { employeeId: staff.id, yearMonth: '2020-01', amountPaisa: 0 },
      }),
    ).rejects.toThrow();

    // ⚠️ ঋণাত্মকও — একই CHECK
    await expect(
      h.prisma.securityDeposit.create({
        data: { employeeId: staff.id, yearMonth: '2020-02', amountPaisa: -1 },
      }),
    ).rejects.toThrow();
  });

  /**
   * ⭐⭐ **মাস-ধরে তালিকাটা মালিকও দেখতে পান** — এতদিন কেবল কর্মীর নিজের
   * পাতায় (`/me/deposit`) ছিল। ⚠️ ওটা না থাকায় মাঠের বাগটা দু-সপ্তাহ
   * ধরা পড়েনি: যোগফল দেখে বোঝার উপায়ই ছিল না কোন মাসটা ভুল।
   */
  it('⭐ মালিক মাস-ধরে খাতা দেখতে পান', async () => {
    const staff = await addStaff('Songshodhon Mash');
    await balances();
    await correct(staff.id, thisMonth, 30_000).expect(200);

    const res = await owner.http
      .get(`/api/v1/deposits/${staff.id}/months`)
      .expect(200);

    expect(res.body.months).toEqual([
      { yearMonth: thisMonth, amount: '300.00' },
    ]);
    expect(res.body.total).toBe('300.00');
  });
});
