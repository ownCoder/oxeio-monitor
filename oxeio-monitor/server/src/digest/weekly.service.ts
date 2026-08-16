import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  TelegramChannel,
  type TelegramOutcome,
} from '../alerts/telegram.channel';
import { TeamsChannel } from '../alerts/teams.channel';
import { AlertMailer } from '../alerts/alerts.mailer';
import { digestRecipients } from './digest.recipients';
import { PrismaService } from '../prisma/prisma.service';
import { parseWorkDate, toIsoDate } from '../reports/reports.range';
import { ReportsService } from '../reports/reports.service';
import {
  buildWeekly,
  weeklyGateOf,
  weeklyMessage,
  weeklyWindow,
  WEEKLY_ALLOW_GROUP_ENV,
  type ObservedDay,
  type Weekly,
  type WeeklyGate,
  type WeeklyMessage,
  type WeeklyWindow,
} from './weekly.rules';

/** লেটারহেড ও ইমেইলের শিরোনামে যা আছে — `digest.service.ts`-এর সাথে একই env */
const DEFAULT_ORG_NAME = 'oXeio Monitoring';

/**
 * ⭐ `TelegramOutcome`-এর তিনটে মানই এখানে খাটে, **আর একটা বাড়ে**:
 * `chat_not_private` — কনফিগার করা আছে, পাঠানোও যেত, কিন্তু গন্তব্যটা
 * ব্যক্তিগত চ্যাট নয় বলে ইচ্ছাকৃতভাবে পাঠানো হয়নি (`weeklyGateOf()`)।
 *
 * ⚠️⚠️ এর জন্য `not_configured` ফেরত দেওয়া যেত **না** — টোকেন ও chat id
 * দুটোই তো আছে। ভুল কারণ ফেরত দিলে লগ দেখে মালিক টোকেন খুঁজতেন, অথচ
 * সমস্যাটা সম্পূর্ণ অন্য। এক সংখ্যা, এক সংজ্ঞা (নিয়ম ২)।
 *
 * ⚠️ `TelegramOutcome` থাকে `alerts/telegram.channel.ts`-এ, ওই ফাইলটা এই
 * কাজের আওতার বাইরে — তাই মানটা এখানে **যোগ** করা হয়েছে, ওখানে নয়।
 */
export type WeeklyOutcome = TelegramOutcome | 'chat_not_private';

export interface WeeklyDigestResult {
  from: string;
  to: string;
  employees: number;
  withData: number;
  behind: number;
  /** যতজনের অন্তত একটা দিন দেখাই হয়নি */
  withGaps: number;
  /** রিপোর্ট থেকে বাদ পড়া কর্মী (inactive, অথচ `left_on` খালি) */
  excluded: number;
  outcome: WeeklyOutcome;
  /** বার্তার দৈর্ঘ্য ও কতগুলো নাম ছাঁটা পড়ল — লগ দেখে সীমার চাপ বোঝা যায় */
  chars: number;
  hidden: number;
}

