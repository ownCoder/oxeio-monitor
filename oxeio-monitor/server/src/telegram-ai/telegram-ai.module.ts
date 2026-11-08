import {Module} from '@nestjs/common';
import {TelegramChannel} from '../alerts/telegram.channel';
import {MeModule} from '../me/me.module';
import {ReportsModule} from '../reports/reports.module';
import {TelegramAiAnswerService} from './telegram-ai-answer.service';
import {TelegramAiDataController} from './telegram-ai-data.controller';
import {TelegramAiDataService} from './telegram-ai-data.service';
import {TelegramAiLinkController} from './telegram-ai-link.controller';
import {TelegramAiLinkService} from './telegram-ai-link.service';
import {TelegramAiWorker} from './telegram-ai-worker';
import {DevelopmentRoadmapService} from './development-roadmap.service';

@Module({
 imports:[MeModule,ReportsModule],
 controllers:[TelegramAiLinkController,TelegramAiDataController],
 providers:[TelegramChannel,TelegramAiLinkService,TelegramAiAnswerService,TelegramAiDataService,TelegramAiWorker,DevelopmentRoadmapService],
})
export class TelegramAiModule {}
