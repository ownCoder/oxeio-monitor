import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { nextLocalMidnight } from '../agent/util/dhaka-time';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_TIMEZONE, RunLock, SCHEDULING_ENABLED } from './scheduling';
import { previousWorkDate } from './summary.math';
import { SummaryService } from './summary.service';

export interface DayCloseResult {
  /** যে কর্মদিবসটা ক্লোজ করা হলো */
  workDate: Date | null;
  sessionsClosed: number;
  employees: number;
  skipped: boolean;
}

/**
 * **K05** — দিন-ক্লোজ: খোলা পড়ে থাকা সেশন বন্ধ, ওই দিনের সারাংশ চূড়ান্ত,
 * মাসিক rollup হালনাগাদ।
 *
 * ⭐ **সময় রাত ০০:১৫, আগের দিনের জন্য — ২৩:৩০ নয়।**
 * 04-Features-এর K05 সারিতে এখনো পুরোনো "রাত ১১:৩০" লেখা আছে, কিন্তু সেটা
 * G30-এর আগের সিদ্ধান্ত। শিফট তুলে দেওয়ার পর রাত ১১টার পর কাজ স্বাভাবিক
 * ঘটনা, তাই ২৩:৩০-এ "দিন চূড়ান্ত" করলে ঠিক যাঁরা রাতে কাজ করছেন তাঁদের
 * শেষ আধ ঘণ্টা প্রতিদিন হিসাবের বাইরে থেকে যেত।
 * উৎস: [07 § ২.১-ক ও § ৬.৪](../../../docs/07-Technical-Spec.md),
 * [08 G30](../../../docs/08-Gap-Analysis.md), [02 § দৈনিক ছক](../../../docs/02-Workflow.md)।
 *
 * ⚠️ "ক্লোজ" মানে ঘণ্টা **জমা করা নয়**। কাজের সময় আসে কেবল
 * `activity_segments` থেকে; সেশন বন্ধ করা নিছক হিসাবরক্ষা, যাতে
 * `ended_at` চিরকাল NULL পড়ে না থাকে (G24)। তাই এই জব না চললেও কারো
 * এক সেকেন্ড ঘণ্টাও হারায় না — শুধু সারাংশ পুরোনো থাকে।
 */
@Injectable()
export class DayCloseJob {
  private readonly logger = new Logger(DayCloseJob.name);
  private readonly lock = new RunLock();

  constructor(
    private readonly prisma: PrismaService,
    private readonly summary: SummaryService,
  ) {}

  /** ⚠️ `timeZone` ছাড়া এটা UTC-র ০০:১৫ = ঢাকার সকাল ৬:১৫-তে চলত। */
  @Cron('0 15 0 * * *', {
    name: 'day-close',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    // ⚠️ দ্বিতীয় তালা — কারণ ব্যাখ্যা `summary-refresh.job.ts`-এ
    if (!SCHEDULING_ENABLED) return;
    await this.runOnce();
  }

  /**
   * `now`-এর **আগের** কর্মদিবসটা ক্লোজ করে।
   *
   * ⚠️ চলতি দিনটা ইচ্ছাকৃতভাবে ছোঁয়া হয় না — ০০:১৫-তে অনেকের PC তখনো
   * চালু, তাঁদের সেশন এখন বন্ধ করলে টাইমলাইনে মাঝপথে কাটা পড়ত।
   */
  async runOnce(now: Date = new Date()): Promise<DayCloseResult> {
    const target = previousWorkDate(now);

    const result = await this.lock.run(async () => {
      const sessionsClosed = await this.closeStaleSessions(target);
      const refreshed = await this.summary.refreshDate(target, now);
      return { sessionsClosed, employees: refreshed.employees };
    });

    if (result === null) {
      this.logger.warn('আগের দিন-ক্লোজ এখনো চলছে — এই দফা বাদ');
      return { workDate: null, sessionsClosed: 0, employees: 0, skipped: true };
    }

    this.logger.log(
      `দিন-ক্লোজ ${target.toISOString().slice(0, 10)} · ` +
        `${result.sessionsClosed}টি সেশন বন্ধ · ${result.employees} জনের সারাংশ`,
    );

    return { workDate: target, ...result, skipped: false };
  }

  /**
   * `target` বা তার আগের যেসব `work_session` খোলা পড়ে আছে (এজেন্ট ক্র্যাশ,
   * PC-র প্লাগ খুলে যাওয়া, বা পুরোনো এজেন্ট) সেগুলো বন্ধ করে।
   *
   * ⚠️ ⭐ `ended_at` বসে **সেশনের নিজের মধ্যরাতে**, `now`-তে নয়। এটাই
   * এখানকার একমাত্র নীরব ফাঁদ: ১১ আগস্টের একটা সেশনকে ১২ আগস্ট ০০:১৫-তে
   * "এখন" দিয়ে বন্ধ করলে সেশনটা পরের তারিখে ১৫ মিনিট গড়িয়ে যেত, আর
   * টাইমলাইনে ১২ আগস্টের ভোরে এমন একটা সেশন দেখা যেত যা কখনো ছিল না।
   * (একই যুক্তিতে `ingest.service.ts`-ও `nextLocalMidnight` ব্যবহার করে,
   * আর কারণও এক — তাই `end_reason`-ও একই: `day_rollover`।)
   */
  private async closeStaleSessions(target: Date): Promise<number> {
    const open = await this.prisma.workSession.findMany({
      where: { endedAt: null, workDate: { lte: target } },
      select: { id: true, startedAt: true },
    });

    if (open.length === 0) return 0;

    // একই মধ্যরাতে পড়া সেশনগুলো একসাথে — প্রতি সারিতে আলাদা UPDATE নয়
    const byMidnight = new Map<number, bigint[]>();
    for (const s of open) {
      const at = nextLocalMidnight(s.startedAt).getTime();
      const ids = byMidnight.get(at);
      if (ids) ids.push(s.id);
      else byMidnight.set(at, [s.id]);
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const [at, ids] of byMidnight) {
      ops.push(
        this.prisma.workSession.updateMany({
          where: { id: { in: ids } },
          data: { endedAt: new Date(at), endReason: 'day_rollover' },
        }),
      );
    }

    await this.prisma.$transaction(ops);

    return open.length;
  }
}
