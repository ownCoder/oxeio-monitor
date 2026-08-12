import { api } from './client';

/**
 * **B14 · ADR-011e** — সিস্টেমের দোষে হারানো ঘণ্টা owner ফেরত দেন।
 *
 * ⚠️ এটা কোনো **অনুমোদন ব্যবস্থা নয়**। স্টাফ কিছু দাবি করে না, কোথাও
 * কিছু চাপে না — owner নিজে দেখে ঠিক করেন। একবার "claim" চালু হলে সেটা
 * পুরো approval workflow টেনে আনত, যেটা এই সিস্টেমে ইচ্ছাকৃতভাবে নেই
 * (§ ৪ · ADR-011d)।
 */
export interface AdjustmentView {
  /** ⚠️ স্ট্রিং — সার্ভারে `BigInt`, JSON-এ সংখ্যা হিসেবে পাঠালে ভাঙত */
  id: string;
  employeeId: number;
  workDate: string;
  /** + = ঘণ্টা ফেরত · − = কেটে নেওয়া */
  deltaSec: number;
  cause: AdjustmentCause;
  reason: string;
  beyondEvidence: boolean;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  /** বাতিল হলে আর গোনা হয় না */
  active: boolean;
}

export type AdjustmentCause =
  | 'agent_down'
  | 'server_down'
  | 'agent_crash'
  | 'pc_replaced'
  | 'data_loss'
  | 'other';

/**
 * ⚠️ লেখাগুলো স্টাফও পড়ে (J08), তাই কারিগরি নয় — "agent_crash"-এর বদলে
 * "The agent crashed"। কারণটা তার নিজের ঘণ্টার ব্যাখ্যা।
 */
export const CAUSE_LABELS: Record<AdjustmentCause, string> = {
  agent_down: 'The agent was not running',
  server_down: 'The server was unreachable',
  agent_crash: 'The agent crashed',
  pc_replaced: 'The PC was replaced',
  data_loss: 'Data was lost',
  other: 'Something else',
};

export function listAdjustments(
  employeeId: number,
  signal?: AbortSignal,
): Promise<AdjustmentView[]> {
  return api<AdjustmentView[]>(`/employees/${employeeId}/time-adjustments`, {
    signal,
  });
}

export function createAdjustment(
  employeeId: number,
  body: {
    workDate: string;
    deltaSec: number;
    cause: AdjustmentCause;
    reason: string;
    beyondEvidence?: boolean;
  },
): Promise<AdjustmentView> {
  return api<AdjustmentView>(`/employees/${employeeId}/time-adjustments`, {
    method: 'POST',
    body,
  });
}

/** ⚠️ ডিলিট নয় — সারিটা থেকে যায়, শুধু গোনা বন্ধ হয়। */
export function revokeAdjustment(
  id: string,
  reason: string,
): Promise<AdjustmentView> {
  return api<AdjustmentView>(`/time-adjustments/${id}/revoke`, {
    method: 'POST',
    body: { reason },
  });
}
