import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { MyTargetsController, TargetsController } from './targets.controller';
import { TargetsJob } from './targets.job';
import { TargetsService } from './targets.service';

/**
 * **ডিজাইন-টার্গেট** *(২২ আগস্ট ২০২৬)* — জমা · বণ্টন · শেষ হওয়া।
 *
 * ⚠️ `ScheduleModule.forRoot()` এখানে **নেই** — `SummaryModule` ওটা
 * global করে রেখেছে। দ্বিতীয় একটা forRoot বসালে দুটো explorer একই
 * `@Cron` দুবার রেজিস্টার করত, আর তখন বণ্টন দিনে দুবার চলত।
 */
@Module({
  imports: [AuditModule],
  controllers: [TargetsController, MyTargetsController],
  providers: [TargetsService, TargetsJob],
  // ⭐ `SummaryService` এটা ডাকে — ফাইলের নাম থেকে টার্গেট বন্ধ করতে
  exports: [TargetsService],
})
export class TargetsModule {}
