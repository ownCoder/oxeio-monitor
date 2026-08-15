import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { isWorkday } from '../summary/summary.math';

export interface LeaveView {
  id: number;
  employeeId: number;
  employeeName: string;
  leaveDate: string;
  type: string;
  note: string | null;
  createdBy: string;
  /**
   * ⭐⭐ ওই তারিখটা ওই কর্মীর জন্য আদৌ কর্মদিবস ছিল কি না।
   *
   * ⚠️⚠️ এটা পর্দা পর্যন্ত পাঠানোর কারণ আছে: শুক্রবারে বা সরকারি ছুটির
   * দিনে লেখা একটা ছুটি **টার্গেটের কিছুই কমায় না** (`countLeaveWorkdays`
   * ওটা ছেঁকে ফেলে)। সারিটা তবু খাতায় থাকে, আর তখন পর্দায় ওটাকে অন্য
   * সবের মতো দেখালে খাতা একটা মিথ্যা বলত — "এই দিনটা ছাড় পেয়েছে"।
   * তাই সারিটা থাকে, কিন্তু নিজেই বলে দেয় সে কিছু বদলায়নি।
   */
  countsTowardTarget: boolean;
}

/** ⚠️ তিনটেই সবেতন — কেন `unpaid` নেই, `schema.prisma`-র নোট দেখুন */
const LEAVE_TYPES = new Set(['casual', 'sick', 'annual']);

/**
 * ⭐⭐ **R2 — ছুটির খাতা।**
 *
 * ⚠️⚠️ **যা এটা করে না:** কোনো আবেদন-অনুমোদনের প্রবাহ নেই। মালিক বা
 * ম্যানেজার একটা তারিখ লেখেন, ব্যস। সাতজনের অফিসে অনুমোদনের ধাপ যোগ
 * করা মানে এমন একটা প্রক্রিয়া বানানো যা কেউ ব্যবহার করবে না, আর তখন
 * খাতাটা ফাঁকা থাকত — অর্থাৎ ছুটির দিনগুলো "অনুপস্থিতি" হয়েই থাকত।
 *
 * ⭐⭐ **সিদ্ধান্তটা: ছুটি সবেতন।** ছুটি `target_sec` কমায় (ওই দিনের
 * ৮ ঘণ্টা আর কারো কাছে পাওনা নয়), কিন্তু পে-রোলের ভগ্নাংশ `d ÷ D` **ছোঁয়
 * না**। কোডে এই বিচ্ছেদটা তিন জায়গায় পাহারা দেওয়া: `prorate()`,
 * `proratedExpectedSec()`, আর `test/proration.spec.ts`।
 */
