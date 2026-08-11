import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_PW_CHANGE, IS_PUBLIC } from '../decorators';
import type { AuthedRequest } from '../types';

/**
 * G33 — seed বা owner-এর দেওয়া অস্থায়ী পাসওয়ার্ড নিয়ে কেউ যেন
 * সিস্টেম ব্যবহার করতে না পারে। বদলানোর আগে সব রুট বন্ধ,
 * শুধু `@AllowWhileMustChangePw()` চিহ্নিত রুটগুলো খোলা।
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user?.mustChangePw) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PW_CHANGE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (allowed) return true;

    throw new ForbiddenException({
      message: 'You must change your password first',
      mustChangePassword: true,
    });
  }
}
