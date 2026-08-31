import { api } from './client';

/**
 * **ডিজাইন-টার্গেট** *(২২ আগস্ট ২০২৬)* — গবেষকের জমা, ডিজাইনারের তালিকা।
 */

export type RejectReason =
  | 'not_amazon'
  | 'short_link'
  | 'no_asin'
  | 'duplicate_in_paste';

/**
 * ⭐⭐ কারণগুলো **করণীয় বলে, দোষ নয়** — "কিছু একটা ভুল" লিখলে গবেষক
 * জানতেন না লাইনটা নিয়ে কী করতে হবে।
 */
export const REJECT_TEXT: Record<RejectReason, string> = {
  short_link: 'Open the short link and paste the real URL',
  not_amazon: 'Not an Amazon link',
  no_asin: 'No product in this link (a search page?)',
  duplicate_in_paste: 'Already in this same list',
};

export interface RejectedLine {
  line: number;
  text: string;
  reason: RejectReason;
}

export interface BulkResult {
  added: number;
  /** ⚠️ ভুল নয়, কিন্তু লুকোনোও নয় — "৫০০ দিলাম, ৪৭৩ ঢুকল" রহস্য থাকা চলবে না */
  alreadyKnown: number;
  /** ⚠️ সর্বোচ্চ ২০০টা — আসল সংখ্যা `rejectedTotal`-এ */
  rejected: RejectedLine[];
  /** ⭐ কতগুলো সত্যিই বাদ পড়েছে, তালিকা ছাঁটা হলেও */
  rejectedTotal: number;
  poolSize: number;
}

export interface TargetStats {
  pool: number;
  assigned: number;
  done: number;
  skipped: number;
  /** ⭐ Amazon-এ পাতাটাই নেই — হাতে মুছে ফেলা *(২৯ আগস্ট)* */
  deleted: number;
  perDesigner: number;
  /** ⭐ Amazon-এ পাঠানো হয়েছে — `done`-এর উপরে, বদলে নয় */
  uploaded: number;
  /** ⭐ বিক্রির জন্য উঠেছে */
  live: number;
  /**
   * ⭐⭐ **গবেষকের কিউ** *(২৪ আগস্ট ২০২৬)* — শেষ হয়েছে অথচ আপলোড হয়নি।
   *
   * ⚠️ ২৩ আগস্টের আগের সারিগুলো গোনা হয় না — ইমপোর্ট করা ২৭ হাজার
   * পুরোনো কাজ অনেক আগেই Amazon-এ গেছে, তখন বোতামটাই ছিল না।
   */
  toUpload: number;
  /** ⭐ আপলোড হয়েছে অথচ লাইভ হয়নি */
  toLive: number;
  /**
   * ⭐⭐ **বানান দেখা বাকি** *(ADR-038)* — সুমাইয়ার কিউ।
   *
   * ⚠️ যন্ত্র বানান পড়ে না; এটা কেবল *"কোনগুলো দেখা হয়নি"*-র হিসাব।
   */
  toCheck: number;
  /** ⭐ ভুল পাওয়া গেছে, ঠিক হয়নি — বেলালের কিউ */
  toFix: number;
}

export interface MyTarget {
  id: number;
  asin: string;
  /** ⭐ সার্ভার ASIN থেকে বানিয়ে পাঠায় — ওয়েব জোড়া লাগায় না */
  url: string;
  jobNumber: number | null;
  assignedAt: string | null;
  /**
   * ⭐ ফাইলটা খোলা হয়েছে — "কাজ চলছে"।
   *
   * ⚠️ এটা **শেষ হওয়া নয়**: এজেন্ট নম্বরটা দেখে ফাইল খোলার মুহূর্তে।
   * শেষ হওয়া বলেন ডিজাইনার নিজে, Complete বোতামে।
   */
  startedAt: string | null;
  /**
   * ⭐⭐ **আজ শেষ করা হয়েছে** *(২৫ আগস্ট)*।
   *
   * ⚠️⚠️ `null` = এখনো হাতে আছে। এই একটা ঘরই ঠিক করে সারিটা কার্ডের
   * কোন ভাগে বসবে — "হাতে আছে" নাকি "আজ শেষ করেছি"।
   *
   * ⚠️ **আজকের** বাইরের কিছু সার্ভার পাঠায়ই না, তাই মান থাকা মানেই
   * "এখনো ফেরানো যায়"।
   */
  completedAt: string | null;
}

