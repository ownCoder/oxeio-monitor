import { api } from './client';
import { qs } from './query';

/**
 * D06–D09 — ক্যাটাগরির নিয়ম, দৈনিক productivity স্কোর, টপ অ্যাপ/সাইট,
 * টিম-ভিত্তিক সাইট সারাংশ।
 *
 * সার্ভারের উৎস: `server/src/activity/` (activity.controller.ts ·
 * activity.service.ts · activity.math.ts · category.controller.ts)।
 *
 * ⚠️ `/activity/*` — owner + manager। `/categories/*` — **owner-only**
 *    (নিয়ম বদলানো মানে সবার রিপোর্টের সংখ্যা বদলে দেওয়া)।
 *
 * ⚠️ **এখানকার কোনো সংখ্যা বেতনের হিসাবে ঢোকে না।** কেউ সারাদিন
 *    "unproductive" থাকলেও তার ঘণ্টা অক্ষত (docs/09 § ৪)।
 */

export type Productivity = 'productive' | 'neutral' | 'unproductive';
export type MatchType = 'process' | 'domain' | 'title_regex';

/**
 * সেকেন্ডের চারটে ঝুড়ি।
 *
 * ⭐ `unknownSec` আলাদা ঝুড়ি, `neutralSec`-এর অংশ নয়। "জানি না" আর
 * "জানি, এবং নিরপেক্ষ" এক নয় — মিলিয়ে ফেললে অচেনা প্রতিটা অ্যাপ নীরবে
 * স্কোরের হর বাড়িয়ে দিত।
 */
export interface SecondBuckets {
  productiveSec: number;
  neutralSec: number;
  unproductiveSec: number;
  unknownSec: number;
}

export interface ProductivityScore extends SecondBuckets {
  /** productive + neutral + unproductive — স্কোরের **হর** */
  categorizedSec: number;
  /** categorized + unknown */
  totalSec: number;
  /**
   * ⭐⚠️ **হর শূন্য হলে `null`, শূন্য নয়।** `0%` লিখলে "কিছুই productive
   * করেনি" বোঝাত, অথচ সত্যিটা "বলার মতো তথ্যই নেই"। `formatPct()` এটা
   * সামলায় — নিজে `?? 0` লিখবেন না।
   */
  scorePct: number | null;
  /**
   * ⭐ মোট সময়ের কত শতাংশ অচেনা। স্কোরের পাশে এটা **সবসময়** দেখাতে হবে —
   * ৯০% সময় অচেনা হলে ১০০% স্কোরও অর্থহীন।
   */
  unknownPct: number;
}

export interface DailyScore extends ProductivityScore {
  /** `YYYY-MM-DD` */
  workDate: string;
}

export interface EmployeeProductivity {
  employeeId: number;
  empCode: string;
  fullName: string;
  /**
   * ⚠️ যেসব দিনে একটাও সারি নেই সেই দিন **তালিকায় থাকে না** — শূন্য সারি
   *    বানানো হয় না। ফাঁকা দিন ছুটি না অনুপস্থিতি, সেটা এখান থেকে বোঝা যায় না।
   */
  days: DailyScore[];
  total: ProductivityScore;
}

/**
 * D07। ⚠️ `reports.ts`-এর `ProductivityReport` (F04) **আলাদা জিনিস** —
 * ওটা অ্যাপ/সাইট ভিত্তিক ছাপার রিপোর্ট, এটা দিনে-দিনে স্কোর।
 */
export interface DailyProductivityReport {
  from: string;
  to: string;
  /** ⭐ যাদের একটাও সারি নেই তারাও থাকেন — নইলে "এজেন্ট বন্ধ" আর "সব ঠিক" একরকম দেখাত */
  employees: EmployeeProductivity[];
  /** ⚠️ নিচের OVERLAP_CAVEAT — পেজে দেখাতে হবে */
  caveat: string;
}

export interface UsageTally {
  /** স্বাভাবিক করা কী (ছোট হাতের, সাইটে `www.` ছাড়া) */
  key: string;
  /** দেখানোর নাম — নিশ্চিত হলে রুলের নাম, নইলে কী-টাই */
  label: string;
  seconds: number;
  /** দুই দশমিক ঘণ্টা, স্ট্রিং — `formatHoursAsDuration()` দিয়ে দেখান */
  hours: string;
  records: number;
  buckets: SecondBuckets;
  /** সবচেয়ে বড় **জানা** ঝুড়ি; কিছু জানা না থাকলে `null` */
  category: Productivity | null;
  /**
   * ⚠️ একাধিক জানা ক্যাটাগরি মিশে আছে। `chrome.exe`-এর ভেতরে youtube আর
   * github দুটোই — একটামাত্র ক্যাটাগরি দেখানো তখন মিথ্যে হতো।
   */
  mixed: boolean;
  /** **সব** কী-র মোট সময়ের শতাংশ (টপ-১০-এর যোগফলের নয়) */
  sharePct: number;
}

