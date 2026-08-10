import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

import { BackupCheck } from '../alerts/backup.check';
import { TelegramChannel } from '../alerts/telegram.channel';
import { BACKUP_CHECK_TICK_MS, TELEGRAM_TICK_MS } from './ops.constants';

/**
 * G04-এর পর্যায়ক্রমিক চেক আর G08-এর টেলিগ্রাম sweep।
 *
 * ⚠️ `AlertsScheduler`-এর মতোই সাধারণ `setInterval`, `@Cron` নয় — একই
 *    কারণে: এই দুটোর কোনোটাই "দিনের নির্দিষ্ট সময়ে" চলার জিনিস নয়, আর
 *    `@Cron` ব্যবহার করলে ওদের চলা-না-চলা নির্ভর করত অন্য একটা মডিউলের
 *    `ScheduleModule.forRoot()`-এর উপর। রাতের ব্যাকআপে ওই নির্ভরতাটুকু
 *    মানা হয়েছে (টাইমজোন-সহ দৈনিক সময় দরকার), কিন্তু এখানে দরকার নেই।
 *
 * ⚠️ টেস্টে কোনো টাইমার নয় — নইলে টেস্ট চলাকালীন sweep অন্য এজেন্টের
 *    ফিক্সচারের অ্যালার্টে `channels_sent` বসিয়ে দিত, আর ব্যর্থতাগুলো
 *    এলোমেলো জায়গায় দেখা দিত।
 */
@Injectable()
export class OpsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OpsScheduler.name);
  private readonly timers: NodeJS.Timeout[] = [];
  /** আগের দফা এখনো চললে পরেরটা বাদ */
  private readonly running = new Set<string>();

  constructor(
    private readonly backupCheck: BackupCheck,
    private readonly telegram: TelegramChannel,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') {
      this.logger.log('NODE_ENV=test — ops শিডিউলার চালু হয়নি');
      return;
    }

    this.schedule('backup-check', BACKUP_CHECK_TICK_MS, (now) =>
      this.backupCheck.runOnce(now),
    );

    if (this.telegram.configured) {
      this.schedule('telegram', TELEGRAM_TICK_MS, (now) =>
        this.telegram.runOnce(now),
      );
    }

    this.logger.log(
      'ops চেক চালু হয়েছে (G04' +
        (this.telegram.configured ? ' · G08' : '') +
        ')',
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  /** হাতে চালানোর জন্য — শিডিউলার বন্ধ থাকলেও (যেমন টেস্টে) কাজ করে */
  async runAllOnce(now = new Date()): Promise<number> {
    const raised = await this.backupCheck.runOnce(now);
    await this.telegram.runOnce(now);
    return raised;
  }

  private schedule(
    name: string,
    everyMs: number,
    task: (now: Date) => Promise<number>,
  ): void {
    const timer = setInterval(() => {
      void this.tick(name, task);
    }, everyMs);

    // ⚠️ unref — টাইমার যেন প্রসেসকে বাঁচিয়ে না রাখে
    timer.unref();
    this.timers.push(timer);
  }

  /**
   * ⭐ প্রতিটা টিক try/catch-এ মোড়া — `setInterval`-এর কলব্যাক থেকে
   * বেরিয়ে যাওয়া rejected promise Node-এ পুরো সার্ভার নামিয়ে দেয়।
   * ব্যাকআপের খবর নিতে গিয়ে মনিটরিং বন্ধ হওয়াটা হাস্যকর হতো।
   */
  private async tick(
    name: string,
    task: (now: Date) => Promise<number>,
  ): Promise<void> {
    if (this.running.has(name)) return;

    this.running.add(name);
    try {
      await task(new Date());
    } catch (err) {
      this.logger.error(
        `${name} চেক ব্যর্থ: ${err instanceof Error ? err.message : 'অজানা ত্রুটি'}`,
      );
    } finally {
      this.running.delete(name);
    }
  }
}
