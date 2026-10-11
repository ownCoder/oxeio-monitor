import {BadRequestException,Controller,Get,Header,Query} from '@nestjs/common';
import {CurrentUser} from '../auth/decorators';
import type {SessionUser} from '../auth/types';
import {DATA_TOPICS,TelegramAiDataService,type DataTopic} from './telegram-ai-data.service';

@Controller('me/telegram-ai/data')
export class TelegramAiDataController {
 constructor(private readonly data:TelegramAiDataService){}

 @Get()
 @Header('Cache-Control','no-store')
 read(@CurrentUser() actor:SessionUser,@Query('topic') raw:string){
  if(!DATA_TOPICS.includes(raw as DataTopic)) throw new BadRequestException('Choose a supported data topic.');
  return this.data.read(actor,raw as DataTopic);
 }
}
