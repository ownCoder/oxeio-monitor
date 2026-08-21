import { api } from './client';
import { qs } from './query';

/**
 * E10 · E11 · H05 · H06 — স্টাফ, ডিভাইস, work policy, ছুটি, audit log।
 *
 * সার্ভারের উৎস: `server/src/admin/` ও `server/src/users/`।
 *
 * ⭐ ভূমিকার সীমানাটা এখানে সবচেয়ে সূক্ষ্ম:
 *   · `GET /employees`, `GET /employees/:id` — **owner + manager**
 *     (ম্যানেজারের লাইভ ভিউ ও রিপোর্ট নামের তালিকা ছাড়া অর্থহীন)
 *   · বাকি **সবকিছু** — owner-only: স্টাফ লেখা, ডিভাইস, policy, ছুটি,
 *     audit log, পাসওয়ার্ড রিসেট, portal অ্যাকাউন্ট
 *
 * ⚠️ owner-only জিনিস ম্যানেজারকে **দেখানোই হবে না** — `useAuth().user.role`
 *    দেখে বোতাম/ট্যাব লুকান। ৪০৩ ধরে বার্তা দেখানো শেষ রক্ষাকবচ, প্রথম নয়।
 */

export type EmployeeStatus = 'active' | 'inactive';
export type DeviceStatus = 'active' | 'revoked';

/** ⚠️ `UserRole` (কে কী দেখবে) নয় — এটা "কে কী কাজ করে" */
export type StaffType = 'designer' | 'researcher' | 'manager';

export const STAFF_TYPE_LABEL: Record<StaffType, string> = {
  designer: 'Designer',
  researcher: 'Researcher',
  manager: 'Manager',
};
export type Role = 'owner' | 'manager' | 'employee';

/**
 * ⭐ ড্রপডাউন থেকে **যে ভূমিকাগুলো বসানো যায়** — `owner` ইচ্ছাকৃতভাবে বাইরে।
 *
 * owner মানে বেতন, audit log আর সেটিংসের চাবি; সেটা এক ক্লিকে হাতবদলের
 * জিনিস নয় (ADR-011d)। সার্ভারের DTO-তেও `@IsIn` একই তালিকা আটকায়।
 *
 * ⚠️ নামটা আলাদা করে রাখা হলো যাতে `Role`-এর সাথে গুলিয়ে না যায় —
 * ১৩ আগস্ট ঠিক ওই গুলিয়ে ফেলাটাই **ওয়েব বিল্ড ভেঙে রেখেছিল** (TS2345),
 * আর ভাঙা অবস্থায় তিনটে কমিট পার হয়ে গেছে।
 */
export type AssignableRole = Exclude<Role, 'owner'>;

/**
 * ⭐⚠️ `monthlySalary` **ঐচ্ছিক, কারণ ম্যানেজারের JSON-এ key-টাই থাকে না**
 * (`undefined`, `null` নয় — সার্ভার ইচ্ছাকৃতভাবে key বসায়ই না, redact.ts)।
 * তাই `emp.monthlySalary ?? '—'` লিখলে ম্যানেজারের পর্দাতেও বেতনের ঘর
 * বসে যেত। কলামটাই render করবেন না যদি `user.role !== 'owner'`।
 */
export interface EmployeeView {
  id: number;
  empCode: string;
  fullName: string;
  email: string | null;
  designation: string | null;
  /**
   * ⭐ কাজের ধরন *(২১ আগস্ট)* — নিয়ম **কেবল এর উপরেই** বসে।
   *
   * ⚠️ `designation`-এর বিকল্প নয়: ওটা পদবি (মুক্ত-লেখা), এটা শ্রেণি।
   * ⚠️ `null` মানে "বসানো হয়নি" — টার্গেটের হিসাব তখন ওই কর্মীকে **ছেড়ে
   * দেয়**, শূন্য ধরে না।
   */
  staffType: StaffType | null;
  department: string | null;
  policyId: number | null;
  /** `YYYY-MM-DD` */
  joinedOn: string | null;
  leftOn: string | null;
  /** ⭐ এজেন্ট বসানোর জন্য তৈরি কি না — Staff পর্দার "Setup" কলাম */
  hasPortalAccount: boolean;
  hasDevice: boolean;
  /** ⭐ portal অ্যাকাউন্টের id ও লগইন ইমেইল — রিসেট ও ইমেইল বদলানোর জন্য */
  portalUserId: number | null;
  portalEmail: string | null;
  /**
   * ⚠️ ড্রপডাউনটা **বর্তমান** ভূমিকা দেখিয়ে খুলতে হয়। null ধরে "Staff"
   * দেখালে কেউ শুধু ইমেইল বদলাতে গিয়ে সেভ চাপলে একজন ম্যানেজার নীরবে
   * স্টাফ হয়ে যেতেন।
   */
  portalRole: 'owner' | 'manager' | 'employee' | null;

