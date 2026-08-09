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

  /** I06 — ঐচ্ছিক 2FA, Phase 6-এ চালু হবে */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  totp?: string;
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
