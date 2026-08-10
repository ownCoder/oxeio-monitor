import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { Roles } from '../auth/decorators';
import { type AuditLogPage, AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './dto';

/**
 * E11 — `GET /api/v1/audit-log`, **owner-only** (স্পেক § ৪.৩)।
 *
 * ⚠️ ইচ্ছাকৃতভাবে শুধু `@Get` — কোনো POST/PATCH/DELETE নেই। যে লগ
 * বদলানো যায় সেটা আর প্রমাণ নয়, তাই লেখার দরজাটা রাখাই হয়নি।
 *
 * ⚠️ audit log **দেখা** নিজে audit করা হয় না। করলে প্রতিটা পেজ-লোড আরেকটা
 * সারি বানাত, আর সেই সারিও দেখা যেত — টেবিলটা নিজেকেই খেতে থাকত।
 */
@Roles(UserRole.owner)
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  /** `?userId=&action=&targetType=&targetId=&from=&to=&page=&pageSize=` */
  @Get()
  list(@Query() query: AuditLogQueryDto): Promise<AuditLogPage> {
    return this.auditLog.list(query);
  }
}
