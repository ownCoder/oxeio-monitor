import type { EmployeeStatus, UserRole } from '@prisma/client';

/**
 * E10 — কর্মচারীর DB সারিকে API রেসপন্সে রূপ দেওয়া।
 *
 * এই ফাইলের একটাই কঠিন দায়িত্ব: **`monthlySalary` owner ছাড়া কারো কাছে
 * যাবে না** ([ADR-023](../../../docs/05-Options-Decisions.md), স্পেক § ৪.৩)।
 *
 * খাঁটি রাখা হয়েছে (কোনো I/O নেই) কারণ "ম্যানেজার বেতন দেখতে পায় কি না"
 * প্রশ্নটার উত্তর একটা ডাটাবেস ছাড়া টেস্ট দিয়ে প্রমাণ করা দরকার। সার্ভিসের
 * ভেতরে মিশে থাকলে প্রমাণ করতে হলে পুরো HTTP স্ট্যাক দাঁড় করাতে হতো, আর
 * তখন কেউ আর টেস্টটা লিখত না।
 */

/**
 * Prisma-র `Decimal`-এর যেটুকু দরকার, শুধু সেটুকুর আকার।
 *
 * ⚠️ ইচ্ছাকৃতভাবে `@prisma/client`-এর Decimal ইমপোর্ট করা হয়নি — তাহলে এই
 * ফাইলটা আর নিরিবিলি খাঁটি থাকত না, আর টেস্টে একটা আসল Decimal বানাতে হতো।
 * সাধারণ `number`-ও এই আকার মেনে চলে, তাই টেস্টে `13000` লিখলেই চলে।
 */
export interface Decimalish {
  toFixed(digits: number): string;
}

/** ঠিক যতটুকু কলাম সার্ভিস select করে — এর বেশি কিছু এখানে ঢোকে না */
export interface EmployeeRow {
  id: number;
  empCode: string;
  fullName: string;
  email: string | null;
  designation: string | null;
  department: string | null;
  policyId: number | null;
  monthlySalary: Decimalish | null;
  joinedOn: Date | null;
  leftOn: Date | null;
  status: EmployeeStatus;
  policySignedAt: Date | null;
  policyDocPath: string | null;
  createdAt: Date;
  /** ⭐ সেটআপের অবস্থা — `EMPLOYEE_SELECT` থেকে */
  devices?: { status: 'active' | 'revoked' }[];
  portalUsers?: { id: number; email: string; role: UserRole }[];
}

/** ম্যানেজার ও owner — দুজনেই এটুকু দেখে */
export interface EmployeeBaseView {
  id: number;
  empCode: string;
  fullName: string;
  email: string | null;
  designation: string | null;
  department: string | null;
  policyId: number | null;
  /** 'YYYY-MM-DD' */
  joinedOn: string | null;
  leftOn: string | null;
  status: EmployeeStatus;
  policySignedAt: string | null;
  policyDocPath: string | null;
  createdAt: string;

  /**
   * ⭐ **এজেন্ট বসানোর জন্য তৈরি কি না** — এক নজরে।
   *
   * ⚠️ সংখ্যা নয়, `boolean` — কার কটা ডিভাইস সেটা এই পর্দার প্রশ্ন নয়,
   * প্রশ্নটা "তার সেটআপ শেষ কি না"। সংখ্যা দিলে সেটা আরেকটা পড়ার মতো
   * জিনিস হয়ে দাঁড়াত, অথচ কাজে লাগত না।
   */
  hasPortalAccount: boolean;
  hasDevice: boolean;
  /** ⭐ ডিভাইস আছে, কিন্তু সবগুলোই বন্ধ — সারিতে "Turn agent on" দেখানোর ভিত্তি */
  agentSwitchedOff: boolean;

  /**
   * ⭐ portal অ্যাকাউন্টের id ও লগইন ইমেইল — পাসওয়ার্ড রিসেট ও ইমেইল
   * বদলানোর জন্য পর্দার এটাই দরকার। অ্যাকাউন্ট না থাকলে দুটোই `null`।
   */
  portalUserId: number | null;
  portalEmail: string | null;

  /**
   * ⭐ ভূমিকা — পর্দার ড্রপডাউন **বর্তমান** মান দেখিয়ে খোলার জন্য।
   *
   * ⚠️ না পাঠালে ড্রপডাউন সবসময় "Staff" দেখাত, আর কেউ শুধু ইমেইল বদলাতে
   * গিয়ে সেভ চাপলে একজন ম্যানেজার নীরবে স্টাফ হয়ে যেতেন।
   */
  portalRole: 'owner' | 'manager' | 'employee' | null;
}

/** ⭐ শুধু owner-এর রেসপন্সে বেতনের ফিল্ডটা **থাকে** */
export interface OwnerEmployeeView extends EmployeeBaseView {
  /** টাকা, দুই দশমিক। বসানো না থাকলে `null` — শূন্য নয় (payroll § দেখুন) */
  monthlySalary: string | null;
}

export type EmployeeView = EmployeeBaseView | OwnerEmployeeView;

