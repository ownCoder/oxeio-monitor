import { Controller, Get, Ip, Param, ParseIntPipe, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { EmployeeListQueryDto } from './dto';
import { EmployeesService } from './employees.service';
import type { EmployeeView } from './redact';

/**
 * ⭐ E10-এর সবচেয়ে সূক্ষ্ম জায়গা — **কর্মচারীর তালিকা owner-only নয়**।
 *
 * স্পেক § ৪.৩ বলে ম্যানেজার লাইভ ভিউ, টাইমলাইন ও রিপোর্ট দেখবে; সেগুলোর
 * কোনোটাই নামের তালিকা ছাড়া অর্থবহ নয়। তাই পড়ার রুট দুটো ইচ্ছাকৃতভাবে
 * `@Roles(owner)` ক্লাসের **বাইরে**, আলাদা কন্ট্রোলারে।
 *
 * ⚠️ কেন আলাদা *ফাইলে*, একই ফাইলে দুটো ক্লাস নয়: পরে কেউ নতুন endpoint
 * লিখতে গিয়ে ভুল ক্লাসে বসিয়ে দিলে সেটা নীরবে ম্যানেজারের নাগালে চলে
 * যেত। ফাইলের নামটাই (`-read`) সীমানাটা মনে করিয়ে দেয়।
 *
 * ⚠️ আর বেতন? সেটা এখানে role দেখে ছাঁকা হয় না — `redact.ts`-এ ছাঁকা হয়,
 * এক জায়গায়, আর সেটারই টেস্ট আছে।
 */
@Roles(UserRole.owner, UserRole.manager)
@Controller('employees')
export class EmployeesReadController {
  constructor(private readonly employees: EmployeesService) {}

  /** `GET /api/v1/employees?status=active|inactive|all&search=` */
  @Get()
  list(
    @CurrentUser() actor: SessionUser,
    @Query() query: EmployeeListQueryDto,
    @Ip() ip: string,
  ): Promise<{ rows: EmployeeView[]; total: number }> {
    return this.employees.list(actor, query, ip);
  }

  /** `GET /api/v1/employees/:id` */
  @Get(':id')
  get(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseIntPipe) id: number,
    @Ip() ip: string,
  ): Promise<EmployeeView> {
    return this.employees.get(actor, id, ip);
  }
}
