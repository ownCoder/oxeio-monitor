import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * F01 · F02 · F04 · F05 · F08।
 *
 * ⚠️ `PayrollModule` (F03) আলাদা — ওটা owner-only আর `monthly_salary` পড়ে।
 * ⚠️ `ActivityModule`-এর উপর কোনো নির্ভরতা নেই: F04 নিজের কোয়েরিতে
 *    `app_usage.category_id` → `app_categories` জোড়া লাগায়, কারণ
 *    ক্যাটাগরির নিয়ম **প্রয়োগ** (ingest) আর নিয়মের **ফল পড়া** (রিপোর্ট)
 *    দুটো আলাদা কাজ।
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