/** স্পেক § ৪.৩ — বেতন একমাত্র owner-এর জিনিস */
export function canSeeSalary(role: UserRole): boolean {
  return role === 'owner';
}

/**
 * ⭐ সারিটা কখনো spread করা হয় **না** (`{ ...row }`)। প্রতিটা ফিল্ড হাতে
 * লিখে তোলা হয়, অর্থাৎ এটা whitelist — blacklist নয়।
 *
 * পার্থক্যটা ভবিষ্যতের: স্কিমায় কাল যদি `bankAccount` বা `nid` কলাম যোগ হয়,
 * blacklist ধাঁচে (`delete copy.monthlySalary`) সেটা চুপচাপ ম্যানেজারের
 * রেসপন্সে চলে যেত। whitelist-এ ভুলে গেলে ফিল্ডটা **আসবেই না** — ফাঁস নয়,
 * অনুপস্থিতি। ভুলের দিকটা এভাবেই বেছে নেওয়া হয়েছে।
 */
export function toEmployeeView(row: EmployeeRow, role: UserRole): EmployeeView {
  const base: EmployeeBaseView = {
    id: row.id,
    empCode: row.empCode,
    fullName: row.fullName,
    email: row.email,
    designation: row.designation,
    department: row.department,
    policyId: row.policyId,
    joinedOn: toDateOnly(row.joinedOn),
    leftOn: toDateOnly(row.leftOn),
    status: row.status,
    policySignedAt: row.policySignedAt?.toISOString() ?? null,
    policyDocPath: row.policyDocPath,
    createdAt: row.createdAt.toISOString(),

    // ⚠️ `_count` না এলে `false` — "জানি না"-কে "নেই" ধরা হয়, কারণ এই
    //    পর্দাটা কাজ **বাকি আছে** দেখানোর জন্য; ভুল করলে বাড়তি কাজ দেখাক,
    //    কম নয়।
    hasPortalAccount: (row.portalUsers?.length ?? 0) > 0,
    hasDevice: (row.devices ?? []).some((d) => d.status === 'active'),

    /**
     * ⭐ এজেন্ট বসানো ছিল, কিন্তু এখন বন্ধ।
     *
     * ⚠️⚠️ কর্মী নিষ্ক্রিয় করলে তাঁর সব ডিভাইস revoke হয়, আর আবার সক্রিয়
     * করলে সেগুলো **ফেরে না** (ইচ্ছাকৃত — পুরোনো টোকেন আপনাআপনি জেগে
     * ওঠা উচিত নয়)। ফলে বোর্ডে তিনি চিরকাল "Offline", অথচ এজেন্ট তাঁর
     * PC-তে দিব্যি চলছে। এই ঘরটাই পর্দাকে "Turn agent on" বোতামটা
     * দেখানোর সুযোগ দেয়।
     */
    agentSwitchedOff:
      !(row.devices ?? []).some((d) => d.status === 'active') &&
      (row.devices ?? []).some((d) => d.status === 'revoked'),
    portalUserId: row.portalUsers?.[0]?.id ?? null,
    portalEmail: row.portalUsers?.[0]?.email ?? null,
    portalRole: row.portalUsers?.[0]?.role ?? null,
  };

  if (!canSeeSalary(role)) {
    // ⚠️ এখানে `monthlySalary: undefined` লেখার লোভ হয় — JSON.stringify-এ
    //    ফিল্ডটা উধাও হয়ে যায় বলে দেখতে ঠিকই লাগে। কিন্তু তখন অবজেক্টে
    //    key-টা থেকে যায় (`'monthlySalary' in emp` → true), আর কোনো
    //    ইন্টারসেপ্টর, লগার বা `JSON.stringify(obj, replacer)` সেটাকে
    //    `null` করে বাইরে পাঠিয়ে দিতে পারত। তাই key-টা **বসানোই হয় না**।
    return base;
  }

  return {
    ...base,
    // Decimal → স্ট্রিং। ⚠️ `Number(...)` দিয়ে যাওয়া হয় না — টাকা কখনো
    //    binary float হয়ে ফিরবে না, ১৩০০০.১০ যেন ১৩০০০.০৯৯৯… না হয়।
    monthlySalary: row.monthlySalary === null ? null : row.monthlySalary.toFixed(2),
  };
}

export function toEmployeeViews(
  rows: readonly EmployeeRow[],
  role: UserRole,
): EmployeeView[] {
  return rows.map((row) => toEmployeeView(row, role));
}

/**
 * `@db.Date` কলাম Prisma থেকে UTC-মধ্যরাত হিসেবে আসে, তাই ISO স্ট্রিংয়ের
 * প্রথম দশ অক্ষরই ক্যালেন্ডার তারিখ।
 *
 * ⚠️ এখানে ঢাকার অফসেট যোগ করা হয় **না**। এটা কোনো instant নয় — জন্মদিন
 * বা যোগদানের তারিখের মতো নিছক ক্যালেন্ডার তারিখ। টাইমজোন চাপালে ০১
 * তারিখ কখনো ৩১ হয়ে যেত।
 */
function toDateOnly(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}
