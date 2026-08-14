import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MonthCloseService } from '../src/admin/month-close.service';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/types';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * ⭐⭐ **R1 — মাস বন্ধ করা।**
 *
 * ⚠️⚠️ যে বিপদটা এই ফিচার ঠেকায়: `monthly_summary`-র সংখ্যা প্রতিবার
 * নতুন করে গোনা হয়, আর গোনার সময় **ওই মুহূর্তের** ছুটির তালিকা পড়া হয়।
 * তাই বেতন দিয়ে দেওয়ার পরেও একটা ছুটির তারিখ নড়লে d ও D বদলে যেত —
 * আর কোন সংখ্যায় বেতন হয়েছিল তা প্রমাণ করার উপায় থাকত না।
 *
 * ⭐ এখানকার টেস্টগুলো **সীমানার** — কারণ ভুলগুলো সীমানাতেই: চলতি মাস
 * বন্ধ করা, দুবার বন্ধ করা, ভুল ছাঁদের চাবি।
 */

const OWNER: SessionUser = {
  userId: 1,
  email: 'owner@example.com',
  role: 'owner',
} as SessionUser;

function makeService(closures: Record<string, { closedAt: Date; closedBy: string; note: string | null }> = {}) {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  const prisma = {
    monthClosure: {
      findUnique: vi.fn(({ where }: { where: { yearMonth: string } }) =>
        Promise.resolve(
          closures[where.yearMonth]
            ? { yearMonth: where.yearMonth, ...closures[where.yearMonth] }
            : null,
        ),
      ),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, closedAt: new Date('2026-09-03T10:00:00Z') }),
      ),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };

  return {
    svc: new MonthCloseService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
    prisma,
    audit,
  };
}

describe('MonthCloseService', () => {
  beforeEach(() => {
    // ⚠️ "আজ" স্থির করা — নইলে টেস্টটা মাস বদলালেই ভাঙত, আর ভাঙার কারণ
    //    দেখে মনে হতো কোড ভুল, অথচ ক্যালেন্ডার এগিয়েছে।
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
  });

  describe('বন্ধ করা', () => {
    it('শেষ হয়ে যাওয়া মাস বন্ধ হয়', async () => {
      const { svc, audit } = makeService();
      const row = await svc.close(OWNER, '2026-08', 'বেতন ৩ সেপ্টেম্বর দেওয়া', '1.2.3.4');

      expect(row.yearMonth).toBe('2026-08');
      expect(row.closedBy).toBe('owner@example.com');
      expect(row.note).toBe('বেতন ৩ সেপ্টেম্বর দেওয়া');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'month_closed', targetId: '2026-08' }),
      );
    });

    /**
     * ⚠️⚠️ **সবচেয়ে জরুরি টেস্ট।** চলতি মাস বন্ধ করা গেলে আজকের ঘণ্টাগুলো
     * আর যোগ হতো না — আর ব্যর্থতাটা হতো নীরব: কেউ বলত "আজকের ঘণ্টা উঠছে
     * না", আর কারণ খুঁজতে কেউ মাস-বন্ধের পাতায় আসত না।
     */
    it('⭐ চলতি মাস বন্ধ করা যায় না', async () => {
      const { svc } = makeService();
      await expect(svc.close(OWNER, '2026-09', undefined, 'ip')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ভবিষ্যতের মাসও নয়', async () => {
      const { svc } = makeService();
      await expect(svc.close(OWNER, '2026-12', undefined, 'ip')).rejects.toThrow(
        BadRequestException,
      );
    });

    /**
     * ⭐ দ্বিতীয়বার বন্ধ করলে **প্রথমজনের নাম-তারিখই থাকে** — রেকর্ডটা
     * বদলে গেলে "কখন জমাট হয়েছিল" প্রশ্নের উত্তর হারাত।
     */
    it('দুবার বন্ধ করা যায় না, আর প্রথম রেকর্ডটাই থাকে', async () => {
      const { svc, prisma } = makeService({
        '2026-08': { closedAt: new Date('2026-09-01T09:00:00Z'), closedBy: 'first@example.com', note: null },
      });

      await expect(svc.close(OWNER, '2026-08', undefined, 'ip')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.monthClosure.create).not.toHaveBeenCalled();
    });

    it.each(['2026-8', '2026-13', '26-08', 'aug-2026', ''])(
      'ভুল ছাঁদের চাবি ফিরিয়ে দেয় — %s',
      async (bad) => {
        const { svc } = makeService();
        await expect(svc.close(OWNER, bad, undefined, 'ip')).rejects.toThrow(
          BadRequestException,
        );
      },
    );

    it('খালি নোট `null` হয়ে যায়, খালি স্ট্রিং নয়', async () => {
      const { svc, prisma } = makeService();
      await svc.close(OWNER, '2026-08', '   ', 'ip');
      expect(prisma.monthClosure.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ note: null }) }),
      );
    });
  });

  describe('খোলা', () => {
    it('বন্ধ না থাকলে ৪০৪', async () => {
      const { svc } = makeService();
      await expect(svc.reopen(OWNER, '2026-08', 'ip')).rejects.toThrow(NotFoundException);
    });

    /**
     * ⚠️⚠️ খোলার audit সারিতে **পুরোনো বন্ধের তথ্য** থাকতেই হবে — সারিটা
     * DB থেকে মুছে যায়, তাই ওটাই একমাত্র জায়গা যেখানে "কে কখন বন্ধ
     * করেছিল" টিকে থাকে। না রাখলে বেতনের পর মাস খুলে সংখ্যা বদলানোর
     * ইতিহাসটাই অসম্পূর্ণ হতো।
     */
    it('⭐ খোলার রেকর্ডে পুরোনো বন্ধের তথ্য থাকে', async () => {
      const { svc, audit } = makeService({
        '2026-08': { closedAt: new Date('2026-09-01T09:00:00Z'), closedBy: 'first@example.com', note: null },
      });

      await svc.reopen(OWNER, '2026-08', 'ip');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'month_reopened',
          meta: expect.objectContaining({ closedBy: 'first@example.com' }),
        }),
      );
    });
  });
});
