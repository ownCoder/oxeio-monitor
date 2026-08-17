import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { ListAlertsDto } from './alerts.dto';
import { AlertsService, type AlertPage, type AlertRow } from './alerts.service';

/**
 * ⚠️ পুরো কন্ট্রোলারটাই **owner-only** — মেথডে নয়, ক্লাস-লেভেলে।
 * পরে কেউ নতুন endpoint যোগ করলে সেটাও আপনাআপনি owner-only থাকবে।
 *
 * অ্যালার্টে হোস্টনেম, কর্মীর নাম আর ডিভাইসের অবস্থা একসাথে থাকে — স্পেক
 * § ৪.৩ অনুযায়ী device/audit ঘরানার তথ্য ম্যানেজারের নাগালের বাইরে।
 */
@Roles(UserRole.owner)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** G01–G07 — `GET /api/v1/alerts?status=open&type=agent_down&page=1&limit=50` */
  @Get()
  list(@Query() query: ListAlertsDto): Promise<AlertPage> {
    return this.alerts.list(query);
  }

  /**
   * `POST /api/v1/alerts/acknowledge-all` — একসাথে সব খোলা অ্যালার্ট দেখেছি।
   *
   * ⚠️ `:id/acknowledge`-এর **আগে** ঘোষণা করা — নইলে `acknowledge-all`
   *    একটা `:id` হিসেবে পড়ার ঝুঁকি (রুট-মেলানোর ক্রম)।
   */
  @Post('acknowledge-all')
  @HttpCode(HttpStatus.OK)
  acknowledgeAll(@CurrentUser() actor: SessionUser): Promise<{ count: number }> {
    return this.alerts.acknowledgeAll(actor.userId);
  }

  /**
   * `POST /api/v1/alerts/:id/acknowledge` — "দেখেছি" বলা।
   *
   * ⚠️ অ্যালার্ট কখনো ডিলিট হয় না, শুধু acknowledged হয়। কী কী ভুল হয়েছিল
   *    তার ইতিহাসটাই পরে সবচেয়ে কাজে লাগে — বিশেষ করে ঘণ্টা সংশোধনের
   *    (`time_adjustments.evidence_alert_id`) প্রমাণ হিসেবে।
   */
  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledge(
    @CurrentUser() actor: SessionUser,
    @Param('id') id: string,
  ): Promise<AlertRow> {
    return this.alerts.acknowledge(id, actor.userId);
  }
}
