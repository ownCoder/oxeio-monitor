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
}

export interface MyTarget {
  id: number;
  asin: string;
  /** ⭐ সার্ভার ASIN থেকে বানিয়ে পাঠায় — ওয়েব জোড়া লাগায় না */
  url: string;
  jobNumber: number | null;
  assignedAt: string | null;
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

export function skipTarget(id: number, reason?: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/me/targets/${id}/skip`, {
    method: 'POST',
    body: { reason },
  });
}
