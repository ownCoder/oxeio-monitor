import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../src/audit/audit.service';
import { WorkPoliciesService } from '../src/admin/work-policies.service';
import type { SessionUser } from '../src/auth/types';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * **G85 — বন্ধ করার কোডের সাথে খোলার কোডও।**
 *
 * `deactivate()` ছিল, `reactivate()` ছিল না। ফলে একবার নিষ্ক্রিয় করা
 * পলিসি **চিরতরে** নিষ্ক্রিয় থাকত, আর ফেরার একমাত্র পথ ছিল সার্ভারে
 * বসে SQL।
 *
 * ⭐ এটা মাঠে ধরা পড়েনি — ধরা পড়েছে **G84 সারানোর পর নিয়মটা লিখে রেখে
 * একই চোখে বাকি কোড দেখতে গিয়ে**। সেটাই নিয়ম লিখে রাখার আসল লাভ: একটা
 * বাগ সারানোর পর একই ধাঁচের বাকিগুলো খোঁজা যায়, পরেরটা মাঠে ধরা পড়ার
 * অপেক্ষা না করে।
 *
 * ⭐ DB ছাড়াই টেস্ট, কারণ এখানকার প্রশ্নগুলো লজিকের: **কোন অবস্থায়
 * থামে, কী লেখে, আর কী ফেরত দেয়।**
 */

const ACTOR = { userId: 1 } as unknown as SessionUser;

const POLICY = {
  id: 4,
  name: 'Default',
  monthlyTargetHours: 208,
  expectedWorkdays: 26,
  weeklyOffDay: 5,
  screenshotFrom: '07:00',
  screenshotTo: '23:00',
  idleThresholdSec: 60,
  slotMinutes: 5,
  timezone: 'Asia/Dhaka',
  isActive: false,
};

function makeService(overrides: {
  findUnique?: unknown;
  update?: ReturnType<typeof vi.fn>;
  record?: ReturnType<typeof vi.fn>;
}) {
  const update =
    overrides.update ??
    vi.fn().mockResolvedValue({ ...POLICY, isActive: true });
  const record = overrides.record ?? vi.fn().mockResolvedValue(undefined);

  const prisma = {
    workPolicy: {
      findUnique: vi.fn().mockResolvedValue(overrides.findUnique),
      update,
    },
  } as unknown as PrismaService;

  const audit = { record } as unknown as AuditService;

  return {
    svc: new WorkPoliciesService(prisma, audit),
    update,
    record,
  };
}

describe('G85 · work policy আবার সক্রিয় করা', () => {
  it('নিষ্ক্রিয় পলিসি সক্রিয় হয়, আর ফেরত আসা view-তে সেটা দেখা যায়', async () => {
    const { svc, update } = makeService({
      findUnique: { ...POLICY, _count: { employees: 0 } },
    });

    const view = await svc.reactivate(ACTOR, 4, '10.0.0.1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { isActive: true },
    });
    expect(view.isActive).toBe(true);
  });

  it('নেই এমন পলিসিতে ৪০৪', async () => {
    const { svc } = makeService({ findUnique: null });

    await expect(svc.reactivate(ACTOR, 99, '10.0.0.1')).rejects.toThrow(
      NotFoundException,
    );
  });

  /**
   * ⚠️ আগে থেকেই সক্রিয় হলে ৪০৯ — নইলে audit log-এ এমন "বদল" জমত
   * যেখানে আসলে কিছুই বদলায়নি, ঠিক যে কারণে ভূমিকা বদলের রুটেও
   * একই মান বসালে কিছু লেখা হয় না (G87)।
   */
  it('আগে থেকেই সক্রিয় হলে ৪০৯, আর কিছুই লেখা হয় না', async () => {
    const { svc, update, record } = makeService({
      findUnique: { ...POLICY, isActive: true, _count: { employees: 0 } },
    });

    await expect(svc.reactivate(ACTOR, 4, '10.0.0.1')).rejects.toThrow(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('audit log-এ op ও নাম দুটোই যায়', async () => {
    const { svc, record } = makeService({
      findUnique: { ...POLICY, _count: { employees: 0 } },
    });

    await svc.reactivate(ACTOR, 4, '10.0.0.1');

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        targetId: 4,
        ipAddress: '10.0.0.1',
        meta: { op: 'reactivate', name: 'Default' },
      }),
    );
  });

  /**
   * ⚠️⚠️ সবচেয়ে সূক্ষ্ম টেস্ট। `deactivate()` শেষে `toView(row, 0)` লেখে,
   * আর সেটা **ঠিক** — সে শূন্য না হলে চলতেই দেয় না।
   *
   * কিন্তু এখানে শূন্য ধরে নেওয়া হতো একটা **অনুমান**: নিষ্ক্রিয় পলিসিতে
   * কর্মী থাকা সম্ভব (কেউ SQL দিয়ে বসিয়ে দিলে, বা ভবিষ্যতে নিয়ম বদলালে),
   * আর তখন পর্দা "0 staff" দেখাত অথচ বাস্তবে তাঁরা আছেন।
   */
  it('কর্মী-সংখ্যা আসল গোনা থেকেই আসে, শূন্য ধরে নয়', async () => {
    const { svc } = makeService({
      findUnique: { ...POLICY, _count: { employees: 12 } },
    });

    const view = await svc.reactivate(ACTOR, 4, '10.0.0.1');

    expect(view.employeeCount).toBe(12);
  });
});
