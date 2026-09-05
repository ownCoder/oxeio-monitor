import { Module } from '@nestjs/common';

import { ActivityModule } from '../activity/activity.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

import { AgentConfigService } from './agent-config.service';
import { AgentController } from './agent.controller';
import { ClockDriftService } from './clock-drift.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { DeviceRateLimitService } from './device-rate-limit.service';
import { EnrollmentService } from './enrollment.service';
import { IngestService } from './ingest.service';
import { ProgressService } from './progress.service';
import { RolloutAdvanceJob } from './rollout-advance.job';
import { ScreenshotIngestService } from './screenshot-ingest.service';
import { UpdateService } from './update.service';

@Module({
  // ⚠️ `AuthModule` শুধু `AuthService`-এর জন্য — স্টাফের লগইন দিয়ে
  //    enrollment (`/agent/enroll-login`)। পাসওয়ার্ড যাচাই, 2FA আর
  //    brute-force throttle সব ওখানেই, নকল করে লেখা হয়নি।
  // ⭐ `AuditModule` — রোলআউট নিজে থেকে এগোলে খাতায় লেখা থাকতে হয়
  imports: [ActivityModule, AuditModule, AuthModule],
  controllers: [AgentController],
  providers: [
    ProgressService,
    AgentConfigService,
    RolloutAdvanceJob,
    ClockDriftService,
    DeviceAuthGuard,
    DeviceRateLimitService,
    EnrollmentService,
    IngestService,
    ScreenshotIngestService,
    UpdateService,
  ],
  // ⚠️ `ProgressService` export করা হয় **কর্মীর নিজের পাতার জন্য**
  //    (`MeModule`) — tray আর ওয়েব যেন একই সংখ্যা দেখায়।
  /**
   * ⭐ `UpdateService` export — `AdminModule`-এর ডাউনলোড রুট এটাই ব্যবহার
   *    করে। ⚠️ কোডটা নকল করা হয়নি ইচ্ছাকৃতভাবে: `openMsi()` path-traversal
   *    আটকায় (storage-এর বাইরের ফাইল দেওয়া যাবে না), আর ওই পাহারাটা দুই
   *    জায়গায় থাকলে একদিন একটায় ঠিক হতো, অন্যটায় নয়।
   */
  exports: [AgentConfigService, ClockDriftService, ProgressService, UpdateService],
})
export class AgentModule {}
