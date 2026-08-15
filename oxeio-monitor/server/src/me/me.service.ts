import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { ProgressService, type EmployeeProgress } from '../agent/progress.service';
import { workDateOf } from '../agent/util/dhaka-time';
import { DepositsService } from '../deposits/deposits.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseWorkDate, toIsoDate } from '../reports/reports.range';
import { SCREENSHOT_RETENTION_DAYS } from '../summary/retention.job';
import { isWorkday } from '../summary/summary.math';
import type { SessionUser } from '../auth/types';

/** কর্মীর নিজের পাতার উপরের অংশ */
export interface MySummary {
  employee: {
    empCode: string;
    fullName: string;
    designation: string | null;
    joinedOn: string | null;
  };
  progress: EmployeeProgress;
  /**
   * ⭐ নীতিমালায় সই করার তারিখ। স্টাফ নিজে দেখতে পায় **ইচ্ছাকৃতভাবে** —
   * "কবে থেকে, কী শর্তে" প্রশ্নের উত্তরটা তার নিজের কাছেই থাকা দরকার।
   */
  policySignedAt: string | null;
  /** ⭐ "ছবি কতদিন থাকে" — প্রতিশ্রুতিটা সংখ্যাসহ, পাতাতেই */
  screenshotRetentionDays: number;
}

/** একটা দিনের সারি — কর্মীর নিজের তালিকায় */
export interface MyDay {
  workDate: string;
  /** ওই দিনে গোনা সেকেন্ড (ACTIVE-এর যোগফল) */
  workedSec: number;
  /** owner-এর সংশোধন, ± */
  adjustmentSec: number;
  /** worked + adjustment — মাসের টার্গেটে এটাই যায় */
  creditedSec: number;
  /** সাপ্তাহিক ছুটি বা ক্যালেন্ডার ছুটি */
  isOffDay: boolean;
}

const MS_PER_DAY = 86_400_000;

/** ⚠️ একবারে কত দিন — ছাদ না থাকলে কেউ `from=2000-01-01` দিয়ে পুরো টেবিল টানত */
export const MY_DAYS_MAX = 92;

