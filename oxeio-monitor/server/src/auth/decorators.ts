import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { UserRole } from '@prisma/client';

import type { AuthedRequest, SessionUser } from './types';

export const IS_PUBLIC = 'oxeio:public';
export const REQUIRED_ROLES = 'oxeio:roles';
export const ALLOW_PW_CHANGE = 'oxeio:allowWhileMustChangePw';

/** লগইন ছাড়াই পৌঁছানো যায় — health, login */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC, true);

/** নির্দিষ্ট role ছাড়া ঢোকা যাবে না */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

/**
 * `mustChangePw = true` অবস্থাতেও যেসব রুট খোলা থাকবে —
 * নইলে ইউজার পাসওয়ার্ডই বদলাতে পারত না।
 */
export const AllowWhileMustChangePw = (): MethodDecorator =>
  SetMetadata(ALLOW_PW_CHANGE, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) {
      // JwtAuthGuard আগেই আটকে দেওয়ার কথা — এখানে পৌঁছানো মানে wiring-এ ভুল
      throw new Error('CurrentUser ব্যবহার হয়েছে কিন্তু রুটটি @Public');
    }
    return req.user;
  },
);
