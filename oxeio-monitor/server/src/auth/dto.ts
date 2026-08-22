import { UserRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { MIN_PASSWORD_LENGTH } from './auth.constants';

export class LoginDto {
  @IsEmail({}, { message: 'Email is not valid' })
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password' })
  @MaxLength(200)
  password!: string;

  /**
   * I06 — ঐচ্ছিক 2FA-র দ্বিতীয় ধাপ। প্রথম কলে থাকে না; সার্ভার
   * `{ needsTotp: true }` ফেরত দিলে ইমেইল+পাসওয়ার্ডসহ আবার আসে।
   * ⚠️ ১০ অক্ষর — ৬ অঙ্কের কোডে অ্যাপ থেকে কপি করলে স্পেস ঢুকে যায়।
   */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  totp?: string;

  /** ফোন হারালে — `ABCDE-FGHJK` ধরনের একবার-ব্যবহার্য কোড */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  recoveryCode?: string;
}

/** ⚠️ ৬ অঙ্ক, কিন্তু স্পেস/ড্যাশ মেনে নেওয়া হয় — normalize সার্ভারেই হয় */
export class TotpCodeDto {
  @IsString()
  @MinLength(6, { message: 'Enter the 6-digit code' })
  @MaxLength(10)
  code!: string;
}

/**
 * ⚠️ 2FA বন্ধ করা আর রিকভারি কোড নতুন করে বানানো — দুটোতেই পাসওয়ার্ড লাগে।
 *    সেশন cookie-ই যথেষ্ট ধরলে খোলা রেখে যাওয়া ল্যাপটপ থেকে 2FA খুলে
 *    ফেলা যেত, অথচ 2FA-র উদ্দেশ্যই cookie চুরির বিরুদ্ধে রক্ষা।
 */
export class PasswordConfirmDto {
  @IsString()
  @MinLength(1, { message: 'Enter your password' })
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(200)
  newPassword!: string;
}

export class CreatePortalAccountDto {
  @IsEmail({}, { message: 'Email is not valid' })
  @MaxLength(200)
  email!: string;

  /** owner চাইলে manager-ও বানাতে পারে; ডিফল্ট employee */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /**
   * ⭐⭐ **মালিকের বেছে দেওয়া পাসওয়ার্ড** *(২৩ আগস্ট, মালিকের সিদ্ধান্ত)*।
   *
   * ⚠️ ঐচ্ছিক। না দিলে সিস্টেম একটা এলোমেলো পাসওয়ার্ড বানায় (মালিককে
   * একবার দেখানো হয়) — কিন্তু **কোনো ক্ষেত্রেই বদলাতে বলা হয় না**
   * *(২৩ আগস্ট, [ADR-033](../../../docs/05-Options-Decisions.md))*।
   */
  @IsOptional()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(200)
  password?: string;
}

export class EmployeeIdParam {
  @IsInt()
  id!: number;
}

/**
 * ⭐ owner কারো পাসওয়ার্ড রিসেট করে — চাইলে নিজেই একটা বসিয়ে দিয়ে
 * *(২৩ আগস্ট)*।
 *
 * ⚠️ ঘরটা খালি রাখলে আগের আচরণ অক্ষত: এলোমেলো পাসওয়ার্ড, আর প্রথম
 * লগইনে বাধ্যতামূলক বদল।
 */
export class ResetPasswordDto {
  @IsOptional()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(200)
  password?: string;
}

