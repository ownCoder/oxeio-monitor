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
   * ⚠️ এক সময় ঘণ্টার স্ন্যাপশট (`SnapshotService`) এটাই ডাকত; সেই জবটা
   * **তুলে দেওয়া হয়েছে** (১৮ আগস্ট — দিনে ১১টা বার্তা, আর মালিক
   * চেয়েছিলেন একটা দৈনিক রিপোর্ট)। ⭐ export রাখা হলো: "এখন কে কাজ
   * করছে" প্রশ্নের একটাই হিসাব থাকা এখনো ঠিক নিয়ম।
   */
  exports: [DashboardService],
})
export class DashboardModule {}
