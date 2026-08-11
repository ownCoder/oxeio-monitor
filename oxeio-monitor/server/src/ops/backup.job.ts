import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';

import { BackupCheck } from '../alerts/backup.check';
import { JOB_TIMEZONE, SCHEDULING_ENABLED } from '../summary/scheduling';
import { BackupService, type BackupResult } from './backup.service';
import { BACKUP_CRON } from './ops.constants';

/** ⚠️ `SchedulerRegistry`-তে খোঁজার জন্য — নামটা `@Cron`-এর নামের সাথে এক */
const JOB_NAME = 'db-backup';

/**
 * **K02 · K03** — রাত ২:৩০-এর ব্যাকআপ (স্পেক § ৬.৪)।
 *
 * ⚠️ এখানে `ScheduleModule.forRoot()` **যোগ করা হয়নি**, ইচ্ছাকৃতভাবে।
 *    `SummaryModule` ইতিমধ্যেই সেটা করে, আর forRoot **global** — তার
 *    explorer অ্যাপের সব provider স্ক্যান করে, ফলে এই `@Cron` এমনিতেই
 *    ধরা পড়ে। দুবার forRoot করলে দুটো explorer একই নামের জব দুবার
 *    রেজিস্টার করতে গিয়ে bootstrap-এই ভেঙে পড়ত।
 *
 * ⚠️ কিন্তু সেই নির্ভরতাটা **অদৃশ্য** — কেউ `SummaryModule` সরালে বা
 *    টেস্ট-মোডের শর্তটা বদলালে ব্যাকআপ নীরবে বন্ধ হয়ে যেত, আর সেটা
 *    জানা যেত পুনরুদ্ধারের দিনে। তাই bootstrap-এ মিলিয়ে দেখা হয় জবটা
 *    সত্যিই রেজিস্টার হয়েছে কি না, আর না হলে জোরে বলা হয়। (G04-ও
 *    ধরত, কিন্তু ২৬ ঘণ্টা পরে; এটা ধরে সাথে সাথেই।)
 */
@Injectable()
export class BackupJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(BackupJob.name);

  constructor(
    private readonly backup: BackupService,
    private readonly check: BackupCheck,
    /**
     * ⚠️ `@Optional()` — টেস্টে `ScheduleModule` লোডই হয় না, তখন এই
     *    provider-টা কনটেইনারে নেই। Optional না করলে টেস্টে পুরো
     *    অ্যাপ bootstrap-এ ভাঙত।
     */
    @Optional()
    @Inject(SchedulerRegistry)
    private readonly registry: SchedulerRegistry | null,
  ) {}

  onApplicationBootstrap(): void {
    if (!SCHEDULING_ENABLED) return;

    const registered = (() => {
      try {
        return this.registry?.doesExist('cron', JOB_NAME) ?? false;
      } catch {
        return false;
      }
    })();

    if (!registered) {
      this.logger.error(
        `The nightly backup job (${JOB_NAME}) was not registered — is ScheduleModule.forRoot() ` +
          'present anywhere? Backups will not run in this state.',
      );
      return;
    }

    this.logger.log(
      `Nightly backup enabled (${BACKUP_CRON}, ${JOB_TIMEZONE})` +
        (this.backup.configured ? '' : ' — but there is no BACKUP_PASSPHRASE, so it will not run'),
    );
  }

  /**
   * ⚠️ `timeZone` ছাড়া UTC-র ২:৩০ = ঢাকার সকাল ৮:৩০ — অফিস শুরুর মুখে
   *    পুরো ডাটাবেসের উপর দিয়ে একটা ডাম্প। সবচেয়ে ব্যস্ত সময়ে সবচেয়ে
   *    ভারী কাজ।
   */
  @Cron(BACKUP_CRON, {
    name: JOB_NAME,
    timeZone: JOB_TIMEZONE,
    disabled: !SCHEDULING_ENABLED,
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    // ⚠️ দ্বিতীয় তালা — `disabled` ছাড়াও, retention জবের মতোই
    if (!SCHEDULING_ENABLED) return;
    await this.runOnce();
  }

  /**
   * ব্যাকআপ, তারপর সাথে সাথেই G04 চেক।
   *
   * ⭐ চেকটা এখানেই ডাকা হয় যাতে ব্যর্থতার খবর ঘণ্টাখানেক অপেক্ষা না করে।
   * পর্যায়ক্রমিক চেকটাও (`OpsScheduler`) আলাদাভাবে চলতে থাকে — ওটার কাজ
   * ভিন্ন: জবটা **আদৌ চলেনি** এমন অবস্থা ধরা, যেখানে এই লাইনটা কখনো
   * চলতই না।
   */
  async runOnce(now = new Date()): Promise<BackupResult> {
    const result = await this.backup.runOnce(now);
    await this.check.runOnce(new Date());
    return result;
  }
}
