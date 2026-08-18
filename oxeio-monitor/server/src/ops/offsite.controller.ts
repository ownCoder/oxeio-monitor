import { Body, Controller, Get, Ip, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsString, MaxLength } from 'class-validator';

import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { B2_AUTH_TIMEOUT_MS } from './ops.constants';
import {
  b2Verdict,
  offsiteView,
  resolveOffsite,
  OFFSITE_SETTING_KEY,
  type B2Verdict,
  type OffsiteSettingsView,
} from './offsite.settings';

class SaveOffsiteDto {
  /**
   * ⚠️ খালি স্ট্রিং **বৈধ** — মানে "মুছে দাও, সার্ভারের ফাইলে ফেরত যাও"।
   * তাই `@IsNotEmpty()` নয়, নইলে ভুল করে বসানো কী সরানোর পথ থাকত না।
   */
  @IsString() @MaxLength(120)
  keyId!: string;

  @IsString() @MaxLength(120)
  appKey!: string;

  @IsString() @MaxLength(120)
  bucket!: string;
}

/**
 * **অফসাইট ব্যাকআপের কনফিগ পর্দা থেকে** (R5 · G39)।
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো — মাঠের ঘটনা, ১৮ আগস্ট।** B2-র কী বসাতে হতো
 * VPS-এ SSH → `rclone config` → `/etc/oxeio-offsite.env` সম্পাদনা। মালিক
 * চেষ্টা করলেন, আর একটা আংশিক-পেস্ট হওয়া key নিয়ে `401 bad_auth_token`
 * এল — কারণটা বুঝতে টার্মিনালে বসে খোঁজাখুঁজি করতে হলো। ⭐ পর্দা থেকে
 * বসানো গেলে ওই পুরো পথটাই লাগে না, আর ভুল **সাথে সাথে** ধরা পড়ে।
 *
 * ⚠️ owner-only। এটা পরিকাঠামোর ক্রেডেনশিয়াল, আর ব্যাকআপে গোটা
 * প্রতিষ্ঠানের ঘণ্টা, বেতন ও স্ক্রিনশট আছে — কে ওখানে হাত দেবে সেই
 * সিদ্ধান্ত ম্যানেজারের নয়।
 */
