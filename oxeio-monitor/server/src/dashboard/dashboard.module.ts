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
})
export class DashboardModule {}