export function addTargets(text: string): Promise<BulkResult> {
  return api<BulkResult>('/design-targets/bulk', { method: 'POST', body: { text } });
}

export function targetStats(signal?: AbortSignal): Promise<TargetStats> {
  return api<TargetStats>('/design-targets/stats', { signal });
}

export function distributeTargets(): Promise<{ assigned: number }> {
  return api<{ assigned: number }>('/design-targets/distribute', { method: 'POST' });
}

export function myTargets(signal?: AbortSignal): Promise<MyTarget[]> {
  return api<MyTarget[]>('/me/targets', { signal });
}

/**
 * ⭐⭐ "শেষ করেছি" *(২৩ আগস্ট, মালিকের চাওয়া)*।
 *
 * ⚠️ এটা ছাড়া উপায় নেই: সিস্টেম কেবল **শুরু** হওয়া দেখতে পায়
 * (ফাইল খোলা), শেষ হওয়া নয়।
 */
export function completeTarget(id: number): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/me/targets/${id}/done`, { method: 'POST' });
}

/**
 * ⭐⭐ **"ভুল করে Complete চেপে ফেলেছি"** *(২৫ আগস্ট)*।
 *
 * ⚠️ সার্ভার তিনটে শর্ত দেখে — আজকের, নিজের, আর শেকলে এগোয়নি। শর্ত না
 * মিললে **কেন** মিলল না সেটা বার্তায় বলে দেয়, চুপ করে থাকে না।
 */
export function undoTarget(id: number): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/me/targets/${id}/undone`, { method: 'POST' });
}

/**
 * ⚠️⚠️ `reason` এখন **বাধ্যতামূলক** *(৩১ আগস্ট)* — আগে ঐচ্ছিক ছিল, আর
 * পর্দা কোনোদিন পাঠায়ইনি; ফলে ৯৩টা skipped সারির একটাতেও কারণ ছিল না।
 */
