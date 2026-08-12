import { Module } from '@nestjs/common';

import { SummaryModule } from '../summary/summary.module';
import {
  AdjustmentsController,
  EmployeeAdjustmentsController,
} from './adjustments.controller';
import { AdjustmentsService } from './adjustments.service';

/**
 * **B14 · G35 · ADR-011e** — ঘণ্টা সংশোধন।
 *
 * ⚠️ `SummaryModule` ইমপোর্ট করা হয়েছে শুধু `SummaryService`-এর জন্য —
 * সংশোধনের পর ওই দিনের সারাংশ সাথে সাথে নতুন করে বসাতে। ওই মডিউলে
 * `ScheduleModule.forRoot()` আছে, কিন্তু Nest মডিউল singleton, তাই
 * ইমপোর্ট করলে সেটা দ্বিতীয়বার চলে না — আর ওটাই জরুরি, কারণ দুটো
 * explorer একই নামের cron দুবার রেজিস্টার করতে গিয়ে bootstrap-এই
 * ভেঙে পড়ত (`summary.module.ts`-এর সতর্কতা দেখুন)।
 */
@Module({
  imports: [SummaryModule],
  controllers: [EmployeeAdjustmentsController, AdjustmentsController],
  providers: [AdjustmentsService],
  exports: [AdjustmentsService],
})
export class AdjustmentsModule {}
