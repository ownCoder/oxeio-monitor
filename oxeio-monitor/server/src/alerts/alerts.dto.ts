import { AlertSeverity } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { ALERT_TYPE_VALUES, type AlertType } from './alerts.constants';

/**
 * `GET /api/v1/alerts`-এর কোয়েরি।
 *
 * ⚠️ গ্লোবাল ValidationPipe-এ `forbidNonWhitelisted` চালু, তাই এখানে না থাকা
 *    কোনো প্যারামিটার পাঠালে ৪০০ আসবে — ড্যাশবোর্ডে নতুন ফিল্টার যোগ করার
 *    আগে সেটা এই ক্লাসেও যোগ করতে হবে।
 */
export class ListAlertsDto {
  /**
   * ডিফল্ট `open` — কারণ তালিকাটার উদ্দেশ্যই "এখনো যেগুলো দেখা বাকি"।
   * পুরোনো সব দেখতে হলে স্পষ্ট করে `all` চাইতে হবে।
   */
  @IsOptional()
  @IsIn(['open', 'all'])
  status?: 'open' | 'all';

  @IsOptional()
  @IsIn(ALERT_TYPE_VALUES as readonly string[])
  type?: AlertType;

  @IsOptional()
  @IsEnum(AlertSeverity)
  severity?: AlertSeverity;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** ⚠️ সর্বোচ্চ ২০০ — নইলে একটা রিকোয়েস্টেই হাজার হাজার সারি টেনে আনা যেত */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
