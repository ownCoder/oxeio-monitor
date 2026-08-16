import { Injectable, Logger } from '@nestjs/common';

import { TelegramChannel } from '../alerts/telegram.channel';
import { DashboardService } from '../dashboard/dashboard.service';
import { shouldSendSnapshot, snapshotMessage } from './snapshot.rules';

/**
 * **ঘণ্টায় একবার — এখন কে কাজ করছে, কে করছে না** (টেলিগ্রামে)।
 *
 * ⚠️⚠️ **কেন প্রতি বিরতিতে অ্যালার্ট নয়:** মালিক চেয়েছিলেন কেউ ১০ মিনিটের
 * বেশি idle থাকলেই খবর। হিসাব করলে ১২ জনের অফিসে দিনে **৬০–১৮০টা বার্তা** —
 * চা, দুপুরের খাবার, বাথরুম, ফোন, মিটিং। `THROTTLE_HOURS`-এর ডকে ওই পথের
 * পরিণতি আগেই লেখা আছে: কিছুদিনে কেউ আর কোনো বার্তা পড়ে না, আর তখন
 * **সত্যিকারের** সমস্যাও চোখ এড়িয়ে যায়।
 *
 * ⭐ তাই ঘণ্টায় একটা বার্তা, পুরো দলের ছবিসহ — একই তথ্য, কিন্তু পড়া হয়।
 *
 * ⚠️ কোনো নতুন হিসাব নেই — Live Board যা দেখায়, এটা ঠিক সেটাই পাঠায়
 * (`DashboardService.live()`)। দুই জায়গায় দুই হিসাব হলে পর্দা এক কথা
 * বলত আর টেলিগ্রাম অন্য কথা, আর কোনটা সত্যি তা বলা যেত না।
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly dashboard: DashboardService,
    private readonly telegram: TelegramChannel,
  ) {}

  /** ⚠️ কখনো throw করে না — জবটা এর উপর দাঁড়িয়ে */
  async runOnce(now: Date = new Date()): Promise<'sent' | 'skipped' | 'failed'> {
    /**
     * ⚠️ ঢাকার ঘড়ি, সার্ভারের নয়। কনটেইনারে `TZ=Asia/Dhaka` বসানো আছে,
     * তবু স্পষ্ট করে বের করা — একদিন কেউ TZ বদলালে বার্তা রাত ২টায়
     * যেতে শুরু করত, আর কারণটা খুঁজে পাওয়া কঠিন হতো।
     */
    const dhaka = new Date(now.getTime() + 6 * 3_600_000);
    const hour = dhaka.getUTCHours();

    if (!shouldSendSnapshot(hour)) return 'skipped';

    const board = await this.dashboard.live(now);

    const text = snapshotMessage({
      people: board.cards.map((c) => ({
        fullName: c.fullName,
        status: c.status,
        todayWorkedSec: c.todayWorkedSec,
      })),
      clock: `${String(hour).padStart(2, '0')}:00`,
    });

    // ⚠️ কেউ না থাকলে (সবাই নিষ্ক্রিয়, বা এখনো কেউ যোগ হয়নি) চুপ থাকা
    if (text === null) return 'skipped';

    const outcome = await this.telegram.send(text);

    if (outcome === 'sent') {
      this.logger.log(`Hourly snapshot sent · ${board.cards.length} staff`);
      return 'sent';
    }

    /**
     * ⚠️ `not_configured` **ব্যর্থতা নয়** — টেলিগ্রাম না থাকা স্বাভাবিক।
     * ব্যর্থ বললে লগ রোজ ৮ বার অকারণে লাল হতো, আর আসল ব্যর্থতা ওই
     * লালের ভিড়ে হারাত।
     */
    return outcome === 'failed' ? 'failed' : 'skipped';
  }
}
