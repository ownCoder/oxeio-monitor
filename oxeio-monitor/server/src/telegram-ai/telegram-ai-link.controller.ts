import {Controller,Delete,Get,Header,Post} from '@nestjs/common';
import {CurrentUser} from '../auth/decorators';
import type {SessionUser} from '../auth/types';
import {TelegramAiLinkService} from './telegram-ai-link.service';

@Controller('me/telegram-ai')
export class TelegramAiLinkController {
 constructor(private readonly links:TelegramAiLinkService){}

 @Get()
 status(@CurrentUser() actor:SessionUser){return this.links.status(actor.userId);}

 @Post('code')
 @Header('Cache-Control','no-store')
 code(@CurrentUser() actor:SessionUser){return this.links.createCode(actor.userId);}

 @Delete()
 unlink(@CurrentUser() actor:SessionUser){return this.links.unlink(actor.userId);}
}
