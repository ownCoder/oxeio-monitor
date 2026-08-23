import { DeviceStatus, RolloutStage } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * ⚠️ ValidationPipe গ্লোবালি `whitelist + forbidNonWhitelisted` — তাই এখানে
 * নেই এমন কোনো ফিল্ড পাঠালে ৪০০ যাবে, চুপচাপ উপেক্ষা হবে না। query-র
 * ক্ষেত্রেও একই, অর্থাৎ `?foo=bar` লিখলেও ৪০০।
 */

/**
 * ⭐ টাকা **স্ট্রিং হিসেবে** নেওয়া হয়, সংখ্যা হিসেবে নয়।
 *
 * `13000.10` JSON থেকে number হয়ে এলে সেটা IEEE-754-এ 13000.099999999999
 * হয়ে বসে, তারপর Decimal(12,2)-এ round হয়ে ফিরে আসে — আর কেউ কোনোদিন
 * বুঝত না কেন এক পয়সা এদিক-ওদিক। স্ট্রিং সরাসরি Prisma-র Decimal-এ যায়,
 * মাঝপথে কোনো float নেই।
 */
const TAKA = /^\d{1,10}(\.\d{1,2})?$/;
const TAKA_MSG =
  'Salary must be given as a string in the form "13000" or "13000.50"';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── employees ───────────────────────────────────────────────────────────────

/**
 * ⭐⭐ **`empCode` ইচ্ছাকৃতভাবে এখানে নেই — সার্ভার নিজে বানায়।**
 *
 * ⚠️ `forbidNonWhitelisted: true` (app.setup.ts) বলে কেউ পাঠালে ৪০০ পাবে,
 *    নীরবে উপেক্ষা নয়। এটাই চাওয়া: "পাঠালাম অথচ বসল না" অবস্থাটা এই
 *    ফিল্ডে সবচেয়ে বিপজ্জনক, কারণ কোডটা মানুষ চোখে চেনে।
 */
export class CreateEmployeeDto {
  @IsString() @MinLength(1) @MaxLength(120)
  fullName!: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(120)
  designation?: string;

  @IsOptional() @IsString() @MaxLength(120)
  department?: string;

  /**
   * ⭐ কাজের ধরন — নিয়ম **কেবল এর উপরেই** বসে (যেমন ডিজাইনারের দৈনিক ২৫)।
   *
   * ⚠️ `designation`-এর বিকল্প নয়, পাশাপাশি: ওটা পদবি (মুক্ত-লেখা), এটা
   * শ্রেণি (নির্দিষ্ট তালিকা)। ⚠️ ঐচ্ছিক — না বসালে ওই কর্মী টার্গেটের
   * হিসাব থেকে **বাদ** থাকেন, শূন্য পান না।
   */
  @IsOptional() @IsIn(['designer', 'researcher', 'manager'])
  staffType?: 'designer' | 'researcher' | 'manager';

  @IsOptional() @IsInt() @Min(1)
  policyId?: number;

  @IsOptional() @Matches(TAKA, { message: TAKA_MSG })
  monthlySalary?: string;

  @IsOptional() @Matches(DATE_ONLY, { message: 'joinedOn must be in YYYY-MM-DD format' })
  joinedOn?: string;

  /**
   * ⭐⭐ **এই ডিজাইনারের নিজের দৈনিক টার্গেট** *(২৩ আগস্ট ২০২৬)* — মালিকের
   * কথায়: *"karo daily target 25 ta, kono designer er daily target 15 ta"*।
   *
   * ⚠️ **খালি রাখলে পলিসির সংখ্যাটাই খাটে** (`work_policies`-এর ২৫), শূন্য নয়।
   * `null` পাঠিয়ে আগের মান মুছে পলিসিতে ফেরানো যায়।
   * ⚠️⚠️ **০ বৈধ** — "এর টার্গেট বন্ধ"; সংখ্যা গোনা চলবে, কিন্তু কেউ পিছিয়ে নয়।
   * ⚠️ ছাদ ৫০০ — টাইপো ধরার জন্য, নীতির জন্য নয় (পলিসির ঘরের মতোই)।
   */
  @IsOptional() @IsInt() @Min(0) @Max(500)
  dailyDesignTarget?: number | null;
}

