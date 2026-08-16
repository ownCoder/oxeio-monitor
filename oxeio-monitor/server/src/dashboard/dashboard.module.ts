import { Module } from '@nestjs/common';

import { DashboardService } from './dashboard.service';
import { EmployeeActivityController } from './employee-activity.controller';
import { LiveController } from './live.controller';

/**
 * E01/E02/E04/E05 — লাইভ বোর্ড ও কর্মীর দিনের বিস্তারিত।
 *
 * PrismaModule গ্লোবাল, তাই আলাদা করে import করতে হয় না
 * (PayrollModule-ও একই কারণে খালি `imports`-এ চলে)।
 */
@Module({
  controllers: [LiveController, EmployeeActivityController],
  providers: [DashboardService],
  /**
   * ⭐ ঘণ্টার স্ন্যাপশট (`SnapshotService`) এটাই ডাকে — Live Board যা
   * দেখায়, টেলিগ্রামেও ঠিক সেটাই যায়।
   *
   * ⚠️⚠️ **আলাদা করে আবার হিসাব করা হয়নি, ইচ্ছাকৃতভাবে।** দুই জায়গায়
   * দুই হিসাব হলে পর্দা এক কথা বলত আর টেলিগ্রাম অন্য কথা, আর কোনটা
   * সত্যি তা বলার উপায় থাকত না।
   */
  exports: [DashboardService],
})
export class DashboardModule {}
