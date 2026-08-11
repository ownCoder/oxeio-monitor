import { randomBytes, randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { hashEnrollmentCode } from '../admin/enrollment-code';
import { PrismaService } from '../prisma/prisma.service';
import { AgentConfigService, type AgentConfig } from './agent-config.service';
import { hashToken } from './device-auth.guard';
import type { EnrollDto } from './dto';

export interface EnrollResult {
  deviceId: number;
  /** ⚠️ এই একবারই যাবে — সার্ভারে শুধু sha256 জমা থাকে */
  deviceToken: string;
  employee: { id: number; empCode: string; fullName: string };
  configVersion: string;
  config: AgentConfig;
}

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: AgentConfigService,
  ) {}

  async enroll(dto: EnrollDto): Promise<EnrollResult> {
    // ⚠️ hash তৈরি ও যাচাই — দুই পাশে **একই ফাংশন**। আলাদা লিখলে একদিন
    //    একটা বদলাত আর সব enrollment নীরবে ভাঙত।
    const codeHash = hashEnrollmentCode(dto.enrollmentCode);

    const code = await this.prisma.enrollmentCode.findUnique({
      where: { codeHash },
      include: { employee: true },
    });

    // "নেই", "ব্যবহার হয়ে গেছে", "মেয়াদ শেষ" — তিনটেতেই একই বার্তা,
    // নইলে কোড অনুমান করার চেষ্টা সহজ হয়ে যেত (H05 · G18)
    if (!code || code.usedAt || code.expiresAt <= new Date()) {
      throw new UnauthorizedException('Enrolment code is invalid or expired');
    }

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
            employeeId: code.employeeId,
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
            employeeId: code.employeeId,
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
        await tx.enrollmentCode.update({
          where: { id: code.id },
          data: { usedAt: now, usedByDeviceId: device.id },
        });

        await tx.event.create({
          data: {
            deviceId: device.id,
            employeeId: code.employeeId,
            clientUuid: randomUUID(),
            type: 'agent_start',
            occurredAt: now,
            meta: {
              enrolled: true,
              hostname: dto.hostname,
              agentVersion: dto.agentVersion ?? null,
            },
          },
        });

        const { version, config } = await this.configs.build(
          code.employee.policyId,
        );

        this.logger.log(
          `device ${device.id} (${dto.hostname}) → employee ${code.employee.empCode}`,
        );

        return {
          deviceId: device.id,
          deviceToken,
          employee: {
            id: code.employee.id,
            empCode: code.employee.empCode,
            fullName: code.employee.fullName,
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
