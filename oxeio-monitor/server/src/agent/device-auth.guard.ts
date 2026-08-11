import { createHash } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Device } from '@prisma/client';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { CLIENT_TIME_HEADER } from './agent.constants';
import { ClockDriftService, type Drift } from './clock-drift.service';

export interface DeviceRequest extends Request {
  device?: Device;
  drift?: Drift;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * এজেন্টের সব endpoint-এর দরজা।
 *
 * টোকেন সার্ভারে **plaintext-এ জমা থাকে না** — শুধু sha256 (I02)।
 * তাই ডাটাবেস ফাঁস হলেও কেউ এজেন্ট সেজে ডেটা পাঠাতে পারবে না।
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockDriftService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<DeviceRequest>();

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Device token required');
    }

    const device = await this.prisma.device.findFirst({
      where: { tokenHash: hashToken(header.slice(7).trim()) },
    });
    if (!device) throw new UnauthorizedException('Device token is invalid');

    // H06 — দূর থেকে revoke করলে এজেন্ট আর কিছু পাঠাতে পারবে না
    if (device.status === 'revoked') {
      throw new ForbiddenException({
        message: 'This device has been revoked',
        command: 'revoke',
      });
    }

    const clientTimeRaw = req.headers[CLIENT_TIME_HEADER];
    const clientTime =
      typeof clientTimeRaw === 'string' ? new Date(clientTimeRaw) : null;

    const drift = this.clock.measure(clientTime);
    req.device = device;
    req.drift = drift;

    // last_seen_at → "এজেন্ট ১০ মিনিট চুপ" অ্যালার্ট এর উপরেই দাঁড়ানো (G01)
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    // drift থাকলে ডিভাইসে লিখে রাখা, বেশি হলে অ্যালার্ট (§ ২)
    await this.clock.record(device.id, device.employeeId, drift);

    return true;
  }
}