@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * এক মাসের সব ছুটি — কর্মীর নাম সহ।
   *
   * ⚠️ মাস দিয়ে ছাঁকা **বাধ্যতামূলক**, রেঞ্জ ঐচ্ছিক নয়: খাতা বছরের পর
   *    বছর বাড়ে, আর "সব ছুটি" চাওয়ার মতো কোনো পর্দা নেই।
   */
  async list(yearMonth: string): Promise<{ rows: LeaveView[] }> {
    const { first, last } = monthBounds(yearMonth);

    const [rows, holidayRows] = await Promise.all([
      this.prisma.leave.findMany({
        where: { leaveDate: { gte: first, lte: last } },
        orderBy: [{ leaveDate: 'asc' }, { employeeId: 'asc' }],
        include: {
          employee: {
            select: {
              fullName: true,
              policy: { select: { weeklyOffDay: true } },
            },
          },
        },
      }),
      this.prisma.holiday.findMany({
        where: { holidayDate: { gte: first, lte: last } },
        select: { holidayDate: true },
      }),
    ]);

    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: r.employee.fullName,
        leaveDate: r.leaveDate.toISOString().slice(0, 10),
        type: r.type,
        note: r.note,
        createdBy: r.createdBy,
        countsTowardTarget: isWorkday(
          r.leaveDate,
          r.employee.policy?.weeklyOffDay ?? null,
          holidays,
        ),
      })),
    };
  }

  /**
   * এক বা একাধিক দিনের ছুটি লেখা।
   *
   * ⭐ **রেঞ্জ ধরে**, একদিন ধরে নয় — মানুষ "১০ থেকে ১৪ তারিখ" ছুটি নেয়,
   * "১০ তারিখ" পাঁচবার নয়। একদিনের API-তে পর্দাকে পাঁচটা রিকোয়েস্ট
   * পাঠাতে হতো, আর মাঝপথে একটা ব্যর্থ হলে খাতায় অর্ধেক ছুটি বসে থাকত।
   */
  async create(
    actor: SessionUser,
    input: {
      employeeId: number;
      from: string;
      to: string;
      type: string;
      note?: string;
    },
    ip: string,
  ): Promise<{ created: number; skipped: string[] }> {
    if (!LEAVE_TYPES.has(input.type)) {
      throw new BadRequestException(
        `Unknown leave type "${input.type}" — expected one of ${[...LEAVE_TYPES].join(', ')}`,
      );
    }

    const from = parseDate(input.from);
    const to = parseDate(input.to);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('The start date is after the end date');
    }

    /**
     * ⚠️ ⭐ **৯২ দিনের ছাদ।** টাইপো (`2026` বদলে `2016`) ছাড়া কেউ এর
     *    চেয়ে বড় রেঞ্জ লিখবে না, আর ছাদ না থাকলে ওই টাইপোটা কয়েক হাজার
     *    সারি বসিয়ে দিত — এবং প্রতিটা মাসের টার্গেট শূন্য করে দিত।
     */
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 92) {
      throw new BadRequestException(
        `${days} days is too long for one entry — 92 is the limit`,
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, fullName: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    /**
     * ⚠️⚠️ **বন্ধ মাসে ছুটি লেখা যায় না** (R1)। লিখতে দিলে বন্ধ করার পুরো
     *    উদ্দেশ্যটাই ব্যর্থ হতো: `refreshMonth()` বন্ধ মাস ছোঁয় না, তাই
     *    সারিটা খাতায় বসত কিন্তু টার্গেট বদলাত না — অর্থাৎ ছুটির খাতা আর
     *    সংখ্যা দুটো চিরকালের জন্য আলাদা কথা বলত, নীরবে।
     */
    const months = [
      ...new Set(
        eachDay(from, to).map((d) => d.toISOString().slice(0, 7)),
      ),
    ];
    const closed = await this.prisma.monthClosure.findMany({
      where: { yearMonth: { in: months } },
      select: { yearMonth: true },
    });
    if (closed.length > 0) {
      throw new ConflictException(
        `${closed.map((c) => c.yearMonth).join(', ')} ${closed.length === 1 ? 'is' : 'are'} closed — reopen the month first`,
      );
    }

    /**
     * ⭐ `skipDuplicates` — ইতিমধ্যে লেখা একটা দিনের জন্য গোটা রেঞ্জটা
     *    ব্যর্থ হয় না। কোন দিনগুলো বাদ পড়ল সেটা নিচে ফেরত যায়, নইলে
     *    পর্দা "৫টা যোগ হয়েছে" বলত যখন আসলে ৩টা হয়েছে।
     */
    const existing = await this.prisma.leave.findMany({
      where: {
        employeeId: employee.id,
        leaveDate: { gte: from, lte: to },
      },
      select: { leaveDate: true },
    });
    const already = new Set(existing.map((e) => e.leaveDate.getTime()));
    const fresh = eachDay(from, to).filter((d) => !already.has(d.getTime()));

    if (fresh.length > 0) {
      await this.prisma.leave.createMany({
        data: fresh.map((leaveDate) => ({
          employeeId: employee.id,
          leaveDate,
          type: input.type,
          note: input.note?.trim() || null,
          createdBy: actor.email,
        })),
      });
    }

    await this.audit.record({
      userId: actor.userId,
      action: 'leave_added',
      targetType: 'employee',
      targetId: String(employee.id),
      ipAddress: ip,
      meta: {
        from: input.from,
        to: input.to,
        type: input.type,
        created: fresh.length,
      },
    });

    this.logger.log(
      `${fresh.length} leave day(s) for ${employee.fullName} (${input.from}…${input.to}) by ${actor.email}`,
    );

    return {
      created: fresh.length,
      skipped: [...already]
        .sort((a, b) => a - b)
        .map((ms) => new Date(ms).toISOString().slice(0, 10)),
    };
  }

  /**
   * একদিনের ছুটি মুছে ফেলা।
   *
   * ⚠️ সত্যিই মুছে ফেলা হয়, `revoked_at` নয় — ছুটি কোনো আর্থিক লেনদেন নয়
   *    (সময়-সংশোধনের মতো), আর audit-এ কে কবে মুছল তা থেকেই যায়।
   */
  async remove(actor: SessionUser, id: number, ip: string): Promise<void> {
    const row = await this.prisma.leave.findUnique({
      where: { id },
      select: { id: true, employeeId: true, leaveDate: true, type: true },
    });
    if (!row) throw new NotFoundException('Leave entry not found');

    const yearMonth = row.leaveDate.toISOString().slice(0, 7);
    const closed = await this.prisma.monthClosure.findUnique({
      where: { yearMonth },
      select: { yearMonth: true },
    });
    // ⚠️ মোছাটাও বন্ধ মাসে আটকানো — কারণ একই: খাতা বদলাত, সংখ্যা নয়
    if (closed) {
      throw new ConflictException(
        `${yearMonth} is closed — reopen the month first`,
      );
    }

    await this.prisma.leave.delete({ where: { id } });

    await this.audit.record({
      userId: actor.userId,
      action: 'leave_removed',
      targetType: 'employee',
      targetId: String(row.employeeId),
      ipAddress: ip,
      meta: {
        leaveDate: row.leaveDate.toISOString().slice(0, 10),
        type: row.type,
      },
    });
  }
}

/** `YYYY-MM-DD` → UTC-মধ্যরাত, ঠিক যেভাবে `holidays` টেবিলে বসে */
function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`Expected YYYY-MM-DD, got "${value}"`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`"${value}" is not a real date`);
  }
  return d;
}

function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    out.push(new Date(t));
  }
  return out;
}

function monthBounds(yearMonth: string): { first: Date; last: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw new BadRequestException(`Expected YYYY-MM, got "${yearMonth}"`);
  }
  const [y, m] = yearMonth.split('-').map(Number);
  return {
    first: new Date(Date.UTC(y, m - 1, 1)),
    last: new Date(Date.UTC(y, m, 0)),
  };
}
