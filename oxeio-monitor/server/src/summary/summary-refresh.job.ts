import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { JOB_TIMEZONE, RunLock, SCHEDULING_ENABLED } from './scheduling';
import { type DrainResult, SummaryService } from './summary.service';

export interface SummaryRefreshResult {
  workDate: Date | null;
  employees: number;
  /** আগের রান তখনো চলছিল বলে এই ডাক ফিরে গেছে */
  skipped: boolean;
  ms: number;
  /**
   * ⭐ দেরিতে আসা কতগুলো পুরোনো দিন এই টিকে গোনা হলো *(৬ সেপ্টেম্বর ২০২৬)*।
   * ⚠️ `skipped` হলে `null` — কিছুই চলেনি।
   */
  drained: DrainResult | null;
}

/**
 * **K06** — প্রতি ১৫ মিনিটে আজকের `daily_summary` (ও চলতি মাসের rollup)।
 *
 * কেন rollup আদৌ লাগে: Live Board, হিটম্যাপ আর pace কার্ড প্রতিবার
 * `activity_segments` থেকে হিসাব করলে ১৫ জনের মাসের লাখখানেক সারিতে বারবার
 * merge চালাতে হতো। ১৫ মিনিটের পুরোনো সংখ্যা এখানে যথেষ্ট — কারণ "এখন কে
 * অনলাইনে" প্রশ্নের উত্তর আসে heartbeat থেকে, rollup থেকে নয়।
 */
@Injectable()
export class SummaryRefreshJob {
  private readonly logger = new Logger(SummaryRefreshJob.name);
  private readonly lock = new RunLock();

  constructor(private readonly summary: SummaryService) {}

  /**
   * ⚠️ ⭐ `:০০/:১৫/:৩০/:৪৫` নয়, **`:০৫/:২০/:৩৫/:৫০`** — ব্যবধান ঠিক ১৫
   * মিনিটই, শুধু পাঁচ মিনিট সরানো। কারণ দিন-ক্লোজ (K05) চলে ঠিক ০০:১৫-তে;
   * একই মুহূর্তে দুটো জব একই `monthly_summary` সারিতে upsert করলে K06
   * গতকালের সারাংশ লেখা **শেষ হওয়ার আগে** পড়া মাসিক যোগফল পরে লিখে দিত।
   * upsert নিজে atomic, তাই ডেটা নষ্ট হতো না — কিন্তু মাসিক সংখ্যাটা
   * পরের টিক পর্যন্ত ১৫ মিনিট পুরোনো থেকে যেত। পাঁচ মিনিট সরিয়ে দিলে
   * সংঘর্ষটাই আর ঘটে না।
   *
   * ⚠️ `disabled` + নিচের `if` — দুটো তালা, আর দুটোই দরকার।
   *
   * `SummaryModule` টেস্টে `ScheduleModule.forRoot()` ইমপোর্টই করে না, তাই
   * ডেকোরেটরটা তখন নিছক মেটাডেটা। কিন্তু K02/K04 বানাতে গিয়ে কেউ যদি
   * `app.module.ts`-এ `ScheduleModule.forRoot()` বসায়, তার explorer
   * অ্যাপের **সব** provider স্ক্যান করে — আমার এই মেথডও তখন হঠাৎ চালু হয়ে
   * যেত। তাই ডেকোরেটরের বাইরে আরেকটা তালা।
   */
  @Cron('0 5,20,35,50 * * * *', {
    name: 'summary-refresh',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    // আগের রান শেষ না হলে পরের টিক পুরোপুরি বাদ — জমে গিয়ে ডাটাবেসে
    // একই আপডেট একাধিকবার চলার কোনো মানে নেই
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    if (!SCHEDULING_ENABLED) return;
    await this.runOnce();
  }

  /** টেস্ট (বা ভবিষ্যতে কোনো admin endpoint) ইচ্ছে করে ডাকতে পারে। */
  async runOnce(now: Date = new Date()): Promise<SummaryRefreshResult> {
    const startedAt = Date.now();

    /**
     * ⚠️⚠️ **দুটো কাজ একই তালার ভেতরে** — আজকের দিন, তারপর দেরিতে আসা
     * পুরোনো দিনগুলো। আলাদা তালা দিলে দুটো একসাথে চলতে পারত, আর তখন
     * একই `monthly_summary` সারিতে দুজনে upsert করত।
     *
     * ⭐ ক্রমটাও ইচ্ছাকৃত: আজকেরটা আগে, কারণ পর্দায় সেটাই সবাই দেখছেন।
     */
    const result = await this.lock.run(async () => {
      const today = await this.summary.refreshToday(now);
      const drained = await this.summary.drainDirty(now);
      return { today, drained };
    });

    if (result === null) {
      this.logger.warn('Previous summary refresh still going — skipping this tick');
      return { workDate: null, employees: 0, skipped: true, ms: 0, drained: null };
    }

    const { today, drained } = result;
    const ms = Date.now() - startedAt;
    this.logger.log(
      `summary refresh: ${today.workDate.toISOString().slice(0, 10)} · ` +
        `${today.employees} staff · ${ms}ms` +
        // ⚠️ পুরোনো দিন গোনা হলে **সবসময়** লগে ওঠে — নীরবে ইতিহাস
        //    বদলানো ঠিক সেই জিনিস যেটা পরে কেউ ব্যাখ্যা করতে পারত না
        (drained.refreshed > 0 || drained.closed > 0 || drained.pending > 0
          ? ` · late days: ${drained.refreshed} recomputed` +
            (drained.closed > 0 ? `, ${drained.closed} in a closed month` : '') +
            (drained.pending > 0 ? `, ${drained.pending} still queued` : '')
          : ''),
    );

    return {
      workDate: today.workDate,
      employees: today.employees,
      skipped: false,
      ms,
      drained,
    };
  }
}
