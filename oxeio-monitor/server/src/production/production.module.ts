import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ProductResultsService } from './product-results.service';
import { TelegramChannel } from '../alerts/telegram.channel';
import { ActionDigestService } from './action-digest.service';
import { MonitorService } from './monitor.service';

@Module({
  controllers: [ProductionController],
  providers: [
    ProductionService,
    ProductResultsService,
    TelegramChannel,
    ActionDigestService,
    MonitorService,
  ],
  exports: [ProductionService],
})
export class ProductionModule {}
