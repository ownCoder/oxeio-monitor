import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { Roles } from '../auth/decorators';
import {
  DashboardService,
  type LiveBoard,
  type TeamPulse,
} from './dashboard.service';

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

  /**
   * ⭐ E01 — `GET /api/v1/live/pulse` · দলের দিনের ছন্দ, ২৪টা ঘণ্টা।
   *
   * ⭐ ক্লাস-লেভেলের `@Roles` এখানেও খাটে (উপরের নোট) — তাই স্টাফ এই
   *    পথেও সহকর্মীদের ছন্দ দেখতে পান না।
   *
   * ⚠️ `date` ঐচ্ছিক ও যাচাই করা হয় `resolveWorkDate`-এ (ভুল ফরম্যাটে ৪০০)।
   *    বোর্ড এটা পাঠায় না — আজকের দিনই চায় — কিন্তু ঘরটা রাখা হলো, কারণ
   *    "গতকাল কেমন গেল" প্রশ্নটা এই একই চার্টেরই কাজ, আর তখন নতুন
   *    endpoint লেখার দরকার হবে না।
   */
  @Get('pulse')
  pulse(@Query('date') date?: string): Promise<TeamPulse> {
    return this.dashboard.teamPulse(date);
  }
}