/**
 * ⚠️ প্রতিটা ফিল্ড optional, আর `null`-ও গ্রহণযোগ্য — `@IsOptional()`
 * null ও undefined দুটোতেই যাচাই বাদ দেয়। এটা ইচ্ছাকৃত: `null` পাঠানো =
 * "মানটা মুছে দাও", ফিল্ড না পাঠানো = "হাত দিও না"। সার্ভিস `undefined`
 * দেখে দুটোকে আলাদা করে।
 */
export class UpdateEmployeeDto {
  /**
   * ⭐⭐ **`empCode` এখানেও নেই — একবার বসলে আর বদলায় না।**
   *
   * ⚠️ কোডটা কেবল একটা লেবেল নয়, মানুষের **পরিচয়**: রিপোর্ট, Excel,
   *    পে-রোল শিট, টেলিগ্রামের সারাংশ, এমনকি ছাপানো কাগজেও ওটাই লেখা
   *    থাকে। মাঝপথে বদলে গেলে পুরোনো কাগজ আর নতুন পর্দা দুই কথা বলত,
   *    অথচ কোথাও কোনো ভুল দেখা যেত না।
   * ⚠️ ডেটার দিক থেকেও বদলানোর দরকার নেই — ফাইলের পাথ ও সব foreign key
   *    employee **id** ধরে চলে, `empCode` ধরে নয়।
   */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  fullName?: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(120)
  designation?: string | null;

  @IsOptional() @IsString() @MaxLength(120)
  department?: string | null;

  /** ⚠️ `null` পাঠানো **বৈধ** — ধরনটা তুলে নেওয়ার একমাত্র পথ */
  @IsOptional() @IsIn(['designer', 'researcher', 'manager', null])
  staffType?: 'designer' | 'researcher' | 'manager' | null;

  @IsOptional() @IsInt() @Min(1)
  policyId?: number | null;

  /** ⭐ বদলালে আলাদা audit সারি বসে (targetType = `employee_salary`) */
  @IsOptional() @Matches(TAKA, { message: TAKA_MSG })
  monthlySalary?: string | null;

  @IsOptional() @Matches(DATE_ONLY)
  joinedOn?: string | null;

  /**
   * ⭐⭐ **এই ডিজাইনারের নিজের দৈনিক টার্গেট** *(২৩ আগস্ট ২০২৬)* — মালিকের
   * কথায়: *"karo daily target 25 ta, kono designer er daily target 15 ta"*।
   *
   * ⚠️ **খালি রাখলে পলিসির সংখ্যাটাই খাটে** (`work_policies`-এর ২৫), শূন্য নয়।
   * `null` পাঠিয়ে আগের মান মুছে পলিসিতে ফেরানো যায়।
   * ⚠️⚠️ **০ বৈধ** — "এর টার্গেট বন্ধ"; সংখ্যা গোনা চলবে, কিন্তু কেউ পিছিয়ে নয়।
   * ⚠️ ছাদ ৫০০ — টাইপো ধরার জন্য, নীতির জন্য নয় (পলিসির ঘরের মতোই)।
   */
  @IsOptional() @IsInt() @Min(0) @Max(500)
  dailyDesignTarget?: number | null;
}

/**
 * `POST /employees/:id/policy-signed` — সই করা মনিটরিং পলিসির তারিখ।
 *
 * ⭐ **কেন আলাদা endpoint, `PATCH /employees/:id`-এর একটা ফিল্ড নয়:**
 * এটা কর্মীর তথ্য সম্পাদনা নয়, একটা **আইনি ঘটনা রেকর্ড করা** —
 * রোলআউটের একমাত্র শর্ত ([01 § রোলআউট](../../../docs/01-Planning.md))।
 * সাধারণ update-এর ভেতরে থাকলে সেটা `employee_update` audit-এ মিশে যেত,
 * আর "কার সই কবে নেওয়া হয়েছিল" আলাদা করে বের করা যেত না।
 *
 * ⚠️ **স্ক্যান আপলোড এখনো নেই** — শুধু তারিখ। `monitoring-policy-template.md`
 * "স্ক্যান করে ড্যাশবোর্ডে আপলোড" বলে; সেটা ভবিষ্যতের কাজ
 * (`upload_policy_doc` audit action ওর জন্যই তোলা আছে)।
 */
