import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * ⚠️ গ্লোবাল ValidationPipe `whitelist + forbidNonWhitelisted` — এখানে নেই
 * এমন ফিল্ড পাঠালে ৪০০, চুপচাপ বাদ নয়।
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class UpdateDepositPolicyDto {
  /**
   * ⭐ **পয়সায়**, টাকায় নয় — ৫০০ টাকা = ৫০০০০।
   *
   * ⚠️ বেতনের মতো স্ট্রিং-দশমিক নয়, কারণ কিস্তির অঙ্কে ভগ্নাংশ পয়সা
   * আসার কোনো কারণ নেই; integer রাখলে round করার প্রশ্নই ওঠে না।
   * পর্দা টাকার ঘরটা দেখায় আর ১০০ দিয়ে গুণ করে পাঠায়।
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_00)
  amountPaisa?: number;

  /** '2026-08' — কোন মাস থেকে কাটা শুরু */
  @IsOptional()
  @Matches(YEAR_MONTH, { message: 'startYearMonth must be in YYYY-MM format' })
  startYearMonth?: string;

  /**
   * ⚠️ ০ দেওয়া যায় — মানে "নোটিশ লাগে না"। সেটা অদ্ভুত শোনালেও বৈধ, আর
   * আটকে দিলে নিয়ম শিথিল করতে চাইলে কোড বদলাতে হতো।
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  noticeDays?: number;

  /** ⚠️ `false` মানে নতুন কিস্তি বসা বন্ধ — পুরোনো জমা অটুট থাকে */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SettleDepositDto {
  /**
   * ⚠️ মাত্র দুটো মান, আর ডাটাবেসেও CHECK দিয়ে বাঁধা। টাইপো হলে পর্দা
   * কিছুই দেখাত না, আর "ফেরত দেওয়া হয়েছে কি না" প্রশ্নের উত্তর নীরবে
   * হারাত।
   */
  @IsIn(['refunded', 'forfeited'])
  outcome!: 'refunded' | 'forfeited';

  /**
   * কবে জানিয়েছিলেন, আর শেষ কর্মদিবস কবে।
   *
   * ⚠️ দুটোই **ঐচ্ছিক** — পুরোনো কারো ক্ষেত্রে তারিখ মনে না-ও থাকতে পারে,
   * আর বাধ্যতামূলক করলে মালিক বাধ্য হয়ে একটা মনগড়া তারিখ বসাতেন। না
   * দিলে সিস্টেম নোটিশের দিন গোনে না, আর সারিতে `null` থেকে যায় —
   * "জানা নেই" আর "শূন্য দিন" এক জিনিস নয়।
   */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'noticeGivenOn must be in YYYY-MM-DD format' })
  noticeGivenOn?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'lastWorkingDay must be in YYYY-MM-DD format' })
  lastWorkingDay?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * ⭐ এই কর্মীর জামানত কোন মাস থেকে কাটা শুরু।
 *
 * ⚠️ `null` **বৈধ ও অর্থবহ** — মানে "নিয়মের সাধারণ শুরুর মাসেই ফিরে যাও"।
 * তাই `@IsOptional()` নয়, নইলে ঘরটা খালি করে দেওয়ার কোনো পথ থাকত না।
 */
export class SetDepositStartDto {
  @ValidateIf((_, value) => value !== null)
  @Matches(YEAR_MONTH, { message: 'yearMonth must be in YYYY-MM format' })
  yearMonth!: string | null;
}

/**
 * ⭐⭐ **বসে যাওয়া একটা কিস্তির অঙ্ক সংশোধন** *(৫ সেপ্টেম্বর ২০২৬)*।
 *
 * ⚠️ এটা নিয়ম বদলানো নয়, **ভুল সংশোধন** — তাই `reason` বাধ্যতামূলক।
 */
export class CorrectInstalmentDto {
  @Matches(YEAR_MONTH, { message: 'yearMonth must be YYYY-MM' })
  yearMonth!: string;

  /**
   * ⚠️⚠️ `@Min(1)` — শূন্য বসানোর কোনো পথ নেই, আর সেটাই নকশা। মকুব মানে
   * ওই মাসে কিস্তি **নেই**, ৳০-এর কিস্তি **আছে**; দুটো এক করে ফেললে
   * "কত মাস জমা হয়েছে" প্রশ্নের উত্তরই নষ্ট হয় — মাঠে ঠিক সেটাই ঘটেছিল।
   * শুরুর দিকের মাস বাদ দিতে `PATCH :id/start` আছে।
   */
  @IsInt()
  @Min(1)
  @Max(100_000_00)
  amountPaisa!: number;

  /** ⚠️ ছ-মাস পরে "ওই মাসে এর অঙ্ক আলাদা কেন" প্রশ্নের একমাত্র উত্তর */
  @IsString()
  @MaxLength(300)
  reason!: string;
}
