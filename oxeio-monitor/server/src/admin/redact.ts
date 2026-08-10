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
