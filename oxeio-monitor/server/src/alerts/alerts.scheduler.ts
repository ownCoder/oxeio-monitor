import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { AgentDownCheck } from './agent-down.check';
import { AgentTamperCheck } from './agent-tamper.check';
import {
  AGENT_DOWN_TICK_MS,
  DISK_TICK_MS,
  DISPATCH_TICK_MS,
  NO_ACTIVITY_TICK_MS,
  STARTUP_GRACE_MIN,
  TAMPER_TICK_MS,
} from './alerts.constants';
import { AlertDispatcher } from './alerts.dispatcher';
import { isWithinStartupGrace } from './alerts.rules';
import { DiskCheck } from './disk.check';
import { NoActivityCheck } from './no-activity.check';

/**
 * অ্যালার্টের সব শিডিউলড চেক এখান থেকে চলে।
 *
 * ⚠️ এখানে `@nestjs/schedule` ব্যবহার করা হয়নি — ইচ্ছাকৃতভাবে, যদিও rollup জব
 *    (`src/summary/`) সেটাই ব্যবহার করে। `ScheduleModule.forRoot()` একটা
 *    **গ্লোবাল** মডিউল আর তার explorer অ্যাপের **সব** provider স্ক্যান করে
 *    `@Cron` খুঁজতে। অর্থাৎ কে কোথায় forRoot বসাল তার ওপর আমার চেকগুলো
 *    চালু-বন্ধ হওয়া নির্ভর করত। অ্যালার্টের বেলায় ভুলটার দাম বেশি: না চললে
 *    কেউ কিছু জানে না, আর দুবার চললে সরাসরি দ্বিগুণ ইমেইল। সাধারণ
 *    `setInterval` কম চতুর, কিন্তু এখানে আচরণটা পুরোপুরি অনুমেয় —
 *    আর কোনো `@Cron` ডেকোরেটর না থাকায় বাইরের explorer এই ক্লাসে কিছুই পায় না।
 */
@Injectable()
export class AlertsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AlertsScheduler.name);
  private readonly bootedAt = new Date();
  private readonly timers: NodeJS.Timeout[] = [];
  /** ⚠️ আগের দফা এখনো চললে পরেরটা বাদ — ধীর DB-তে টিক জমে যেত */
  private readonly running = new Set<string>();

  constructor(
    private readonly agentDown: AgentDownCheck,
    private readonly tamper: AgentTamperCheck,
    private readonly disk: DiskCheck,
    private readonly noActivity: NoActivityCheck,
    private readonly dispatcher: AlertDispatcher,
  ) {}

  onApplicationBootstrap(): void {
    // ⚠️ টেস্টে কোনো টাইমার নয় — নইলে টেস্ট চলার মাঝপথে চেক চলে গিয়ে
    //    অন্য এজেন্টের ফিক্সচারের ওপর অ্যালার্ট বসাত, আর ব্যর্থতাগুলো
    //    এলোমেলোভাবে আসত। প্রতিটা চেকের `runOnce()` আছে — টেস্ট সেটাই ডাকবে।
    if (process.env.NODE_ENV === 'test') {
      this.logger.log('NODE_ENV=test — alert scheduler not started');
      return;
    }

    this.schedule('agent-down', AGENT_DOWN_TICK_MS, (now) => {
      // ⭐ সার্ভার সবে উঠেছে — এখন সবাইকেই চুপ দেখাবে (কারণ আমরাই ছিলাম না)
      if (isWithinStartupGrace(this.bootedAt, now)) {
        this.logger.debug(
          `startup grace (${STARTUP_GRACE_MIN}m) — agent_down check not yet`,
        );
        return Promise.resolve(0);
      }
      return this.agentDown.runOnce(now);
    });

    this.schedule('agent-tamper', TAMPER_TICK_MS, (now) =>
      this.tamper.runOnce(now),
    );
    this.schedule('disk', DISK_TICK_MS, (now) => this.disk.runOnce(now));
    this.schedule('no-activity', NO_ACTIVITY_TICK_MS, (now) =>
      this.noActivity.runOnce(now),
    );
    this.schedule('dispatch', DISPATCH_TICK_MS, (now) =>
      this.dispatcher.runOnce(now),
    );

    this.logger.log('Alert checks started (G01 · G02 · G03 · G06 · G07)');
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  /**
   * হাতে চালানোর জন্য — সবগুলো চেক একবার।
   * শিডিউলার বন্ধ থাকা অবস্থাতেও (যেমন টেস্টে) কাজ করে।
   */
  async runAllOnce(now = new Date()): Promise<number> {
    const counts = await Promise.all([
      this.agentDown.runOnce(now),
      this.tamper.runOnce(now),
      this.disk.runOnce(now),
      this.noActivity.runOnce(now),
    ]);
    await this.dispatcher.runOnce(now);
    return counts.reduce((a, b) => a + b, 0);
  }

  private schedule(
    name: string,
    everyMs: number,
    task: (now: Date) => Promise<number>,
  ): void {
    const timer = setInterval(() => {
      void this.tick(name, task);
    }, everyMs);

    // ⚠️ unref — টাইমার যেন প্রসেসকে বাঁচিয়ে না রাখে। নইলে shutdown hook
    //    চললেও Node বসে থাকত এবং কন্টেইনার restart-এ দেরি হতো।
    timer.unref();
    this.timers.push(timer);
  }

  /**
   * ⭐ প্রতিটা টিক try/catch-এ মোড়া।
   *
   * setInterval-এর কলব্যাক থেকে বেরিয়ে যাওয়া একটা rejected promise Node-এ
   * unhandled rejection — আর সেটা পুরো সার্ভার নামিয়ে দেয়। ডাটাবেসে সাময়িক
   * একটা টাইমআউটের দাম কখনোই "মনিটরিং বন্ধ" হতে পারে না।
   */
  private async tick(
    name: string,
    task: (now: Date) => Promise<number>,
  ): Promise<void> {
    if (this.running.has(name)) {
      this.logger.warn(`${name} check: previous run still going — skipping this tick`);
      return;
    }

    this.running.add(name);
    try {
      await task(new Date());
    } catch (err) {
      this.logger.error(
        `${name} check failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.running.delete(name);
    }
  }
}