export function skipTarget(
  id: number,
  reason: DropReason,
): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/me/targets/${id}/skip`, {
    method: 'POST',
    body: { reason },
  });
}

export type TargetStatus = 'pool' | 'assigned' | 'done' | 'skipped' | 'deleted';

/**
 * ⭐⭐ **একটা টার্গেট কেন কাজের বাইরে গেল** *(মালিকের চাওয়া, ৩১ আগস্ট ২০২৬)*।
 *
 * ⚠️ ক্রমটাই পর্দার ক্রম, আর **`not_found` প্রথমে** — মাঠে ওটাই সবচেয়ে
 * বেশি ঘটে (Amazon-এ পাতাটাই নেই)। বেশি-ব্যবহৃতটা হাতের কাছে থাকে।
 */
export const DROP_REASONS = ['not_found', 'copyright', 'events'] as const;

export type DropReason = (typeof DROP_REASONS)[number];

/**
 * ⚠️⚠️ **জমা হয় যন্ত্রের মান, দেখা যায় এই লেখা** — দুটো আলাদা রাখা হয়েছে
 * বলেই একদিন "Not Found"-কে "Page gone" বলা যাবে পুরোনো সারি না ছুঁয়ে।
 */
export const DROP_REASON_LABEL: Record<DropReason, string> = {
  not_found: 'Not Found',
  copyright: 'Copyright',
  events: 'Events',
};

/** ⭐ মোছার ফল — কতগুলো গেল, আর শেষ হয়ে যাওয়া কতগুলো থেকে গেল */
export interface DeleteResult {
  deleted: number;
  keptDone: number;
}

export interface TargetRow {
  id: number;
  asin: string;
  url: string;
  status: TargetStatus;
  jobNumber: number | null;
  /** ⚠️ ছেড়ে যাওয়া কর্মীর সারিতে `null` — নামটা তখন `sourceNote`-এ */
  assignedTo: { empCode: string; fullName: string } | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completedVia: string | null;
  /**
   * ⭐ কে "শেষ" বলেছেন *(২৩ আগস্ট)*।
   *
   * ⚠️ `assignedTo`-র সাথে গুলিয়ে ফেলা যাবে না — বরাদ্দ পাওয়া মানুষ আর
   * শেষ বলা মানুষ এক না-ও হতে পারে (মালিক নিজেও চাপতে পারেন)।
   */
  completedBy: { fullName: string; role: string } | null;

  /**
   * ⭐⭐ **কে টার্গেটটা এনেছেন** *(২৫ আগস্ট ২০২৬)*।
   *
   * ⚠️ `assignedTo`-র সাথে গুলিয়ে ফেলবেন না — ওটা **কর্মী** (যিনি
   * ডিজাইন করবেন), এটা **ব্যবহারকারী** (যিনি লিঙ্কটা এনেছেন)।
   *
   * ⚠️ `| null` **নেই** — কলামটা `NOT NULL`, প্রতিটা সারির একজন উৎস
   * আছে। মিথ্যা ঐচ্ছিকতা রাখলে পর্দায় অকারণ `?? '—'` বসাতে হতো।
   */
  addedBy: { fullName: string; role: string };
  /** ⭐ কবে এসেছে — একই ব্যাচের সারিগুলো এক মুহূর্তে বসে */
  addedAt: string;
  /** ⭐ বানান দেখা হয়েছে — `null` = এখনো দেখা হয়নি (ADR-038) */
  checkedAt: string | null;
  /** ⭐ ভুল পাওয়া গেছে — `null` আর `checkedAt` বসানো = ঠিক ছিল */
  errorFoundAt: string | null;
  /** ⭐ ভুলটা ঠিক করা হয়েছে */
  fixedAt: string | null;
  uploadedAt: string | null;
  liveAt: string | null;
  /** ⚠️ **আমাদের নিজের** পণ্যের ASIN — উপরের `asin` নমুনার */
  liveAsin: string | null;
  /**
   * ⭐ কেন বাদ গেল — `skipped` ও `deleted` সারিতে থাকে, বাকিতে `null`
   * *(৩১ আগস্ট)*। ⚠️ পুরোনো সারিতে `null`, কারণ তখন কারণ চাওয়াই হতো না।
   */
  dropReason: DropReason | null;
  /** পুরোনো Excel-এর কাঁচা লেখা — `Hafiz-24-05-2026` */
  sourceNote: string | null;
}

export interface TargetPage {
  rows: TargetRow[];
  total: number;
  page: number;
  pages: number;
}

/**
 * ⭐ পুরো তালিকা — মালিক · ম্যানেজার · গবেষক *(২৩ আগস্ট)*।
 *
 * ⚠️ পাতা ভাগ বাধ্যতামূলক: টেবিলে ৩৯ হাজারের বেশি সারি।
 * ⭐ `q`-তে **URL বা ASIN** দুটোই চলে — একটা লিঙ্ক পেস্ট করে দেখে নেওয়া
 * যায় ওটা আগে হয়ে গেছে কি না, আর কে করেছিল।
 */
export function listTargets(
  params: {
    status?: TargetStatus;
    q?: string;
    page?: number;
    /** ⭐ কোন ডিজাইনারের — `employees.id` *(২৩ আগস্ট)* */
    staffId?: number;
    /**
     * ⭐ কে এনেছেন — `users.id` *(২৫ আগস্ট)*।
     * ⚠️ উপরেরটার সাথে **আলাদা id-র জগৎ** — `employees` বনাম `users`।
     */
    addedById?: number;
    /** ⭐ `YYYY-MM-DD` — শেষ কাজের তারিখ এই সীমার ভেতরে */
    from?: string;
    to?: string;
    /** ⭐ শেকলের কোন ধাপে আটকে — গবেষকের কিউ (২৪ আগস্ট) */
    stage?: 'to_check' | 'to_fix' | 'to_upload' | 'to_live';
  },
  signal?: AbortSignal,
): Promise<TargetPage> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.staffId) qs.set('staffId', String(params.staffId));
  if (params.addedById) qs.set('addedById', String(params.addedById));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.stage) qs.set('stage', params.stage);
  if (params.page && params.page > 1) qs.set('page', String(params.page));

  const suffix = qs.toString();
  return api<TargetPage>(`/design-targets${suffix ? `?${suffix}` : ''}`, { signal });
}

/**
 * ⭐ তালিকা সম্পাদনা *(২৩ আগস্ট)* — owner · manager · গবেষক।
 *
 * ⚠️ ASIN বদলানোর পথ **নেই** — ওটা সারিটার পরিচয়; বদলালে
 * ডুপ্লিকেট-প্রহরীর ভিত্তিই নড়ে যেত। কেবল **অবস্থা** বদলানো যায়।
 */
export function updateTarget(id: number, status: TargetStatus): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/design-targets/${id}`, {
    method: 'PATCH',
    body: { status },
  });
}

