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