export class PolicySignedDto {
  /**
   * `YYYY-MM-DD`। না দিলে **আজকের ঢাকার তারিখ**।
   *
   * ⚠️ তারিখ দেওয়ার সুযোগ রাখা হয়েছে কারণ কাগজটা প্রায়ই আগে সই হয়,
   * আর ড্যাশবোর্ডে বসানো হয় দু-দিন পরে। বসানোর দিনটাকে সইয়ের দিন ধরে
   * নিলে রেকর্ডটা কাগজের সাথে মিলত না।
   */
  @IsOptional() @Matches(DATE_ONLY)
  signedOn?: string;
}

/**
 * ⚠️ ডিলিট নেই, deactivate আছে — কারো সারি মুছলে তার মাসের হিসাব,
 * স্ক্রিনশট আর audit trail সব অনাথ হয়ে যেত।
 */
export class DeactivateEmployeeDto {
  /** না দিলে ঢাকার আজকের তারিখ */
  @IsOptional() @Matches(DATE_ONLY, { message: 'leftOn must be in YYYY-MM-DD format' })
  leftOn?: string;

  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

/** query-তে 'all'-ও লাগে, তাই Prisma-র enum সরাসরি ব্যবহার করা যায় না */
export const EMPLOYEE_STATUS_FILTERS = ['active', 'inactive', 'all'] as const;
export type EmployeeStatusFilter = (typeof EMPLOYEE_STATUS_FILTERS)[number];

export class EmployeeListQueryDto {
  /**
   * ডিফল্ট `active` — চলে যাওয়া লোকজন তালিকা ভরিয়ে রাখে না।
   *
   * ⚠️ এখানে `?includeInactive=true` ধাঁচের boolean রাখা হয়নি, কারণ
   * query string-এ সব কিছুই স্ট্রিং আর `Boolean('false')` = **true**।
   * ওই ফাঁদে পড়লে "চলে যাওয়া কর্মীদের বাদ দাও" চেকবক্সটা কখনোই কাজ করত না।
   */
  @IsOptional() @IsIn(EMPLOYEE_STATUS_FILTERS)
  status?: EmployeeStatusFilter;

  @IsOptional() @IsString() @MaxLength(120)
  search?: string;
}

// ── devices ─────────────────────────────────────────────────────────────────

export class DeviceListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  employeeId?: number;

  @IsOptional() @IsEnum(DeviceStatus)
  status?: DeviceStatus;
}

/**
 * ⭐ কারণ বাধ্যতামূলক — `time_adjustments.reason`-এর মতোই।
 * দূর থেকে কারো মেশিন থামিয়ে দেওয়া এমন কাজ যার ব্যাখ্যা ছয় মাস পরেও
 * লাগতে পারে, আর তখন কারো মনে থাকবে না।
 */
export class RevokeDeviceDto {
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

export class RestoreDeviceDto {
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

export class CreateEnrollmentCodeDto {
  @IsInt() @Min(1)
  employeeId!: number;
}

// ── work policies ───────────────────────────────────────────────────────────

export class CreateWorkPolicyDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  /** ⭐ একমাত্র টার্গেট — ডিফল্ট ২০৮ ঘণ্টা (ADR-011b) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(744)
  monthlyTargetHours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(31)
  expectedWorkdays?: number;

  /**
   * ISO দিন — সোম = ১ … রবি = ৭, শুক্র = ৫।
   * ⚠️ এটা ব্লক নয়; ছুটির দিনে কাজ করলেও ঘণ্টা পুরোপুরি গোনা হয়।
   */
  @IsOptional() @IsInt() @Min(1) @Max(7)
  weeklyOffDay?: number | null;

