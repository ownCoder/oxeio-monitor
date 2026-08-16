import { Body, Controller, Get, Ip, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsString, MaxLength } from 'class-validator';

import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramChannel } from './telegram.channel';
import {
  resolveTelegram,
  telegramView,
  TELEGRAM_SETTING_KEY,
  type TelegramSettingsView,
} from './telegram.settings';

class SaveTelegramDto {
  /**
   * ⚠️ খালি স্ট্রিং **বৈধ** — মানে "মুছে দাও, `.env`-এ ফেরত যাও"। তাই
   * `@IsNotEmpty()` নয়, নইলে ভুল করে বসানো টোকেন সরানোর কোনো পথ থাকত না।
   */
  @IsString() @MaxLength(200)
  botToken!: string;

  @IsString() @MaxLength(64)
  chatId!: string;
}

/**
 * **টেলিগ্রামের কনফিগ পর্দা থেকে** (G08)।
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো:** টোকেন ও চ্যাট আইডি ছিল কেবল `.env`-এ,
 * অর্থাৎ বদলাতে হলে VPS-এ SSH → ফাইল সম্পাদনা → কনটেইনার রিস্টার্ট।
 * মালিকের পক্ষে সেটা কার্যত অসম্ভব, তাই একবার ভুল হলে সেটা মাসের পর মাস
 * ভুলই থেকে যেত।
 *
 * ⚠️ owner-only। টেলিগ্রাম চ্যানেলে কর্মীর নাম ও ঘণ্টা যায়, তাই কে
 * সেটা পাবে সেই সিদ্ধান্ত ম্যানেজারের নয়।
 */
@Roles(UserRole.owner)
@Controller('settings/telegram')
export class TelegramSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async read(): Promise<TelegramSettingsView> {
    const row = await this.prisma.setting.findUnique({
      where: { key: TELEGRAM_SETTING_KEY },
    });

    /**
     * ⚠️⚠️ `telegramView()` দিয়েই যায় — **কাঁচা সারিটা কখনো নয়**। ওতে
     * পুরো টোকেন থাকে, আর সেটা ব্রাউজারে গেলে DevTools, প্রক্সি লগ বা
     * স্ক্রিন শেয়ারে দেখা যেত। পর্দায় যায় কেবল শেষ চার অক্ষর।
     */
    return telegramView(
      resolveTelegram((row?.value as Record<string, string> | undefined) ?? null, {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
      }),
    );
  }

  @Patch()
  async save(
    @CurrentUser() actor: SessionUser,
    @Body() dto: SaveTelegramDto,
    @Ip() ip: string,
  ): Promise<TelegramSettingsView> {
    const botToken = dto.botToken.trim();
    const chatId = dto.chatId.trim();

    await this.prisma.setting.upsert({
      where: { key: TELEGRAM_SETTING_KEY },
      update: { value: { botToken, chatId }, updatedById: actor.userId },
      create: {
        key: TELEGRAM_SETTING_KEY,
        value: { botToken, chatId },
        updatedById: actor.userId,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'change_setting',
      targetType: 'setting',
      targetId: TELEGRAM_SETTING_KEY,
      ipAddress: ip,
      /**
       * ⚠️⚠️ **টোকেন audit log-এও যায় না** — শুধু "বসানো হয়েছে কি না"।
       * audit log মালিক ও ম্যানেজার দুজনেই দেখেন, আর গোপন মান একবার ওখানে
       * বসলে সেটা আর মোছা যায় না।
       */
      meta: { op: 'telegram', tokenSet: botToken.length > 0, chatId },
    });

    return this.read();
  }

  /**
   * ⭐⭐ **সত্যিই কাজ করছে কি না — একটা পরীক্ষামূলক বার্তা।**
   *
   * ⚠️ এটা না থাকলে মালিক সেভ করে অপেক্ষা করতেন **শুক্রবার পর্যন্ত**, আর
   * তখন কিছু না এলে বুঝতেন ভুল ছিল — অথচ কী ভুল, সেটা জানার উপায় নেই।
   */
  @Patch('test')
  async test(@CurrentUser() actor: SessionUser): Promise<{ outcome: string }> {
    const outcome = await this.telegram.send(
      `oXeio — test message from ${actor.email}. If you can read this, the setup works.`,
    );

    return { outcome };
  }
}
