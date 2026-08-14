import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { JOB_TIMEZONE, RunLock, SCHEDULING_ENABLED } from '../summary/scheduling';
import { weeklyScheduleOf } from './weekly.rules';
import { WeeklyDigestService, type WeeklyDigestResult } from './weekly.service';

/**
 * ⚠️ `process.env` **সরাসরি** পড়া হয়েছে, `ConfigService` দিয়ে নয় — ইচ্ছাকৃত,
 * `summary/scheduling.ts`-এর একই কারণে। `@Cron(...)`-এর expression ও অপশন
 * হিসাব হয়ে যায় **ক্লাস ডিফাইন হওয়ার সময়ে**, অর্থাৎ ফাইল ইমপোর্ট হওয়ার
 * মুহূর্তে; Nest-এর DI কনটেইনার তখনো জন্মায়নি, তাই ইনজেক্ট করা কিছু পাওয়া
 * সম্ভব নয়।
 */
const SCHEDULE = weeklyScheduleOf(
  process.env.WEEKLY_DIGEST_DAY,
  process.env.WEEKLY_DIGEST_HOUR,
);

/**
 * **R3** — সপ্তাহে একবার owner-এর টেলিগ্রামে সারাংশ।
 * ডিফল্ট শুক্রবার সন্ধ্যা ৬:০০ (ঢাকা), `WEEKLY_DIGEST_DAY` /
 * `WEEKLY_DIGEST_HOUR` দিয়ে বদলানো যায়।
 *
 * ⚠️ `timeZone` ছাড়া cron সার্ভারের নিজের টাইমজোনে চলত (Docker-এ প্রায়
 * সবসময় UTC) — "শুক্র সন্ধ্যা ৬টা" তখন বাস্তবে ঢাকার **শনিবার** রাত ১২টা
 * হতো, অর্থাৎ বার্তাটা আসত পরের সপ্তাহের প্রথম দিনে আর উইন্ডোটাও একদিন
 * সরে যেত। দিন-ভিত্তিক cron-এ ভুলটা দৈনিকের চেয়ে বেশি ক্ষতিকর: বারটাও
 * বদলে যায়।
 *
 * ⚠️ `disabled` **আর** নিচের `if` — দুটো তালা, দুটোই দরকার
 * (`summary/summary-refresh.job.ts`-এর নোট দেখুন)।
 *
 * ⚠️ `ScheduleModule.forRoot()` এখানে **বসানো হয়নি** — `SummaryModule` ওটা
 * করে আর সেটা global। দুবার `forRoot()` হলে দুটো explorer একই জব দুবার
 * রেজিস্টার করত, আর তার আগ পর্যন্ত বার্তাটা সপ্তাহে দুবার যেত।
 */
@Injectable()
export class WeeklyDigestJob {
  private readonly logger = new Logger(WeeklyDigestJob.name);
  private readonly lock = new RunLock();

  constructor(private readonly weekly: WeeklyDigestService) {
    // ⚠️ ভুল env নীরবে ডিফল্টে নামে না। নইলে `WEEKLY_DIGEST_DAY=Friday`
    //    লিখে কেউ সোমবার অপেক্ষা করতেন, আর "কাজ করছে না" বোঝার একমাত্র
    //    উপায় হতো সাত দিন পরে বার্তা না আসা।
    for (const problem of SCHEDULE.ignored) this.logger.error(problem);

    this.logger.log(
      `Weekly summary scheduled for ISO day ${SCHEDULE.isoDay} at ` +
        `${String(SCHEDULE.hour).padStart(2, '0')}:00 ${JOB_TIMEZONE}`,
    );
  }

  @Cron(SCHEDULE.expression, {
    name: 'weekly-digest',
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
   * ⭐ **কখনো throw করে না** — `DigestJob`-এর মতোই। সাপ্তাহিক সারাংশ
   * মনিটরিংয়ের সহায়ক কাজ; একটা মৃত টেলিগ্রাম টোকেন কিংবা work policy
   * মুছে ফেলার ফলে `ReportsService`-এর ছোড়া ৫০০ — কোনোটাই যেন ঘণ্টা গোনা
   * বা এজেন্টের ডেটা নেওয়া থামিয়ে না দেয়। cron কলব্যাক থেকে বেরিয়ে যাওয়া
   * rejected promise Node-এ unhandled rejection, আর সেটা গোটা প্রসেস
   * নামিয়ে দেয়।
   *
   * দুটো কারণে `null` ফিরতে পারে — আগেরটা এখনো চলছে (`RunLock`), বা নিচের
   * catch। দুটোই লগে আলাদা করে দেখা যায়, তাই ডাকা কোড দুটোকে আলাদা করার
   * দরকার পড়ে না।
   */
  async runOnce(now: Date = new Date()): Promise<WeeklyDigestResult | null> {
    return this.lock.run(async () => {
      try {
        return await this.weekly.runOnce(now);
      } catch (err) {
        this.logger.error(
          `Could not build the weekly summary: ${err instanceof Error ? err.message : 'unknown error'}`,
          err instanceof Error ? err.stack : undefined,
        );
        return null;
      }
    });
  }
}
