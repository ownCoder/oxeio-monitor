import type { UserRole } from '@prisma/client';
import type { Request } from 'express';

/** JWT-তে যা থাকে, আর যা `req.user`-এ বসে */
export interface SessionUser {
  userId: number;
  email: string;
  role: UserRole;
  /** role = employee হলে কোন স্টাফ; নইলে null */
  employeeId: number | null;
  /** true হলে পাসওয়ার্ড না বদলানো পর্যন্ত কিছুই করা যাবে না */
  mustChangePw: boolean;
  /** টোকেন কখন ইস্যু হয়েছিল (epoch seconds) — sliding refresh-এর জন্য */
  issuedAt: number;
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
}