/**
 * **R3** — সাপ্তাহিক সারাংশ, owner-এর টেলিগ্রামে।
 *
 * ⚠️⚠️ **গন্তব্য বাছার কোনো ক্ষমতা এই ফাইলের নেই — কিন্তু "না পাঠানোর"
 * ক্ষমতা আছে।** বার্তাটায় নাম ধরে ধরে "কে পিছিয়ে" লেখা থাকে; সেটা দলের
 * গ্রুপে গেলে সাপ্তাহিক প্রকাশ্য অপমান, একবার পাঠানো হলে আর ফেরানো যায়
 * না, আর মানুষ চাকরি ছাড়ে ঠিক এই কারণে।
 *
 * ⚠️⚠️ চ্যাটটা `TELEGRAM_CHAT_ID`, অর্থাৎ **অ্যালার্টের সাথে ভাগ করা**।
 * অ্যালার্টে কেবল হোস্টনেম ও ধরন যায় বলে অনেকে ওখানে দলের গ্রুপ বসিয়ে
 * রাখেন — আর তখন প্রথম শুক্রবারেই র‍্যাঙ্কিংটা সেখানে চলে যেত। আগে এখানে
 * তিন জায়গায় "কর্মীদের গ্রুপে নয়" **লেখা** ছিল, কিন্তু কোডে কোনো প্রহরী
 * ছিল না; এখন `weeklyGateOf()` পাঠানোর ঠিক আগে দাঁড়ায় (`runOnce()`)।
 * ⭐ মালিক সজ্ঞানে গ্রুপে চাইলে `WEEKLY_DIGEST_ALLOW_GROUP=true`।
 *
 * ⭐ সংখ্যাগুলো তৈরি হয় **`ReportsService` দিয়েই** (F01 + F02), ঠিক দৈনিক
 * ডাইজেস্টের মতো। নিজে `daily_summary` পড়ে ঘণ্টা বা টার্গেট বানালে ছুটির
 * ক্যালেন্ডারের আরেকটা বাস্তবায়ন দাঁড়াত, আর টেলিগ্রাম ও রিপোর্ট দু-রকম
 * ঘণ্টা বলত।
 *
 * ⚠️ `PrismaService` তবু ইনজেক্ট করা — **একটিমাত্র** কাজে: কোন দিনের সারি
 * আদৌ লেখা হয়েছিল তা জানা (`observedDays()`)। ওটা সংখ্যা নয়, অস্তিত্ব, আর
 * রিপোর্টের ধরনে ওটা প্রকাশ করার কোনো ঘর নেই — F01 "সারি নেই" ও "সারি
 * আছে, ০ ঘণ্টা" দুটোকেই `no_activity` বলে। ⚠️ এখানে আর কোনো কোয়েরি যোগ
 * করবেন না; ঘণ্টার দ্বিতীয় উৎস তৈরি হওয়ার শুরুটা ঠিক এভাবেই হয়।
 *
 * ⚠️ এই ক্লাস **throw করতে পারে** — `ReportsService` active work policy না
 * পেলে ৫০০ ছোড়ে। ব্যতিক্রম ধরা হয় `WeeklyDigestJob`-এ, একটাই জায়গায়
 * (শিডিউলড ডাক আর হাতে ডাক দুটোরই), `DigestJob`-এর মতোই।
 */
