import { Module } from '@nestjs/common';

import { AgentConfigService } from './agent-config.service';
import { AgentController } from './agent.controller';
import { ClockDriftService } from './clock-drift.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { DeviceRateLimitService } from './device-rate-limit.service';
import { EnrollmentService } from './enrollment.service';
import { IngestService } from './ingest.service';
import { ScreenshotIngestService } from './screenshot-ingest.service';
import { UpdateService } from './update.service';

@Module({
  controllers: [AgentController],
  providers: [
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
