import { Controller, Get, Ip, Query, StreamableFile } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { ProductivityQuery, ReportRangeQuery, SummaryQuery } from './dto';
import { XLSX_MIME } from './reports.excel';
import { ReportsService } from './reports.service';
import type {
  AttendanceReport,
  ProductivityReport,
  ReportFile,
  SummaryReport,
} from './reports.types';

/**
 * F01 · F02 · F04 · F05 · F08 — রিপোর্ট ও Excel এক্সপোর্ট।
 *
 * ⚠️ ভূমিকা **ক্লাস-লেভেলে** বসানো (মেথডে নয়): owner ও manager দুজনেই
 * রিপোর্ট দেখতে ও নামাতে পারেন (§ ৪.৩), কিন্তু স্টাফ নয়। পরে কেউ নতুন
 * রিপোর্ট যোগ করলে সেটাও আপনাআপনি এই দুজনেই সীমাবদ্ধ থাকবে — মেথডে
 * লিখলে নতুন endpoint নীরবে সবার নাগালে চলে যেত।
 *
 * ⚠️ পে-রোল এখানে **নেই** — `/reports/payroll` আলাদা মডিউলে, owner-only।
 * এক কন্ট্রোলারে এনে ফেললে এই ক্লাস-লেভেল `@Roles`-এর ভেতরে manager-ও
 * বেতনের শিট পেয়ে যেতেন।
 */
@Roles(UserRole.owner, UserRole.manager)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** F01 — `GET /api/v1/reports/attendance?from=&to=&format=json|xlsx` */
  @Get('attendance')
  async attendance(
    @CurrentUser() actor: SessionUser,
    @Ip() ip: string,
    @Query() q: ReportRangeQuery,
  ): Promise<AttendanceReport | StreamableFile> {
    if (q.format === 'xlsx') {
      return xlsx(await this.reports.attendanceFile(q, actor.userId, ip));
    }
    return this.reports.attendance(q);
  }

  /** F02 — `GET /api/v1/reports/summary?from=&to=&groupBy=week|month` */
  @Get('summary')
  async summary(
    @CurrentUser() actor: SessionUser,
    @Ip() ip: string,
    @Query() q: SummaryQuery,
  ): Promise<SummaryReport | StreamableFile> {
    if (q.format === 'xlsx') {
      return xlsx(await this.reports.summaryFile(q, actor.userId, ip));
    }
    return this.reports.summary(q);
  }

  /** F04 — `GET /api/v1/reports/productivity?from=&to=` */
  @Get('productivity')
  async productivity(
    @CurrentUser() actor: SessionUser,
    @Ip() ip: string,
    @Query() q: ProductivityQuery,
  ): Promise<ProductivityReport | StreamableFile> {
    if (q.format === 'xlsx') {
      return xlsx(await this.reports.productivityFile(q, actor.userId, ip));
    }
    return this.reports.productivity(q);
  }
}

/**
 * ⭐ হেডার `StreamableFile`-এর অপশনেই দেওয়া হয়, `@Res()` দিয়ে নয়। `@Res()`
 * ধরিয়ে দিলে ওই হ্যান্ডলারে Nest-এর নিজের রেসপন্স-পাইপলাইন (ইন্টারসেপ্টর,
 * সিরিয়ালাইজেশন) বন্ধ হয়ে যায় — অথচ একই মেথডের JSON শাখাটার ওটাই দরকার।
 *
 * ⚠️ ফাইলের নাম ASCII (`reports.excel.ts`-এর `reportFilename`) —
 *    Content-Disposition-এ বাংলা নাম দিতে হলে RFC 5987 এনকোডিং লাগত,
 *    নইলে ক্লায়েন্ট ভাঙা নামে সেভ করত।
 */
function xlsx(file: ReportFile): StreamableFile {
  return new StreamableFile(file.buffer, {
    type: XLSX_MIME,
    disposition: `attachment; filename="${file.filename}"`,
    length: file.buffer.byteLength,
  });
}
