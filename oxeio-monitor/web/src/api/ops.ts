import { api } from './client';

/**
 * **K02 · K04** — সার্ভারের হেলথ ও হাতে চালানো জব।
 *
 * সার্ভারের উৎস: `server/src/ops/ops.health.service.ts` ও `ops.controller.ts`।
 *
 * ⚠️ পুরোটাই **owner-only**, ক্লাস-লেভেলে। উত্তরে ডিস্কের আকার, ব্যাকআপের
 * ইতিহাস আর কতগুলো ডিভাইস চুপ — একসাথে এগুলো দিয়ে অফিসের অবকাঠামোর ছবি
 * আঁকা যায়, তাই ম্যানেজারও এখানে ঢোকেন না।
 *
 * ⚠️ এটা `GET /health`-এর সাথে **গুলিয়ে ফেলবেন না** — ওটা পাবলিক
 * liveness (Docker healthcheck ও Live Board ওটার উপরেই দাঁড়ানো)।
 */

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface OpsHealth {
  status: HealthStatus;
  /** খালি অ্যারে = সব ঠিক */
  problems: string[];
  checkedAt: string;
  uptimeSec: number;

  db: { up: boolean; latencyMs: number | null };

  disk: {
    path: string;
    usedPct: number | null;
    freeBytes: number | null;
    totalBytes: number | null;
    free: string | null;
    total: string | null;
  };

  backup: {
    configured: boolean;
    copyConfigured: boolean;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastOutcome: 'ok' | 'failed' | null;
    lastError: string | null;
    lastSize: string | null;
    consecutiveFailures: number;
    hoursSinceSuccess: number | null;
    copyOutcome: 'ok' | 'failed' | null;
    copyError: string | null;
    /**
     * ⭐ G04 যে verdict দেখে অ্যালার্ট করে, হুবহু সেটাই। `null` = সব ঠিক।
     *
     * ⚠️ "সফল হলে কিছুই বলে না" — নীরবতাই এখানে ইতিবাচক খবর, আর সেই
     * নীরবতাই খবরটাকে মূল্য দেয় (`ops.rules.ts` § G04)।
     */
    problem: 'not_configured' | 'failed' | 'never' | 'stale' | null;
  };

  devices: {
    active: number;
    /** ⚠️ শুধু গোনা — রাতে সবাই চুপ থাকাই স্বাভাবিক, তাই status খারাপ হয় না */
    silent: number;
    silenceThresholdMin: number;
  };

  queue: {
    pendingAlerts: number;
    openAlerts: number;
    screenshotsAwaitingPurge: number;
  };
}

export function getOpsHealth(signal?: AbortSignal): Promise<OpsHealth> {
  return api<OpsHealth>('/ops/health', { signal });
}

/** ⚠️ উত্তরে কোনো ফাইল-পাথ বা পাসফ্রেজ আসে না, ইচ্ছাকৃতভাবে */
export interface ManualBackupResult {
  ok: boolean;
  skipped: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  durationMs: number;
  error: string | null;
  copy: { configured: boolean; ok: boolean; error: string | null };
  rotated: number;
}

/**
 * ⭐ থাকার কারণ: যে ব্যাকআপ কখনো পরীক্ষা করা হয়নি সেটা ব্যাকআপ নয়,
 * অনুমান। রাত ২:৩০ পর্যন্ত অপেক্ষা না করে ইনস্টলের দিনই যাচাই করা যায়।
 */
export function runBackupNow(): Promise<ManualBackupResult> {
  return api<ManualBackupResult>('/ops/backup/run', { method: 'POST' });
}

export interface RetentionResult {
  cutoff: string | null;
  marked: number;
  filesDeleted: number;
  filesMissing: number;
  rowsDeleted: number;
  failed: number;
  unsafePaths: number;
  skipped: boolean;
}

/**
 * ⭐ K01 — নীতিমালায় স্টাফকে লিখিতভাবে বলা আছে "৯০ দিন পর ছবি নিজে
 * থেকেই মুছে যাবে"। রাতের cron আছে, কিন্তু চোখে দেখা না গেলে সেটা
 * প্রতিশ্রুতি, ব্যবস্থা নয়।
 */
export function runRetentionNow(): Promise<RetentionResult> {
  return api<RetentionResult>('/ops/retention/run', { method: 'POST' });
}