@Roles(UserRole.owner)
@Controller('settings/offsite')
export class OffsiteSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async read(): Promise<OffsiteSettingsView> {
    return offsiteView(await this.resolve());
  }

  @Patch()
  async save(
    @CurrentUser() actor: SessionUser,
    @Body() dto: SaveOffsiteDto,
    @Ip() ip: string,
  ): Promise<OffsiteSettingsView> {
    const bucket = dto.bucket.trim();
    let keyId = dto.keyId.trim();
    let appKey = dto.appKey.trim();

    /**
     * ⭐⭐ **খালি appKey মানে "আগেরটাই থাক"** — টেলিগ্রামের চেয়ে এখানে
     * নিয়মটা আলাদা, আর সেটা ইচ্ছাকৃত।
     *
     * ⚠️⚠️ কারণ B2 applicationKey **একবারই দেখায়**। bucket-এর নামটা
     * শুধরাতে গিয়ে সেভ চাপলে যদি কী মুছে যেত, তাহলে মালিককে **নতুন key
     * বানাতে হতো** — একটা টাইপো ঠিক করার দাম হিসেবে। টেলিগ্রামের টোকেন
     * যেকোনো সময় BotFather থেকে আবার পাওয়া যায়, এটা যায় না।
     *
     * ⭐ পুরোপুরি মুছতে হলে তিনটে ঘরই খালি রেখে সেভ — নিচের শর্তটা তাই
     * `keyId` ও `bucket`-ও খালি কিনা দেখে।
     */
    if ((appKey.length === 0 || keyId.length === 0) && bucket.length > 0) {
      const current = await this.stored();
      if (appKey.length === 0) appKey = current?.appKey?.trim() ?? '';
      if (keyId.length === 0) keyId = current?.keyId?.trim() ?? '';
    }

    await this.prisma.setting.upsert({
      where: { key: OFFSITE_SETTING_KEY },
      update: { value: { keyId, appKey, bucket }, updatedById: actor.userId },
      create: {
        key: OFFSITE_SETTING_KEY,
        value: { keyId, appKey, bucket },
        updatedById: actor.userId,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: 'setting',
      targetId: OFFSITE_SETTING_KEY,
      ipAddress: ip,
      /**
       * ⚠️⚠️ **কী audit log-এও যায় না** — শুধু "বসানো হয়েছে কি না"।
       * audit log মালিক ও ম্যানেজার দুজনেই দেখেন, আর গোপন মান একবার
       * ওখানে বসলে আর মোছা যায় না।
       */
      meta: { op: 'offsite', keySet: appKey.length > 0, keyId, bucket },
    });

    return this.read();
  }

  /**
   * ⭐⭐ **কী-জোড়া সত্যিই কাজ করে কি না — এখনই।**
   *
   * ⚠️⚠️ এটা না থাকলে মালিক সেভ করে অপেক্ষা করতেন **শনিবার পর্যন্ত**, আর
   * তখন কিছু না গেলে বুঝতেন ভুল ছিল — কিন্তু কী ভুল, জানার উপায় নেই।
   * ঠিক এই অন্ধকারেই ১৮ আগস্ট সময় গেছে।
   *
   * ⭐ `b2_authorize_account` বেছে নেওয়া হয়েছে ইচ্ছাকৃতভাবে: **সীমাবদ্ধ
   * key-তেও এটা চলে** (bucket তালিকা করার অনুমতি লাগে না), আর উত্তরে
   * key-টা কোন bucket-এ বাঁধা সেটাও বলে দেয়।
   */
  @Post('test')
  async test(): Promise<B2Verdict> {
    const { settings } = await this.resolve();
    if (settings === null) {
      return {
        ok: false,
        message: 'Nothing to test yet — fill in the key and bucket first.',
        boundTo: null,
      };
    }

    try {
      const auth = Buffer.from(
        `${settings.keyId}:${settings.appKey}`,
      ).toString('base64');

      const res = await fetch(
        'https://api.backblazeb2.com/b2api/v3/b2_authorize_account',
        {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(B2_AUTH_TIMEOUT_MS),
        },
      );

      // ⚠️ B2-র ভুল-উত্তরও JSON, কিন্তু নেটওয়ার্ক ভাঙলে সেটা HTML হতে
      //    পারে — তাই parse ব্যর্থ হলে চুপচাপ খালি অবজেক্ট।
      const body = (await res.json().catch(() => ({}))) as {
        allowed?: { bucketName?: string | null };
        message?: string;
      };

      return b2Verdict(
        { status: res.status, allowed: body.allowed, message: body.message },
        settings.bucket,
      );
    } catch (err) {
      /**
       * ⚠️ কখনো throw নয় — এটা একটা **পরীক্ষা**, আর পরীক্ষা ব্যর্থ হওয়া
       * মানে ৫০০ নয়। ৫০০ দিলে পর্দায় "কিছু একটা ভুল" ছাড়া কিছুই বলা
       * যেত না, অথচ আসল কারণটাই মালিকের দরকার।
       */
      return {
        ok: false,
        message: `Could not reach Backblaze — ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        boundTo: null,
      };
    }
  }

  private async stored(): Promise<Record<string, string> | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: OFFSITE_SETTING_KEY },
    });
    return (row?.value as Record<string, string> | undefined) ?? null;
  }

  /**
   * ⚠️ `.env`-এর নামগুলো `deploy/offsite-b2.sh`-এর সাথে মিলিয়ে রাখা —
   * দুই জায়গায় দু-রকম নাম হলে "কেন খাটছে না" প্রশ্নের উত্তর খুঁজতে
   * অনেক সময় যেত।
   */
  private async resolve() {
    return resolveOffsite(await this.stored(), {
      keyId: process.env.B2_KEY_ID,
      appKey: process.env.B2_APP_KEY,
      bucket: process.env.B2_BUCKET,
    });
  }
}
