import { Module } from '@nestjs/common';

import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { EmployeesReadController } from './employees-read.controller';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { HolidaysController } from './holidays.controller';
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
    AuditLogController,
  ],
  providers: [
    EmployeesService,
    DevicesService,
    WorkPoliciesService,
    HolidaysService,
    AuditLogService,
  ],
})
export class AdminModule {}
