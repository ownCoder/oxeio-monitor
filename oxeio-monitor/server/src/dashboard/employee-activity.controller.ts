import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { Roles } from '../auth/decorators';
import {
  DashboardService,
  type HourlyChart,
  type Timeline,
} from './dashboard.service';
import { WorkDateQueryDto } from './dto';

/**
 * E04/E05 — একজন কর্মীর একদিনের বিস্তারিত।
 *
 * ⚠️ পথ `employees` — `src/users/employee-portal.controller.ts`-ও একই prefix
 * ব্যবহার করে, কিন্তু সেটা `POST :id/portal-account`। method+path আলাদা
 * বলে সংঘাত নেই; নতুন রুট যোগ করার আগে ওই ফাইলটাও দেখে নেওয়া দরকার।
 *
 * ⚠️ owner + manager (§ ৪.৩)। `role = employee` এখানে ঢুকতে পারবে না —
 * স্টাফের নিজের ভিউ (J04) আলাদা পথে হবে, নইলে একজন স্টাফ `:id` বদলে
 * সহকর্মীর পুরো দিন দেখে ফেলত।
 */
@Roles(UserRole.owner, UserRole.manager)
@Controller('employees')
export class EmployeeActivityController {
  constructor(private readonly dashboard: DashboardService) {}

  /** E04 — `GET /api/v1/employees/3/timeline?date=2026-08-10` */
  @Get(':id/timeline')
  timeline(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: WorkDateQueryDto,
  ): Promise<Timeline> {
    return this.dashboard.timeline(id, query.date);
  }

  /** E05 — `GET /api/v1/employees/3/hourly?date=2026-08-10` */
  @Get(':id/hourly')
  hourly(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: WorkDateQueryDto,
  ): Promise<HourlyChart> {
    return this.dashboard.hourly(id, query.date);
  }
}
