import { Module } from '@nestjs/common';

import { AgentDownCheck } from './agent-down.check';
import { AgentTamperCheck } from './agent-tamper.check';
import { AlertsController } from './alerts.controller';
import { AlertDispatcher } from './alerts.dispatcher';
import { AlertMailer } from './alerts.mailer';
import { AlertsScheduler } from './alerts.scheduler';
import { AlertsService } from './alerts.service';
import { DiskCheck } from './disk.check';
import { NoActivityCheck } from './no-activity.check';

/**
 * G01–G07 — অ্যালার্ট।
 *
 * `AlertsService` export করা হয়েছে যাতে অন্য মডিউল (যেমন ব্যাকআপ জব → G04,
 * বা overlap সনাক্তকরণ → `device_overlap`) নিজেরা `prisma.alert.create()` না
 * লিখে এখান দিয়েই অ্যালার্ট বসায় — ⭐ throttle-টা তখন আপনাআপনি পেয়ে যায়।
 *
 * ⚠️ PrismaModule `@Global`, তাই এখানে আলাদা করে import করার দরকার নেই।
 */
@Module({
  controllers: [AlertsController],
  providers: [
    AlertsService,
    AlertMailer,
    AlertDispatcher,
    AgentDownCheck,
    AgentTamperCheck,
    DiskCheck,
    NoActivityCheck,
    AlertsScheduler,
  ],
  exports: [AlertsService],
})
export class AlertsModule {}