  /**
   * ⭐ এজেন্ট বসানো ছিল, কিন্তু এখন বন্ধ — সারিতে "Turn agent on" দেখানোর ভিত্তি।
   *
   * ⚠️ `hasDevice === false` দুটো সম্পূর্ণ আলাদা অবস্থায় সত্যি হয়:
   * কখনো বসানো হয়নি, আর বসানো ছিল কিন্তু বন্ধ করে দেওয়া। প্রথমটায়
   * PC-তে যেতে হয়, দ্বিতীয়টায় সারিতেই এক ক্লিক।
   */
  agentSwitchedOff: boolean;
  status: EmployeeStatus;
  policySignedAt: string | null;
  policyDocPath: string | null;
  createdAt: string;
  /** ⭐ শুধু owner-এর রেসপন্সে থাকে। উপরের নোটটা পড়ুন। */
  monthlySalary?: string | null;
}

export interface EmployeeListQuery {
  /** ডিফল্ট `active` */
  status?: EmployeeStatus | 'all';
  /** নাম, কোড বা ইমেইলে খোঁজা */
  search?: string;
}

export function listEmployees(
  query: EmployeeListQuery = {},
  signal?: AbortSignal,
): Promise<{ rows: EmployeeView[]; total: number }> {
  return api<{ rows: EmployeeView[]; total: number }>(
    `/employees${qs({ ...query })}`,
    { signal },
  );
}

export function getEmployee(
  id: number,
  signal?: AbortSignal,
): Promise<EmployeeView> {
  return api<EmployeeView>(`/employees/${id}`, { signal });
}

/**
 * ⚠️ `empCode` **নেই, ইচ্ছাকৃতভাবে** — সার্ভার নিজে বসায়।
 *
 * ⚠️ পাঠালে ৪০০ আসবে (`forbidNonWhitelisted`), চুপচাপ উপেক্ষা নয়।
 */
export interface CreateEmployeeBody {
  fullName: string;
  email?: string;
  designation?: string;
  department?: string;
  staffType?: StaffType;
  policyId?: number;
  /**
   * ⭐⚠️ টাকা **স্ট্রিং** হিসেবে পাঠাতে হবে (`'13000'` বা `'13000.50'`)।
   * সংখ্যা পাঠালে JSON-এর float-এ ১৩০০০.১০ হয়ে যেত ১৩০০০.০৯৯৯…, আর
   * এক পয়সার হেরফের কেউ ধরতে পারত না। ইনপুট বাক্সের মান সরাসরি দিন।
   */
  monthlySalary?: string;
  joinedOn?: string;
}

/**
 * ⚠️ `undefined` = "হাত দিও না", `null` = "মুছে দাও" — সার্ভার দুটোকে
 *    আলাদা করে। ফাঁকা ইনপুট বাক্স থেকে `''` না পাঠিয়ে `null` পাঠান।
 */
/** ⚠️ `empCode` এখানেও নেই — একবার বসলে আর বদলায় না। */
export type UpdateEmployeeBody = Partial<{
  fullName: string;
  email: string | null;
  designation: string | null;
  department: string | null;
  staffType: StaffType | null;
  policyId: number | null;
  monthlySalary: string | null;
  joinedOn: string | null;
}>;

export function createEmployee(
  body: CreateEmployeeBody,
): Promise<EmployeeView> {
  return api<EmployeeView>('/employees', { method: 'POST', body });
}

export function updateEmployee(
  id: number,
  body: UpdateEmployeeBody,
): Promise<EmployeeView> {
  return api<EmployeeView>(`/employees/${id}`, { method: 'PATCH', body });
}