  /** ⭐ না দিলে ০৭:০০–২৩:০০ বসে — `null` করে ২৪ ঘণ্টা করা যায় না (ADR-011c) */
  @IsOptional() @Matches(HHMM, { message: "screenshotFrom must be in 'HH:MM' format" })
  screenshotFrom?: string;

  @IsOptional() @Matches(HHMM, { message: "screenshotTo must be in 'HH:MM' format" })
  screenshotTo?: string;

  /**
   * ⭐⭐ **অফিস কখন খোলা** — শুধু `agent_down` অ্যালার্ট কখন **তোলা হবে না**
   * তা ঠিক করে (G01)। ⚠️ ঘণ্টা গোনায় কোনো প্রভাব নেই।
   *
   * ⚠️ না দিলে খালি থাকে, আর খালি মানে **সারাদিনই খোলা** — অর্থাৎ আগের
   *    আচরণ। "নীরবে পাহারা বন্ধ" হওয়ার চেয়ে "বেশি অ্যালার্ট" নিরাপদ।
   */
  @IsOptional() @Matches(HHMM, { message: "officeFrom must be in 'HH:MM' format" })
  officeFrom?: string;

  @IsOptional() @Matches(HHMM, { message: "officeTo must be in 'HH:MM' format" })
  officeTo?: string;

  @IsOptional() @IsInt() @Min(10) @Max(3600)
  idleThresholdSec?: number;

  @IsOptional() @IsInt() @Min(1) @Max(60)
  slotMinutes?: number;

  /**
   * ⭐ ডিজাইনারের দৈনিক টার্গেট (মালিকের চাওয়া ২৫)।
   * ⚠️ ০ **বৈধ** — টার্গেট বন্ধ, কিন্তু সংখ্যা গোনা চলতেই থাকে।
   * ⚠️ ছাদ ৫০০: টাইপো ধরার জন্য, নীতির জন্য নয়।
   */
  @IsOptional() @IsInt() @Min(0) @Max(500)
  dailyDesignTarget?: number;
}

export class UpdateWorkPolicyDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(744)
  monthlyTargetHours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(31)
  expectedWorkdays?: number;

  @IsOptional() @IsInt() @Min(1) @Max(7)
  weeklyOffDay?: number | null;

  @IsOptional() @Matches(HHMM)
  screenshotFrom?: string;

  @IsOptional() @Matches(HHMM)
  screenshotTo?: string;

  /** ⭐ অফিসের সময় — `agent_down` অ্যালার্টের জানালা (G01) */
  @IsOptional() @Matches(HHMM)
  officeFrom?: string;

  @IsOptional() @Matches(HHMM)
  officeTo?: string;

  @IsOptional() @IsInt() @Min(10) @Max(3600)
  idleThresholdSec?: number;

  @IsOptional() @IsInt() @Min(1) @Max(60)
  slotMinutes?: number;

  /**
   * ⭐ ডিজাইনারের দৈনিক টার্গেট (মালিকের চাওয়া ২৫)।
   * ⚠️ ০ **বৈধ** — টার্গেট বন্ধ, কিন্তু সংখ্যা গোনা চলতেই থাকে।
   * ⚠️ ছাদ ৫০০: টাইপো ধরার জন্য, নীতির জন্য নয়।
   */
  @IsOptional() @IsInt() @Min(0) @Max(500)
  dailyDesignTarget?: number;
}

// ── holidays ────────────────────────────────────────────────────────────────

export class CreateHolidayDto {
  @Matches(DATE_ONLY, { message: 'holidayDate must be in YYYY-MM-DD format' })
  holidayDate!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  /** public | optional | company — খোলা রাখা হয়েছে, স্কিমাতেও TEXT */
  @IsOptional() @IsString() @MaxLength(32)
  type?: string;
}

export class UpdateHolidayDto {
  @IsOptional() @Matches(DATE_ONLY)
  holidayDate?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(32)
  type?: string;
}

export class HolidayListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year?: number;
}

