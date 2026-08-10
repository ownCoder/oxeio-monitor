import { MatchType, Productivity } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * D06–D09-এর ইনপুট।
 *
 * ⚠️ গ্লোবাল `ValidationPipe`-এ `whitelist` + `forbidNonWhitelisted`
 * ([app.setup.ts](../app.setup.ts)) — তাই এখানে **না থাকা** কোনো ফিল্ড
 * বা query প্যারামিটার এলে সরাসরি ৪০০। টাইপো নীরবে উপেক্ষিত হয় না।
 */

/** `YYYY-MM-DD` — আসল তারিখ কি না সেটা `parseWorkDate()` দেখে। */
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// ── D06 · ক্যাটাগরি রুল ──────────────────────────────────────────────────────

export class CreateCategoryDto {
  @IsEnum(MatchType)
  matchType!: MatchType;

  /**
   * `code.exe` · `youtube.com` · regex।
   * ⚠️ ফরম্যাট ঠিক আছে কি না দেখে `patternProblem()` — class-validator নয়,
   * কারণ নিয়মটা `matchType`-এর উপর নির্ভর করে।
   */
  @IsString()
  @MaxLength(260)
  pattern!: string;

  @IsString()
  @MaxLength(100)
  displayName!: string;

  @IsEnum(Productivity)
  category!: Productivity;

  /**
   * ⚠️ **ছোট সংখ্যা আগে জেতে।** seed-এ ব্রাউজারের ২০০, বাকি সবার ১০০ —
   * অর্থাৎ ডোমেইনের নিয়ম ব্রাউজারের নিয়মকে হারায়। উল্টো বুঝে ২০০ বসালে
   * নতুন রুলটা কার্যত সবার শেষে পড়ত ([category-matcher.ts](./category-matcher.ts))।
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;
}

/**
 * সব ফিল্ডই ঐচ্ছিক — কিন্তু **সবগুলো ফাঁকা রাখা যাবে না**।
 * খালি `{}` পাঠালে সার্ভিস ৪০০ দেয়: নইলে ২০০ ফেরত যেত, মালিক ভাবতেন
 * পরিবর্তনটা হয়ে গেছে, অথচ কিছুই বদলায়নি।
 */
export class UpdateCategoryDto {
  @IsOptional() @IsEnum(MatchType) matchType?: MatchType;
  @IsOptional() @IsString() @MaxLength(260) pattern?: string;
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  @IsOptional() @IsEnum(Productivity) category?: Productivity;
  @IsOptional() @IsInt() @Min(1) @Max(1000) priority?: number;
}

export class RecategorizeDto {
  /**
   * `true` হলে শুধু `category_id IS NULL` সারিগুলো — অনেক দ্রুত।
   * নতুন রুল **যোগ** করার পর এটাই যথেষ্ট।
   *
   * ⚠️ রুল **বদলানো বা মোছার** পর `false` লাগে, নইলে পুরোনো সিদ্ধান্ত
   * বসানো সারিগুলো পুরোনোই থেকে যেত।
   */
  @IsOptional()
  @IsBoolean()
  onlyUnmatched?: boolean;
}

// ── D07–D09 · রিপোর্টের রেঞ্জ ────────────────────────────────────────────────

export class RangeQueryDto {
  /** না দিলে চলতি মাসের ১ তারিখ */
  @IsOptional()
  @Matches(DATE_FORMAT, { message: '`from` দিতে হবে YYYY-MM-DD ফরম্যাটে' })
  from?: string;

  /** না দিলে ঢাকার আজকের তারিখ */
  @IsOptional()
  @Matches(DATE_FORMAT, { message: '`to` দিতে হবে YYYY-MM-DD ফরম্যাটে' })
  to?: string;
}

export class EmployeeRangeQueryDto extends RangeQueryDto {
  /**
   * না দিলে **সব active কর্মী**।
   * ⚠️ `@Type(() => Number)` লাগে — query স্ট্রিং সবসময় string হয়ে আসে।
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId?: number;
}

export class TopQueryDto extends EmployeeRangeQueryDto {
  /** ডিফল্ট ১০ (D08)। উপরের সীমা আছে যাতে একটা GET পুরো টেবিল না ঢালে। */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class TeamQueryDto extends RangeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
