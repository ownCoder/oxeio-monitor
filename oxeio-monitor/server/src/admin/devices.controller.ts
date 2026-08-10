import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import {
  type DeviceView,
  DevicesService,
  type EnrollmentCodeResult,
} from './devices.service';
import {
  CreateEnrollmentCodeDto,
  DeviceListQueryDto,
  RestoreDeviceDto,
  RevokeDeviceDto,
} from './dto';

/**
 * ডিভাইস ম্যানেজমেন্ট (E10 · H05 · H06) — পুরো ক্লাসটাই owner-only।
 *
 * ⚠️ কর্মচারীর তালিকার মতো এখানে ম্যানেজারের জন্য কোনো ফাঁক রাখা হয়নি:
 * স্পেক § ৪.৩ অনুযায়ী "Device revoke / audit log" শুধু owner-এর।
 */
@Roles(UserRole.owner)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** `GET /api/v1/devices?employeeId=&status=active|revoked` */
  @Get()
  list(
    @Query() query: DeviceListQueryDto,
  ): Promise<{ rows: DeviceView[]; total: number }> {
    return this.devices.list(query);
  }

  /**
   * `POST /api/v1/devices/enrollment-code` → `{ code, expiresAt }`
   *
   * ⚠️ `:id` ওয়ালা রুটগুলোর **আগে** লেখা। এখন সংঘাত নেই (ওগুলোয় দুটো
   * সেগমেন্ট), কিন্তু পরে কেউ `POST /devices/:id` যোগ করলে Express
   * `enrollment-code`-কেই `:id` ধরে নিত — আর কোড বানানো নীরবে ৪০৪ হতো।
   */
  @Post('enrollment-code')
  @HttpCode(HttpStatus.CREATED)
  enrollmentCode(
    @CurrentUser() actor: SessionUser,
    @Body() dto: CreateEnrollmentCodeDto,
    @Ip() ip: string,
  ): Promise<EnrollmentCodeResult> {
    return this.devices.createEnrollmentCode(actor, dto, ip);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<DeviceView> {
    return this.devices.get(id);
  }

  /** H06 — `POST /api/v1/devices/:id/revoke`। ডিলিট নয়। */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RevokeDeviceDto,
    @Ip() ip: string,
  ): Promise<DeviceView> {
    return this.devices.revoke(actor, id, dto, ip);
  }

  /** `POST /api/v1/devices/:id/restore` */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RestoreDeviceDto,
    @Ip() ip: string,
  ): Promise<DeviceView> {
    return this.devices.restore(actor, id, dto, ip);
  }
}
