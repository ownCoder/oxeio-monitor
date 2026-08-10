import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { Roles } from '../auth/decorators';
import {
  ActivityService,
  type ProductivityReport,
  type TeamReport,
  type TopReport,
} from './activity.service';
import { EmployeeRangeQueryDto, TeamQueryDto, TopQueryDto } from './dto';

/**
 * D07–D09 — পড়ার রিপোর্ট (`/api/v1/activity/…`)।
 *
 * ⚠️ **owner + manager, ক্লাস-লেভেলে** (স্পেক § ৪.৩: "রিপোর্ট ও এক্সপোর্ট"
 * দুজনেরই)। `@Roles` না লিখলে গ্লোবাল গার্ড শুধু লগইন দেখত, আর তখন
 * `role = employee` পোর্টাল অ্যাকাউন্ট থেকে `?employeeId=` বদলে **সহকর্মীর
 * পুরো অ্যাপ-তালিকা** দেখা যেত। ক্লাস-লেভেলে বসানোর কারণ একই: পরে যোগ
 * হওয়া endpoint-ও যেন আপনাআপনি বন্ধ থাকে।
 *
 * ⚠️ স্টাফের নিজের ডেটা দেখার পথ (J04) এখানে **নেই** — সেটা হলে
 * "নিজের কি না" যাচাই করতে হতো, আর সেই যাচাই ভুলে গেলে গোটা টিমের
 * ডেটা ফাঁস হতো। নিজস্ব ভিউ আলাদা কন্ট্রোলারে হবে।
 */
@Roles(UserRole.owner, UserRole.manager)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /**
   * D07 — `GET /api/v1/activity/productivity?employeeId=&from=&to=`
   *
   * প্রতিটি দিনের স্কোরের পাশে **কত শতাংশ সময় অচেনা** সেটাও থাকে।
   */
  @Get('productivity')
  productivity(
    @Query() query: EmployeeRangeQueryDto,
  ): Promise<ProductivityReport> {
    return this.activity.productivity(query);
  }

  /** D08 — `GET /api/v1/activity/top?employeeId=&from=&to=&limit=` */
  @Get('top')
  top(@Query() query: TopQueryDto): Promise<TopReport> {
    return this.activity.top(query);
  }

  /** D09 — `GET /api/v1/activity/team?from=&to=&limit=` */
  @Get('team')
  team(@Query() query: TeamQueryDto): Promise<TeamReport> {
    return this.activity.team(query);
  }
}
