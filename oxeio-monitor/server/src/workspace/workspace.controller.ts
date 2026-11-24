import {Body,Controller,Get,Post,Query} from '@nestjs/common';
import {IsString,MaxLength} from 'class-validator';
import {CurrentUser} from '../auth/decorators';
import type {SessionUser} from '../auth/types';
import {WorkspaceService} from './workspace.service';
class SearchDto {@IsString() @MaxLength(100) q!:string;}
class ReadDto {@IsString() @MaxLength(120) key!:string;}
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspace:WorkspaceService) {}
  @Get('search') search(@CurrentUser() actor:SessionUser,@Query() q:SearchDto){return this.workspace.search(actor,q.q);}
  @Get('inbox') inbox(@CurrentUser() actor:SessionUser){return this.workspace.notices(actor);}
  @Get('deadlines') deadlines(@CurrentUser() actor:SessionUser){return this.workspace.deadlines(actor);}
  @Post('read') read(@CurrentUser() actor:SessionUser,@Body() dto:ReadDto){return this.workspace.read(actor,dto.key);}
}
