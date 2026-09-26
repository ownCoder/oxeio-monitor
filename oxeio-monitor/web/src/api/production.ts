import { api } from './client';
export const QUEUES = [
  'unstarted',
  'in_progress',
  'to_check',
  'to_fix',
  'to_upload',
  'to_live',
] as const;
export type Queue = (typeof QUEUES)[number];
export const LABELS: Record<Queue, string> = {
  unstarted: 'Unstarted',
  in_progress: 'In progress',
  to_check: 'To check',
  to_fix: 'To fix',
  to_upload: 'To upload',
  to_live: 'To live',
};
export interface Card {
  id: number;
  asin: string;
  jobNumber: number | null;
  priority: number;
  dueAt: string | null;
  waitingHours: number | null;
  assignedTo: { id: number; fullName: string; empCode: string } | null;
}
export interface QueuePage {
  queue: Queue;
  total: number;
  page: number;
  pages: number;
  rows: Card[];
}
export interface Workload {
  id: number;
  fullName: string;
  empCode: string;
  dailyDesignTarget: number;
  unstarted: number;
  started: number;
  highPriority: number;
  overdue: number;
}
export interface Target {
  id: number;
  jobNumber: number | null;
  asin: string;
  status: string;
  priority: number;
  dueAt: string | null;
  assignedToId: number | null;
  startedAt: string | null;
  assignedTo: { fullName: string; empCode: string } | null;
}
export interface History {
  target: Target;
  since: string | null;
  rows: {
    id: number;
    action: string;
    actorName: string | null;
    source: string;
    recordedAt: string;
    beforeState: Record<string, unknown> | null;
    afterState: Record<string, unknown>;
  }[];
  nextBefore: number | null;
}
export interface Preview {
  id: number;
  version: number;
  filename: string;
  authorName: string;
  note: string;
  createdAt: string;
  comments: {
    id: number;
    text: string;
    authorId: number;
    authorName: string;
    x: number | null;
    y: number | null;
    resolvedAt: string | null;
  }[];
}
export interface Quality {
  reviewed: number;
  accepted: number;
  rework: number;
  firstPassRate: number | null;
  historySince: string | null;
  completeToUploadHours: number | null;
  uploadToLiveHours: number | null;
  uploadSamples: number;
  liveSamples: number;
}
export interface Sale {
  id: number;
  period: string;
  liveAsin: string;
  units: number;
  royalty: string;
  currency: string;
  targetId: number | null;
  target: {
    jobNumber: number | null;
    costs: { amount: string; currency: string; note: string }[];
  } | null;
}
export interface Sales {
  rows: Sale[];
  total: number;
  pages: number;
  currencies: { currency: string; units: number; royalty: string }[];
  imports: {
    id: number;
    name: string;
    createdAt: string;
    _count: { rows: number };
  }[];
}
export interface CsvPreview {
  alreadyImported: boolean;
  rows: {
    period: string;
    liveAsin: string;
    units: number;
    royalty: string;
    currency: string;
    targetId: number | null;
    jobNumber: number | null;
    match: string;
    duplicate: boolean;
  }[];
}
export interface Digest {
  config: { enabled: boolean; staleHours: number };
  queues: { queue: Queue; count: number }[];
  overdue: number;
  backupFailed: boolean;
  actionable: boolean;
  last: { at: string; outcome: string } | null;
}
export interface Monitor {
  uptimeConfigured: boolean;
  backupConfigured: boolean;
  digestConfigured: boolean;
  backup: {
    lastSuccessAt?: string;
    lastOutcome?: string;
    lastCopyOutcome?: string;
  } | null;
  digest: { at: string; outcome: string } | null;
  heartbeats: Record<string, string> | null;
  restoreVerification: string;
}
export function getProduction<T>(path: string, signal?: AbortSignal) {
  return api<T>(`/production/${path}`, { signal });
}
export function changeProduction<T = unknown>(
  path: string,
  body: unknown,
  method = 'POST',
) {
  return api<T>(`/production/${path}`, { method, body });
}
export function dhakaDate(value: string) {
  return new Date(new Date(value).getTime() + 21600000)
    .toISOString()
    .slice(0, 10);
}
export function stamp(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString('en-GB', {
        timeZone: 'Asia/Dhaka',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Not recorded';
}
export function age(hours: number | null) {
  return hours === null
    ? 'Age unknown'
    : hours < 24
      ? `${Math.floor(hours)}h waiting`
      : `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h waiting`;
}
