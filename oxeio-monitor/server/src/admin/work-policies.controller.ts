import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { CreateWorkPolicyDto, UpdateWorkPolicyDto } from './dto';
import {
  WorkPoliciesService,
  type WorkPolicyView,
} from './work-policies.service';

/**
 * `CRUD /api/v1/work-policies` — পুরোটাই owner-only (স্পেক § ৪.২, § ৪.৩)।
 *
 * ⚠️ এই কনফিগ শুধু ড্যাশবোর্ডের জিনিস নয় — `AgentConfigService` এখান থেকেই
 * এজেন্টের config বানায়। এখানে একটা সংখ্যা বদলালে পরের config sync-এ
 * ১৫টা PC-র আচরণ বদলে যায়। তাই প্রতিটা বদল audit করা।
 */
@Roles(UserRole.owner)
@Controller('work-policies')
export class WorkPoliciesController {
  constructor(private readonly policies: WorkPoliciesService) {}

  @Get()
  list(): Promise<{ rows: WorkPolicyView[] }> {
    return this.policies.list();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<WorkPolicyView> {
    return this.policies.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: SessionUser,
    @Body() dto: CreateWorkPolicyDto,
    @Ip() ip: string,
  ): Promise<WorkPolicyView> {
    return this.policies.create(actor, dto, ip);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkPolicyDto,
    @Ip() ip: string,
  ): Promise<WorkPolicyView> {
    return this.policies.update(actor, id, dto, ip);
  }

  /** ⚠️ `@Delete` নেই — পলিসির দিকে employees আর পুরোনো মাসের হিসাব তাকিয়ে আছে */
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ): Promise<WorkPolicyView> {
    return this.policies.deactivate(actor, id, ip);
  }
}
