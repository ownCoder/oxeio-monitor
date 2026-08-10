import { Injectable } from '@nestjs/common';

import { countWorkdays } from '../summary/summary.math';
import { PrismaService } from '../prisma/prisma.service';
import { paceSecOf } from './progress.math';
import { workDateOf } from './util/dhaka-time';

export interface EmployeeProgress {
  /** ঢাকার আজকের দিনে গোনা সেকেন্ড */
  todayActiveSec: number;
  /** চলতি মাসে (ঢাকার) গোনা সেকেন্ড */
  monthActiveSec: number;
  /** ওই কর্মীর work policy থেকে — হার্ডকোড ২০৮ নয় */
  monthlyTargetHours: number;
  /**
   * **B05b** — আজ পর্যন্ত এগিয়ে (+) না পিছিয়ে (−), সেকেন্ডে।
   * `credited_sec − expected_sec` (§ ২.১-খ)।
   *
   * ⭐ **এটা না পাঠালে এজেন্ট নিজেই আন্দাজ করে** — সে `holidays` টেবিল
   * চেনে না, তাই শুধু শুক্রবার বাদ দিয়ে কর্মদিবস গোনে আর জানালায় "গতি
   * (আনুমানিক)" লিখে রাখে। ঈদের সপ্তাহে ওই আন্দাজ ড্যাশবোর্ডের সংখ্যার
   * চেয়ে কয়েক ঘণ্টা পিছিয়ে দেখাত — অর্থাৎ ছুটির দিনগুলোকেই কর্মীর ঘাটতি
   * বলে গোনা হতো। সার্ভার সংখ্যাটা দেওয়া শুরু করলে এজেন্ট লেবেল থেকে
   * "আনুমানিক" নিজেই তুলে নেয়।
   *
   * ⚠️ `optional` — পুরোনো এজেন্ট ফিল্ডটা চেনে না, আর নতুন এজেন্টও
   * `null` পেলে নিজের আন্দাজে ফিরে যায়। তাই কখনো ভাঙে না।
   */
  paceSec: number;
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
    // পরের মাসের "০ তারিখ" = চলতি মাসের শেষ দিন (লিপ ইয়ারও নিজে সামলায়)
    const monthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
    );

    const [todayRow, monthRow, employee, adjustmentRow, holidayRows] =
      await Promise.all([
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
          select: {
            // ⚠️ `weeklyOffDay` কর্মীর নয়, **work policy**-র কলাম — সাপ্তাহিক
            //    ছুটি নীতির অংশ, ব্যক্তিগত বৈশিষ্ট্য নয়।
            policy: { select: { monthlyTargetHours: true, weeklyOffDay: true } },
          },
        }),
        /**
         * ⚠️ `time_adjustments` থেকে সরাসরি, `daily_summary.adjustment_sec`
         * থেকে নয় — ওই কলামটা ১৫ মিনিট পরপর চলা rollup-এর ফল, তাই owner
         * ঘণ্টা ফেরত দেওয়ার পর স্টাফের tray পরের রিফ্রেশ পর্যন্ত তাকে
         * "পিছিয়ে" দেখাত। সংশোধনের পুরো উদ্দেশ্যই তখন দেরিতে পৌঁছাত।
         *
         * ⚠️ `revokedAt: null` — বাতিল করা সংশোধন ঘণ্টা ফেরত দেয় না
         * (schema-য় ডিলিট নেই, শুধু revoke)।
         */
        this.prisma.timeAdjustment.aggregate({
          _sum: { deltaSec: true },
          where: {
            employeeId,
            revokedAt: null,
            workDate: { gte: monthStart, lte: today },
          },
        }),
        this.prisma.holiday.findMany({
          where: { holidayDate: { gte: monthStart, lte: monthEnd } },
          select: { holidayDate: true },
        }),
      ]);

    const monthActiveSec = monthRow._sum.durationSec ?? 0;
    const monthlyTargetHours = Number(
      // পলিসি না থাকলে স্পেকের ডিফল্ট — শূন্য দিলে এজেন্টে ভাগ করতে গিয়ে
      // অসীম অগ্রগতি দেখাত
      employee?.policy?.monthlyTargetHours ?? 208,
    );

    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));
    const off = employee?.policy?.weeklyOffDay ?? null;
    const expectedWorkdays = countWorkdays(monthStart, monthEnd, off, holidays);
    const workdaysElapsed = countWorkdays(monthStart, today, off, holidays);

    return {
      todayActiveSec: todayRow._sum.durationSec ?? 0,
      monthActiveSec,
      monthlyTargetHours,
      paceSec: paceSecOf({
        /**
         * ⚠️ `credited`, `worked` নয় — § ২.১-ঙ (G35)। সার্ভারের দোষে ঘণ্টা
         * হারানো স্টাফ owner-এর সংশোধনের পরেও tray-তে সারা মাস "পিছিয়ে"
         * দেখত, অথচ ড্যাশবোর্ড তাকে এগিয়ে দেখাত — দুটো সংখ্যা দুই কথা
         * বললেই আস্থা শেষ, আর এই ফিচারটার উদ্দেশ্যই আস্থা।
         */
        creditedSec: monthActiveSec + (adjustmentRow._sum.deltaSec ?? 0),
        monthlyTargetHours,
        expectedWorkdays,
        workdaysElapsed,
      }),
    };
  }
}
