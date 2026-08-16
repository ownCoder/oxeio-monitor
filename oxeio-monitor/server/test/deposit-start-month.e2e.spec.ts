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
} from './setup/harness';

/**
 * **R21** — এই কর্মীর জামানত **কোন মাস থেকে** কাটা শুরু।
 *
 * ⚠️⚠️ এতদিন শুরুর মাস ছিল গোটা অফিসের জন্য একটাই। কিন্তু কর্মীরা আলাদা
 * সময়ে যোগ দেন, আর কারো কাটা শুরু হয়েছিল অন্য মাস থেকে — সেটা বলার কোনো
 * জায়গাই ছিল না, তাই খাতা ভুল থাকত আর ঠিক করার উপায়ও ছিল না।
 *
 * ⭐⭐ এই ফাইলের সবচেয়ে জরুরি দাবি: **মাস এগিয়ে দিলে আগের ভুল কিস্তি
 * মুছে যায়।** না মুছলে "সংশোধন" করেও খাতায় ভুলটা রয়ে যেত, আর মালিক
 * ভাবতেন সেভই হয়নি।
 */
let h: Harness;
let owner: Session;
let employeeId: number;

const POLICY_START = '2026-01';

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);
  owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

  await h.prisma.depositPolicy.upsert({
    where: { id: 1 },
    update: {
      amountPaisa: 50_000,
      startYearMonth: POLICY_START,
      active: true,
      updatedBy: 'test',
    },
    create: {
      id: 1,
      amountPaisa: 50_000,
      startYearMonth: POLICY_START,
      active: true,
      updatedBy: 'test',
    },
  });

  const employee = await h.prisma.employee.create({
    data: { empCode: `DS-${Date.now()}`, fullName: 'Belal Hossain' },
  });
  employeeId = employee.id;
});

const setStart = (yearMonth: string | null, id = employeeId) =>
  owner.http
    .patch(`/api/v1/deposits/${id}/start`)
    .set('X-CSRF-Token', owner.csrf)
    .send({ yearMonth });

const months = () =>
  h.prisma.securityDeposit.findMany({
    where: { employeeId },
    orderBy: { yearMonth: 'asc' },
    select: { yearMonth: true },
  });

/** খাতা ভরাতে তালিকাটা একবার ডাকা — `balances()` নিজেই `ensureLedger()` চালায় */
const fillLedger = () => owner.http.get('/api/v1/deposits').expect(200);

