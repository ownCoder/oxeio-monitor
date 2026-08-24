import { Injectable } from '@nestjs/common';

import { prorate } from '../summary/proration';
import {
  countLeaveWorkdays,
  countWorkdays,
  elapsedWorkdays,
} from '../summary/summary.math';
import { PrismaService } from '../prisma/prisma.service';
import { trackedFromBy } from '../summary/tracking-start';
import { paceSecOf } from './progress.math';
import { workDateOf } from './util/dhaka-time';

/**
 * ⚠️ `work_date` সবসময় UTC-মধ্যরাতের `@db.Date`, তাই দিন যোগ-বিয়োগে DST বা
 * ঘণ্টার ঝামেলা নেই — এটা নিছক পাটিগণিত, কোনো টাইমজোন নিয়ম নয়।
 */
const MS_PER_DAY = 86_400_000;

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

  /**
   * আজকের টার্গেট, সেকেন্ডে — মাসিক টার্গেট ÷ ওই মাসের কর্মদিবস।
   *
   * ⚠️ **ছুটির দিনে ০** (সাপ্তাহিক ছুটি বা `holidays`)। ০ মানে "আজ কিছু
   * করার দরকার নেই", আর সেদিন কেউ কাজ করলে সেটা এমনিতেই মাসের হিসাবে যোগ
   * হয় — নিয়মটা "যেকোনো দিন গোনা হয়" (§ ৪)।
   *
   * ⭐ DB-তে দৈনিক টার্গেট বলে কোনো কলাম নেই, ইচ্ছাকৃতভাবে — একমাত্র
   * চুক্তি মাসিক ২০৮ ঘণ্টা (O8)। এটা শুধু **দেখানোর** সংখ্যা, কাটার নয়।
   */
  dailyTargetSec: number;

  /** গত ৭ দিনে (আজ ধরে) গোনা সেকেন্ড */
  week7ActiveSec: number;

  /**
   * ওই ৭ দিনের মধ্যে যতগুলো কর্মদিবস, তত × দৈনিক টার্গেট।
   *
   * ⚠️ "চলতি সপ্তাহ" নয়, **রোলিং ৭ দিন** — এই সিস্টেমে সপ্তাহের কোনো
   * সীমানাই নেই (§ ৪: যেকোনো দিন গোনা হয়)। "এই সপ্তাহ" বানাতে গেলে
   * সপ্তাহ কবে শুরু সেই নতুন ধারণা আমদানি করতে হতো।
   */
  week7TargetSec: number;
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

    // রোলিং ৭ দিন — আজ ধরে, তাই ৬ দিন পিছিয়ে
    const week7Start = new Date(today.getTime() - 6 * MS_PER_DAY);

    /**
     * ⚠️ ছুটির তালিকা **মাসের শুরু নয়, ৭ দিনের জানালাটাও ধরে** আনতে হয়।
     * মাসের ১–৬ তারিখে ৭ দিনের জানালা আগের মাসে ঢুকে পড়ে; শুধু চলতি মাসের
     * ছুটি আনলে আগের মাসের ঈদের দিনগুলো "কর্মদিবস" হিসেবে গোনা হতো, আর
     * ৭ দিনের টার্গেট বেশি দেখাত।
     */
    const holidayFrom = week7Start < monthStart ? week7Start : monthStart;

    const [
      todayRow,
      monthRow,
      week7Row,
      employee,
      adjustmentRow,
      holidayRows,
      leaveRows,
      firstSeen,
    ] = await Promise.all([
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
        this.prisma.activitySegment.aggregate({
          _sum: { durationSec: true },
          where: {
            employeeId,
            countsAsWork: true,
            workDate: { gte: week7Start, lte: today },
          },
        }),
        this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: {
            // ⭐ G37 — কর্মকালের দুই প্রান্ত, tray-র টার্গেটও prorate হয়
            joinedOn: true,
            leftOn: true,
            // ⚠️ `weeklyOffDay` কর্মীর নয়, **work policy**-র কলাম — সাপ্তাহিক
            //    ছুটি নীতির অংশ, ব্যক্তিগত বৈশিষ্ট্য নয়।
            policy: {
              select: {
                monthlyTargetHours: true,
                weeklyOffDay: true,
                expectedWorkdays: true,
              },
            },
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
          where: { holidayDate: { gte: holidayFrom, lte: monthEnd } },
          select: { holidayDate: true },
        }),
        /**
         * ⭐ R2 — তার নিজের ছুটি। ⚠️ `holidayFrom` থেকেই আনা হয় (মাসের ১
         *    তারিখ নয়), কারণ নিচে সাত দিনের টার্গেটেও এটা লাগে আর ওই
         *    জানালা মাসের সীমা পেরোতে পারে।
         */
        this.prisma.leave.findMany({
          where: { employeeId, leaveDate: { gte: holidayFrom, lte: monthEnd } },
          select: { leaveDate: true },
        }),
        /**
         * ⭐⭐ **সার্ভার কবে থেকে এই কর্মীকে নিয়ে হিসাব করছে** — তার
         * সবচেয়ে পুরোনো `daily_summary` সারি। প্রত্যাশার জানালা এর আগে
         * শুরু হয় না।
         *
         * ⚠️ মাস দিয়ে ছাঁকা হয় না, ইচ্ছাকৃত: প্রশ্নটা "এই মাসে তার ডেটা
         *    আছে কি" নয়, "তাকে কবে থেকে গুনছি"। মাস দিয়ে ছাঁকলে প্রতিটি
         *    মাসের ১ তারিখেই ট্র্যাকিং নতুন করে "শুরু" হতো।
         *
         * ⚠️ সংস্থা-স্তরের min **নয়** — তাহলে পরে যোগ হওয়া কর্মীর জানালা
         *    সংস্থার প্রথম দিন থেকে শুরু হতো, অর্থাৎ সে সিস্টেমে আসার
         *    আগের সময়টাও তার ঘাটতিতে ঢুকত।
         *
         * ⚠️⚠️ **এটা "এজেন্ট কবে বসেছে" নয়।** `refreshDate()` প্রতিটি
         *    active কর্মীর সারি লেখে, ডেটা থাক বা না থাক — তাই ১ অক্টোবর
         *    সক্রিয় হয়ে ৮ অক্টোবর এজেন্ট পাওয়া কর্মীর এজেন্টহীন দিনগুলো
         *    এখনো পুরো ঘাটতি। আগে এখানে উল্টোটা দাবি করা ছিল, আর ওই
         *    মিথ্যা মন্তব্যটা পড়ে কেউ ভাবতেন কেসটা ঢাকা পড়ে গেছে।
         */
        trackedFromBy(this.prisma, [employeeId]),
      ]);

    const monthActiveSec = monthRow._sum.durationSec ?? 0;
    const monthlyTargetHours = Number(
      // পলিসি না থাকলে স্পেকের ডিফল্ট — শূন্য দিলে এজেন্টে ভাগ করতে গিয়ে
      // অসীম অগ্রগতি দেখাত
      employee?.policy?.monthlyTargetHours ?? 208,
    );

    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));
    const off = employee?.policy?.weeklyOffDay ?? null;
    const leaveDates = new Set(leaveRows.map((l) => l.leaveDate.getTime()));

    /**
     * ⭐⭐ **G37 · ADR-025 — tray-র টার্গেটও prorate হয়।**
     *
     * ⚠️⚠️ এটা বাদ দিলে **সবচেয়ে খারাপ ধরনের বাগ** হতো: ১৫ তারিখে যোগ
     * দেওয়া স্টাফের tray দেখাত "x / ২০৮ঘ", আর ড্যাশবোর্ড ও পে-রোল শিট
     * দেখাত "x / ১১২ঘ"। দুই জায়গায় দুই সংখ্যা মানে একটা মিথ্যা বলছে, আর
     * এই ফিচারটার পুরো উদ্দেশ্যই আস্থা ([§ ২.১-ঙ](../../../docs/07-Technical-Spec.md))।
     */
    const p = prorate({
      monthStart,
      monthEnd,
      joinedOn: employee?.joinedOn ?? null,
      leftOn: employee?.leftOn ?? null,
      weeklyOffDay: off,
      holidays,
      monthlyTargetSec: monthlyTargetHours * 3600,
      policyWorkdays: employee?.policy?.expectedWorkdays ?? 26,
      leaveDates,
    });

    const expectedWorkdays = p.employeeWorkdays;

    /**
     * ⭐⭐ **জানালাটা এখানে হিসাব করা হয় না — `elapsedWorkdays()` করে।**
     *
     * ⚠️⚠️ আগে এখানে নিজের একটা হিসাব ছিল: `max(মাসের ১, joinedOn)` থেকে
     *    **আজ ধরে** ক্যালেন্ডার কর্মদিবস। সেটাই ছিল এই রিপোর সবচেয়ে বড়
     *    পাপের উৎস — কর্মী তার নিজের tray/`/me`-তে যা দেখতেন আর owner
     *    Monthly পাতায় যা দেখতেন, দুটোর ফারাক দাঁড়িয়েছিল ~৮৯ ঘণ্টা।
     *    কারণ দুটো:
     *      ১· **আজকের দিনটা ধরা হতো।** ভোর ৬টায় tray "৮ ঘণ্টা পিছিয়ে"
     *         দেখাত, সন্ধ্যায় নিজে থেকেই ঠিক হয়ে যেত — একই মানুষ দিনে
     *         দুবার দুই রায় পেতেন, কেবল ঘড়ির কাঁটার কারণে।
     *      ২· **ট্র্যাকিং শুরুর আগের দিনও গোনা হতো**, অর্থাৎ এজেন্ট বসার
     *         আগের না-দেখা দিনগুলো তার ব্যর্থতা হয়ে যেত।
     */
    const workdaysElapsed = elapsedWorkdays({
      periodStart: monthStart,
      periodEnd: monthEnd,
      today,
      joinedOn: employee?.joinedOn ?? null,
      leftOn: employee?.leftOn ?? null,
      // ⚠️⚠️ `?? today` — না-দেখা কর্মীর প্রত্যাশা ০, পুরো মাস নয় (G120)
      trackingStartedOn: firstSeen.get(employeeId) ?? today,
      weeklyOffDay: off,
      holidays,
    }, leaveDates);

    /**
     * এক কর্মদিবসের ভাগ। ⚠️ পলিসি থেকে সরাসরি, তার কর্মদিবস দিয়ে ভাগ করে
     * নয় — দৈনিক টার্গেট সবার জন্য একই ৮ ঘণ্টা, কে কবে যোগ দিল তাতে বদলায় না।
     */
    const perWorkdayTargetSec = Math.round(p.dailyTargetSec);

    // আজ কর্মদিবস কি না — countWorkdays দুই প্রান্তই ধরে, তাই একদিনের রেঞ্জ
    const todayIsWorkday = countWorkdays(today, today, off, holidays) > 0;

    return {
      todayActiveSec: todayRow._sum.durationSec ?? 0,
      monthActiveSec,
      // ⭐ G37 — এজেন্ট যা দেখাবে সেটা **তার** টার্গেট, ফ্ল্যাট ২০৮ নয়
      monthlyTargetHours: p.targetSec / 3600,
      dailyTargetSec: todayIsWorkday ? perWorkdayTargetSec : 0,
      week7ActiveSec: week7Row._sum.durationSec ?? 0,
      /**
       * ⚠️ R2 — সাত দিনের টার্গেট থেকেও ছুটি বাদ। নইলে ছুটি কাটিয়ে ফেরা
       *    কেউ tray-তে "এই সপ্তাহে অনেক পিছিয়ে" দেখতেন — অথচ মাসিক
       *    সংখ্যাটা তাঁকে ঠিকই ছাড় দিয়েছে। দুটো একসাথে দেখা যায়।
       */
      week7TargetSec:
        perWorkdayTargetSec *
        Math.max(
          0,
          countWorkdays(week7Start, today, off, holidays) -
            countLeaveWorkdays(leaveDates, week7Start, today, off, holidays),
        ),
      paceSec: paceSecOf({
        /**
         * ⚠️ `credited`, `worked` নয় — § ২.১-ঙ (G35)। সার্ভারের দোষে ঘণ্টা
         * হারানো স্টাফ owner-এর সংশোধনের পরেও tray-তে সারা মাস "পিছিয়ে"
         * দেখত, অথচ ড্যাশবোর্ড তাকে এগিয়ে দেখাত — দুটো সংখ্যা দুই কথা
         * বললেই আস্থা শেষ, আর এই ফিচারটার উদ্দেশ্যই আস্থা।
         */
        creditedSec: monthActiveSec + (adjustmentRow._sum.deltaSec ?? 0),
        monthlyTargetHours: p.targetSec / 3600,
        expectedWorkdays,
        leaveWorkdays: p.leaveWorkdays,
        workdaysElapsed,
      }),
    };
  }
}
