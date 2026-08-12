import { Module } from '@nestjs/common';

import { BackupCheck } from '../alerts/backup.check';
import { AlertsModule } from '../alerts/alerts.module';
import { TelegramChannel } from '../alerts/telegram.channel';
import { SummaryModule } from '../summary/summary.module';
import { BackupJob } from './backup.job';
import { BackupService } from './backup.service';
import { BackupStateStore } from './backup.state';
import { OpsController } from './ops.controller';
import { OpsHealthService } from './ops.health.service';
import { OpsScheduler } from './ops.scheduler';

/**
 * **K02 · K03 · K04 · G04 · G08** — ব্যাকআপ, হেলথ, ব্যাকআপ-অ্যালার্ট, টেলিগ্রাম।
 *
 * ⚠️ `BackupCheck` (G04) আর `TelegramChannel` (G08) ফাইল হিসেবে
 *    `src/alerts/`-এ, কিন্তু provider হিসেবে **এখানে** — কারণ
 *    `alerts.module.ts` এই কাজের আওতার বাইরে ছিল। ঘরটা ঠিক জায়গায়
 *    নয়, আর সেটা জেনেই রাখা: দুটোকেই `AlertsModule`-এ সরানো উচিত।
 *    ⚠️ সরানোর দিন খেয়াল রাখতে হবে `AlertsModule` যেন `OpsModule`
 *    ইমপোর্ট না করে — তাহলে বৃত্ত (`Ops → Alerts → Ops`) তৈরি হবে,
 *    কারণ `BackupCheck` `BackupService` ব্যবহার করে।
 *
 * ⚠️ এখানে `ScheduleModule.forRoot()` নেই — `SummaryModule` সেটা করে,
 *    আর forRoot global। দুবার করলে bootstrap-এই ভাঙে।
 *
 * ⚠️ `PrismaModule` `@Global`, তাই আলাদা import লাগে না।
 */
@Module({
  // ⚠️ `SummaryModule` শুধু `RetentionJob`-এর জন্য (K01-এর হাতে-চালানো
  //    endpoint)। ওখানে `ScheduleModule.forRoot()` আছে, কিন্তু Nest মডিউল
  //    singleton — ইমপোর্ট করলে সেটা দ্বিতীয়বার চলে না।
  imports: [AlertsModule, SummaryModule],
  controllers: [OpsController],
  providers: [
    BackupStateStore,
    BackupService,
    BackupCheck,
    TelegramChannel,
    BackupJob,
    OpsHealthService,
    OpsScheduler,
  ],
  // টেস্ট বা ভবিষ্যতের admin endpoint যেন `runOnce()` ডাকতে পারে
  exports: [BackupService, BackupJob, BackupStateStore, OpsHealthService, OpsScheduler],
})
export class OpsModule {}
