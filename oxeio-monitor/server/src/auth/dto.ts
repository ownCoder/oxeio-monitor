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
  @IsEmail({}, { message: 'ইমেইল ঠিক নেই' })
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'পাসওয়ার্ড দিন' })
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
  @MinLength(6, { message: '৬ অঙ্কের কোড দিন' })
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
  @MinLength(1, { message: 'পাসওয়ার্ড দিন' })
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `নতুন পাসওয়ার্ড অন্তত ${MIN_PASSWORD_LENGTH} অক্ষরের হতে হবে`,
  })
  @MaxLength(200)
  newPassword!: string;
}

export class CreatePortalAccountDto {
  @IsEmail({}, { message: 'ইমেইল ঠিক নেই' })
  @MaxLength(200)
  email!: string;

  /** owner চাইলে manager-ও বানাতে পারে; ডিফল্ট employee */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class EmployeeIdParam {
  @IsInt()
  id!: number;
}