/**
 * ⭐⭐ **মুছে ফেলা — সারিটা থাকে, "Deleted" হয়ে** *(২৯ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ আগে এটা সত্যিকারের `DELETE` ছিল, আর তাতে `asin` UNIQUE প্রহরীও
 * উধাও হতো — মরা ASIN কাল আবার পুলে ঢুকে বণ্টনে চলে যেত।
 */
export function deleteTarget(
  id: number,
  reason: DropReason,
): Promise<DeleteResult> {
  // ⚠️ কারণটা query-তে — বডিসহ DELETE অনেক প্রক্সি নীরবে ফেলে দেয়
  return api<DeleteResult>(`/design-targets/${id}?reason=${reason}`, {
    method: 'DELETE',
  });
}

/**
 * ⭐⭐ **বেছে নেওয়া কয়েকটা একসাথে** *(মালিকের চাওয়া, ২৯ আগস্ট)*।
 *
 * ⚠️ `POST`, `DELETE` নয় — বডিসহ `DELETE` অনেক প্রক্সি নীরবে ফেলে দেয়।
 */
export function deleteTargets(
  ids: number[],
  reason: DropReason,
): Promise<DeleteResult> {
  return api<DeleteResult>('/design-targets/delete', {
    method: 'POST',
    body: { ids, reason },
  });
}

/** ⭐ "আপলোড হয়েছে" — owner · manager · গবেষক */
export function markUploaded(id: number): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/design-targets/${id}/uploaded`, { method: 'POST' });
}

/** ⭐ "Amazon-এ লাইভ" — নতুন পণ্যের ASIN ঐচ্ছিক */
/**
 * ⭐⭐ **"বানান দেখলাম"** — `ok: false` হলে সারিটা ঠিক-করার কিউতে যায়।
 *
 * ⚠️ ডিজাইনের মালিকানা বদলায় না — কে দেখলেন, কে ঠিক করলেন, দুটোই
 * আলাদা ঘরে বসে।
 */
export function markChecked(id: number, ok: boolean): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/design-targets/${id}/checked`, {
    method: 'POST',
    body: { ok },
  });
}

/** ⭐ **"ঠিক করেছি"** — ভুল পাওয়া ডিজাইন সারিয়ে দেওয়া হয়েছে */
export function markFixed(id: number): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/design-targets/${id}/fixed`, { method: 'POST' });
}

export function markLive(id: number, liveAsin?: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/design-targets/${id}/live`, {
    method: 'POST',
    body: liveAsin ? { liveAsin } : {},
  });
}

/** ⭐ ছাঁকনির ড্রপডাউনের জন্য — যাঁদের নামে কোনো টার্গেট আছে */
export interface TargetDesigner {
  id: number;
  empCode: string;
  fullName: string;
}

export function listTargetDesigners(signal?: AbortSignal): Promise<TargetDesigner[]> {
  return api<TargetDesigner[]>('/design-targets/designers', { signal });
}

/**
 * ⭐⭐ **কে কতগুলো টার্গেট এনেছেন** *(২৫ আগস্ট ২০২৬)*।
 *
 * ⚠️ `TargetDesigner`-এর সাথে গুলিয়ে ফেলবেন না — ওখানে `id` মানে
 * `employees.id`, এখানে `users.id`। নামও আলাদা রাখা হয়েছে সেজন্যই।
 *
 * ⭐ `count` সঙ্গে আসে, তাই ড্রপডাউনেই উত্তরটা দেখা যায় — ছাঁকতে হয় না।
 */
export interface TargetAdder {
  id: number;
  fullName: string;
  role: 'owner' | 'manager' | 'researcher' | 'employee';
  count: number;
}

/**
 * ⭐ মালিক/ম্যানেজারের "শেষ ফিরিয়ে নাও" — **যেকোনো দিনের** *(২৫ আগস্ট)*।
 *
 * ⚠️ `updateTarget(id, 'assigned')` দিয়ে এটা করা যায় না: ওই পথ কেবল
 * `status` বদলায়, `completedAt` মোছে না — আর কিউগুলো ওটা ধরেই চলে।
 */
export function undoComplete(id: number): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/design-targets/${id}/undone`, { method: 'POST' });
}

export function listTargetAdders(signal?: AbortSignal): Promise<TargetAdder[]> {
  return api<TargetAdder[]>('/design-targets/adders', { signal });
}
