import { Module } from '@nestjs/common';

import { ActivityModule } from '../activity/activity.module';

import { AgentConfigService } from './agent-config.service';
import { AgentController } from './agent.controller';
import { ClockDriftService } from './clock-drift.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { DeviceRateLimitService } from './device-rate-limit.service';
import { EnrollmentService } from './enrollment.service';
import { IngestService } from './ingest.service';
import { ProgressService } from './progress.service';
import { ScreenshotIngestService } from './screenshot-ingest.service';
import { UpdateService } from './update.service';

@Module({
  imports: [ActivityModule],
  controllers: [AgentController],
  providers: [
    ProgressService,
    AgentConfigService,
    ClockDriftService,
    DeviceAuthGuard,
    DeviceRateLimitService,
    EnrollmentService,
    IngestService,
    ScreenshotIngestService,
    UpdateService,
  ],
  exports: [AgentConfigService, ClockDriftService],
})
export class AgentModule {}
