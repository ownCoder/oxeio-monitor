import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { ReadinessController } from './readiness.controller';
import { OpsModule } from '../ops/ops.module';

@Module({
  imports: [OpsModule],
  controllers: [HealthController, ReadinessController],
})
export class HealthModule {}
