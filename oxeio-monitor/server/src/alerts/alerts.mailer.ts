import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

import { SMTP_TIMEOUT_MS } from './alerts.constants';

/**
 * ⚠️ nodemailer-এর পুরো `Transporter` টাইপটা ধরে রাখা হয়নি — যেটুকু ব্যবহার
 *    হয় শুধু সেটুকুর একটা ইন্টারফেস। এতে লাইব্রেরির ভার্সন বদলালে এই ফাইলে
 *    কী কী ভাঙতে পারে সেটা এক নজরেই দেখা যায়।
 */
interface MailSender {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
  close(): void;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export type SendOutcome = 'sent' | 'not_configured' | 'failed';

/**
 * G07 — অ্যালার্টের ইমেইল চ্যানেল।
 *
 * ⭐ এই ক্লাসের একটাই অলঙ্ঘনীয় নিয়ম: **এটা কখনো সার্ভার নামাতে পারবে না**।
 * ইমেইল পাঠানো মনিটরিংয়ের সহায়ক কাজ, মূল কাজ নয়। একটা ভুল SMTP পাসওয়ার্ড,
 * একটা ঝুলে যাওয়া মেইল সার্ভার বা DNS-এ ভুল হোস্টনেম — কোনোটাই যেন ঘণ্টা
 * গোনা বা এজেন্টের ডেটা নেওয়া বন্ধ না করে। তাই কনস্ট্রাক্টর থেকে শুরু করে
 * প্রতিটা send পর্যন্ত সবকিছু try/catch-এ মোড়া, আর কোথাও `verify()` ডাকা হয় না।
 */
@Injectable()
export class AlertMailer implements OnModuleDestroy {
  private readonly logger = new Logger(AlertMailer.name);
  private readonly config: SmtpConfig | null;
  private transporter: MailSender | null = null;
  /** একই অভিযোগ প্রতি মিনিটে লগে লেখার কোনো মানে নেই */
  private warnedMissing = false;

  constructor(config: ConfigService) {
    this.config = readSmtpConfig(config);

    if (!this.config) {
      this.logger.log(
        'SMTP কনফিগ নেই — অ্যালার্ট শুধু লগে লেখা হবে (SMTP_HOST বসালে ইমেইল চালু হবে)',
      );
    }
  }

  get configured(): boolean {
    return this.config !== null;
  }

  /**
   * ফেরত দেয় কী হলো — কলার সেটা দেখে `channels_sent` বসায়।
   * ⚠️ কখনো throw করে না। ব্যর্থতা একটা **মান**, ব্যতিক্রম নয়।
   */
  async send(
    to: readonly string[],
    subject: string,
    body: string,
  ): Promise<SendOutcome> {
    if (!this.config || to.length === 0) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        this.logger.warn(
          this.config
            ? 'অ্যালার্ট পাঠানোর মতো কোনো ইমেইল ঠিকানা নেই (owner-এর ইমেইল বা ALERT_EMAIL_TO দেখুন)'
            : 'SMTP কনফিগ নেই — অ্যালার্ট ইমেইলে যাচ্ছে না',
        );
      }
      return 'not_configured';
    }

    try {
      const transporter = this.ensureTransport();
      await transporter.sendMail({
        from: this.config.from,
        to: to.join(', '),
        subject,
        text: body,
      });
      return 'sent';
    } catch (err) {
      // ⚠️ শুধু বার্তা, stack নয় — SMTP-র error object-এ কখনো কখনো
      //    পাঠানো তথ্য (এমনকি auth স্ট্রিং) জুড়ে থাকে, সেটা লগে যাওয়া চলবে না।
      this.logger.error(
        `অ্যালার্ট ইমেইল পাঠানো যায়নি: ${err instanceof Error ? err.message : 'অজানা ত্রুটি'}`,
      );
      // পরের চেষ্টায় নতুন কানেকশন — ঝুলে থাকা সকেট ধরে রাখা হয় না
      this.dispose();
      return 'failed';
    }
  }

  onModuleDestroy(): void {
    this.dispose();
  }

  private ensureTransport(): MailSender {
    if (this.transporter) return this.transporter;

    const { host, port, secure, user, pass } = this.config as SmtpConfig;

    const transporter: MailSender = createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      // ⚠️ টাইমআউট তিনটেই স্পষ্ট করে বসানো — nodemailer-এর ডিফল্ট এত বড় যে
      //    একটা মৃত মেইল সার্ভারে প্রতিটা sweep কয়েক মিনিট ধরে ঝুলে থাকত।
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });

    // ⚠️ EventEmitter-এ 'error' শোনার কেউ না থাকলে Node পুরো প্রসেস ফেলে দেয়।
    //    এই এক লাইনটাই "ভুল SMTP সার্ভার নামিয়ে দেবে না" প্রতিশ্রুতির শেষ পেরেক।
    transporter.on('error', (err: Error) => {
      this.logger.error(`SMTP কানেকশনে ত্রুটি: ${err.message}`);
    });

    this.transporter = transporter;
    return transporter;
  }

  private dispose(): void {
    try {
      this.transporter?.close();
    } catch {
      // বন্ধ করতে না পারলেও কিছু করার নেই
    }
    this.transporter = null;
  }
}

/**
 * ⚠️ `SMTP_HOST` না থাকলে পুরোটাই বন্ধ — অর্ধেক কনফিগ নিয়ে চালু হওয়ার চেয়ে
 *    পরিষ্কারভাবে "নেই" বলা ভালো।
 */
function readSmtpConfig(config: ConfigService): SmtpConfig | null {
  const host = config.get<string>('SMTP_HOST')?.trim();
  if (!host) return null;

  const port = Number(config.get<string>('SMTP_PORT') ?? 587);
  const user = config.get<string>('SMTP_USER')?.trim() || undefined;
  const pass = config.get<string>('SMTP_PASS') || undefined;

  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    // ৪৬৫ = implicit TLS; বাকি পোর্টে STARTTLS, তাই secure = false
    secure: (config.get<string>('SMTP_SECURE') ?? '').toLowerCase() === 'true'
      ? true
      : port === 465,
    user,
    pass,
    from: config.get<string>('SMTP_FROM')?.trim() || `oXeio <no-reply@${host}>`,
  };
}