/**
 * ⚠️ **ডিলিট নেই, deactivate আছে** — সারিটা মুছলে ওই কর্মীর মাসের হিসাব,
 * স্ক্রিনশট আর audit trail সব অনাথ হতো। তাই UI-তেও "মুছে ফেলুন" লিখবেন না।
 *
 * ⭐ এটা একইসাথে তার সব ডিভাইস revoke করে, enrollment code বাতিল করে আর
 * portal অ্যাকাউন্ট বন্ধ করে — নিশ্চিত করার বাক্সে সেটা বলা দরকার।
 *
 * `reason` বাধ্যতামূলক, অন্তত ৩ অক্ষর।
 */
export function deactivateEmployee(
  id: number,
  reason: string,
  leftOn?: string,
): Promise<EmployeeView> {
  return api<EmployeeView>(`/employees/${id}/deactivate`, {
    method: 'POST',
    body: { reason, ...(leftOn ? { leftOn } : {}) },
  });
}

export function reactivateEmployee(id: number): Promise<EmployeeView> {
  return api<EmployeeView>(`/employees/${id}/reactivate`, { method: 'POST' });
}



// ── ডিভাইস (owner-only) ─────────────────────────────────────────────────────

export interface DeviceView {
  id: number;
  hostname: string;
  windowsUsername: string;
  machineGuid: string;
  osVersion: string | null;
  agentVersion: string | null;
  monitors: number;
  status: DeviceStatus;
  /** ISO instant — কখনো সাড়া না দিলে `null` */
  lastSeenAt: string | null;
  /** ঘড়ির হেরফের, সেকেন্ডে — বড় হলে সময়ের হিসাব সন্দেহজনক */
  lastDriftSec: number;
  maxDriftSec: number;
  enrolledAt: string;
  /** কোনো কর্মীর সাথে যুক্ত না থাকলে `null` */
  employee: { id: number; empCode: string; fullName: string } | null;
}

/**
 * ⚠️⚠️ **এই রুটটা সার্ভারে বহুদিন ধরে ছিল, ওয়েব একবারও ডাকেনি।**
 *
 * উপরের `DeviceView` টাইপটাও লেখা হয়ে বসে ছিল — অর্থাৎ চুক্তির দুই পাশই
 * তৈরি, মাঝখানে কল নেই। ফল: *"কোন PC-তে কোন এজেন্ট চলছে"* প্রশ্নের উত্তর
 * পর্দার কোথাও ছিল না, যদিও ডেটাটা এক কল দূরে (১৮ আগস্ট, মালিকের প্রশ্ন)।
 *
 * ⚠️ owner-only (`@Roles(UserRole.owner)`), আর সার্ভার `{ rows, total }`
 * খামে পাঠায় — `total` এখানে লাগে না, সারিগুলোই ফেরত দেওয়া হয়।
 */
export function listDevices(signal?: AbortSignal): Promise<DeviceView[]> {
  return api<{ rows: DeviceView[]; total: number }>('/devices', {
    signal,
  }).then((r) => r.rows);
}





export interface EnrollmentCodeResult {
  /** ⭐⚠️ **এই একবারই দেখা যাবে** — সার্ভারে শুধু sha256 জমা থাকে */
  code: string;
  expiresAt: string;
  employee: { id: number; empCode: string; fullName: string };
}


// ── work policy (owner-only) ────────────────────────────────────────────────

export interface WorkPolicyView {
  id: number;
  name: string;
  /** ⭐ একমাত্র টার্গেট, ডিফল্ট ২০৮ */
  monthlyTargetHours: number;
  expectedWorkdays: number;
  /** ISO দিন — সোম = ১ … শুক্র = ৫ … রবি = ৭। `null` হলে প্রতিদিনই কর্মদিবস। */
  weeklyOffDay: number | null;
  /** `'HH:MM'` — ক্যাপচার উইন্ডো, ডিফল্ট ০৭:০০–২৩:০০ */
  screenshotFrom: string | null;
  screenshotTo: string | null;
  idleThresholdSec: number;
  slotMinutes: number;
  timezone: string;
  isActive: boolean;
  /** ⭐ deactivate করার আগে এটাই দেখার জিনিস — কেউ থাকলে সার্ভার আটকাবে */
  employeeCount: number;
}

