import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { workDateOf } from '../agent/util/dhaka-time';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { MonthDeliveryService } from '../reports/month-delivery.service';

export interface MonthClosureView {
  yearMonth: string;
  closedAt: string;
  closedBy: string;
  note: string | null;
}

/**
 * R1 — **মাস বন্ধ করা (payroll lock)।**
 *
 * ⚠️⚠️ যে সমস্যাটা এটা সারায়, আর কেন এটা "সবার আগে": `monthly_summary`-র
 * সংখ্যাগুলো `refreshMonth()` **প্রতিবার নতুন করে গোনে**, আর গোনার সময়
 * **ওই মুহূর্তের** `holidays` টেবিল পড়ে। তাই ছুটির একটা তারিখ নড়লে — বা
 * পুরোনো মাসের কোনো সময়-সংশোধন অনুমোদন/বাতিল হলে — গত মাসের `target_sec`,
 * `expected_sec`, d আর D চারটেই পিছন ফিরে বদলাত। পে-রোল ওই সারি থেকেই
 * d ও D পড়ে, অর্থাৎ **বেতন দিয়ে দেওয়ার পরেও হিসাব নড়ত**, নীরবে।
 *
 * ⭐ বন্ধ করা মানে সংখ্যা কোথাও **কপি করা নয়** — `monthly_summary`-তেই
 * ওগুলো থেকে যায়, শুধু কেউ আর ছোঁয় না। এক সংখ্যা, এক জায়গা।
 */
@Injectable()
export class MonthCloseService {
  private readonly logger = new Logger(MonthCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly delivery: MonthDeliveryService,
  ) {}

  async list(): Promise<{ rows: MonthClosureView[] }> {
    const rows = await this.prisma.monthClosure.findMany({
      orderBy: { yearMonth: 'desc' },
    });
    return { rows: rows.map(toView) };
  }

  /**
   * ⚠️ **চলতি ও ভবিষ্যতের মাস বন্ধ করা যায় না।**
   *
   * চলতি মাস এখনো চলছে — বন্ধ করলে আজকের ঘণ্টাগুলো আর যোগ হতো না, আর
   * পর্দার সংখ্যা দুপুরেই জমে যেত। ⚠️ ব্যর্থতাটা হতো **নীরব**: কেউ
   * অভিযোগ করত "আজকের ঘণ্টা উঠছে না", আর কারণ খুঁজতে কেউ এখানে আসত না।
   * ভবিষ্যতের মাসে তো গোনার মতো কিছুই নেই।
   */
  async close(
    actor: SessionUser,
    yearMonth: string,
    note: string | undefined,
    ip: string,
  ): Promise<MonthClosureView> {
    assertYearMonth(yearMonth);

    const current = workDateOf(new Date()).toISOString().slice(0, 7);
    if (yearMonth >= current) {
      throw new BadRequestException(
        yearMonth === current
          ? `${yearMonth} is still running — a month can only be closed once it is over`
          : `${yearMonth} is in the future — there is nothing to close`,
      );
    }

    const existing = await this.prisma.monthClosure.findUnique({
      where: { yearMonth },
    });
    if (existing) {
      // ⚠️ ৪০৯, আর **প্রথমজনের নাম-তারিখই থাকে** — দ্বিতীয়বার বন্ধ করলে
      //    রেকর্ডটা বদলে গেলে "কখন জমাট হয়েছিল" প্রশ্নের উত্তর হারাত।
      throw new ConflictException(
        `${yearMonth} was already closed on ${existing.closedAt.toISOString().slice(0, 10)} by ${existing.closedBy}`,
      );
    }

    /**
     * ⚠️ বন্ধ করার **ঠিক আগে** শেষবার গুনে নেওয়া হয় না — ইচ্ছাকৃত।
     * সংখ্যাগুলো এমনিতেই প্রতি ১৫ মিনিটে তাজা (K06), আর এখানে গুনতে
     * গেলে "বন্ধ করা" নিজেই একটা **বদল** হয়ে যেত: মালিক যে সংখ্যা দেখে
     * বন্ধ করার সিদ্ধান্ত নিলেন, বন্ধ করার পর সেটাই অন্য হতে পারত।
     */
    const row = await this.prisma.monthClosure.create({
      data: { yearMonth, closedBy: actor.email, note: note?.trim() || null },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'month_closed',
      targetType: 'month',
      targetId: yearMonth,
      ipAddress: ip,
      meta: { note: row.note },
    });

    /**
     * ⭐⭐ **R26 — হিসাবের ফাইল নিজে থেকে চলে যায়।**
     *
     * ⚠️⚠️ `void` + `.catch()`, আর কখনো `await` নয় — তিনটে কারণেই:
     *  ১· সারিটা **উপরেই commit হয়ে গেছে** (`create` নিজের ট্রানজেকশনে),
     *     তাই এখানকার ব্যর্থতা মাস-বন্ধ করাকে ছুঁতে পারে না।
     *  ২· await করলে মালিকের HTTP রিকোয়েস্ট আপলোডের পুরোটা সময় ঝুলত
     *     (কয়েক MB, ৬০ সেকেন্ড পর্যন্ত), আর throw করলে **সফল** একটা
     *     মাস-বন্ধ ৫০০ হয়ে ফিরত — তিনি আবার চেষ্টা করে ৪০৯ পেতেন।
     *  ৩· `.catch()` ছাড়া একটা floating promise unhandled rejection হয়ে
     *     গোটা API প্রসেস নামিয়ে দিত (`alerts.scheduler.ts`-এর একই শিক্ষা)।
     *
     * ⚠️ ভবিষ্যতে কেউ যদি `close()`-কে `$transaction`-এ মোড়ে, এই কলটা
     *    অবশ্যই কলব্যাকের **বাইরে** তুলতে হবে — নইলে চলন্ত আপলোড
     *    Prisma-র ৫ সেকেন্ডের সীমা পেরিয়ে আসল মাস-বন্ধটাই rollback করাত।
     */
    void this.delivery
      .deliverClosedMonth(yearMonth)
      .catch((err: unknown) =>
        this.logger.error(
          `Auto-delivery for ${yearMonth} failed (the month is closed regardless)`,
          err instanceof Error ? err.stack : undefined,
        ),
      );

    this.logger.log(`${yearMonth} closed by ${actor.email}`);
    return toView(row);
  }

