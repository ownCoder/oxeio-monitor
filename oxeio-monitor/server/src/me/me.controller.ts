import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { MyDaysQuery } from './me.dto';
import { MeService, type MyDay, type MySummary } from './me.service';

/**
 * **J04 · J05 · J08** — `GET /api/v1/me/...`, কর্মীর নিজের ডেটা।
 *
 * ⭐⭐ <b>ক্লাসে কোনো `@Roles` নেই, আর সেটা ইচ্ছাকৃত।</b> তিনটে ভূমিকাই
 * ঢুকতে পারে, কারণ সীমাটা ভূমিকার নয় — **সেশনের**। কোন কর্মীর ডেটা
 * ফিরবে সেটা ঠিক হয় `actor.employeeId` থেকে, পথের কোনো প্যারামিটার
 * থেকে নয়। ⚠️ `@Roles(employee)` লিখলে উল্টো ক্ষতি হতো: owner বা
 * manager যদি নিজেও একজন কর্মী হন (`users.employee_id` বসানো), তাঁরা
 * নিজের পাতাটাই দেখতে পেতেন না।
 *
 * ⚠️ পথে **কখনো** `:id` বসাবেন না। বসালেই একজন স্টাফ সংখ্যাটা বদলে
 * সহকর্মীর দিন দেখে ফেলত — গোটা মডিউলটার একমাত্র নিরাপত্তা-নকশা এটাই।
 */
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** নাম, আজকের ও মাসের ঘণ্টা, সইয়ের তারিখ, ছবি কতদিন থাকে */
  @Get()
  summary(@CurrentUser() actor: SessionUser): Promise<MySummary> {
    return this.me.summary(actor);
  }

  /**
   * `GET /api/v1/me/days?from=2026-08-01&to=2026-08-12`
   *
   * ⚠️ ছুটির দিনগুলোও তালিকায় থাকে (`isOffDay: true`) — বাদ দিলে
   * "শুক্রবারটা কই" প্রশ্নের উত্তর পাতা দেখে পাওয়া যেত না।
   */
  /**
   * ⭐ `GET /api/v1/me/deposit` — **R21**, নিজের জামানত কত জমেছে।
   *
   * ⚠️ পথে `:id` নেই, বাকি সবের মতোই — কর্মী আসে সেশন থেকে।
   */
  @Get('deposit')
  deposit(@CurrentUser() actor: SessionUser) {
    return this.me.myDeposit(actor);
  }

  @Get('days')
  days(
    @CurrentUser() actor: SessionUser,
    @Query() query: MyDaysQuery,
  ): Promise<MyDay[]> {
    return this.me.days(actor, query.from, query.to);
  }
}
