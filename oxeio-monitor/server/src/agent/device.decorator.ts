import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Device } from '@prisma/client';

import type { Drift } from './clock-drift.service';
import type { DeviceRequest } from './device-auth.guard';

export const CurrentDevice = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): Device => {
    const req = ctx.switchToHttp().getRequest<DeviceRequest>();
    if (!req.device) throw new Error('CurrentDevice used without DeviceAuthGuard');
    return req.device;
  },
);

export const CurrentDrift = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): Drift => {
    const req = ctx.switchToHttp().getRequest<DeviceRequest>();
    return req.drift ?? { seconds: 0, level: 'none' };
  },
);
