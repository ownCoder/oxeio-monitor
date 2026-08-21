import { Injectable, Logger } from '@nestjs/common';
import { SegmentState, type Prisma } from '@prisma/client';

import { workDateOf } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import { designIdsInDay } from './design.rules';
import { prorate } from './proration';
import {
  elapsedWorkdays,
  hoursToSec,
  isWorkday,
  monthBounds,
  rollupMonth,
  summarizeDay,
  type Span,
} from './summary.math';

/** work policy না থাকলে স্পেকের ডিফল্ট (07 § ১) */
const DEFAULT_TARGET_HOURS = 208;

/**
 * ⚠️ পলিসি না থাকলে ২৬ — কারণ ২০৮ ÷ ২৬ = ৮ ঘণ্টা, স্পেকের দৈনিক টার্গেট।
 * দুটো ডিফল্ট আলাদা হয়ে গেলে দৈনিক টার্গেট নীরবে অন্য সংখ্যা হয়ে যেত।
 */
const DEFAULT_POLICY_WORKDAYS = 26;

interface EmployeePolicy {
  id: number;
  /** পলিসির মাসিক টার্গেট (২০৮ঘ) — ⚠️ এটা আর সরাসরি target_sec নয়, G37-এর পর */
  targetSec: number;
  /** পলিসির `expected_workdays` (২৬) — দৈনিক টার্গেট এটা দিয়েই ভাগ হয় */
  policyWorkdays: number;
  /** ISO দিন (শুক্র = ৫), null = প্রতিটি দিনই কর্মদিবস */
  weeklyOffDay: number | null;
  /** G37 — `null` = আগে থেকেই আছে / এখনো আছে */
  joinedOn: Date | null;
  leftOn: Date | null;
}

export interface RefreshResult {
  workDate: Date;
  employees: number;
}

