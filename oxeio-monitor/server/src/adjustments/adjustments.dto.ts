import { AdjustmentCause } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** `YYYY-MM-DD` — বাকি DTO-গুলোর মতোই */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * এক দিনে সর্বোচ্চ কত সেকেন্ড যোগ বা বিয়োগ করা যাবে।
 *
 * ⚠️ ২৪ ঘণ্টার সীমাটা নিছক সতর্কতা নয়: `delta_sec` একটা `Int`, আর owner
 * ভুল করে সেকেন্ডের জায়গায় মিলিসেকেন্ড বসালে (৭২০০০০০) সেটা নীরবে
 * ঢুকে যেত — মাসের হিসাবে ২,০০০ ঘণ্টা যোগ হতো, আর pace, payroll ও
 * ড্যাশবোর্ড তিনটেই একসাথে অর্থহীন হয়ে যেত।
 */
export const ADJUSTMENT_MAX_SEC = 24 * 3600;

/**
 * **B14 · ADR-011e** — সিস্টেমের দোষে হারানো ঘণ্টা owner ফেরত দেন।
 *
 * ⚠️ এটা কোনো **অনুমোদন ব্যবস্থা নয়**। স্টাফ কিছু দাবি করে না, কোথাও
 * কিছু চাপে না; owner নিজে দেখে ঠিক করেন। এই পার্থক্যটাই সিস্টেমের
 * মূল নিয়ম (§ ৪ · ADR-011d) — একবার "claim" চালু হলে সেটা পুরো
 * approval workflow টেনে আনত।
 */
export class CreateAdjustmentDto {
  /** কোন দিনের হিসাবে যোগ হবে (ঢাকার কর্মদিবস) */
  @Matches(DATE_ONLY, { message: 'workDate must be YYYY-MM-DD' })
  workDate!: string;

  /**
   * + = ঘণ্টা ফেরত · − = কেটে নেওয়া। শূন্য নয়।
   *
   * ⚠️ সেকেন্ডে, ঘণ্টায় নয় — DB-র কলামটাও সেকেন্ডে। ঘণ্টা নিলে
   * ভগ্নাংশ নিয়ে দুই জায়গায় দু-রকম গোল হতো।
   */
  @IsInt()
  deltaSec!: number;

  @IsEnum(AdjustmentCause)
  cause!: AdjustmentCause;

  /**
   * ⭐ বাধ্যতামূলক, আর সেটাই মূল কথা — কারণ ছাড়া কারো হিসাব বদলানো যায় না।
   * স্টাফ নিজেও এই লেখাটা পড়তে পারে (J08), তাই এটা ব্যাখ্যা, নোট নয়।
   */
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;

  /** যে অ্যালার্টটা প্রমাণ — যেমন ওই দিনের `agent_down` */
  @IsOptional() @IsInt() @Min(1)
  evidenceAlertId?: number;

  /** মাপা downtime-এর চেয়ে বেশি দেওয়া হচ্ছে — রিপোর্টে আলাদা দেখায় */
  @IsOptional() @IsBoolean()
  beyondEvidence?: boolean;
}

export class RevokeAdjustmentDto {
  /** ⚠️ কেন বাতিল করা হলো — সেটাও রেকর্ডে থাকে, কারণ সংশোধনও ভুল হতে পারে */
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}
