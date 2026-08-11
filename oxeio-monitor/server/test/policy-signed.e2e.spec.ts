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
} from './setup/harness';

/**
 * ⭐ **রোলআউটের একমাত্র শর্ত** — "সই ছাড়া কারো PC-তে এজেন্ট বসবে না"
 * ([01 § রোলআউট](../../docs/01-Planning.md))।
 *
 * ⚠️ এতদিন `policy_signed_at` কলামটা ছিল, API পড়ত, ওয়েবে টাইপ করা ছিল —
 * কিন্তু **বসানোর কোনো পথ ছিল না**। অর্থাৎ শর্তটা সিস্টেমে রেকর্ডই করা
 * যেত না। এই টেস্টগুলো সেই পথটার পাহারা।
 */
let h: Harness;
let employeeId: number;

const today = (): string => {
  // ঢাকার আজকের তারিখ (UTC+6, DST নেই)
  const dhaka = new Date(Date.now() + 6 * 3600_000);
  return dhaka.toISOString().slice(0, 10);
};

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await resetDatabase(h.prisma, h.app);

  const policy = await h.prisma.workPolicy.create({
    data: { name: 'test', monthlyTargetHours: 208, isActive: true },
  });

  const employee = await h.prisma.employee.create({
    data: { empCode: 'OX-99', fullName: 'Policy Test', policyId: policy.id },
  });

  employeeId = employee.id;
});

describe('সই রেকর্ড করা (রোলআউটের শর্ত)', () => {
  it('তারিখ না দিলে আজকের তারিখ বসে', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.policySignedAt).toBeTruthy();
    expect(String(res.body.policySignedAt).slice(0, 10)).toBe(today());
  });

  /**
   * ⚠️ কাগজ প্রায়ই আগে সই হয়, ড্যাশবোর্ডে বসানো হয় দু-দিন পরে। বসানোর
   * দিনটাকে সইয়ের দিন ধরে নিলে রেকর্ডটা কাগজের সাথে মিলত না।
   */
  it('পুরোনো তারিখ দেওয়া যায়', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf)
      .send({ signedOn: '2026-08-03' });

    expect(res.status).toBe(200);
    expect(String(res.body.policySignedAt).slice(0, 10)).toBe('2026-08-03');
  });

  /**
   * ⭐ কাগজ সই হওয়ার **আগেই** রেকর্ড হয়ে গেলে গোটা শর্তটার মানেই থাকে না।
   */
  it('ভবিষ্যতের তারিখ নাকচ', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf)
      .send({ signedOn: soon });

    expect(res.status).toBe(400);
  });

  it('ভুল ফরম্যাটের তারিখ নাকচ', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf)
      .send({ signedOn: '03-08-2026' });

    expect(res.status).toBe(400);
  });

  it('অচেনা কর্মীতে ৪০৪', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    const res = await s.http
      .post('/api/v1/employees/999999/policy-signed')
      .set('X-CSRF-Token', s.csrf)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe('সই তুলে নেওয়া', () => {
  it('DELETE-এ তারিখ শূন্য হয়, কর্মী থেকে যায়', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    await s.http
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf)
      .send({});

    const res = await s.http
      .delete(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf);

    expect(res.status).toBe(200);
    expect(res.body.policySignedAt).toBeNull();

    // ⚠️ কর্মীর সারি অক্ষত — DELETE যেন কখনো কর্মী না মোছে
    const row = await h.prisma.employee.findUnique({ where: { id: employeeId } });
    expect(row).not.toBeNull();
    expect(row?.empCode).toBe('OX-99');
  });
});

describe('অডিট ও অনুমতি', () => {
  /**
   * ⭐ `change_setting`-এ মিশে গেলে ছ-মাস পরে "ওর সই কি সত্যিই নেওয়া
   * হয়েছিল" প্রশ্নের উত্তর আর খুঁজে পাওয়া যেত না।
   */
  it('আলাদা audit action বসে, আগের মানসহ', async () => {
    const s = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);

    await s.http
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf)
      .send({ signedOn: '2026-08-03' });

    await s.http
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf)
      .send({ signedOn: '2026-08-05' });

    await s.http
      .delete(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf);

    const rows = await h.prisma.auditLog.findMany({
      where: { targetId: String(employeeId) },
      orderBy: { id: 'asc' },
    });

    const actions = rows.map((r) => r.action);
    expect(actions).toContain('policy_signed');
    expect(actions).toContain('policy_signed_cleared');

    // দ্বিতীয়বার বসানোয় আগেরটাও meta-তে থাকা চাই — সংশোধন নাকি ভুল, বোঝার জন্য
    const second = rows.filter((r) => r.action === 'policy_signed')[1];
    expect(JSON.stringify(second.meta)).toContain('2026-08-03');
  });

  /**
   * ⚠️ CSRF হেডারটা **দিতেই হবে** — না দিলে ৪০৩ আসত CSRF গার্ড থেকে, আর
   * টেস্টটা পাস করত ভুল কারণে। তখন কেউ role guard সরিয়ে দিলেও এটা সবুজই
   * থাকত।
   */
  it('ম্যানেজার সই বসাতে পারে না (CSRF নয়, role guard)', async () => {
    const s = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);

    const res = await s.http
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .set('X-CSRF-Token', s.csrf)
      .send({});

    expect(res.status).toBe(403);
  });

  it('লগইন ছাড়া বন্ধ', async () => {
    // ⚠️ এখানে CSRF হেডার **নেই**, ইচ্ছাকৃতভাবে — সেশনই নেই, তাই টোকেনও
    //    নেই। ৪০১ আসা চাই, ৪০৩ নয়: গার্ডের ক্রম ঠিক আছে কি না সেটাই দেখা
    //    হচ্ছে (§ ৩.১-এর সেই সংশোধন)।
    const res = await h
      .http()
      .post(`/api/v1/employees/${employeeId}/policy-signed`)
      .send({});

    expect(res.status).toBe(401);
  });
});
