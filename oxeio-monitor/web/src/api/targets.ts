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
  rejected: RejectedLine[];
  poolSize: number;
}

export interface TargetStats {
  pool: number;
  assigned: number;
  done: number;
  skipped: number;
  perDesigner: number;
  /** ⭐ Amazon-এ পাঠানো হয়েছে — `done`-এর উপরে, বদলে নয় */
  uploaded: number;
  /** ⭐ বিক্রির জন্য উঠেছে */
  live: number;
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

export function skipTarget(id: number, reason?: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/me/targets/${id}/skip`, {
    method: 'POST',
    body: { reason },
  });
}

export type TargetStatus = 'pool' | 'assigned' | 'done' | 'skipped';

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
  uploadedAt: string | null;
  liveAt: string | null;
  /** ⚠️ **আমাদের নিজের** পণ্যের ASIN — উপরের `asin` নমুনার */
  liveAsin: string | null;
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
  params: { status?: TargetStatus; q?: string; page?: number },
  signal?: AbortSignal,
): Promise<TargetPage> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
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
 * ⚠️⚠️ মুছলে ডুপ্লিকেট-প্রহরী ওই ASIN **ভুলে যায়** — কাল কেউ আবার জমা
 * দিলে নতুন কাজ হিসেবে ঢুকবে। সাধারণত "Skipped" বেশি নিরাপদ।
 */
export function deleteTarget(id: number): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/design-targets/${id}`, { method: 'DELETE' });
}

/** ⭐ "আপলোড হয়েছে" — owner · manager · গবেষক */
export function markUploaded(id: number): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/design-targets/${id}/uploaded`, { method: 'POST' });
}

/** ⭐ "Amazon-এ লাইভ" — নতুন পণ্যের ASIN ঐচ্ছিক */
export function markLive(id: number, liveAsin?: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/design-targets/${id}/live`, {
    method: 'POST',
    body: liveAsin ? { liveAsin } : {},
  });
}