  /**
   * ⚠️⚠️ খোলা যায়, কিন্তু **চিহ্নটা থেকে যায়** — audit-এ দুটো সারি
   * (`month_closed`, `month_reopened`)। বেতন দেওয়ার পর কেউ মাস খুলে
   * সংখ্যা বদলালে সেটা প্রমাণসহ দেখা যাবে; নীরবে ফিরে যাওয়ার পথ নেই।
   *
   * ⭐ খোলার সাথে সাথে সংখ্যা **নিজে থেকে বদলায় না** — পরের rollup (K06,
   * ১৫ মিনিট) বা কোনো সংশোধনে বদলাবে। তাই খোলা মানেই ক্ষতি নয়, খোলা
   * মানে "আবার নড়তে পারে"।
   */
  async reopen(
    actor: SessionUser,
    yearMonth: string,
    ip: string,
  ): Promise<{ yearMonth: string; reopened: true }> {
    assertYearMonth(yearMonth);

    const existing = await this.prisma.monthClosure.findUnique({
      where: { yearMonth },
    });
    if (!existing) throw new NotFoundException(`${yearMonth} is not closed`);

    await this.prisma.monthClosure.delete({ where: { yearMonth } });

    await this.audit.record({
      userId: actor.userId,
      action: 'month_reopened',
      targetType: 'month',
      targetId: yearMonth,
      ipAddress: ip,
      meta: {
        closedAt: existing.closedAt.toISOString(),
        closedBy: existing.closedBy,
      },
    });

    this.logger.warn(`${yearMonth} reopened by ${actor.email} — figures can move again`);
    return { yearMonth, reopened: true };
  }
}

function toView(row: {
  yearMonth: string;
  closedAt: Date;
  closedBy: string;
  note: string | null;
}): MonthClosureView {
  return {
    yearMonth: row.yearMonth,
    closedAt: row.closedAt.toISOString(),
    closedBy: row.closedBy,
    note: row.note,
  };
}

/**
 * ⚠️ `2026-8` বা `2026-13` নীরবে মেনে নিলে একটা কখনো-না-মেলা চাবি DB-তে
 * বসে যেত, আর মাসটা "বন্ধ" দেখাত অথচ কোনো প্রহরী কাজ করত না — কারণ
 * `refreshMonth()` খোঁজে `2026-08` ছাঁদে।
 */
function assertYearMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new BadRequestException('yearMonth must look like 2026-08');
  }
}