export interface UsageReport {
  rows: UsageTally[];
  /** রেঞ্জের **সব** কী মিলিয়ে মোট */
  totalSec: number;
  distinctKeys: number;
  /** ⭐ টপ তালিকার বাইরে পড়ে যাওয়া সময় — এটা না দেখালে "টপ ১০"-ই যেন সব */
  otherSec: number;
}

export interface TopReport {
  from: string;
  to: string;
  employeeId: number | null;
  apps: UsageReport;
  sites: UsageReport;
  /** ⚠️ অ্যাপ ও সাইটের সময় **যোগ করা যাবে না** — একই সময়ের দুই রকম কাটাছেঁড়া */
  caveat: string;
}

export interface TeamSiteRow {
  domain: string;
  label: string;
  category: Productivity | null;
  mixed: boolean;
  totalSec: number;
  hours: string;
  /** ⭐ কতজন কর্মী — `employees === 1` হলে এটা টিমের অভ্যাস নয়, একজনের */
  employees: number;
  topEmployeeId: number | null;
  topEmployeeSec: number;
  sharePct: number;
}

export interface TeamReport {
  rows: TeamSiteRow[];
  totalSec: number;
  distinctDomains: number;
  otherSec: number;
  from: string;
  to: string;
  employeesWithData: number;
  caveat: string;
}

export interface RangeQuery {
  /** না দিলে চলতি মাসের ১ তারিখ */
  from?: string;
  /** না দিলে ঢাকার আজকের তারিখ */
  to?: string;
}

/**
 * D07 — `GET /api/v1/activity/productivity?employeeId=&from=&to=`
 *
 * `employeeId` না দিলে সব active কর্মী।
 */
export function getDailyProductivity(
  query: RangeQuery & { employeeId?: number } = {},
  signal?: AbortSignal,
): Promise<DailyProductivityReport> {
  return api<DailyProductivityReport>(`/activity/productivity${qs({ ...query })}`, {
    signal,
  });
}

/**
 * D08 — `GET /api/v1/activity/top?employeeId=&from=&to=&limit=`
 * ⚠️ `limit` সর্বোচ্চ ৫০, ডিফল্ট ১০।
 */
export function getTopUsage(
  query: RangeQuery & { employeeId?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<TopReport> {
  return api<TopReport>(`/activity/top${qs({ ...query })}`, { signal });
}

/**
 * D09 — `GET /api/v1/activity/team?from=&to=&limit=`
 *
 * ⚠️ এখানে `employeeId` **নেই** — একজনের হিসাব চাইলে `getTopUsage()`।
 *    পাঠালে ৪০০ (forbidNonWhitelisted)।
 */
export function getTeamSites(
  query: RangeQuery & { limit?: number } = {},
  signal?: AbortSignal,
): Promise<TeamReport> {
  return api<TeamReport>(`/activity/team${qs({ ...query })}`, { signal });
}

// ── D06 · ক্যাটাগরির নিয়ম (owner-only) ──────────────────────────────────────

export interface CategoryRuleView {
  id: number;
  matchType: MatchType;
  pattern: string;
  displayName: string;
  category: Productivity;
  /** ⚠️ **ছোট সংখ্যা আগে জেতে** — ব্রাউজারের রুল ২০০, বাকিদের ১০০ */
  priority: number;
}

export interface CategoryDeleteResult {
  deleted: CategoryRuleView;
  /** ⚠️ কত সারি এই মোছার ফলে "অচেনা" হয়ে গেল — পর্দায় দেখানো দরকার */
  orphanedRows: number;
  hint: string;
}

export function listCategories(
  signal?: AbortSignal,
): Promise<CategoryRuleView[]> {
  return api<CategoryRuleView[]>('/categories', { signal });
}

export interface CreateCategoryBody {
  matchType: MatchType;
  /** `code.exe` · `youtube.com` · regex। ⚠️ ডোমেইনে ফুল URL দিলে ৪০০ */
  pattern: string;
  displayName: string;
  category: Productivity;
  priority?: number;
}

export function createCategory(
  body: CreateCategoryBody,
): Promise<CategoryRuleView> {
  return api<CategoryRuleView>('/categories', { method: 'POST', body });
}

export function updateCategory(
  id: number,
  body: Partial<CreateCategoryBody>,
): Promise<CategoryRuleView> {
  return api<CategoryRuleView>(`/categories/${id}`, { method: 'PATCH', body });
}

export function deleteCategory(id: number): Promise<CategoryDeleteResult> {
  return api<CategoryDeleteResult>(`/categories/${id}`, { method: 'DELETE' });
}

/**
 * পুরোনো সারিগুলোতে নিয়ম আবার বসানো।
 *
 * ⚠️ নিয়ম **যোগ** করার পর `onlyUnmatched: true` যথেষ্ট (অনেক দ্রুত)।
 *    নিয়ম **বদলানো বা মোছার** পর `false` লাগে, নইলে পুরোনো সিদ্ধান্ত
 *    বসানো সারিগুলো পুরোনোই থেকে যেত।
 */
export function recategorize(
  onlyUnmatched = true,
): Promise<{ scanned: number; changed: number }> {
  return api<{ scanned: number; changed: number }>('/categories/recategorize', {
    method: 'POST',
    body: { onlyUnmatched },
  });
}