/**
 * ⭐ `daily_summary` ও `monthly_summary` — rollup লেখার একমাত্র জায়গা।
 *
 * K06 (প্রতি ১৫ মিনিট) আর K05 (দিন-ক্লোজ) দুটোই এই একই কোড ডাকে। আলাদা
 * করে লিখলে দিন-ক্লোজে কোনো একটা কলাম অন্যভাবে হিসাব হতো, আর দিনের বেলার
 * সংখ্যা মাঝরাতে নীরবে বদলে যেত — যে বাগ ধরা পড়তে মাস লেগে যায়।
 *
 * ⚠️ এই সার্ভিস `activity_segments`-এ **কখনো হাত দেয় না**। কাঁচা ডেটা
 * অপরিবর্তনীয় (§ ২.১-ঙ, নিয়ম ৪) — সারাংশ যেকোনো সময় শূন্য থেকে আবার
 * বানানো যায়, আর সেজন্যই upsert, insert নয়।
 */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ঢাকার আজকের কর্মদিবস — K06-এর প্রবেশপথ। */
  refreshToday(now: Date = new Date()): Promise<RefreshResult> {
    return this.refreshDate(workDateOf(now), now);
  }

  /**
   * একটা কর্মদিবসের সারাংশ নতুন করে বসায়, তারপর ওই দিনের মাসটাও।
   *
   * ⚠️ **সব active কর্মীর** জন্য চলে, শুধু যাদের ডেটা আছে তাদের নয়। খরচ
   * নগণ্য (১৫ জন), আর বিনিময়ে যে দিন কেউ একেবারেই কাজ করেনি সেদিনও একটা
   * `no_activity` সারি তৈরি হয় — হিটম্যাপে ওই ফাঁকা ঘরটা তখন "ডেটা আসেনি"
   * নাকি "কাজ হয়নি" সেই সন্দেহ আর থাকে না।
   */
  async refreshDate(
    workDate: Date,
    now: Date = new Date(),
  ): Promise<RefreshResult> {
    const employees = await this.activeEmployees();
    if (employees.length === 0) {
      return { workDate, employees: 0 };
    }

    const ids = employees.map((e) => e.id);

    const [segments, shots, adjustments, usage, holiday, designTitles] =
      await Promise.all([
      this.prisma.activitySegment.findMany({
        where: { workDate, employeeId: { in: ids } },
        select: {
          employeeId: true,
          state: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
        },
      }),
      this.prisma.screenshot.groupBy({
        by: ['employeeId'],
        // ⚠️ retention যেগুলো মুছে ফেলার জন্য মার্ক করেছে সেগুলো বাদ —
        //    গ্যালারিতে যা দেখা যায় না, গোনাতেও তা থাকা উচিত নয়
        where: { workDate, employeeId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.timeAdjustment.groupBy({
        by: ['employeeId'],
        // ⚠️ revoke করা সংশোধন বাদ (§ ২.১-ঙ) — ডিলিট হয় না, তাই ফিল্টারই ভরসা
        where: { workDate, employeeId: { in: ids }, revokedAt: null },
        _sum: { deltaSec: true },
      }),
      this.prisma.appUsage.findMany({
        // ⭐ R22a — শুধু ACTIVE-এ দেখা খণ্ড (idle সারি হিসাবে যায় না)
        where: {
          workDate,
          employeeId: { in: ids },
          categoryId: { not: null },
          segmentState: SegmentState.active,
        },
        select: {
          employeeId: true,
          startedAt: true,
          endedAt: true,
          category: { select: { category: true } },
        },
      }),
      this.prisma.holiday.findUnique({ where: { holidayDate: workDate } }),
      /**
       * ⭐⭐ **ডিজাইনের নম্বর** *(২১ আগস্ট)* — ডিজাইন-অ্যাপের শিরোনাম।
       *
       * ⚠️ উপরের `usage` কোয়েরিটা কাজে লাগানো যেত না: ওটা `categoryId`
       * থাকা ও **ACTIVE** সারিই আনে (productivity-র হিসাব), অথচ ডিজাইনের
       * নম্বর ওই দুটো শর্তের বাইরেও থাকে — Illustrator ক্যাটাগরিতে না
       * পড়লেই ডিজাইন গোনা বন্ধ হয়ে যেত, আর কেউ বুঝতেই পারত না কেন।
       *
       * ⚠️ `windowTitle` এখানে আসে ঠিকই, কিন্তু **কোথাও জমা হয় না** —
       * `designIdsInDay()` কেবল সামনের নম্বরটা ফেরত দেয় (মালিকের শর্ত)।
       */
      this.prisma.appUsage.findMany({
        where: {
          workDate,
          employeeId: { in: ids },
          processName: { in: ['Illustrator.exe', 'Photoshop.exe'] },
        },
        select: { employeeId: true, processName: true, windowTitle: true },
      }),
    ]);

    const segmentsBy = groupBy(segments, (s) => s.employeeId);
    const shotsBy = new Map(shots.map((s) => [s.employeeId, s._count._all]));
    const adjustBy = new Map(
      adjustments.map((a) => [a.employeeId, a._sum.deltaSec ?? 0]),
    );

    const productiveBy = new Map<number, Span[]>();
    const unproductiveBy = new Map<number, Span[]>();
    for (const u of usage) {
      const bucket =
        u.category?.category === 'productive'
          ? productiveBy
          : u.category?.category === 'unproductive'
            ? unproductiveBy
            : null;
      // neutral আর ক্যাটাগরিহীন — দুটোই productivity ভগ্নাংশের বাইরে
      if (bucket === null) continue;
      push(bucket, u.employeeId, u);
    }

    const holidays = new Set(holiday ? [workDate.getTime()] : []);

    const designsBy = await this.claimDesigns(designTitles, workDate);

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const e of employees) {
      const numbers = summarizeDay({
        segments: segmentsBy.get(e.id) ?? [],
        screenshotCount: shotsBy.get(e.id) ?? 0,
        adjustmentSec: adjustBy.get(e.id) ?? 0,
        productiveSpans: productiveBy.get(e.id) ?? [],
        unproductiveSpans: unproductiveBy.get(e.id) ?? [],
        isOffDay: !isWorkday(workDate, e.weeklyOffDay, holidays),
      });

      // ⚠️ `summarizeDay`-র ভেতরে ঢোকানো হয়নি — ওটা **সময়ের** খাঁটি অঙ্ক,
      //    আর ডিজাইনের সংখ্যা সময় নয়। মিশিয়ে দিলে ওই ফাংশনের টেস্টগুলোয়
      //    হঠাৎ ডাটাবেসের দরকার পড়ত।
      const designsDone = designsBy.get(e.id) ?? 0;

      ops.push(
        this.prisma.dailySummary.upsert({
          where: { employeeId_workDate: { employeeId: e.id, workDate } },
          create: {
            employeeId: e.id,
            workDate,
            ...numbers,
            designsDone,
            computedAt: now,
          },
          update: { ...numbers, designsDone, computedAt: now },
        }),
      );
    }

    // এক ট্রানজেকশনে — ১৫টা আলাদা রাউন্ড-ট্রিপের বদলে একটাই, আর ড্যাশবোর্ড
    // কখনো "অর্ধেক কর্মীর হালনাগাদ, বাকিদের পুরোনো" অবস্থায় দেখে না
    await this.prisma.$transaction(ops);

    await this.refreshMonth(workDate, employees, now);

    return { workDate, employees: employees.length };
  }

  /**
   * ⭐⭐ **আজ কতগুলো নতুন ডিজাইন** — কর্মী ধরে।
   *
   * ⚠️⚠️ **"খোলা" আর "নতুন" এক নয়, আর তফাতটা বড়।** গতকালের ফাইল আজ আবার
   * খুললে সেটা আজকের কাজ নয়। মাঠে মেপে দেখা গেছে একজনের ৩৯ নেমে দাঁড়ায়
   * **২৪**-এ — অর্থাৎ সরল "আজ যতগুলো দেখা গেছে" নিয়মটা টার্গেটের চেয়ে
   * ৫০%-ও বেশি দেখাতে পারত, আর সেই সংখ্যার উপর কারো মূল্যায়ন দাঁড়াত।
   *
   * ⭐ তাই প্রতিটা (কর্মী, ডিজাইন) জোড়া `design_credits`-এ **একবারই** বসে;
   * প্রাথমিক কী-ই দ্বিতীয়বার বসতে দেয় না (`skipDuplicates`)। "আজকের
   * সংখ্যা" = আজকের তারিখে দাবি করা সারি।
   *
   * ⚠️⚠️ **ক্রমের একটা সীমা লিখে রাখা দরকার:** ক্রেডিট দাবি হয় *যে দিনটা
   * আগে হিসাব হয়* তার নামে। স্বাভাবিক চলায় দিন এগোয় সামনের দিকে, তাই
   * ঠিকই থাকে — কিন্তু কেউ **পুরোনো** একটা দিন নতুন করে হিসাব করালে ওই
   * দিনের ডিজাইনগুলো ইতিমধ্যে পরের দিনের নামে বসে থাকতে পারে, আর তখন
   * পুরোনো দিনটা কম দেখাবে। ব্যাকফিল করলে **পুরোনো থেকে নতুন** ক্রমে।
   *
   * ⚠️ কখনো throw করে না — ডিজাইনের সংখ্যা একটা বাড়তি মাপ; ওটার জন্য
   * ঘণ্টার সারাংশ আটকে যাওয়া চলবে না।
   */
  private async claimDesigns(
    titles: readonly { employeeId: number; processName: string; windowTitle: string | null }[],
    workDate: Date,
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (titles.length === 0) return counts;

    const byEmployee = groupBy(titles, (t) => t.employeeId);

    try {
      for (const [employeeId, rows] of byEmployee) {
        const ids = designIdsInDay(rows);
        if (ids.size === 0) continue;

        await this.prisma.designCredit.createMany({
          data: [...ids].map((designId) => ({
            employeeId,
            designId,
            firstWorkDate: workDate,
          })),
          skipDuplicates: true,
        });
      }

      // ⚠️ দাবি করার **পরে** গোনা হয়, আগে নয় — নইলে আজ প্রথমবার দেখা
      //    ডিজাইনগুলো এই রানে গোনায় পড়ত না, আর সংখ্যাটা একদিন পিছিয়ে থাকত।
      const claimed = await this.prisma.designCredit.groupBy({
        by: ['employeeId'],
        where: { firstWorkDate: workDate, employeeId: { in: [...byEmployee.keys()] } },
        _count: { _all: true },
      });

      for (const row of claimed) counts.set(row.employeeId, row._count._all);
    } catch (err) {
      this.logger.warn(
        `Could not count designs for ${workDate.toISOString().slice(0, 10)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return counts;
  }

  /**
   * ওই তারিখ যে মাসে পড়ে, সেই মাসের rollup।
   *
   * ⚠️ মাস বের হয় **`workDate` থেকে, `now` থেকে নয়**। ১ তারিখ রাত ০০:১৫-তে
   * দিন-ক্লোজ আগের মাসের শেষ দিনটা বন্ধ করে; `now` ধরলে হালনাগাদ হতো সদ্য
   * শুরু হওয়া নতুন মাসের সারিতে, আর আগের মাসের শেষ দিনের ঘণ্টা পে-রোলে
   * কোনোদিনই যোগ হতো না।
   */
  private async refreshMonth(
    workDate: Date,
    employees: readonly EmployeePolicy[],
    now: Date,
  ): Promise<void> {
    const { start, end, yearMonth } = monthBounds(workDate);
    const ids = employees.map((e) => e.id);

    /**
     * ⭐⭐ **R1 — বন্ধ মাস আর গোনা হয় না।** এটাই পুরো ফিচারটার একমাত্র
     * কার্যকর লাইন; বাকি সব (endpoint, ৪০৯, পর্দা) এর চারপাশের মোড়ক।
     *
     * ⚠️⚠️ কেন দরকার: নিচের হিসাবটা **প্রতিবার ওই মুহূর্তের `holidays`
     *    টেবিল পড়ে** আর `prorate()` দিয়ে d ও D আবার গোনে। তাই ছুটির একটা
     *    তারিখ নড়লেই গত মাসের `target_sec` · `expected_sec` ·
     *    `expected_workdays` · `month_workdays` চারটেই পিছন ফিরে বদলাত —
     *    আর পে-রোল ওই সারি থেকেই d ও D পড়ে, অর্থাৎ **বেতন দিয়ে দেওয়ার
     *    পরেও হিসাব নড়ত**, নীরবে।
     *
     * ⚠️ ফেরত যাওয়া হয় **নীরবে নয়** — লগে লেখা হয়, নইলে "সংখ্যা আপডেট
     *    হচ্ছে না কেন" খুঁজতে গিয়ে কেউ এখানে পৌঁছাত না।
     */
    const closed = await this.prisma.monthClosure.findUnique({
      where: { yearMonth },
      select: { closedAt: true },
    });
    if (closed) {
      this.logger.log(
        `${yearMonth} is closed (${closed.closedAt.toISOString()}) — monthly figures left untouched`,
      );
      return;
    }

    const [days, holidayRows, leaveRows, existing, firstSeen] = await Promise.all([
      this.prisma.dailySummary.findMany({
        where: { employeeId: { in: ids }, workDate: { gte: start, lte: end } },
        select: {
          employeeId: true,
          workedSec: true,
          adjustmentSec: true,
        },
      }),
      this.prisma.holiday.findMany({
        where: { holidayDate: { gte: start, lte: end } },
        select: { holidayDate: true },
      }),
      /**
       * ⭐⭐ R2 — **এই মাসে এই কর্মীদের ছুটি**, কর্মীপ্রতি।
       *
       * ⚠️⚠️ `holidays`-এর সাথে এক সেটে মেশানো হয় **না**। `holidays`
       *    সংস্থার, আর ওটা দিয়েই D গোনা হয় — একজনের ছুটি ওখানে ঢুকলে
       *    গোটা দলের বেতনের হর বদলে যেত।
       */
      this.prisma.leave.findMany({
        where: { employeeId: { in: ids }, leaveDate: { gte: start, lte: end } },
        select: { employeeId: true, leaveDate: true },
      }),
      this.prisma.monthlySummary.findMany({
        where: { employeeId: { in: ids }, yearMonth },
        select: { employeeId: true, targetMetAt: true },
      }),
      /**
       * ⭐⭐ **সার্ভার কবে থেকে এই কর্মীকে নিয়ে হিসাব করছে** — তার সবচেয়ে
       * পুরোনো `daily_summary` সারি।
       *
       * ⚠️⚠️ নামটা যেন বিভ্রান্ত না করে: এটা **"এজেন্ট কবে বসেছে" নয়**।
       *    ঠিক নিচের লুপটাই (`refreshDate()`) প্রতিটি active কর্মীর সারি
       *    লেখে, ডেটা থাক বা না থাক — তাই কেউ active হওয়ার দিনেই তার
       *    প্রথম সারি বসে যায়, এজেন্ট তখনো না পৌঁছালেও।
       *
       * ⚠️⚠️ **কর্মীপ্রতি, সংস্থা-স্তরে নয়** — এখানে আগে `where` ছাড়া
       *    একটাই `findFirst` ছিল, অর্থাৎ পুরো সংস্থার প্রথম দিন। তাতে
       *    দুটো ভুল হতো:
       *      ১· পরে যোগ হওয়া কর্মীর জানালা সংস্থার প্রথম দিন থেকে শুরু
       *         হতো — অর্থাৎ সে সিস্টেমে আসার **আগের** মাসগুলোও তার
       *         ঘাটতিতে ঢুকত (`joined_on` খালি বা ঢিলে হলে যা খুবই সম্ভব)।
       *      ২· কোয়েরিটা নিষ্ক্রিয় কর্মীর সারিও পড়ত, তাই বহু আগে চলে
       *         যাওয়া কারো ডেটা গোটা দলের জানালা পিছিয়ে দিত।
       *
       * ⚠️⚠️ **যেটা এটা সারায় না:** ১ অক্টোবর যোগ দিয়ে ৮ অক্টোবর এজেন্ট
       *    পাওয়া কর্মীর ৫টা এজেন্টহীন দিন এখনো পুরো ঘাটতি — কারণ ১
       *    তারিখেই তার `no_activity` সারি লেখা হয়ে যায়। আগে এখানে ঠিক
       *    এই কেসটা "সারানো হয়েছে" বলে দাবি করা ছিল; দাবিটা মিথ্যা ছিল।
       *    ⭐ সারাতে হলে গোনা শুরু করতে হতো প্রথম **`worked`** সারি থেকে,
       *    আর তাতে সত্যিকারের প্রথম-দিকের অনুপস্থিতিও অদৃশ্য হয়ে যেত।
       *
       * ⚠️ **মাস দিয়ে ছাঁকা হয় না** — ইচ্ছাকৃত। প্রশ্নটা "এই মাসে তার
       *    ডেটা আছে কি" নয়, "তাকে কবে থেকে দেখছি"। মাস দিয়ে ছাঁকলে প্রতিটি
       *    মাসের ১ তারিখেই ট্র্যাকিং নতুন করে "শুরু" হতো, আর সেপ্টেম্বরের
       *    প্রত্যাশা আগস্টের মতোই ভুল কাটা পড়ত।
       */
      this.prisma.dailySummary.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: ids } },
        _min: { workDate: true },
      }),
    ]);

    const holidays = new Set(holidayRows.map((h) => h.holidayDate.getTime()));

    const leaveBy = new Map<number, Set<number>>();
    for (const l of leaveRows) {
      let set = leaveBy.get(l.employeeId);
      if (!set) leaveBy.set(l.employeeId, (set = new Set()));
      set.add(l.leaveDate.getTime());
    }
    const daysBy = groupBy(days, (d) => d.employeeId);
    const metAtBy = new Map(existing.map((m) => [m.employeeId, m.targetMetAt]));

    /**
     * ⚠️ `refreshDate()` আজকের দৈনিক সারি **আগে** লিখে তারপর এখানে আসে,
     * তাই একেবারে প্রথম রানে এটা আজকের তারিখই হবে — আর তখন প্রত্যাশা ০,
     * যেটাই সৎ: শেষ হয়ে যাওয়া একটা দিনও এখনো দেখা হয়নি।
     */
    const trackedFromBy = new Map(
      firstSeen.map((f) => [f.employeeId, f._min.workDate]),
    );

    const today = workDateOf(now);

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const e of employees) {
      const rows = daysBy.get(e.id) ?? [];
      const leaveDates = leaveBy.get(e.id);

      /**
       * ⭐⭐ **G37 · ADR-025** — টার্গেট আর ফ্ল্যাট ২০৮ নয়, **তার কর্মদিবস
       * × দৈনিক টার্গেট**। যে ১৫ তারিখে যোগ দিয়েছে তার টার্গেট ১৪ × ৮।
       *
       * ⚠️ `expectedWorkdays` কলামটার **মানে এখানেই বদলায়** — "মাসের
       * কর্মদিবস" থেকে "তার কর্মদিবস"। D আলাদা কলামে যায়, কারণ পে-রোলে
       * d ÷ D লাগে আর দুটো একই সময়ের হিসাব হওয়া চাই।
       */
      const p = prorate({
        monthStart: start,
        monthEnd: end,
        joinedOn: e.joinedOn,
        leftOn: e.leftOn,
        weeklyOffDay: e.weeklyOffDay,
        holidays,
        monthlyTargetSec: e.targetSec,
        policyWorkdays: e.policyWorkdays,
        leaveDates,
      });

      /**
       * ⚠️ `workdaysElapsed`-ও তার কর্মকালের ভেতরেই গোনা হয়। নইলে ১৫
       * তারিখে যোগ দেওয়া কর্মী মাসের শুরু থেকে "পিছিয়ে" দেখাত — প্রথম
       * দিনেই ৮০ ঘণ্টা ঘাটতি নিয়ে শুরু করত।
       *
       * ⭐⭐ জানালার তিনটে সীমাই (**তার** ট্র্যাকিং-শুরু, যোগ/ছাড়ার দিন,
       *    আর আজকের দিনটা বাদ) `elapsedWorkdays()`-এ — কেন, সেখানকার নোট
       *    দেখুন। tray (`progress.service.ts`), Live Board আর রিপোর্ট
       *    (F01/F02) **এই একই ফাংশনটাই** ডাকে, তাই চার পর্দায় সংখ্যাটা
       *    আর আলাদা হতে পারে না। হিসাবটা খাঁটি ফাংশনে রাখা হয়েছে বলেই
       *    `tracking-start.spec.ts` ডাটাবেস ছাড়াই প্রতিটা ধার পরীক্ষা করে।
       */
      const numbers = rollupMonth({
        workedSec: sum(rows.map((r) => r.workedSec)),
        adjustmentSec: sum(rows.map((r) => r.adjustmentSec)),
        targetSec: p.targetSec,
        expectedWorkdays: p.employeeWorkdays,
        monthWorkdays: p.monthWorkdays,
        /**
         * ⭐⭐ R2 — ছুটি **তিন জায়গায় একসাথে** যেতে হয়, নয়তো সংখ্যাগুলো
         * পরস্পরবিরোধী হয়: টার্গেটে (`prorate` — কমে), প্রত্যাশার হরে
         * (এখানে — কমে), আর প্রত্যাশার লবে (`elapsedWorkdays`-এর দ্বিতীয়
         * আর্গুমেন্ট — কমে)। **d ও D-তে যায় না** — ছুটি সবেতন।
         */
        leaveWorkdays: p.leaveWorkdays,
        workdaysElapsed: elapsedWorkdays({
          periodStart: start,
          periodEnd: end,
          today,
          joinedOn: e.joinedOn,
          leftOn: e.leftOn,
          trackingStartedOn: trackedFromBy.get(e.id) ?? null,
          weeklyOffDay: e.weeklyOffDay,
          holidays,
        }, leaveDates),
        daysWithWork: rows.filter((r) => r.workedSec > 0).length,
      });

      /**
       * ⭐ প্রথমবার টার্গেট ছোঁয়ার সময়টা ধরে রাখা হয় — বারবার লেখা হয় না,
       * নইলে প্রতি ১৫ মিনিটে "এইমাত্র টার্গেট পূরণ হলো" হয়ে যেত।
       *
       * ⚠️ আবার টার্গেটের নিচে নেমে গেলে (কোনো সংশোধন revoke হলে) সময়টা
       * মুছে দেওয়া হয়। রেখে দিলে সারিটা এমন একটা অর্জনের দাবি করত যেটা
       * আর সত্যি নয়।
       */
      const targetMetAt = numbers.targetMet
        ? (metAtBy.get(e.id) ?? now)
        : null;

      ops.push(
        this.prisma.monthlySummary.upsert({
          where: { employeeId_yearMonth: { employeeId: e.id, yearMonth } },
          create: {
            employeeId: e.id,
            yearMonth,
            ...numbers,
            targetMetAt,
            computedAt: now,
          },
          update: { ...numbers, targetMetAt, computedAt: now },
        }),
      );
    }

    await this.prisma.$transaction(ops);
  }

  /**
   * ⚠️ শুধু `active` কর্মী — `payroll.service.ts`-এর মতোই। চলে যাওয়া কারো
   * পুরোনো rollup সারি থেকে যায় (রিপোর্টের জন্য দরকার), কিন্তু নতুন করে
   * হিসাব হয় না — তাঁর তো আর ডেটাই আসছে না।
   */
  private async activeEmployees(): Promise<EmployeePolicy[]> {
    const rows = await this.prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        joinedOn: true,
        leftOn: true,
        policy: {
          select: {
            monthlyTargetHours: true,
            weeklyOffDay: true,
            expectedWorkdays: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      targetSec: hoursToSec(
        Number(r.policy?.monthlyTargetHours ?? DEFAULT_TARGET_HOURS),
      ),
      policyWorkdays: r.policy?.expectedWorkdays ?? DEFAULT_POLICY_WORKDAYS,
      weeklyOffDay: r.policy?.weeklyOffDay ?? null,
      joinedOn: r.joinedOn,
      leftOn: r.leftOn,
    }));
  }
}

function groupBy<T>(rows: readonly T[], key: (row: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) push(map, key(row), row);
  return map;
}

function push<T>(map: Map<number, T[]>, key: number, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
