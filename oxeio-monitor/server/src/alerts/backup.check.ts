import { Injectable, Logger } from '@nestjs/common';

import { BackupService } from '../ops/backup.service';
import { BackupStateStore } from '../ops/backup.state';
import { backupAlertText, backupVerdict } from '../ops/ops.rules';
import { AlertsService } from './alerts.service';

/**
 * **G04** — ব্যাকআপ ব্যর্থ হলে অ্যালার্ট।
 *
 * ⭐ **সফল হলে এই ক্লাস কিচ্ছু বলে না।** কোনো "ব্যাকআপ ঠিকঠাক হয়েছে" মেইল
 * নেই। রোজকার নিশ্চিতকরণ এক সপ্তাহেই ফিল্টারে চলে যায়, আর তার সাথে
 * যেদিন ব্যাকআপ **হয়নি** সেই বার্তাটাও — অর্থাৎ রোজ খবর দেওয়াটাই
 * শেষপর্যন্ত খবরটা হারিয়ে ফেলার সবচেয়ে নিশ্চিত উপায়।
 *
 * ⭐ চেকটা ব্যাকআপ জব থেকে **আলাদা**, আর সেটাই এর মূল মূল্য। জব নিজে
 * ব্যর্থতা জানাতে পারে শুধু যদি জবটা চলে। সবচেয়ে বিপজ্জনক অবস্থাটা হলো
 * জবটার আদৌ না চলা — সার্ভার রাত ২:৩০-এ বন্ধ ছিল, শিডিউলার রেজিস্টার হয়নি,
 * বা কন্টেইনার ক্র্যাশ লুপে। সেই নীরবতা ধরার একমাত্র উপায় বাইরে থেকে
 * ঘড়ি দেখা: "শেষ সফল ব্যাকআপ কত ঘণ্টা আগে?"
 *
 * ⚠️ `type` সবসময় `backup_failed`, আর deviceId/employeeId দুটোই null —
 *    ফলে throttle-এর key শুধু টাইপটাই (সার্ভারপ্রতি একটা), ৬ ঘণ্টায় একটা।
 */
@Injectable()
export class BackupCheck {
  private readonly logger = new Logger(BackupCheck.name);

  constructor(
    private readonly state: BackupStateStore,
    private readonly backup: BackupService,
    private readonly alerts: AlertsService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const snapshot = await this.state.read(this.backup.configured);
    const verdict = backupVerdict(snapshot, now);

    // ⭐ সব ঠিক — কিছুই বলার নেই
    if (!verdict) return 0;

    const { title, detail } = backupAlertText(verdict);

    this.logger.warn(`Backup problem (${verdict.problem}): ${title}`);

    return this.alerts.raiseMany(
      [
        {
          type: 'backup_failed',
          severity: verdict.severity,
          deviceId: null,
          employeeId: null,
          title,
          detail:
            detail +
            // ⚠️ শেষ ত্রুটির বার্তাটা যোগ করা হয় কারণ ওটা না থাকলে মালিককে
            //    সার্ভারে লগইন করে লগ পড়তে হতো — আর তখন অ্যালার্টটা শুধু
            //    দুশ্চিন্তা দিত, দিক নয়।
            (snapshot.lastError ? ` (last error: ${snapshot.lastError})` : ''),
          meta: {
            problem: verdict.problem,
            hoursSinceSuccess: verdict.hoursSinceSuccess,
            consecutiveFailures: snapshot.consecutiveFailures,
          },
        },
      ],
      now,
    );
  }
}
