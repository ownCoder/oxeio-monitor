import { randomBytes, randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { hashEnrollmentCode } from '../admin/enrollment-code';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentConfigService, type AgentConfig } from './agent-config.service';
import { hashToken } from './device-auth.guard';
import type { EnrollDto, EnrollLoginDto } from './dto';

/** দুটো পথেরই সাধারণ অংশ — মেশিনটা কে, কোথায় */
type EnrollFacts = Omit<EnrollDto, 'enrollmentCode'>;

export interface EnrollResult {
  deviceId: number;
  /** ⚠️ এই একবারই যাবে — সার্ভারে শুধু sha256 জমা থাকে */
  deviceToken: string;
  employee: { id: number; empCode: string; fullName: string };
  configVersion: string;
  config: AgentConfig;
}

/**
 * ⭐ 2FA চালু থাকলে প্রথম উত্তরটা এটাই — এজেন্ট তখন ছ-অঙ্কের ঘরটা দেখায়।
 *
 * ⚠️ আলাদা `status` ফিল্ড দিয়ে বোঝানো হয়, কোনো এরর ছুড়ে নয়: কোড না
 * দেওয়াটা আক্রমণ নয়, স্বাভাবিক প্রথম ধাপ। ৪০১ দিলে এজেন্ট "পাসওয়ার্ড
 * ভুল" দেখাত, আর স্টাফ বারবার ঠিক পাসওয়ার্ডই টাইপ করে যেত।
 */
