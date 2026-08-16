import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { JOB_TIMEZONE, RunLock, SCHEDULING_ENABLED } from '../summary/scheduling';
import { SnapshotService } from './snapshot.service';

/**
 * ⭐ প্রতি ঘণ্টায় — এখন কে কাজ করছে, কে করছে না (টেলিগ্রামে)।
 *
 * ⚠️ `timeZone` ছাড়া cron সার্ভারের নিজের টাইমজোনে চলত (Docker-এ প্রায়
 * সবসময় UTC), আর "কাজের সময়" বলতে যা বোঝায় তার সাথে মিলত না।
 *
 * ⚠️⚠️ কাজের সময়ের সীমাটা এখানে **নেই** — সেটা `snapshot.rules.ts`-এ।
 * cron-এও বসালে নিয়মটা দুই জায়গায় থাকত, আর একদিন একটা বদলাত অন্যটা নয়।
 */
@Injectable()
export class SnapshotJob {
  private readonly logger = new Logger(SnapshotJob.name);
  private readonly lock = new RunLock();

  constructor(private readonly snapshot: SnapshotService) {}

  /**
   * ⭐ প্রতি ঘণ্টার শুরুতে। কাজের সময়ের বাইরে হলে `SnapshotService` নিজেই
   * বাদ দেয় — সময়ের নিয়মটা এক জায়গায় (`snapshot.rules.ts`), cron-এ নয়।
   *
   * ⚠️ cron-এ ঘণ্টার সীমা বসালে নিয়মটা **দুই জায়গায়** থাকত, আর একদিন
   * একটা বদলাত অন্যটা নয়।
   */
  @Cron('0 0 * * * *', {
    name: 'hourly-snapshot',
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    if (!SCHEDULING_ENABLED) return;
    await this.runOnce();
  }

  /** টেস্ট বা হাতে চালানোর জন্য। ⚠️ কখনো throw করে না। */
  async runOnce(now: Date = new Date()): Promise<void> {
    await this.lock.run(async () => {
      try {
        await this.snapshot.runOnce(now);
      } catch (err) {
        this.logger.error(
          `Hourly snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }
}
