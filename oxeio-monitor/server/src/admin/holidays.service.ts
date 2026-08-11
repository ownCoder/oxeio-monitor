import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_TARGET } from './admin-audit';
import { parseCalendarDate } from './calendar-date';
import type {
  CreateHolidayDto,
  HolidayListQueryDto,
  UpdateHolidayDto,
} from './dto';

export interface HolidayView {
  id: number;
  /** 'YYYY-MM-DD' */
  holidayDate: string;
  name: string;
  type: string;
}

/**
 * ছুটির ক্যালেন্ডার (owner-only)।
 *
 * ⚠️ এটা কোনো ব্লক নয় — ছুটির দিনে কেউ কাজ করলে তার ঘণ্টা পুরোপুরি গোনা
 * হয় (স্কিমার কমেন্ট দেখুন)। ছুটি শুধু দুই কাজে লাগে: হিটম্যাপে দিন
 * চিহ্নিত করা, আর pace-এর কর্মদিবস গোনা (§ ২.১-খ)।
 */
@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: HolidayListQueryDto): Promise<{ rows: HolidayView[] }> {
    const where: Prisma.HolidayWhereInput = {};

    if (query.year !== undefined) {
      // ⚠️ `getFullYear()` দিয়ে ছাঁকা যায় না — SQL-এ যেতে হবে, তাই
      //    বছরের সীমা দুটো UTC তারিখ হিসেবে বানানো। শেষটা **exclusive**,
      //    নইলে ৩১ ডিসেম্বর বাদ পড়ত বা পরের ১ জানুয়ারি ঢুকে যেত।
      where.holidayDate = {
        gte: new Date(Date.UTC(query.year, 0, 1)),
        lt: new Date(Date.UTC(query.year + 1, 0, 1)),
      };
    }

    const rows = await this.prisma.holiday.findMany({
      where,
      orderBy: { holidayDate: 'asc' },
    });

    return { rows: rows.map(toView) };
  }

  async create(
    actor: SessionUser,
    dto: CreateHolidayDto,
    ip: string,
  ): Promise<HolidayView> {
    const holidayDate = this.parse(dto.holidayDate);

    const row = await this.prisma.holiday
      .create({
        data: {
          holidayDate,
          name: dto.name,
          ...(dto.type === undefined ? {} : { type: dto.type }),
        },
      })
      .catch((err: unknown) => {
        throw this.translateDuplicate(err, dto.holidayDate);
      });

    await this.record(actor, ip, row.id, {
      op: 'create',
      holidayDate: dto.holidayDate,
      name: row.name,
    });

    return toView(row);
  }

  async update(
    actor: SessionUser,
    id: number,
    dto: UpdateHolidayDto,
    ip: string,
  ): Promise<HolidayView> {
    const before = await this.prisma.holiday.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Holiday not found');

    const row = await this.prisma.holiday
      .update({
        where: { id },
        data: {
          ...(dto.holidayDate === undefined
            ? {}
            : { holidayDate: this.parse(dto.holidayDate) }),
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.type === undefined ? {} : { type: dto.type }),
        },
      })
      .catch((err: unknown) => {
        throw this.translateDuplicate(err, dto.holidayDate ?? '');
      });

    await this.record(actor, ip, id, {
      op: 'update',
      from: toAuditMeta(toView(before)),
      to: toAuditMeta(toView(row)),
    });

    return toView(row);
  }

  /**
   * ⭐ এখানে আসল `DELETE` আছে — পুরো মডিউলে এই একটাই।
   *
   * কারণ `holidays`-এর দিকে কোনো FK তাকিয়ে নেই; সারিটা কারো ঘণ্টা বা
   * স্ক্রিনশট ধরে রাখে না।
   *
   * ⚠️ তবু নিরীহ নয়: ছুটি মুছলে ওই মাসের `expected_workdays` বেড়ে যায়,
   * ফলে পরের rollup-এ সবার **pace পিছিয়ে যায়** — কেউ কোনো কাজ না করেও।
   * তাই মুছে ফেলা সারিটার তারিখ ও নাম audit meta-তে তুলে রাখা হয়, যাতে
   * "গত মঙ্গলবার সবার pace হঠাৎ পড়ল কেন" প্রশ্নের উত্তর থাকে।
   */
  async remove(
    actor: SessionUser,
    id: number,
    ip: string,
  ): Promise<{ deleted: HolidayView }> {
    const before = await this.prisma.holiday.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Holiday not found');

    await this.prisma.holiday.delete({ where: { id } });

    await this.record(actor, ip, id, {
      op: 'delete',
      deleted: toAuditMeta(toView(before)),
    });

    return { deleted: toView(before) };
  }

  private parse(value: string): Date {
    const parsed = parseCalendarDate(value);
    if (!parsed) {
      throw new BadRequestException('holidayDate is not a valid date');
    }
    return parsed;
  }

  private translateDuplicate(err: unknown, date: string): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(
        `A holiday has already been set for ${date}`,
      );
    }
    return err;
  }

  private async record(
    actor: SessionUser,
    ip: string,
    id: number,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: ADMIN_TARGET.holiday,
      targetId: id,
      ipAddress: ip,
      meta,
    });
  }
}

/**
 * ⚠️ `HolidayView` সরাসরি audit meta-তে দেওয়া যায় না — Prisma-র
 * `InputJsonValue` index signature চায়, আর interface-এ সেটা থাকে না।
 * তাই সমতল `Record`-এ নামিয়ে দেওয়া।
 */
function toAuditMeta(view: HolidayView): Record<string, string | number> {
  return {
    id: view.id,
    holidayDate: view.holidayDate,
    name: view.name,
    type: view.type,
  };
}

function toView(holiday: {
  id: number;
  holidayDate: Date;
  name: string;
  type: string;
}): HolidayView {
  return {
    id: holiday.id,
    // `@db.Date` UTC-মধ্যরাত হিসেবে আসে, তাই ISO-র প্রথম দশ অক্ষরই তারিখ
    holidayDate: holiday.holidayDate.toISOString().slice(0, 10),
    name: holiday.name,
    type: holiday.type,
  };
}