describe('PATCH /deposits/:id/start', () => {
  it('না বসালে নিয়মের শুরুর মাস থেকেই খাতা ভরে', async () => {
    await fillLedger();

    const rows = await months();
    expect(rows[0].yearMonth).toBe(POLICY_START);
  });

  /**
   * ⭐⭐ **এই ফাইলের মূল টেস্ট।** মাস এগিয়ে দিলে আগের কিস্তি মুছে যায় —
   * নইলে ভুল সংশোধনের কোনো মানেই থাকে না।
   */
  it('মাস এগিয়ে দিলে আগের কিস্তি মুছে যায়', async () => {
    await fillLedger();
    expect((await months())[0].yearMonth).toBe(POLICY_START);

    const res = await setStart('2026-05').expect(200);

    expect(res.body.removed).toBeGreaterThan(0);
    expect((await months())[0].yearMonth).toBe('2026-05');
  });

  it('মাস পিছিয়ে দিলে আগের মাসগুলোও যোগ হয়', async () => {
    await setStart('2026-06').expect(200);
    await fillLedger();
    expect((await months())[0].yearMonth).toBe('2026-06');

    const res = await setStart('2026-02').expect(200);

    expect(res.body.added).toBeGreaterThan(0);
    expect((await months())[0].yearMonth).toBe('2026-02');
  });

  /** ⭐ `null` — নিয়মের সাধারণ মাসে ফেরত, আর সেটাও একটা বৈধ কাজ */
  it('null দিলে নিয়মের মাসে ফিরে যায়', async () => {
    await setStart('2026-06').expect(200);
    await setStart(null).expect(200);
    await fillLedger();

    expect((await months())[0].yearMonth).toBe(POLICY_START);
    const row = await h.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(row.depositStartYearMonth).toBeNull();
  });

  it('তালিকায় বেছে দেওয়া ও কার্যকর — দুটোই আসে', async () => {
    await setStart('2026-04').expect(200);

    const res = await owner.http.get('/api/v1/deposits').expect(200);
    const row = (res.body.rows as Record<string, unknown>[]).find(
      (r) => r.employeeId === employeeId,
    );

    expect(row).toMatchObject({ startYearMonth: '2026-04', effectiveStart: '2026-04' });
  });

  /**
   * ⭐⭐ **যোগদানের তারিখের উপরেও মালিকের কথাই চলে।** `joined_on` প্রায়ই
   * অনুমান বা ফাঁকা; এই ঘরটা মালিক নিজে বেছে দেন — অনুমান বিবৃতিকে
   * হারালে সংশোধন করেও কিছু বদলাত না, আর কেন তা বোঝা যেত না।
   */
  it('joined_on-এর চেয়ে মালিকের বেছে দেওয়া মাসই চলে', async () => {
    await h.prisma.employee.update({
      where: { id: employeeId },
      data: { joinedOn: new Date('2026-07-01T00:00:00.000Z') },
    });

    await setStart('2026-03').expect(200);
    await fillLedger();

    expect((await months())[0].yearMonth).toBe('2026-03');
  });

  it('ভুল ধাঁচ ৪০০', async () => {
    await setStart('2026/03').expect(400);
    await setStart('March').expect(400);
  });

  /** ⚠️ ভবিষ্যতের মাস দিলে খাতা চুপচাপ খালি হয়ে যেত */
  it('ভবিষ্যতের মাস ৪০০', async () => {
    await setStart('2099-01').expect(400);
  });

  /** ⚠️⚠️ নিষ্পত্তি হয়ে গেলে খাতা বন্ধ — মিটে যাওয়া হিসাব নাড়ানো যাবে না */
  it('নিষ্পত্তি হয়ে গেলে বদলানো যায় না', async () => {
    await fillLedger();
    await h.prisma.depositSettlement.create({
      data: {
        employeeId,
        outcome: 'refunded',
        amountPaisa: 50_000,
        // ⚠️ বাধ্যতামূলক — নিষ্পত্তির সময় নিয়মটা কত দিনের ছিল, সেটাও
        //    সারিতেই লেখা থাকে (নিয়ম পরে বদলালেও ইতিহাস নড়ে না)
        noticeDaysRule: 30,
        settledBy: 'owner@test',
      },
    });

    const res = await setStart('2026-05');

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/settled/i);
  });

  it('অচেনা কর্মী ৪০৪', async () => {
    await setStart('2026-05', 999_999).expect(404);
  });

  /** ⚠️ জামানত সরাসরি বেতনের অংশ — ম্যানেজারও নয় (ADR-023 · ADR-027) */
  it('ম্যানেজার পারেন না', async () => {
    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    await manager.http
      .patch(`/api/v1/deposits/${employeeId}/start`)
      .set('X-CSRF-Token', manager.csrf)
      .send({ yearMonth: '2026-05' })
      .expect(403);
  });

  it('একই মাস আবার বসালে কিছুই বদলায় না', async () => {
    await setStart('2026-05').expect(200);

    const res = await setStart('2026-05').expect(200);

    expect(res.body).toEqual({ removed: 0, added: 0 });
  });

  it('বদলটা audit log-এ ওঠে', async () => {
    await setStart('2026-05').expect(200);

    const row = await h.prisma.auditLog.findFirstOrThrow({
      where: { targetId: String(employeeId), action: 'deposit_policy_update' },
      orderBy: { id: 'desc' },
    });

    expect(row.meta).toMatchObject({ op: 'deposit_start_month', to: '2026-05' });
  });
});
