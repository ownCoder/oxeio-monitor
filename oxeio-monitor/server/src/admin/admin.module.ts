import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { ReportsModule } from '../reports/reports.module';

import { AgentVersionsController } from './agent-versions.controller';
import { AgentVersionsService } from './agent-versions.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { EmployeesReadController } from './employees-read.controller';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { HolidaysController } from './holidays.controller';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { MonthCloseController } from './month-close.controller';
import { MonthCloseService } from './month-close.service';
import { HolidaysService } from './holidays.service';
import { WorkPoliciesController } from './work-policies.controller';
import { WorkPoliciesService } from './work-policies.service';

/**
 * E10 — স্টাফ, ডিভাইস, work policy, ছুটি — আর E11-এর audit log ভিউয়ার।
 *
 * ⚠️ `PrismaModule` ও `AuditModule` `@Global()`, তাই আলাদা করে import
 * করার দরকার নেই — কিন্তু `AuditService` ছাড়া এই মডিউলের একটা লেখাও
 * বৈধ নয়। এখানকার প্রতিটা পরিবর্তন কেউ না কেউ ছয় মাস পরে খুঁজবে।
 *
 * ⚠️ `EmployeesReadController` আলাদা করে দেখুন — পুরো মডিউলে ওটাই
 * একমাত্র জায়গা যেখানে owner ছাড়া অন্য কেউ (ম্যানেজার) ঢুকতে পারে।
 */
@Module({
  controllers: [
    EmployeesReadController,
    EmployeesController,
    DevicesController,
    WorkPoliciesController,
    HolidaysController,
    MonthCloseController,
    LeaveController,
    AuditLogController,
    AgentVersionsController,
  ],
  /**
   * ⭐ **R26** — মাস বন্ধ হলে হিসাবের ফাইল পাঠাতে `MonthDeliveryService`
   *    লাগে। ⚠️ AdminModule-এ এতদিন কোনো `imports` ছিল না; এটাই প্রথম।
   */
  imports: [ReportsModule, AgentModule],
  providers: [
    EmployeesService,
    DevicesService,
    WorkPoliciesService,
    HolidaysService,
    MonthCloseService,
    LeaveService,
    AuditLogService,
    AgentVersionsService,
  ],
})
export class AdminModule {}
