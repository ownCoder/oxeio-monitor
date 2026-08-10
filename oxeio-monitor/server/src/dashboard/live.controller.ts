import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { Roles } from '../auth/decorators';
import { DashboardService, type LiveBoard } from './dashboard.service';

/**
 * E01/E02 — `GET /api/v1/live`
 *
 * ⚠️ role দুটো **ক্লাস-লেভেলে** (§ ৪.৩ — লাইভ ভিউ owner ও manager দুজনেই
 * দেখে)। মেথডে বসালে পরে যোগ হওয়া নতুন endpoint নীরবে সবার — এমনকি
 * `role = employee`-র — নাগালে চলে যেত, আর স্টাফ সহকর্মীদের কার্ড দেখত।
 */
@Roles(UserRole.owner, UserRole.manager)
@Controller('live')
export class LiveController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  live(): Promise<LiveBoard> {
    return this.dashboard.live();
  }
}
