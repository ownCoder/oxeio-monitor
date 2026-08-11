import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';

import { REQUIRED_ROLES } from '../decorators';
import type { AuthedRequest } from '../types';

/** I05 — owner / manager / employee (স্পেক § ৪.৩) */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(
      REQUIRED_ROLES,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user || !required.includes(req.user.role)) {
      throw new ForbiddenException("You don't have access to this action");
    }
    return true;
  }
}
