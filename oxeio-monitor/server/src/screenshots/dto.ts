import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * ⚠️ গ্লোবাল ValidationPipe-এ `whitelist + forbidNonWhitelisted` চালু
 *    (app.setup.ts) — তাই এখানে না থাকা কোনো ক্যোয়ারি প্যারামিটার এলে
 *    সরাসরি ৪০০। ফলে `?employee_id=3` (snake_case) লিখলে চুপচাপ উপেক্ষা
 *    না হয়ে সাথে সাথে ধরা পড়ে।
 */
export class GalleryQueryDto {
  /**
   * ⚠️ role=employee হলে এই মানটা **কাজে লাগে না** — সেশন থেকে নেওয়া হয়
   *    (J05, দেখুন screenshots.service.ts)। ক্যোয়ারি থেকে নিলে যে-কেউ
   *    অন্যের ছবি দেখে ফেলত।
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'employeeId must be an integer' })
  @Min(1)
  employeeId?: number;

  /** না দিলে ঢাকার আজকের কর্মদিবস ধরা হয় */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be in YYYY-MM-DD format',
  })
  date?: string;

  /**
   * ⚠️ উপরের সীমা আছে ইচ্ছে করেই — `page=99999999` দিলে Postgres-কে
   *    বিশাল OFFSET গুনতে হতো, আর সেটাই সস্তা DoS।
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

export class ScreenshotFileQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'token is required' })
  token!: string;
}