export type WorkPolicyBody = Partial<{
  name: string;
  monthlyTargetHours: number;
  expectedWorkdays: number;
  weeklyOffDay: number | null;
  screenshotFrom: string;
  screenshotTo: string;
  idleThresholdSec: number;
  slotMinutes: number;
}>;

export function listWorkPolicies(
  signal?: AbortSignal,
): Promise<{ rows: WorkPolicyView[] }> {
  return api<{ rows: WorkPolicyView[] }>('/work-policies', { signal });
}


/**
 * ⚠️ এখানে একটা সংখ্যা বদলালে পরের config sync-এ **প্রতিটা PC-র আচরণ**
 * বদলে যায় (idle threshold, ছবির উইন্ডো)। নিশ্চিত করার ধাপ রাখুন।
 */
export function createWorkPolicy(
  body: WorkPolicyBody & { name: string },
): Promise<WorkPolicyView> {
  return api<WorkPolicyView>('/work-policies', { method: 'POST', body });
}

export function updateWorkPolicy(
  id: number,
  body: WorkPolicyBody,
): Promise<WorkPolicyView> {
  return api<WorkPolicyView>(`/work-policies/${id}`, { method: 'PATCH', body });
}

export function deactivateWorkPolicy(id: number): Promise<WorkPolicyView> {
  return api<WorkPolicyView>(`/work-policies/${id}/deactivate`, {
    method: 'POST',
  });
}

// ── ছুটি (owner-only) ───────────────────────────────────────────────────────

export interface HolidayView {
  id: number;
  /** `YYYY-MM-DD` */
  holidayDate: string;
  name: string;
  /** `public` | `optional` | `company` — খোলা রাখা হয়েছে */
  type: string;
}

export function listHolidays(
  year?: number,
  signal?: AbortSignal,
): Promise<{ rows: HolidayView[] }> {
  return api<{ rows: HolidayView[] }>(`/holidays${qs({ year })}`, { signal });
}

export function createHoliday(body: {
  holidayDate: string;
  name: string;
  type?: string;
}): Promise<HolidayView> {
  return api<HolidayView>('/holidays', { method: 'POST', body });
}

export function updateHoliday(
  id: number,
  body: Partial<{ holidayDate: string; name: string; type: string }>,
): Promise<HolidayView> {
  return api<HolidayView>(`/holidays/${id}`, { method: 'PATCH', body });
}

/**
 * ⚠️ পুরো E10-এ এটাই একমাত্র সত্যিকারের DELETE, আর নিরীহ নয়: ছুটি মুছলে
 * ওই মাসের কর্মদিবস বেড়ে যায়, ফলে **সবার pace পিছিয়ে যায়** — কেউ কোনো
 * কাজ না করেও। নিশ্চিত করার বাক্সে এটা বলুন।
 */
export function deleteHoliday(id: number): Promise<{ deleted: HolidayView }> {
  return api<{ deleted: HolidayView }>(`/holidays/${id}`, { method: 'DELETE' });
}

// ── E11 · audit log (owner-only) ────────────────────────────────────────────

