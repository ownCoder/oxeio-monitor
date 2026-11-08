import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ProductResultsService } from './product-results.service';
import { TelegramChannel } from '../alerts/telegram.channel';
import { ActionDigestService } from './action-digest.service';
import { MonitorService } from './monitor.service';
import { OfficeModule } from '../office/office.module';
import { ScreenshotsModule } from '../screenshots/screenshots.module';
import { TargetEvidenceService } from './target-evidence.service';

@Module({
  imports: [OfficeModule, ScreenshotsModule],
  controllers: [ProductionController],
  providers: [
    ProductionService,
    ProductResultsService,
    TelegramChannel,
    ActionDigestService,
    MonitorService,
    TargetEvidenceService,
  ],
  exports: [ProductionService],
})
export class ProductionModule {}
