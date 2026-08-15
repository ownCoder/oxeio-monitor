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

export interface CreateEmployeeBody {
  /** ⚠️ শুধু অক্ষর, সংখ্যা, হাইফেন, আন্ডারস্কোর */
  empCode: string;
  fullName: string;
  email?: string;
  designation?: string;
  department?: string;
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
export type UpdateEmployeeBody = Partial<{
  empCode: string;
  fullName: string;
  email: string | null;
  designation: string | null;
  department: string | null;
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

/**
 * ⭐ সই করা মনিটরিং পলিসি রেকর্ড করা — **রোলআউটের একমাত্র শর্ত**
 * ([01 § রোলআউট](../../../docs/01-Planning.md))।
 *
 * `signedOn` না দিলে সার্ভার আজকের ঢাকার তারিখ বসায়। তারিখ দেওয়ার সুযোগ
 * আছে কারণ কাগজ প্রায়ই আগে সই হয়, ড্যাশবোর্ডে বসানো হয় পরে।
 */
export function setPolicySigned(
  id: number,
  signedOn?: string,
): Promise<EmployeeView> {
  return api<EmployeeView>(`/employees/${id}/policy-signed`, {
    method: 'POST',
    body: signedOn ? { signedOn } : {},
  });
}

/** ভুল করে বসানো সই তোলা। ⚠️ কর্মী মোছে না, শুধু তারিখটা শূন্য করে। */
export function clearPolicySigned(id: number): Promise<EmployeeView> {
  return api<EmployeeView>(`/employees/${id}/policy-signed`, {
    method: 'DELETE',
  });
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

export function listDevices(
  query: { employeeId?: number; status?: DeviceStatus } = {},
  signal?: AbortSignal,
): Promise<{ rows: DeviceView[]; total: number }> {
  return api<{ rows: DeviceView[]; total: number }>(
    `/devices${qs({ ...query })}`,
    { signal },
  );
}

export function getDevice(
  id: number,
  signal?: AbortSignal,
): Promise<DeviceView> {
  return api<DeviceView>(`/devices/${id}`, { signal });
}

/** H06 — `reason` বাধ্যতামূলক (৩–৫০০ অক্ষর), audit-এ লেখা থাকে */
export function revokeDevice(id: number, reason: string): Promise<DeviceView> {
  return api<DeviceView>(`/devices/${id}/revoke`, {
    method: 'POST',
    body: { reason },
  });
}

/**
 * ⚠️ restore করলে **পুরোনো টোকেনটাই আবার জেগে ওঠে**। ল্যাপটপ হারিয়ে গেলে
 * restore নয় — নতুন enrollment code দিতে হবে। UI-তে এটা লিখে দেওয়া দরকার।
 */
export function restoreDevice(id: number, reason: string): Promise<DeviceView> {
  return api<DeviceView>(`/devices/${id}/restore`, {
    method: 'POST',
    body: { reason },
  });
}

export interface EnrollmentCodeResult {
  /** ⭐⚠️ **এই একবারই দেখা যাবে** — সার্ভারে শুধু sha256 জমা থাকে */
  code: string;
  expiresAt: string;
  employee: { id: number; empCode: string; fullName: string };
}

/**
 * H05 — নতুন PC-তে এজেন্ট বসানোর কোড।
 *
 * ⭐ কোডটা মোডালে বড় করে দেখান আর "কপি" বোতাম দিন — পাতা বদলালে এটা
 * আর কোথাও পাওয়া যাবে না। ⚠️ নতুন কোড দিলে আগেরগুলো তখনই বাতিল হয়।
 */
export function createEnrollmentCode(
  employeeId: number,
): Promise<EnrollmentCodeResult> {
  return api<EnrollmentCodeResult>('/devices/enrollment-code', {
    method: 'POST',
    body: { employeeId },
  });
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

export function getWorkPolicy(
  id: number,
  signal?: AbortSignal,
): Promise<WorkPolicyView> {
  return api<WorkPolicyView>(`/work-policies/${id}`, { signal });
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
export function nextEmployeeCode(signal?: AbortSignal): Promise<{ code: string }> {
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
