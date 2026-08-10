import { describe, expect, it } from 'vitest';

import {
  canSeeSalary,
  toEmployeeView,
  toEmployeeViews,
  type EmployeeRow,
  type OwnerEmployeeView,
} from '../src/admin/redact';

/**
 * ⚠️ `monthlySalary`-তে সাধারণ `number` বসানো হয়েছে — `Decimalish`-এর
 * আকারই তো `toFixed(digits)`, আর `number` সেটা মেনে চলে। এজন্যই
 * `redact.ts`-এ Prisma-র Decimal ইমপোর্ট করা হয়নি: টেস্টে ডাটাবেসের
 * কোনো টাইপ দরকার হয় না।
 */
function row(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    id: 3,
    empCode: 'EMP-003',
    fullName: 'রুমানা হক',
    email: 'rumana@example.com',
    designation: 'Designer',
    department: 'Creative',
    policyId: 1,
    monthlySalary: 13000,
    joinedOn: new Date('2025-03-01T00:00:00.000Z'),
    leftOn: null,
    status: 'active',
    policySignedAt: new Date('2025-03-02T04:30:00.000Z'),
    policyDocPath: 'policies/emp-003.pdf',
    createdAt: new Date('2025-03-01T06:00:00.000Z'),
    ...overrides,
  };
}

describe('redact — বেতন কার কাছে যাবে (ADR-023 · স্পেক § ৪.৩)', () => {
  it('owner বেতন দেখতে পায়, দুই দশমিকের স্ট্রিং হিসেবে', () => {
    const view = toEmployeeView(row(), 'owner') as OwnerEmployeeView;

    expect(view.monthlySalary).toBe('13000.00');
  });

  /** ⭐ পুরো ফাইলটার কারণ এই একটা টেস্ট */
  it('ম্যানেজারের রেসপন্সে ফিল্ডটাই থাকে না — null নয়, অনুপস্থিত', () => {
    const view = toEmployeeView(row(), 'manager');

    expect('monthlySalary' in view).toBe(false);
    expect(Object.keys(view)).not.toContain('monthlySalary');
  });

  it('স্টাফ নিজেও (role = employee) বেতনের ফিল্ড পায় না', () => {
    const view = toEmployeeView(row(), 'employee');

    expect('monthlySalary' in view).toBe(false);
  });

  /**
   * ⚠️ `monthlySalary: undefined` লিখলে JSON-এ ফিল্ডটা উধাও হয় ঠিকই, কিন্তু
   * `in` তখনো true বলত। এই দুটো টেস্ট একসাথে সেই ফাঁকিটা ধরে ফেলে।
   */
  it('ম্যানেজারের JSON-এও শব্দটা কোথাও নেই', () => {
    const json = JSON.stringify(toEmployeeView(row(), 'manager'));

    expect(json).not.toContain('monthlySalary');
    expect(json).not.toContain('13000');
  });

  it('owner-এর ক্ষেত্রে বেতন বসানো না থাকলে null যায় — ফিল্ডটা তবু থাকে', () => {
    // "বেতন বসানো নেই" আর "ম্যানেজার দেখতে পায় না" দুটো আলাদা তথ্য;
    // দুটোকেই "ফিল্ড নেই" বানিয়ে ফেললে owner বুঝতেই পারত না কার বেতন বাকি
    const view = toEmployeeView(
      row({ monthlySalary: null }),
      'owner',
    ) as OwnerEmployeeView;

    expect('monthlySalary' in view).toBe(true);
    expect(view.monthlySalary).toBeNull();
  });

  /**
   * ⭐ whitelist বনাম blacklist-এর আসল পরীক্ষা।
   *
   * স্কিমায় কাল যদি `bankAccount` যোগ হয় আর কেউ `redact.ts` হালনাগাদ করতে
   * ভুলে যায় — blacklist ধাঁচে (`delete copy.monthlySalary`) সেটা চুপচাপ
   * ম্যানেজারের রেসপন্সে চলে যেত। এখানে যায় না।
   */
  it('সারিতে অচেনা সংবেদনশীল কলাম থাকলেও সেটা রেসপন্সে ওঠে না', () => {
    const future = {
      ...row(),
      bankAccount: '0123456789',
      nid: '1990123456789',
    } as EmployeeRow;

    for (const role of ['owner', 'manager'] as const) {
      const view = toEmployeeView(future, role);
      expect('bankAccount' in view).toBe(false);
      expect('nid' in view).toBe(false);
    }
  });

  it('তারিখের কলাম YYYY-MM-DD হয়, টাইমস্ট্যাম্প পুরো ISO', () => {
    const view = toEmployeeView(row(), 'owner');

    expect(view.joinedOn).toBe('2025-03-01');
    expect(view.leftOn).toBeNull();
    expect(view.policySignedAt).toBe('2025-03-02T04:30:00.000Z');
  });

  it('তালিকার প্রতিটা সারিতেই একই নিয়ম খাটে', () => {
    const rows = [row({ id: 1 }), row({ id: 2, monthlySalary: 10000 })];

    const asManager = toEmployeeViews(rows, 'manager');
    expect(asManager).toHaveLength(2);
    expect(asManager.every((v) => !('monthlySalary' in v))).toBe(true);

    const asOwner = toEmployeeViews(rows, 'owner') as OwnerEmployeeView[];
    expect(asOwner.map((v) => v.monthlySalary)).toEqual([
      '13000.00',
      '10000.00',
    ]);
  });

  it('canSeeSalary শুধু owner-এ true', () => {
    expect(canSeeSalary('owner')).toBe(true);
    expect(canSeeSalary('manager')).toBe(false);
    expect(canSeeSalary('employee')).toBe(false);
  });

  /**
   * ⚠️ `Number(13000.10).toString()` = '13000.1' — এক দশমিক। বেতনের অঙ্ক
   * এভাবে দেখালে ফ্রন্টএন্ডে কখনো ১০.৫ কখনো ১০.৫০ দেখাত।
   */
  it('ভগ্নাংশওয়ালা বেতনেও দুই দশমিক থাকে', () => {
    const view = toEmployeeView(
      row({ monthlySalary: 13000.1 }),
      'owner',
    ) as OwnerEmployeeView;

    expect(view.monthlySalary).toBe('13000.10');
  });
});