@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);
  private readonly orgName: string;
  /**
   * ⚠️ `TELEGRAM_CHAT_ID` এখানে **দ্বিতীয়বার** পড়া হচ্ছে (`TelegramChannel`-ও
   * পড়ে), আর সেটা ইচ্ছাকৃত: গন্তব্য পাহারা দিতে গন্তব্যটা জানা লাগে, অথচ
   * চ্যানেল ওটা `private` রাখে আর ওই ফাইল এই কাজের আওতার বাইরে।
   *
   * ⚠️⚠️ এটা কোনো **সংখ্যার** দ্বিতীয় সংজ্ঞা নয় — পাঠানোর কাজটা আগের
   * মতোই কেবল চ্যানেলই করে, এখানে শুধু "পাঠানো হবে কি না" ঠিক হয়। তবু
   * নির্ভরতাটা সত্যি: চ্যানেল কোনোদিন অন্য চলক থেকে chat id নিলে এই
   * প্রহরী নীরবে ভুল চ্যাট পাহারা দেবে।
   */
  private readonly gate: WeeklyGate;
  private readonly digestEmailTo: string | undefined;

  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
    private readonly teams: TeamsChannel,
    private readonly mailer: AlertMailer,
    config: ConfigService,
  ) {
    this.orgName = config.get<string>('ORG_NAME')?.trim() || DEFAULT_ORG_NAME;
    this.digestEmailTo = config.get<string>('DIGEST_EMAIL_TO');
    this.gate = weeklyGateOf(
      config.get<string>('TELEGRAM_CHAT_ID'),
      config.get<string>(WEEKLY_ALLOW_GROUP_ENV),
    );

    // ⭐ **চালুর সময়েই** বলা হয়, শুক্রবার সন্ধ্যায় নয় — নইলে মালিক জানতেন
    //    কেবল প্রথম বার্তাটা না আসার পরে, অর্থাৎ সাত দিন দেরিতে।
    if (!this.gate.send) {
      this.logger.warn(
        `Weekly summary is blocked — ${this.gate.blockedBecause}`,
      );
    }
  }

  /**
   * ⚠️ কখনো throw করে না — `AlertMailer.send()`ও করে না। সাপ্তাহিক জবটা
   * এর উপর দাঁড়িয়ে, আর SMTP বন্ধ থাকা মানে হিসাব হারানো নয়।
   */
  private async sendByEmail(text: string): Promise<'sent' | 'not_configured' | 'failed'> {
    if (!this.mailer.configured) return 'not_configured';

    const owners = await this.prisma.user.findMany({
      where: { role: 'owner', isActive: true },
      select: { email: true },
    });

    const to = digestRecipients({
      explicit: this.digestEmailTo,
      owners: owners.map((o) => o.email),
    });

    // ⚠️ ঠিকানা না থাকলে চুপচাপ ফেরা — `AlertMailer` এমনিতেও একবার লগে
    //    লিখবে, দুবার লেখার মানে নেই।
    if (to.length === 0) return 'not_configured';

    return this.mailer.send(to, `${this.orgName} — weekly summary`, text);
  }

  async runOnce(now: Date = new Date()): Promise<WeeklyDigestResult> {
    const weekly = await this.collect(now);
    const message = weeklyMessage(weekly, this.orgName);

    /**
     * ⭐⭐ **প্রহরীটা এখানে, সংখ্যা গোনার পরে।** আগে বসালে অবরুদ্ধ সপ্তাহে
     * সারাংশটা তৈরিই হতো না, আর নিচের লগে লেখার মতো কিছু থাকত না — অথচ
     * অবরুদ্ধ সপ্তাহেই ওটা সবচেয়ে বেশি দরকার: বার্তাটা তখন **কেবল** লগে
     * থাকে, আর সপ্তাহে একবারের হিসাব হারিয়ে গেলে ফেরত পাওয়ার পথ নেই।
     */
    /**
     * ⭐⭐ **Teams টেলিগ্রামের বিকল্প নয়, পাশাপাশি।** যেটা কনফিগ করা আছে
     * সেটাই পায়; দুটোই থাকলে দুটোই পায়।
     *
     * ⚠️⚠️ **Teams-এর নিজস্ব প্রহরী নেই — ইচ্ছাকৃত।** টেলিগ্রামের প্রহরীটা
     * (`weeklyGateOf`) আছে কারণ ওখানে ভুল করে **গ্রুপ চ্যাটে** কর্মীর নাম ও
     * ঘণ্টা চলে যেতে পারত। Teams-এর webhook একটা নির্দিষ্ট চ্যানেলে বাঁধা —
     * মালিক নিজে যেটা বেছে বসিয়েছেন, আর সেটা বদলাতে হলে `.env` ছুঁতে হয়।
     *
     * ⚠️ তাই টেলিগ্রাম অবরুদ্ধ থাকলেও Teams পাঠানো হয়: দুটো আলাদা ঝুঁকি,
     * একটার শাস্তি অন্যটার উপর চাপানো যায় না।
     */
    const teamsOutcome = await this.teams.send(
      `${this.orgName} — weekly summary`,
      message.text,
    );

    /**
     * ⭐⭐ **ইমেইল — তৃতীয় চ্যানেল, আর এটাই একমাত্র যেটা সবসময় পাওয়া যায়।**
     *
     * ⚠️ মালিকের Teams **ফ্রি/ব্যক্তিগত অ্যাকাউন্ট** (Communities), আর
     * সেখানে incoming webhook বলে কিছু নেই — Workflows কেবল work/school
     * অ্যাকাউন্টে আসে। টেলিগ্রামও সবার থাকে না। কিন্তু SMTP এমনিতেই
     * কনফিগ করা, কারণ অ্যালার্ট ওই পথেই যায়।
     *
     * ⚠️⚠️ প্রাপক ম্যানেজার **নন** — সারাংশে প্রতিটা কর্মীর নাম ও ঘণ্টা
     * থাকে, আর সেটা owner-only পর্দার সমান জিনিস (`digest.recipients.ts`)।
     */
    const emailOutcome = await this.sendByEmail(message.text);

    const outcome: WeeklyOutcome = this.gate.send
      ? await this.telegram.send(message.text)
      : 'chat_not_private';

    /**
     * ⚠️ Teams-এ গেছে অথচ টেলিগ্রাম অবরুদ্ধ — এই অবস্থায় নিচের "পুরো
     * বার্তাটা লগে" শাখাটা আর দরকার নেই, কারণ সারাংশটা হারায়নি। কিন্তু
     * খবরটা লেখা থাকা দরকার, নইলে লগ পড়ে মনে হতো কিছুই পাঠানো হয়নি।
     */
    if (emailOutcome === 'sent') {
      this.logger.log(`Weekly summary emailed · ${weekly.from} → ${weekly.to}`);
    } else if (emailOutcome === 'failed') {
      this.logger.warn('Weekly summary could not be emailed — see the message below');
    }

    if (teamsOutcome === 'sent') {
      this.logger.log(`Weekly summary also sent to Teams · ${weekly.from} → ${weekly.to}`);
    } else if (teamsOutcome === 'failed') {
      this.logger.warn('Weekly summary could not be sent to Teams — see the message below');
    }

    if (outcome === 'chat_not_private') {
      this.logger.warn(
        `Weekly summary was NOT sent — ${this.gate.blockedBecause}\n` +
          `Full text below:\n${message.text}`,
      );
      return resultOf(weekly, message, outcome);
    }

    /**
     * ⚠️ টেলিগ্রাম না থাকলে (বা পাঠানো না গেলে) **ক্র্যাশ নয়, লগ** — আর
     * পুরো বার্তাটাই লগে যায়, শুধু "পাঠানো গেল না" নয়। জবটা সপ্তাহে একবার
     * চলে; বার্তাটা না রাখলে ওই সপ্তাহের সারাংশ চিরতরে হারিয়ে যেত, আর
     * পরে টোকেন ঠিক করে পেছনের সপ্তাহ ফিরে পাওয়ার কোনো উপায় নেই।
     *
     * ⚠️ লগে যাওয়াটা নিরাপদ, কারণ বার্তায় কেবল নাম ও ঘণ্টা — কোনো ডোমেইন,
     * অ্যাপের নাম বা স্ক্রিনশটের পথ নেই (`weekly.rules.ts` দেখুন)।
     */
    if (outcome === 'sent') {
      this.logger.log(
        `Weekly summary sent · ${weekly.from} → ${weekly.to} · ` +
          `${weekly.totals.employees} staff (${weekly.totals.withData} with data) · ` +
          `${weekly.behind.length} behind · ${message.text.length} chars` +
          // ⚠️ ফাঁক ও বাদ পড়া কর্মী লগেও ওঠে — বার্তাটা কেন "ছোট" দেখাচ্ছে
          //    তার উত্তর পরে খুঁজতে গেলে লগই একমাত্র জায়গা
          (weekly.totals.withGaps > 0
            ? ` · ${weekly.totals.withGaps} with unobserved days`
            : '') +
          (weekly.totals.excluded > 0
            ? ` · ${weekly.totals.excluded} excluded from the report`
            : '') +
          (message.hidden > 0 ? ` · ${message.hidden} names trimmed` : ''),
      );
    } else {
      this.logger.warn(
        `Weekly summary was not sent to Telegram (${outcome}) — full text below:\n${message.text}`,
      );
    }

    return resultOf(weekly, message, outcome);
  }

  /** ⭐ শুধু সংখ্যা — না পাঠিয়েই টেস্ট বা ভবিষ্যতের কোনো প্রিভিউ ডাকতে পারে */
  async collect(now: Date = new Date()): Promise<Weekly> {
    const window = weeklyWindow(now);

    const [daily, week, observed] = await Promise.all([
      /**
       * ⚠️ F01 চাওয়া হয় **পুরো উইন্ডোর**, শুধু আজকের দিনের নয়। দিনভিত্তিক
       * টার্গেট ছাড়া প্রত্যাশা থেকে "আজ" আর "যে দিন দেখা হয়নি" — দুটোর
       * একটাও বাদ দেওয়া যায় না, আর F02 পুরো সপ্তাহের একটাই টার্গেট দেয়।
       */
      this.reports.attendance({ from: window.from, to: window.to }),
      this.reports.summary({
        from: window.from,
        to: window.to,
        groupBy: 'week',
      }),
      this.observedDays(window),
    ]);

    return buildWeekly({
      from: window.from,
      to: window.to,
      days: window.days,
      daily: daily.rows,
      week: week.rows,
      observed,
      /**
       * ⚠️ `meta` আগে ফেলে দেওয়া হতো, আর তাতে `excludedEmployees` হারাত —
       * অর্থাৎ যাঁরা `status=inactive` অথচ `left_on` খালি বলে রিপোর্টেই
       * ওঠেন না, তাঁরা টেলিগ্রামেও অদৃশ্য থাকতেন। রিপোর্ট ইচ্ছে করেই নাম
       * ধরে জানায়; সাপ্তাহিক বার্তাও এখন তাই করে।
       *
       * ⭐ `week.meta` নেওয়া হলো, `daily.meta` নয় — দুটো একই (একই রেঞ্জ,
       * একই `context()`), তাই যেকোনো একটাই যথেষ্ট।
       */
      excludedEmployees: week.meta.excludedEmployees,
    });
  }

  /**
   * ⭐⭐ কোন (কর্মী, দিন) জোড়া সার্ভার **আসলেই দেখেছে**।
   *
   * ⚠️ এই একটামাত্র প্রশ্নের উত্তর `ReportsService` দিতে পারে না, তাই এখানে
   * সরাসরি DB পড়া হয়। F01 "সারি নেই" আর "সারি আছে, ০ ঘণ্টা" দুটোকেই
   * `no_activity` বলে (`reports.service.ts`), অথচ পার্থক্যটাই এই বার্তার
   * সবচেয়ে জরুরি তথ্য: `refreshDate()` প্রতিদিন প্রতিটি সক্রিয় কর্মীর সারি
   * লেখে, তাই সারি থাকা = ওই দিনটা মাপা হয়েছে।
   *
   * ⭐ **এখান থেকে একটাও সংখ্যা আসে না** — কেবল অস্তিত্ব। ঘণ্টা, টার্গেট,
   * কর্মদিবস সবই আগের মতো F01/F02 থেকেই, তাই "এক সংখ্যা, এক সংজ্ঞা"
   * অক্ষত: ছুটি বা টার্গেটের দ্বিতীয় কোনো বাস্তবায়ন এখানে জন্মায়নি।
   *
   * ⚠️ কর্মী ধরে ছাঁকা হয় না — সারি অল্প (কর্মী × ৭), আর `employeeId`
   * দিয়ে মেলানোয় অতিরিক্ত সারি থাকলেও ক্ষতি নেই। ছাঁকতে গেলে রিপোর্টের
   * কর্মী-তালিকার জন্য অপেক্ষা করতে হতো, অর্থাৎ তিনটে কোয়েরি আর
   * সমান্তরালে চলত না।
   */
  private async observedDays(window: WeeklyWindow): Promise<ObservedDay[]> {
    const rows = await this.prisma.dailySummary.findMany({
      where: {
        workDate: {
          gte: parseWorkDate(window.from),
          lte: parseWorkDate(window.to),
        },
      },
      select: { employeeId: true, workDate: true },
    });

    // ⚠️ `workDate` UTC-মধ্যরাত (`@db.Date`), তাই `toIsoDate()` — F01-এর
    //    `date` ঠিক একই ফাংশনে তৈরি, নইলে চাবিদুটো কখনো মিলত না
    return rows.map((r) => ({
      employeeId: r.employeeId,
      date: toIsoDate(r.workDate),
    }));
  }
}

/**
 * ⭐ ফলটা **একটাই জায়গায়** বানানো হয় — পাঠানো হোক, আটকে যাক বা ব্যর্থ
 * হোক। দুই শাখায় দুটো object literal থাকলে একটায় নতুন ঘর যোগ করে অন্যটায়
 * ভুলে যাওয়াটা সময়ের ব্যাপার মাত্র, আর তখন `outcome` ভেদে ফলের আকার
 * বদলে যেত।
 */
function resultOf(
  weekly: Weekly,
  message: WeeklyMessage,
  outcome: WeeklyOutcome,
): WeeklyDigestResult {
  return {
    from: weekly.from,
    to: weekly.to,
    employees: weekly.totals.employees,
    withData: weekly.totals.withData,
    behind: weekly.behind.length,
    withGaps: weekly.totals.withGaps,
    excluded: weekly.totals.excluded,
    outcome,
    chars: message.text.length,
    hidden: message.hidden,
  };
}
