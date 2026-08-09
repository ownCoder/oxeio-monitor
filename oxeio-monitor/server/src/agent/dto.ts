import { SegmentState } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { MAX_BATCH_SIZE } from './agent.constants';

/**
 * ⚠️ `clientUuid` ইচ্ছাকৃতভাবে `@IsOptional()` —
 * স্পেক § ৪.১ বলে "না থাকলে 422", কিন্তু ValidationPipe ছুড়বে 400।
 * তাই উপস্থিতি যাচাই সার্ভিসে করা হয় (`assertClientUuids`), যাতে
 * স্পেকের বলা স্ট্যাটাসটাই যায়। ফরম্যাট ভুল হলে অবশ্য 400-ই হবে।
 */
class WithClientUuid {
  @IsOptional()
  @IsUUID()
  clientUuid?: string;
}

// ── enroll ──────────────────────────────────────────────────────────────────

export class EnrollDto {
  @IsString()
  @MaxLength(64)
  enrollmentCode!: string;

  @IsString()
  @MaxLength(200)
  hostname!: string;

  @IsString()
  @MaxLength(200)
  windowsUsername!: string;

  /** হার্ডওয়্যার-ভিত্তিক স্থায়ী আইডি — PC বদলালে বদলায় */
  @IsString()
  @MaxLength(200)
  machineGuid!: string;

  @IsOptional() @IsString() @MaxLength(100) osVersion?: string;
  @IsOptional() @IsString() @MaxLength(50) agentVersion?: string;
  @IsOptional() @IsInt() @Min(1) @Max(8) monitors?: number;
}

// ── heartbeat ───────────────────────────────────────────────────────────────

export class HeartbeatDto {
  @IsEnum(SegmentState)
  state!: SegmentState;

  @IsInt() @Min(0) @Max(86_400)
  activeSecToday!: number;

  @IsOptional() @IsInt() @Min(0)
  queueDepth?: number;

  @IsOptional() @IsString() @MaxLength(64)
  configVersion?: string;
}

// ── segments ────────────────────────────────────────────────────────────────

export class SegmentDto extends WithClientUuid {
  @IsEnum(SegmentState)
  state!: SegmentState;

  @Type(() => Date) @IsDate()
  startedAt!: Date;

  @Type(() => Date) @IsDate()
  endedAt!: Date;

  /** monotonic clock থেকে — ঘড়ি বদলালেও অটুট (§ ৩.২) */
  @IsInt() @Min(0) @Max(86_400)
  durationSec!: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  inputScore?: number;
}

export class SegmentBatchDto {
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => SegmentDto)
  segments!: SegmentDto[];
}

// ── app usage ───────────────────────────────────────────────────────────────

export class AppUsageDto extends WithClientUuid {
  @Type(() => Date) @IsDate() startedAt!: Date;
  @Type(() => Date) @IsDate() endedAt!: Date;

  @IsInt() @Min(0) @Max(86_400)
  durationSec!: number;

  @IsString() @MaxLength(260)
  processName!: string;

  @IsOptional() @IsString() @MaxLength(260) appName?: string;
  @IsOptional() @IsString() @MaxLength(1000) windowTitle?: string;

  /** ⚠️ শুধু ডোমেইন — ফুল URL কখনো নয় (ADR-013) */
  @IsOptional() @IsString() @MaxLength(260) domain?: string;

  @IsOptional() @IsBoolean() isBrowser?: boolean;
}

export class AppUsageBatchDto {
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => AppUsageDto)
  items!: AppUsageDto[];
}

// ── events ──────────────────────────────────────────────────────────────────

export class EventDto extends WithClientUuid {
  @IsString() @MaxLength(50)
  type!: string;

  @Type(() => Date) @IsDate()
  occurredAt!: Date;

  @IsOptional()
  meta?: Record<string, unknown>;
}

export class EventBatchDto {
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => EventDto)
  events!: EventDto[];
}

// ── screenshot ──────────────────────────────────────────────────────────────

/** multipart-এর `meta` অংশ (JSON string হিসেবে আসে) */
export class ScreenshotMetaDto extends WithClientUuid {
  @Type(() => Date) @IsDate()
  slotStart!: Date;

  /** স্লটের ভেতরে আসল র‍্যান্ডম সময় */
  @Type(() => Date) @IsDate()
  capturedAt!: Date;

  @IsInt() @Min(0) @Max(7)
  monitorIndex!: number;

  @IsOptional() @IsInt() @Min(1) width?: number;
  @IsOptional() @IsInt() @Min(1) height?: number;
  @IsOptional() @IsString() @MaxLength(260) activeApp?: string;
  @IsOptional() @IsString() @MaxLength(1000) activeTitle?: string;
}