export interface AuditLogRow {
  /** ⚠️ স্ট্রিং — সার্ভারে BigInt */
  id: string;
  occurredAt: string;
  /** `login` · `view_screenshot` · `payroll_view` · `change_setting` · `revoke_device` … */
  action: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  /** ⚠️ যেকোনো আকারের JSON — অন্ধভাবে render না করে `JSON.stringify` করে দেখান */
  meta: unknown;
  /** ইউজার মুছে গেলে `null` */
  user: {
    id: number;
    email: string;
    fullName: string;
    role: string;
  } | null;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface AuditLogQuery {
  userId?: number;
  action?: string;
  targetType?: string;
  targetId?: string;
  /** ⚠️ ISO-8601 **instant** (`2026-08-10T00:00:00Z`), শুধু তারিখ নয় */
  from?: string;
  to?: string;
  page?: number;
  /** ডিফল্ট ৫০, সর্বোচ্চ ২০০ — বেশি চাইলে ৪০০ */
  pageSize?: number;
}

export function listAuditLog(
  query: AuditLogQuery = {},
  signal?: AbortSignal,
): Promise<AuditLogPage> {
  return api<AuditLogPage>(`/audit-log${qs({ ...query })}`, { signal });
}

// ── অ্যাকাউন্ট (owner-only) ─────────────────────────────────────────────────

/** ⭐ `tempPassword` একবারই আসে — মোডালে দেখিয়ে দিন, কোথাও জমা থাকে না */
export function resetUserPassword(
  userId: number,
): Promise<{ email: string; tempPassword: string }> {
  return api<{ email: string; tempPassword: string }>(
    `/users/${userId}/reset-password`,
    { method: 'POST' },
  );
}

/**
 * পরের কর্মী-কোডের পরামর্শ — নতুন কর্মীর ফর্ম খোলার সময়।
 *
 * ⚠️ এটা **পরামর্শ**, নিশ্চয়তা নয় — ঘরটা সম্পাদনযোগ্যই থাকে, আর দুজন
 * একসাথে যোগ করলে দ্বিতীয়জন সার্ভার থেকে ৪০৯ পাবে।
 */
export function nextEmployeeCode(
  signal?: AbortSignal,
): Promise<{ code: string }> {
  return api<{ code: string }>('/employees/next-code', { signal });
}

/** লগইনের ইমেইল বদলানো — স্টাফের "ইউজারনেম" */
export function changeLoginEmail(
  userId: number,
  email: string,
): Promise<{ id: number; email: string }> {
  return api<{ id: number; email: string }>(`/users/${userId}/email`, {
    method: 'PATCH',
    body: { email },
  });
}

/**
 * স্টাফ ↔ ম্যানেজার।
 *
 * ⚠️ `owner` পাঠানো যায় না — সার্ভার ৪০০ দেবে। owner মানে বেতন, audit log
 * আর সেটিংসের চাবি; সেটা ড্রপডাউনের এক ক্লিকে হাতবদলের জিনিস নয়।
 */
/**
 * বন্ধ হয়ে যাওয়া এজেন্ট আবার চালু — **কর্মী ধরে, ডিভাইস ধরে নয়**।
 *
 * ⚠️ মালিক "ডিভাইস #৬১" নিয়ে ভাবেন না, ভাবেন "Belal-এর PC" নিয়ে। তাই
 * আলাদা Devices পর্দা তুলে দিয়ে কাজটা Staff সারিতে আনা হয়েছে।
 */
export function turnAgentOn(employeeId: number): Promise<{ restored: number }> {
  return api<{ restored: number }>(`/employees/${employeeId}/agent/turn-on`, {
    method: 'POST',
  });
}

/**
 * এই কর্মীর জামানত **কোন মাস থেকে** কাটা শুরু (`YYYY-MM`)।
 *
 * ⚠️ `null` মানে "নিয়মের সাধারণ শুরুর মাসে ফেরত যাও" — বৈধ ও অর্থবহ।
 *
 * ⚠️⚠️ মাস এগিয়ে দিলে তার আগের কিস্তি **মুছে যায়**, আর কতগুলো গেল সেটা
 * রেসপন্সে আসে — পর্দা যেন নীরবে সারি মুছে না ফেলে।
 */
/**
 * ⚠️⚠️ **`tokenHint` — পুরো টোকেন কখনো আসে না।** সার্ভার শেষ চার অক্ষর
 * ছাড়া কিছু পাঠায় না, কারণ ব্রাউজারে গেলে সেটা DevTools, প্রক্সি লগ বা
 * স্ক্রিন শেয়ারে দেখা যেত।
 */
export interface TelegramSettingsView {
  configured: boolean;
  tokenHint: string | null;
  chatId: string;
  /** ⚠️ কোনটা খাটছে — ডাটাবেস না `.env`। না জানালে মালিক ভাবতেন সেভ হয়নি */
  source: 'database' | 'env' | 'none';
}

export function getTelegramSettings(
  signal?: AbortSignal,
): Promise<TelegramSettingsView> {
  return api<TelegramSettingsView>('/settings/telegram', { signal });
}

/**
 * ⚠️ খালি স্ট্রিং পাঠানো **বৈধ** — মানে "মুছে দাও, `.env`-এ ফেরত যাও"।
 */
export function saveTelegramSettings(
  botToken: string,
  chatId: string,
): Promise<TelegramSettingsView> {
  return api<TelegramSettingsView>('/settings/telegram', {
    method: 'PATCH',
    body: { botToken, chatId },
  });
}

/**
 * ⭐ পরীক্ষামূলক বার্তা — নইলে মালিক সেভ করে **শুক্রবার পর্যন্ত** অপেক্ষা
 * করতেন, আর কিছু না এলে বুঝতেন ভুল ছিল, কিন্তু কী ভুল তা জানতেন না।
 */
export function testTelegram(): Promise<{ outcome: string }> {
  return api<{ outcome: string }>('/settings/telegram/test', { method: 'PATCH' });
}

export function setDepositStart(
  employeeId: number,
  yearMonth: string | null,
): Promise<{ removed: number; added: number }> {
  return api<{ removed: number; added: number }>(
    `/deposits/${employeeId}/start`,
    { method: 'PATCH', body: { yearMonth } },
  );
}

export function changeUserRole(
  userId: number,
  role: 'employee' | 'manager',
): Promise<{ id: number; email: string; role: string }> {
  return api<{ id: number; email: string; role: string }>(
    `/users/${userId}/role`,
    { method: 'PATCH', body: { role } },
  );
}

/** স্টাফের নিজস্ব ভিউয়ের অ্যাকাউন্ট (J04/J05) — ডিফল্ট role `employee` */
export function createPortalAccount(
  employeeId: number,
  email: string,
  role?: Role,
): Promise<{ userId: number; email: string; tempPassword: string }> {
  return api<{ userId: number; email: string; tempPassword: string }>(
    `/employees/${employeeId}/portal-account`,
    { method: 'POST', body: { email, ...(role ? { role } : {}) } },
  );
}

// ── H04 · এজেন্টের ভার্সন বিলি ──────────────────────────────────────────────

export type RolloutStage = 'canary' | 'partial' | 'all' | 'halted';

/**
 * ⚠️ লেখাগুলো owner-এর পর্দায় যায়, তাই কারিগরি নাম নয় — "canary" শব্দটা
 * কী বোঝায় সেটা ধরে নেওয়া যায় না।
 */
export const STAGE_LABEL: Record<RolloutStage, string> = {
  canary: 'A few PCs first',
  partial: 'About half',
  all: 'Everyone',
  halted: 'Stopped',
};

export interface AgentVersionView {
  version: string;
  sha256: string;
  sizeBytes: number | null;
  rolloutStage: RolloutStage;
  isMandatory: boolean;
  releaseNotes: string | null;
  releasedAt: string;
  /** ⚠️ সারি আছে কিন্তু MSI-টা ডিস্কে নেই — এজেন্ট নামাতে গিয়ে ৪০৪ পাবে */
  fileMissing: boolean;
  devicesOn: number;
}

export function listAgentVersions(
  signal?: AbortSignal,
): Promise<AgentVersionView[]> {
  return api<AgentVersionView[]>('/agent-versions', { signal });
}

export function publishAgentVersion(body: {
  version: string;
  msiPath: string;
  releaseNotes?: string;
  rolloutStage?: RolloutStage;
  isMandatory?: boolean;
}): Promise<AgentVersionView> {
  // ⚠️ `body` কাঁচা অবজেক্ট — `api()` নিজেই `JSON.stringify` করে।
  //    এখানে আগেই stringify করলে দুবার এনকোড হয়ে সার্ভারে একটা
  //    **স্ট্রিং** পৌঁছাত, আর ব্রাউজারে আসত `"…" is not valid JSON`।
  return api<AgentVersionView>('/agent-versions', { method: 'POST', body });
}

export function setAgentRollout(
  version: string,
  rolloutStage: RolloutStage,
): Promise<AgentVersionView> {
  return api<AgentVersionView>(
    `/agent-versions/${encodeURIComponent(version)}/stage`,
    { method: 'POST', body: { rolloutStage } },
  );
}

// ── R1 · মাস বন্ধ করা ────────────────────────────────────────────────────────

export interface MonthClosureView {
  /** '2026-08' */
  yearMonth: string;
  /** ISO instant */
  closedAt: string;
  /** ⚠️ ইমেইল — ইউজার মুছে গেলেও "কে বন্ধ করেছিল" টিকে থাকা দরকার */
  closedBy: string;
  note: string | null;
}

/**
 * R1 — `GET /api/v1/months` · owner-only।
 *
 * ⭐ শুধু **বন্ধ** মাসগুলোই ফেরে, সব মাস নয় — খোলা মাস মানে "এখনো নড়তে
 * পারে", আর সেটা অনুপস্থিতি দিয়েই বোঝা যায়।
 */
export function listMonthClosures(
  signal?: AbortSignal,
): Promise<{ rows: MonthClosureView[] }> {
  return api<{ rows: MonthClosureView[] }>('/months', { signal });
}

export function closeMonth(
  yearMonth: string,
  note?: string,
): Promise<MonthClosureView> {
  return api<MonthClosureView>(`/months/${yearMonth}/close`, {
    method: 'POST',
    body: { note },
  });
}

/**
 * ⚠️ খোলা মানে বন্ধের রেকর্ডটা তুলে নেওয়া — তাই `DELETE`।
 * ⭐ audit-এ দুটো সারিই (`month_closed`, `month_reopened`) থেকে যায়,
 *    অর্থাৎ ইতিহাস মোছে না।
 */
export function reopenMonth(
  yearMonth: string,
): Promise<{ yearMonth: string; reopened: true }> {
  return api<{ yearMonth: string; reopened: true }>(`/months/${yearMonth}`, {
    method: 'DELETE',
  });
}

// ── R2 · ছুটির খাতা ──────────────────────────────────────────────────────────

export interface LeaveView {
  id: number;
  employeeId: number;
  employeeName: string;
  /** 'YYYY-MM-DD' */
  leaveDate: string;
  /** `casual` · `sick` · `annual` — ⚠️ তিনটেই সবেতন */
  type: string;
  note: string | null;
  createdBy: string;
  /**
   * ⭐⭐ ওই দিনটা ওই কর্মীর কর্মদিবস ছিল কি না।
   *
   * ⚠️ `false` মানে সারিটা খাতায় আছে কিন্তু **টার্গেটের কিছুই কমায়নি** —
   *    শুক্রবার বা সরকারি ছুটির দিনে লেখা ছুটি। পর্দায় এটা আলাদা করে না
   *    দেখালে খাতাটা একটা ছাড়ের দাবি করত যা সে দেয়নি।
   */
  countsTowardTarget: boolean;
}

/** R2 — `GET /api/v1/leaves?month=YYYY-MM` · ⚠️ মাস বাধ্যতামূলক */
export function listLeaves(
  month: string,
  signal?: AbortSignal,
): Promise<{ rows: LeaveView[] }> {
  return api<{ rows: LeaveView[] }>(`/leaves${qs({ month })}`, { signal });
}

export interface CreateLeaveBody {
  employeeId: number;
  /** 'YYYY-MM-DD' */
  from: string;
  to: string;
  type: string;
  note?: string;
}

/**
 * ⭐ রেঞ্জ ধরে — মানুষ "১০ থেকে ১৪" ছুটি নেয়, "১০" পাঁচবার নয়।
 *
 * ⚠️ `skipped` খালি না হলে **সেটা দেখাতেই হবে**: ওই দিনগুলো আগে থেকেই
 *    খাতায় ছিল, তাই যোগ হয়নি। "৫টা যোগ হয়েছে" বলাটা তখন মিথ্যা হতো।
 */
export function createLeave(
  body: CreateLeaveBody,
): Promise<{ created: number; skipped: string[] }> {
  return api<{ created: number; skipped: string[] }>('/leaves', {
    method: 'POST',
    body,
  });
}

export function deleteLeave(id: number): Promise<void> {
  return api<void>(`/leaves/${id}`, { method: 'DELETE' });
}

// ── R21 · সিকিউরিটি মানি (জামানত) ────────────────────────────────────────

/**
 * ⚠️ পুরো পথটা **owner-only** — জামানত সরাসরি বেতনের অংশ, আর বেতনের কোনো
 * সংখ্যা ম্যানেজারের নাগালে নেই (ADR-023 · ADR-027)।
 */
export interface DepositPolicyView {
  /** '500.00' */
  amount: string;
  /** ⭐ পাঠানোর সময় **পয়সায়** যায় — ৫০০ টাকা = ৫০০০০ */
  amountPaisa: number;
  startYearMonth: string;
  noticeDays: number;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface DepositSettlementView {
  outcome: 'refunded' | 'forfeited';
  amount: string;
  noticeGivenOn: string | null;
  lastWorkingDay: string | null;
  noticeDaysGiven: number | null;
  noticeDaysRule: number;
  note: string | null;
  settledAt: string;
  settledBy: string;
}

export interface DepositBalance {
  /**
   * ⭐ মালিকের বেছে দেওয়া শুরুর মাস — না দিলে `null` (নিয়মই চলছে)।
   *
   * ⚠️ `effectiveStart`-ও আসে, কারণ পর্দায় দরকার **কোন মাস থেকে সত্যিই
   * কাটা হচ্ছে**। শুধু override দেখালে খালি ঘর দেখে মালিক বুঝতেন না
   * আসলে কোন মাস খাটছে।
   */
  startYearMonth: string | null;
  effectiveStart: string | null;