export type EnrollLoginResult = EnrollResult | { status: 'needs_totp' };

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: AgentConfigService,
    private readonly auth: AuthService,
  ) {}

  /**
   * **H05** — একবার ব্যবহার্য কোড দিয়ে (স্ক্রিপ্টেড রোলআউটের পথ)।
   *
   * ⚠️ পথটা রাখা হয়েছে ইচ্ছাকৃতভাবে: ১৫টা PC-তে একসাথে বসানোর সময় কারো
   * কীবোর্ডে বসে টাইপ করার সুযোগ থাকে না। মানুষ যখন সামনে থাকে তখন
   * `enrollWithLogin()` সহজ ও নির্ভুল।
   */
  async enroll(dto: EnrollDto): Promise<EnrollResult> {
    // ⚠️ hash তৈরি ও যাচাই — দুই পাশে **একই ফাংশন**। আলাদা লিখলে একদিন
    //    একটা বদলাত আর সব enrollment নীরবে ভাঙত।
    const codeHash = hashEnrollmentCode(dto.enrollmentCode);

    const code = await this.prisma.enrollmentCode.findUnique({
      where: { codeHash },
      select: { id: true, employeeId: true, usedAt: true, expiresAt: true },
    });

    // "নেই", "ব্যবহার হয়ে গেছে", "মেয়াদ শেষ" — তিনটেতেই একই বার্তা,
    // নইলে কোড অনুমান করার চেষ্টা সহজ হয়ে যেত (H05 · G18)
    if (!code || code.usedAt || code.expiresAt <= new Date()) {
      throw new UnauthorizedException('Enrolment code is invalid or expired');
    }

    return this.bind(code.employeeId, dto, code.id);
  }

  /**
   * ⭐⭐ **স্টাফ নিজের ইমেইল-পাসওয়ার্ড দিয়ে নিজের PC যোগ করে।**
   *
   * ⚠️ কেন এই দ্বিতীয় পথ: কোডের ব্যবস্থায় মালিককে প্রতিটা PC-র জন্য
   * আলাদা কোড বানাতে হতো, ২৪ ঘণ্টার মধ্যে ব্যবহার করাতে হতো, আর **কোন
   * কোড কোন মেশিনে** সেটা হাতে মেলাতে হতো। ভুল মিললে কোনো এরর আসত না —
   * শুধু একজনের কাজের ঘণ্টা আরেকজনের নামে জমা হতো, আর ধরা পড়ত মাস শেষে।
   *
   * ⭐ এখানে যে কীবোর্ডে বসে **সে নিজেই প্রমাণ করে সে কে**। তাই বাঁধাটা
   * বেশি নির্ভুল, কম নয়।
   *
   * ⚠️ এতে স্টাফের হাতে নতুন কোনো ক্ষমতা আসে না: সে নিজের ট্র্যাকিং
   * **যোগ** করতে পারে, বাদ দিতে পারে না। পাসওয়ার্ডটা এখানেই ডিভাইস
   * টোকেনে বদলে যায়, আর এজেন্ট সেটা কোথাও জমা রাখে না।
   *
   * ⚠️⚠️ যাচাইটা `AuthService.login()`-এই হয়, নকল করে লেখা হয়নি — ফলে
   * লগইনের তিনটে রক্ষাকবচ আপনাআপনি পাওয়া যায়: brute-force throttle, 2FA,
   * আর `audit_log`-এ `login`/`login_failed`। আলাদা করে লিখলে তিনটেই বাদ
   * পড়ত, আর এই endpoint-টা হয়ে যেত পাসওয়ার্ড অনুমান করার সবচেয়ে সহজ
   * দরজা — সেশন-লগইনের চেয়েও সহজ, কারণ এখানে CSRF বা cookie কিছুই নেই।
   */
  async enrollWithLogin(
    dto: EnrollLoginDto,
    ip: string,
  ): Promise<EnrollLoginResult> {
    const outcome = await this.auth.login(dto.email, dto.password, ip, dto.totp);

    if (outcome.status === 'needs_totp') return { status: 'needs_totp' };

    /**
     * ⚠️ owner ও manager-এর `users.employee_id` সাধারণত null — তাঁদের নামে
     * কর্মীর কোনো সারি নেই, তাই ঘণ্টা জমা করার জায়গাও নেই। ওই অ্যাকাউন্টে
     * এজেন্ট বসালে ডিভাইসটা কার, সেটাই বলা যেত না।
     */
    if (outcome.user.employeeId === null) {
      throw new ForbiddenException(
        'This account is not linked to a staff record. Sign in with the staff account for this PC.',
      );
    }

    // ⚠️ `mustChangePw` এখানে আটকানো হয় **না**। এজেন্ট কোনো ডেটা পড়ে না,
    //    শুধু পাঠায়; আর প্রথম দিনেই "আগে ওয়েবে গিয়ে পাসওয়ার্ড বদলান"
    //    বললে ইনস্টলটাই আটকে যেত।
    return this.bind(outcome.user.employeeId, dto, null);
  }

  /**
   * দুটো পথেরই শেষ ধাপ — ডিভাইসের সারি, `agent_start` ইভেন্ট, আর কনফিগ।
   *
   * ⚠️ এক জায়গায় রাখা হয়েছে ইচ্ছাকৃতভাবে। দুবার লিখলে একদিন একটা পথে
   * `status: 'active'` বসত আর অন্যটায় নয়, বা একটায় ইভেন্ট যেত অন্যটায়
   * না — আর পার্থক্যটা ধরা পড়ত কেবল ওই পথে বসানো মেশিনগুলোয়।
   */
  private async bind(
    employeeId: number,
    dto: EnrollFacts,
    /** কোড দিয়ে এলে তার id — একবার ব্যবহার্য বলে বন্ধ করতে হয়। লগইনে null */
    codeId: number | null,
  ): Promise<EnrollResult> {
    const deviceToken = randomBytes(32).toString('base64url'); // ২৫৬ বিট
    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        // একই PC-তে এজেন্ট আবার ইনস্টল করলে নতুন সারি নয়, আগেরটাই হালনাগাদ
        const device = await tx.device.upsert({
          where: { machineGuid: dto.machineGuid },
          update: {
            hostname: dto.hostname,
            windowsUsername: dto.windowsUsername,
            employeeId,
            osVersion: dto.osVersion ?? null,
            agentVersion: dto.agentVersion ?? null,
            tokenHash: hashToken(deviceToken),
            monitors: dto.monitors ?? 1,
            status: 'active',
            enrolledAt: now,
            lastSeenAt: now,
          },
          create: {
            hostname: dto.hostname,
            windowsUsername: dto.windowsUsername,
            employeeId,
            machineGuid: dto.machineGuid,
            osVersion: dto.osVersion ?? null,
            agentVersion: dto.agentVersion ?? null,
            tokenHash: hashToken(deviceToken),
            monitors: dto.monitors ?? 1,
            status: 'active',
            lastSeenAt: now,
          },
        });

        // একবার ব্যবহার্য — এখানেই বন্ধ হয়ে যায়
        if (codeId !== null) {
          await tx.enrollmentCode.update({
            where: { id: codeId },
            data: { usedAt: now, usedByDeviceId: device.id },
          });
        }

        await tx.event.create({
          data: {
            deviceId: device.id,
            employeeId,
            clientUuid: randomUUID(),
            type: 'agent_start',
            occurredAt: now,
            meta: {
              enrolled: true,
              hostname: dto.hostname,
              agentVersion: dto.agentVersion ?? null,
              // ⚠️ কোন পথে বসল সেটা ইভেন্টেই থাকে — ছ-মাস পরে "এই মেশিনটা
              //    কীভাবে যোগ হয়েছিল" প্রশ্নের একমাত্র সূত্র এটাই
              via: codeId === null ? 'login' : 'code',
            },
          },
        });

        const employee = await tx.employee.findUniqueOrThrow({
          where: { id: employeeId },
          select: { id: true, empCode: true, fullName: true, policyId: true },
        });

        const { version, config } = await this.configs.build(employee.policyId);

        this.logger.log(
          `device ${device.id} (${dto.hostname}) → employee ${employee.empCode}` +
            (codeId === null ? ' [login]' : ' [code]'),
        );

        return {
          deviceId: device.id,
          deviceToken,
          employee: {
            id: employee.id,
            empCode: employee.empCode,
            fullName: employee.fullName,
          },
          configVersion: version,
          config,
        };
      });
    } catch (err) {
      // devices(hostname, windows_username) UNIQUE — অন্য machine_guid নিয়ে
      // একই নামে আরেকটা সারি বসাতে গেলে এখানেই আটকাবে
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Another device is already registered as "${dto.hostname}\\${dto.windowsUsername}"`,
        );
      }
      throw err;
    }
  }
}