// ── audit log (E11) ─────────────────────────────────────────────────────────

export class AuditLogQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  userId?: number;

  @IsOptional() @IsString() @MaxLength(64)
  action?: string;

  @IsOptional() @IsString() @MaxLength(64)
  targetType?: string;

  @IsOptional() @IsString() @MaxLength(120)
  targetId?: string;

  /** ISO-8601 instant — `occurredAt >= from` */
  @IsOptional() @IsISO8601()
  from?: string;

  /** ⚠️ ধরা হয় **exclusive** নয়, inclusive — নিচে সার্ভিসে ব্যাখ্যা আছে */
  @IsOptional() @IsISO8601()
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  /**
   * ⚠️ ২০০-র বেশি চাইলে ৪০০ — চুপচাপ ২০০-তে নামিয়ে দেওয়া হয় না।
   * নামিয়ে দিলে ক্লায়েন্ট ভাবত সে সব পেয়ে গেছে, অথচ পায়নি।
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}

// ── H04 · এজেন্টের ভার্সন বিলি ──────────────────────────────────────────────

/**
 * ⚠️ `sha256` **ঐচ্ছিক**, আর সেটাই মূল সিদ্ধান্ত: সার্ভার নিজে ফাইল পড়ে
 * হিসাব করে। দিলে **মিলিয়ে দেখা হয়** — না মিললে ৪০০।
 *
 * হাতে বসানো হ্যাশে একটা অক্ষর ভুল হলে ১৫টা PC ফাইলটা নামাত, sha256
 * না মেলায় বাতিল করত, আবার নামাত — চিরকাল। লগে কেবল "hash mismatch"
 * লেখা থাকত, ভুলটা যে টাইপোতে সেটা কেউ ধরত না।
 */
export class PublishVersionDto {
  /**
   * ⚠️ SemVer — `rollout.ts`-এর `isNewer()` এই ফরম্যাটই তুলনা করে।
   * `0.2` বা `v0.2.0` দিলে তুলনাটা এলোমেলো হতো।
   */
  @Matches(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, {
    message: 'version must look like 0.2.0',
  })
  version!: string;

  /** storage রুটের ভেতরের পাথ — `updates/oXeioAgent-0.2.0.msi` */
  @IsString() @MaxLength(400)
  msiPath!: string;

  @IsOptional() @IsString() @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'sha256 must be 64 hex characters',
  })
  sha256?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  releaseNotes?: string;

  @IsOptional() @IsEnum(RolloutStage)
  rolloutStage?: RolloutStage;

  @IsOptional() @IsBoolean()
  isMandatory?: boolean;
}

export class SetStageDto {
  @IsEnum(RolloutStage)
  rolloutStage!: RolloutStage;

  @IsOptional() @IsBoolean()
  isMandatory?: boolean;
}


/**
 * R1 — মাস বন্ধ করার সাথে ঐচ্ছিক একটা নোট।
 *
 * ⚠️ নোটটা **কেন** বন্ধ করা হলো তার জায়গা ("আগস্টের বেতন ৩ সেপ্টেম্বর
 *    দেওয়া হয়েছে")। ছয় মাস পরে কেউ audit ঘাঁটলে তারিখটার চেয়ে কারণটাই
 *    বেশি কাজে দেয়।
 */
/**
 * R2 — ছুটি লেখা।
 *
 * ⚠️ `from`/`to` **তারিখ, সময় নয়** — `@IsISO8601` একা `2026-09-10T14:00Z`-ও
 *    মেনে নিত, আর তখন `new Date(...T00:00Z)`-এর সাথে তুলনা করে দিনটা এক
 *    দিন সরে যেত। তাই `Matches` দিয়ে আকারটাও বাঁধা।
 */
export class CreateLeaveDto {
  @IsInt()
  @Min(1)
  employeeId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to!: string;

  /** ⚠️ তিনটেই সবেতন — `unpaid` কেন নেই, `schema.prisma`-র নোট দেখুন */
  @IsIn(['casual', 'sick', 'annual'])
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

export class CloseMonthDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
