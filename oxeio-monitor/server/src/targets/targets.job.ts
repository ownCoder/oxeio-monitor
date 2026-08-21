import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { workDateOf } from '../agent/util/dhaka-time';
import { JOB_TIMEZONE, RunLock, SCHEDULING_ENABLED } from '../summary/scheduling';
import { TargetsService } from './targets.service';

/**
 * ⭐ রোজ সকাল **৮টা (ঢাকা)** — পুল থেকে ডিজাইনারদের মধ্যে বণ্টন
 * *(মালিকের বাছাই, ২২ আগস্ট)*।
 *
 * ⚠️ সময়টা কাজ শুরুর একটু আগে: এসে বসেই তালিকা তৈরি পাওয়া যায়, আর
 * কাউকে কিছু চাপতে হয় না।
 *
 * ⚠️ `timeZone` ছাড়া cron সার্ভারের নিজের টাইমজোনে চলত (Docker-এ UTC),
 * অর্থাৎ "সকাল ৮টা" হতো ঢাকার দুপুর ২টা।
 *
 * ⚠️ `disabled` **আর** নিচের `if` — দুটো তালা, দুটোই দরকার। টেস্টে
 * একবার টিক করলেই শেয়ার্ড DB-তে অন্য কারো ফিক্সচারে বণ্টন বসে যেত।
 *
 * ⚠️⚠️ **ছুটির দিনেও চলে, আর সেটা ইচ্ছাকৃত।** টার্গেট বরাদ্দ কোনো
 * ঘণ্টা গোনে না; ছুটির দিনে বাদ দিলে শনিবার সকালে কারো হাত খালি
 * থাকত। যাঁর হাতে ইতিমধ্যেই ৩০টা আছে, তিনি এমনিতেই কিছু পান না।
 */
@Injectable()
export class TargetsJob {
  private readonly logger = new Logger(TargetsJob.name);
  private readonly lock = new RunLock();
  /** ⚠️ আলাদা তালা — ফেরত ও বণ্টন কখনো একে অন্যকে আটকাবে না */
  private readonly returnLock = new RunLock();

  constructor(private readonly targets: TargetsService) {}

  @Cron('0 0 8 * * *', {
    name: 'design-target-distribution',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    if (!SCHEDULING_ENABLED) return;
    await this.runOnce();
  }

  /**
   * ⭐⭐ **দিন শেষে — না-করা টার্গেট পুলে ফেরত** *(মালিকের নিয়ম, ২২ আগস্ট)*।
   *
   * ⚠️⚠️ **রাত ১১:৫৫, সকাল ৮টা নয় — আর সময়টা ইচ্ছাকৃত।** বণ্টনের ঠিক
   * আগে ফেরত নিলে সকাল ৭টায় কাজ শুরু করা কারো হাত থেকে টার্গেট **টেনে
   * নেওয়া** হতো। রাতে করলে সকালের তালিকা পরিষ্কার হয়েই থাকে।
   *
   * ⚠️ মধ্যরাতের **আগে**, কারণ তারিখ ঘুরলে "আজ ছোঁয়া হয়েছে কি না"
   * প্রশ্নটার উত্তর বদলে যেত — আর তখন আজকের কাজ-চলতি টার্গেটগুলোও
   * ফেরত চলে যেত।
   *
   * ⚠️ ছুটির দিনেও চলে: বরাদ্দ ঘণ্টা গোনে না, আর ছুটির দিনে হাত ভরে
   * রাখার কোনো কারণ নেই।
   */
  @Cron('0 55 23 * * *', {
    name: 'design-target-return',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async returnScheduled(): Promise<void> {
    if (!SCHEDULING_ENABLED) return;
    await this.returnOnce();
  }

  /** টেস্ট বা হাতে চালানোর জন্য। ⚠️ কখনো throw করে না। */
  async returnOnce(now: Date = new Date()): Promise<void> {
    await this.returnLock.run(async () => {
      try {
        await this.targets.returnUnworked(workDateOf(now));
      } catch (err) {
        this.logger.error(
          `Return failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /** টেস্ট বা হাতে চালানোর জন্য। ⚠️ কখনো throw করে না। */
  async runOnce(now: Date = new Date()): Promise<void> {
    await this.lock.run(async () => {
      try {
        await this.targets.distribute(now);
      } catch (err) {
        this.logger.error(
          `Distribution failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }
}