  employeeId: number;
  empCode: string;
  fullName: string;
  status: string;
  /** কত মাসের কিস্তি বসেছে */
  months: number;
  balance: string;
  balancePaisa: number;
  settlement: DepositSettlementView | null;
}

export function listDeposits(
  signal?: AbortSignal,
): Promise<{ rows: DepositBalance[]; policy: DepositPolicyView }> {
  return api<{ rows: DepositBalance[]; policy: DepositPolicyView }>(
    '/deposits',
    { signal },
  );
}

export interface DepositPolicyBody {
  amountPaisa?: number;
  startYearMonth?: string;
  noticeDays?: number;
  active?: boolean;
}

export function updateDepositPolicy(
  body: DepositPolicyBody,
): Promise<DepositPolicyView> {
  return api<DepositPolicyView>('/deposits/policy', { method: 'PATCH', body });
}

export interface SettleDepositBody {
  outcome: 'refunded' | 'forfeited';
  /** 'YYYY-MM-DD' — ⚠️ দুটোই ঐচ্ছিক, "জানা নেই" আর "শূন্য দিন" এক নয় */
  noticeGivenOn?: string;
  lastWorkingDay?: string;
  note?: string;
}

export function settleDeposit(
  employeeId: number,
  body: SettleDepositBody,
): Promise<DepositSettlementView> {
  return api<DepositSettlementView>(`/deposits/${employeeId}/settle`, {
    method: 'POST',
    body,
  });
}

// ── R5 · অফসাইট ব্যাকআপ (Backblaze B2) ──────────────────────────────────────

export interface OffsiteSettingsView {
  configured: boolean;
  /** `…9f2a` — application key বসানো না থাকলে `null` */
  keyHint: string | null;
  /** ⭐ গোপন নয় — পুরোটাই আসে, যাতে "আগেরটাই থাক" কাজ করে */
  keyId: string;
  bucket: string;
  /** ⚠️ কোনটা খাটছে — ডাটাবেস না সার্ভারের ফাইল */
  source: 'database' | 'env' | 'none';
}

export interface B2Verdict {
  ok: boolean;
  message: string;
  /** key-টা যে bucket-এ বাঁধা (সীমাবদ্ধ না হলে `null`) */
  boundTo: string | null;
}

export function getOffsiteSettings(
  signal?: AbortSignal,
): Promise<OffsiteSettingsView> {
  return api<OffsiteSettingsView>('/settings/offsite', { signal });
}

/**
 * ⚠️⚠️ `appKey` খালি পাঠানো মানে **"আগেরটাই থাক"** — টেলিগ্রামের চেয়ে
 * আলাদা, আর সেটা ইচ্ছাকৃত: Backblaze application key **একবারই দেখায়**,
 * তাই bucket-এর নাম শুধরাতে গিয়ে সেটা মুছে গেলে নতুন key বানাতে হতো।
 * ⭐ পুরোপুরি মুছতে হলে তিনটে ঘরই খালি রেখে সেভ।
 */
export function saveOffsiteSettings(
  keyId: string,
  appKey: string,
  bucket: string,
): Promise<OffsiteSettingsView> {
  return api<OffsiteSettingsView>('/settings/offsite', {
    method: 'PATCH',
    body: { keyId, appKey, bucket },
  });
}

/**
 * ⭐⭐ কী-জোড়া সত্যিই কাজ করে কি না — **এখনই**। সার্ভার সরাসরি
 * Backblaze-কে জিজ্ঞেস করে, তাই ভুল key সাথে সাথেই ধরা পড়ে।
 */
export function testOffsite(): Promise<B2Verdict> {
  return api<B2Verdict>('/settings/offsite/test', { method: 'POST' });
}