/**
 * **J04 · J05 · J08** — কর্মীর **নিজের** ডেটা।
 *
 * ⭐⭐ <b>এখানে কোনো `employeeId` প্যারামিটার নেই, আর সেটাই মূল নকশা।</b>
 * পথে আইডি থাকলে একজন স্টাফ সংখ্যাটা বদলে সহকর্মীর পুরো দিন দেখে ফেলত —
 * `employee-activity.controller.ts`-এর ডকেও ঠিক এই আশঙ্কাটা লেখা আছে
 * (*"স্টাফের নিজের ভিউ আলাদা পথে হবে"*)। আইডি আসে **সেশন থেকে**, তাই
 * ভুল করারও উপায় নেই।
 *
 * ⭐ <b>সংখ্যাগুলো `ProgressService` থেকেই আসে — নতুন করে কষা হয় না।</b>
 * ওটাই এজেন্টের tray-কে খাওয়ায়। আলাদা করে লিখলে একদিন tray বলত "৫:৪২"
 * আর ওয়েব বলত "৫:৩৯", আর স্টাফের প্রশ্ন হতো *"কোনটা সত্যি?"* — যে
 * ফিচারের পুরো উদ্দেশ্য আস্থা, সেটাই তখন আস্থা ভাঙত।
 */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
    private readonly deposits: DepositsService,
  ) {}

  /**
   * ⭐⭐ **R21 — নিজের জামানত কত জমল।**
   *
   * ⚠️ কর্মীর পাতায় বেতনের কোনো সংখ্যা নেই, আর এটা সেই নিয়ম ভাঙে না:
   * জমার অঙ্কটা **তাঁর নিজের টাকা**, বেতনের হিসাব নয়। মালিক কত বেতন
   * দেন সেটা এখান থেকে বের করা যায় না।
   *
   * ⭐ মাস ধরে তালিকাটাও যায়, শুধু মোট নয় — "কোন মাসে কাটা হয়েছে"
   * প্রশ্নের উত্তর নিজের পাতাতেই থাকা দরকার, নইলে মিলিয়ে দেখতে হলে
   * মালিকের কাছে যেতে হতো, আর তখন ফিচারটার উদ্দেশ্যই ব্যর্থ।
   */
  myDeposit(actor: SessionUser) {
    return this.deposits.forEmployee(this.employeeIdOf(actor));
  }

  /**
   * ⚠️ owner ও manager-এর `employeeId` সাধারণত `null` — তাঁরা কর্মীর
   * সারিতে বাঁধা নন। তাঁদের জন্য এই পাতাটা নেই, আর সেটা ভুল নয়:
   * তাঁরা `staff/:id`-তে সবার ডেটাই দেখেন।
   */
  private employeeIdOf(actor: SessionUser): number {
    if (actor.employeeId === null) {
      throw new ForbiddenException(
        'This account is not linked to a staff record, so there is no personal data to show.',
      );
    }
    return actor.employeeId;
  }

  async summary(actor: SessionUser, now = new Date()): Promise<MySummary> {
    const employeeId = this.employeeIdOf(actor);

    const [employee, progress] = await Promise.all([
      this.prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: {
          empCode: true,
          fullName: true,
          designation: true,
          joinedOn: true,
          policySignedAt: true,
        },
      }),
      this.progress.forEmployee(employeeId, now),
    ]);

    return {
      employee: {
        empCode: employee.empCode,
        fullName: employee.fullName,
        designation: employee.designation,
        joinedOn: isoDate(employee.joinedOn),
      },
      progress,
      policySignedAt: isoDate(employee.policySignedAt),
      screenshotRetentionDays: SCREENSHOT_RETENTION_DAYS,
    };
  }

  async days(
    actor: SessionUser,
    from: string,
    to: string,
    now = new Date(),
  ): Promise<MyDay[]> {
    const employeeId = this.employeeIdOf(actor);

    /**
     * ⚠️ DTO শুধু **আকৃতি** দেখে (regex); ৩১ ফেব্রুয়ারি ধরা পড়ে এখানে,
     * `parseWorkDate()`-এর round-trip যাচাইয়ে।
     *
     * ⚠️ খাঁটি ফাংশনটা HTTP-র কিছু জানে না, তাই `RangeError` ছোড়ে — আর
     * সেটা এখানেই ৪০০-তে বদলাতে হয় (গ্লোবাল কোনো filter এটা করে না,
     * `activity.service.ts`-ও ঠিক এভাবেই করে)। না করলে ব্যবহারকারীর
     * একটা টাইপো ৫০০ হয়ে ফিরত আর লগে অকারণে স্ট্যাক ট্রেস জমত।
     */
    let start: Date;
    let end: Date;
    try {
      start = parseWorkDate(from);
      end = parseWorkDate(to);
    } catch (err) {
      if (err instanceof RangeError) throw new BadRequestException(err.message);
      throw err;
    }

    if (start > end) return [];

    // ⚠️ ভবিষ্যতের দিন চাওয়া হলে আজ পর্যন্তই — ফাঁকা সারির লম্বা লেজ
    //    দেখিয়ে "কিছুই করোনি" ধরনের ছাপ ফেলার কোনো মানে নেই।
    const today = workDateOf(now);
    const last = end > today ? today : end;

    const span = Math.floor((last.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    if (span < 1) return [];

    const first =
      span > MY_DAYS_MAX
        ? new Date(last.getTime() - (MY_DAYS_MAX - 1) * MS_PER_DAY)
        : start;

    const [segments, adjustments, employee, holidayRows] = await Promise.all([
      /**
       * ⚠️ কাঁচা `activity_segments`, `daily_summary` নয় — ঠিক যে কারণে
       * `ProgressService`-ও তাই করে: rollup ১৫ মিনিট পরপর চলে, আর স্টাফ
       * নিজের আজকের ঘণ্টা দেখতে এসে "০" পেলে ধরে নিত ডেটা হারিয়ে গেছে।
       */
      this.prisma.activitySegment.groupBy({
        by: ['workDate'],
        where: {
          employeeId,
          countsAsWork: true,
          workDate: { gte: first, lte: last },
        },
        _sum: { durationSec: true },
      }),
      // ⚠️ `revokedAt: null` — বাতিল করা সংশোধন ঘণ্টা ফেরত দেয় না
      this.prisma.timeAdjustment.groupBy({
        by: ['workDate'],
        where: {
          employeeId,
          revokedAt: null,
          workDate: { gte: first, lte: last },
        },
        _sum: { deltaSec: true },
      }),
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { policy: { select: { weeklyOffDay: true } } },
      }),
      this.prisma.holiday.findMany({
        where: { holidayDate: { gte: first, lte: last } },
        select: { holidayDate: true },
      }),
    ]);

    const workedBy = new Map(
      segments.map((s) => [s.workDate.getTime(), s._sum.durationSec ?? 0]),
    );
    const adjustBy = new Map(
      adjustments.map((a) => [a.workDate.getTime(), a._sum.deltaSec ?? 0]),
    );
    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));
    const off = employee?.policy?.weeklyOffDay ?? null;

    const rows: MyDay[] = [];

    /**
     * ⚠️ **প্রতিটা দিনের সারি তৈরি হয়, শুধু যেদিন কাজ হয়েছে সেদিনের নয়।**
     * ফাঁক রেখে দিলে তালিকায় ৯ আর ১১ তারিখ পাশাপাশি বসত, আর ১০ তারিখটা
     * "ছিলই না" মনে হতো — অথচ ওটাই সেই দিন যেদিন এজেন্ট বন্ধ ছিল, অর্থাৎ
     * ঠিক যেদিনটা নিয়ে স্টাফের প্রশ্ন থাকে।
     */
    for (let t = first.getTime(); t <= last.getTime(); t += MS_PER_DAY) {
      const worked = workedBy.get(t) ?? 0;
      const adjustment = adjustBy.get(t) ?? 0;
      const date = new Date(t);

      rows.push({
        workDate: toIsoDate(date),
        workedSec: worked,
        adjustmentSec: adjustment,
        creditedSec: worked + adjustment,
        // ⚠️ `isWorkday()` — একই ফাংশন যেটা মাসের টার্গেট কষতে ব্যবহার হয়।
        //    আলাদা করে "শুক্রবার?" লিখলে `holidays` টেবিলটা বাদ পড়ত, আর
        //    ঈদের দিনগুলো তালিকায় সাধারণ কর্মদিবস হিসেবে দেখাত।
        isOffDay: !isWorkday(date, off, holidays),
      });
    }

    // নতুন দিন আগে — মানুষ প্রথমে আজকেরটাই খোঁজে
    return rows.reverse();
  }
}

/** `@db.Date` → `YYYY-MM-DD`, null হলে null */
function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}
