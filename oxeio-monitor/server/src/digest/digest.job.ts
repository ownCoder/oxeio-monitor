import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { JOB_TIMEZONE, RunLock, SCHEDULING_ENABLED } from '../summary/scheduling';
import { DigestService, type DigestResult } from './digest.service';

/**
 * F07 — প্রতিদিন সন্ধ্যা **৬:৩০ (ঢাকা)** ডাইজেস্ট।
 *
 * ⚠️ `timeZone` ছাড়া cron সার্ভারের নিজের টাইমজোনে চলত (Docker-এ প্রায়
 * সবসময় UTC) — "সন্ধ্যা ৬:৩০" তখন বাস্তবে ঢাকার রাত ১২:৩০ হতো, অর্থাৎ
 * ইমেইলটা পরদিনের ভোরে পৌঁছাত আর "আজকের ঘণ্টা" আসলে গতকালের হতো।
 *
 * ⚠️ `disabled` **আর** নিচের `if` — দুটো তালা, দুটোই দরকার
 * ([summary-refresh.job.ts](../summary/summary-refresh.job.ts)-এর একই নোট
 * দেখুন)। টেস্টে একবার টিক করলেই শেয়ার্ড DB-তে অন্য কারো ফিক্সচার ধরে
 * রিপোর্ট বানাতে গিয়ে টেস্ট এলোমেলোভাবে ভাঙত।
 *
 * ⚠️ `ScheduleModule.forRoot()` এখানে **বসানো হয়নি** — `SummaryModule`
 * ওটা করে আর সেটা global। দুবার `forRoot()` হলে দুটো explorer একই জব
 * দুবার রেজিস্টার করতে গিয়ে bootstrap-এই ভেঙে পড়ত, আর তার আগ পর্যন্ত
 * ইমেইল দিনে দুবার যেত। ফলে টেস্টে (যেখানে `SummaryModule` explorer-ই
 * বানায় না) এই `@Cron` নিছক মেটাডেটা।
 */
@Injectable()
export class DigestJob {
  private readonly logger = new Logger(DigestJob.name);
  private readonly lock = new RunLock();

  constructor(private readonly digest: DigestService) {}

  @Cron('0 30 18 * * *', {
    name: 'daily-digest',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    if (!SCHEDULING_ENABLED) return;
    await this.runOnce();
  }

  /**
   * টেস্ট বা হাতে চালানোর জন্য।
   *
   * ⭐ **কখনো throw করে না।** ডাইজেস্ট মনিটরিংয়ের সহায়ক কাজ; একটা মৃত SMTP,
   * কিংবা work policy মুছে ফেলার ফলে `ReportsService`-এর ছোড়া ৫০০ — কোনোটাই
   * যেন ঘণ্টা গোনা বা এজেন্টের ডেটা নেওয়া থামিয়ে না দেয়। `setInterval`/cron
   * কলব্যাক থেকে বেরিয়ে যাওয়া rejected promise Node-এ unhandled rejection,
   * আর সেটা গোটা প্রসেস নামিয়ে দেয়।
   */
  async runOnce(now: Date = new Date()): Promise<DigestResult | null> {
    const result = await this.lock.run(async () => {
      try {
        return await this.digest.runOnce(now);
      } catch (err) {
        this.logger.error(
          `Could not build the daily digest: ${err instanceof Error ? err.message : 'unknown error'}`,
          err instanceof Error ? err.stack : undefined,
        );
        return null;
      }
    });

    if (result === null) {
      // দুটো কারণে `null` হতে পারে — আগেরটা এখনো চলছে, বা উপরের catch।
      // দুটোই লগে আলাদা করে দেখা যায়, তাই এখানে আর কিছু বলার নেই।
      return null;
    }

    return result;
  }
}
