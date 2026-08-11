import { createHash } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import type { Device } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface AgentConfig {
  idleThresholdSec: number;
  slotMinutes: number;
  /** 'HH:MM' — null হলে ২৪ ঘণ্টা ছবি ওঠে (ADR-011c) */
  screenshotFrom: string | null;
  screenshotTo: string | null;
  timezone: string;
  monthlyTargetHours: number;
  heartbeatSec: number;
  appTracking: { enabled: boolean; minDurationSec: number };
  screenshot: {
    format: 'webp';
    quality: number;
    maxWidth: number;
    allMonitors: boolean;
  };
}

@Injectable()
export class AgentConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * এজেন্ট যে কনফিগ নিয়ে চলে। work policy থেকেই আসে, তাই ড্যাশবোর্ড থেকে
   * threshold বদলালে পরের config sync-এ ১৫টা PC-তেই পৌঁছে যাবে।
   */
  async build(policyId: number | null): Promise<{
    version: string;
    config: AgentConfig;
  }> {
    const policy = policyId
      ? await this.prisma.workPolicy.findUnique({ where: { id: policyId } })
      : await this.prisma.workPolicy.findFirst({ where: { isActive: true } });

    if (!policy) throw new NotFoundException('No active work policy found');

    const config: AgentConfig = {
      idleThresholdSec: policy.idleThresholdSec,
      slotMinutes: policy.slotMinutes,
      screenshotFrom: policy.screenshotFrom,
      screenshotTo: policy.screenshotTo,
      timezone: policy.timezone,
      monthlyTargetHours: Number(policy.monthlyTargetHours),
      heartbeatSec: 30,
      appTracking: { enabled: true, minDurationSec: 5 },
      screenshot: {
        format: 'webp',
        quality: 70,
        maxWidth: 1920,
        allMonitors: true,
      },
    };

    return { version: this.versionOf(config), config };
  }

  /** ডিভাইসের স্টাফ যে policy-তে আছে, সেটাই — না থাকলে active default */
  async buildForDevice(
    device: Device,
  ): Promise<{ version: string; config: AgentConfig }> {
    if (device.employeeId === null) return this.build(null);

    const employee = await this.prisma.employee.findUnique({
      where: { id: device.employeeId },
      select: { policyId: true },
    });
    return this.build(employee?.policyId ?? null);
  }

  /**
   * কনফিগের হ্যাশই তার ভার্সন — আলাদা কলাম বা কাউন্টার লাগে না।
   * এজেন্ট heartbeat-এ নিজের ভার্সন পাঠায়; না মিললে `reload_config` কমান্ড যায়।
   */
  private versionOf(config: AgentConfig): string {
    return createHash('sha256')
      .update(JSON.stringify(config))
      .digest('hex')
      .slice(0, 16);
  }
}
