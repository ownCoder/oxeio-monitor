import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { workDateOf } from './util/dhaka-time';

export interface EmployeeProgress {
  /** ঢাকার আজকের দিনে গোনা সেকেন্ড */
  todayActiveSec: number;
  /** চলতি মাসে (ঢাকার) গোনা সেকেন্ড */
  monthActiveSec: number;
  /** ওই কর্মীর work policy থেকে — হার্ডকোড ২০৮ নয় */
  monthlyTargetHours: number;
}

/**
 * এজেন্টের tray-তে "x ঘ / ২০৮ঘ" দেখানোর জন্য সংখ্যাটা।
 *
 * ⚠️ **এজেন্ট নিজে এটা হিসাব করতে পারে না।** সে শুধু নিজের চালু থাকার সময়টুকু
 * জানে — রিবুট বা আপডেটের পর তার হিসাব শূন্য থেকে শুরু হয়। স্টাফ তখন tray-তে
 * দেখত "০ ঘ / ২০৮ঘ" আর ভাবত তার মাসের কাজ মুছে গেছে। যে ফিচারটার পুরো
 * উদ্দেশ্যই আস্থা তৈরি করা, সেটাই তখন আস্থা ভাঙত।
 *
 * তাই সংখ্যাটা সার্ভার দেয় — যেখানে সব ডিভাইসের ডেটা একসাথে আছে
 * (কেউ দুটো PC ব্যবহার করলেও যোগ হয়ে যায়, § ২.১-গ)।
 *
 * কাঁচা `activity_segments` থেকেই যোগ করা হয়, `monthly_summary` থেকে নয় —
 * ওই rollup এখনো তৈরি হয় না, আর ১৫টি ডিভাইসে মাসে কয়েক হাজার সারির যোগফল
 * সরাসরি বের করাই সহজ ও সবসময় হালনাগাদ।
 */
@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async forEmployee(
    employeeId: number,
    now: Date = new Date(),
  ): Promise<EmployeeProgress> {
    const today = workDateOf(now);

    // মাসের প্রথম দিন — ঢাকার ক্যালেন্ডার অনুযায়ী, UTC-র নয়
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );

    const [todayRow, monthRow, employee] = await Promise.all([
      this.prisma.activitySegment.aggregate({
        _sum: { durationSec: true },
        where: { employeeId, countsAsWork: true, workDate: today },
      }),
      this.prisma.activitySegment.aggregate({
        _sum: { durationSec: true },
        where: {
          employeeId,
          countsAsWork: true,
          workDate: { gte: monthStart, lte: today },
        },
      }),
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { policy: { select: { monthlyTargetHours: true } } },
      }),
    ]);

    return {
      todayActiveSec: todayRow._sum.durationSec ?? 0,
      monthActiveSec: monthRow._sum.durationSec ?? 0,
      // পলিসি না থাকলে স্পেকের ডিফল্ট — শূন্য দিলে এজেন্টে ভাগ করতে গিয়ে
      // অসীম অগ্রগতি দেখাত
      monthlyTargetHours: Number(employee?.policy?.monthlyTargetHours ?? 208),
    };
  }
}
