/**
 * ব্যাকআপ ও হেলথের সব **সিদ্ধান্ত** — খাঁটি ফাংশনে, কোনো I/O ছাড়া।
 *
 * এখানে কোনো `fs`, কোনো Prisma, কোনো `new Date()` নেই — সময় সবসময়
 * প্যারামিটারে আসে। কারণ এই ফাইলের প্রশ্নগুলোর ভুল উত্তরগুলো সবই **নীরব**:
 * ভুল নাম মানে ঘোরানোর নিয়ম ফাইলটাকে চিনবেই না, ভুল ঘোরানোর নিয়ম মানে
 * শেষ ভালো কপিটা মুছে যাওয়া, আর ভুল verdict মানে ব্যাকআপ ছাড়া মাসের পর মাস
 * চলা। তিনটেই ধরা পড়ে ঠিক সেদিন, যেদিন আর কিছু করার থাকে না — তাই
 * সিদ্ধান্তটুকু ডাটাবেস বা ডিস্ক থেকে আলাদা করে পরীক্ষাযোগ্য রাখা হয়েছে।
 */

import { DHAKA_OFFSET_MIN } from '../agent/util/dhaka-time';
import {
  BACKUP_CRITICAL_DAYS,
  BACKUP_EXT,
  BACKUP_KEEP_DAYS,
  BACKUP_KEEP_MIN,
  BACKUP_PART_EXT,
  BACKUP_PREFIX,
  BACKUP_SHA_EXT,
  BACKUP_STALE_HOURS,
  HEALTH_PENDING_ALERTS_MAX,
  PART_MAX_AGE_HOURS,
} from './ops.constants';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const OFFSET_MS = DHAKA_OFFSET_MIN * MINUTE_MS;

// ════════════════════════════════════════════════════════════════════════════
// ১. ব্যাকআপের নাম — ⭐ নামটাই একমাত্র মেটাডেটা
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ ফাইলের নামেই তারিখ, আর সেটাই ঘোরানোর একমাত্র সূত্র।
 *
 * `mtime` ধরে ঘোরানো যেত, কিন্তু এক্সটার্নাল ড্রাইভে কপি করলে বা ফাইল
 * পুনরুদ্ধার করলে `mtime` বদলে যায় — তখন ছয় মাসের পুরোনো ব্যাকআপকেও
 * "আজকের" মনে হতো এবং সেটা কোনোদিন ঘুরত না। নাম বদলায় না।
 *
 * ⚠️ তারিখ ঢাকার সময়ে। রাত ২:৩০-এর ডাম্প UTC-তে আগের দিন ২০:৩০ — নাম
 *    UTC ধরে বানালে ফাইলের তারিখ আর "কোন রাতের ব্যাকআপ" এক দিন সরে যেত।
 *
 * ⚠️ নামে ঘণ্টা-মিনিটও আছে। শুধু তারিখ রাখলে একই দিনে হাতে চালানো দ্বিতীয়
 *    ব্যাকআপ প্রথমটাকে চুপচাপ overwrite করত।
 */
export function backupFileName(now: Date): string {
  const s = new Date(now.getTime() + OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}` +
    `-${pad(s.getUTCHours())}${pad(s.getUTCMinutes())}`;
  return `${BACKUP_PREFIX}-${stamp}${BACKUP_EXT}`;
}

/** নামের ঠিক এই আকারটাই ব্যাকআপ বলে গোনা হয় — আর কিছু নয় */
const NAME_RE = new RegExp(
  `^${BACKUP_PREFIX}-(\\d{4})-(\\d{2})-(\\d{2})-(\\d{2})(\\d{2})` +
    `${BACKUP_EXT.replace(/\./g, '\\.')}$`,
);

/**
 * নাম → কোন মুহূর্তের ব্যাকআপ। চেনা না গেলে `null`।
 *
 * ⚠️ `null` ফেরত মানে "এটা আমাদের ফাইল নয়" — আর ঘোরানোর নিয়ম ঠিক
 *    সেগুলোকেই **ছোঁয় না**। ব্যাকআপ ফোল্ডারে মানুষের রাখা একটা
 *    `restore-note.txt` বা হাতে নেওয়া `before-migration.dump` যেন
 *    কোনোদিন এই জবের হাতে না মোছে।
 */
export function parseBackupName(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;

  const [, y, mo, d, hh, mm] = m;
  const localUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mm),
  );
  const at = new Date(localUtc - OFFSET_MS);

  // ⚠️ `2026-13-45` regex-এ পাশ করে যেত (দুই অঙ্ক), কিন্তু Date.UTC সেটাকে
  //    নীরবে পরের মাসে গড়িয়ে দিত। তখন একটা আজেবাজে নাম "ভবিষ্যতের ব্যাকআপ"
  //    হিসেবে গোনা হতো এবং চিরকাল রক্ষা পেত। তাই ফিরে মিলিয়ে দেখা হয়।
  return backupFileName(at) === name ? at : null;
}

export function isBackupFile(name: string): boolean {
  return parseBackupName(name) !== null;
}

/** অসম্পূর্ণ ডাম্প — `oxeio-….dump.enc.part` */
export function isPartFile(name: string): boolean {
  return (
    name.endsWith(BACKUP_PART_EXT) &&
    isBackupFile(name.slice(0, -BACKUP_PART_EXT.length))
  );
}

export interface BackupFile {
  name: string;
  at: Date;
}

/** চেনা ব্যাকআপগুলো, **নতুন থেকে পুরোনো** ক্রমে */
export function listBackups(names: readonly string[]): BackupFile[] {
  const files: BackupFile[] = [];
  for (const name of names) {
    const at = parseBackupName(name);
    if (at) files.push({ name, at });
  }
  return files.sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ════════════════════════════════════════════════════════════════════════════
// ২. ঘোরানোর নিয়ম — ⭐ এই ফাইলের সবচেয়ে বিপজ্জনক ফাংশন
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ কোন ব্যাকআপগুলো মুছে ফেলা যাবে।
 *
 * তিনটে পাহারা, তিনটেই আলাদা বিপদ ঠেকায়:
 *
 *  ১. **নাম না মিললে ছোঁয়াই হয় না** — ব্যাকআপ ফোল্ডারে অন্য যা-ই থাক
 *     (`README-restore.txt`, হাতে নেওয়া ডাম্প, `.sha256` সাইডকার),
 *     সেগুলো এই জবের বিষয় নয়।
 *  ২. ⭐ **সবচেয়ে নতুন কয়েকটা সবসময় থাকে** (`keepMin`) — বয়স যাই হোক।
 *     ব্যাকআপ ৪০ দিন ধরে ব্যর্থ হলে সরল বয়স-নিয়মটা শেষ ভালো কপিটাই
 *     মুছে ফেলত। ঠিক যেদিন ব্যাকআপ দরকার, সেদিন ডিস্ক ঝকঝকে খালি।
 *  ৩. বাকিদের মধ্যে শুধু `keepDays`-এর চেয়ে পুরোনোগুলো যায়।
 *
 * ⚠️ ভবিষ্যতের তারিখওয়ালা ফাইল (সার্ভারের ঘড়ি পিছিয়ে গেলে) সবচেয়ে নতুন
 *    হিসেবেই গোনা হয়, ফলে রক্ষা পায় — ভুলটা মুছে ফেলার দিকে নয়, রেখে
 *    দেওয়ার দিকে।
 */
export function backupsToDelete(
  names: readonly string[],
  now: Date,
  keepDays = BACKUP_KEEP_DAYS,
  keepMin = BACKUP_KEEP_MIN,
): string[] {
  const files = listBackups(names);
  const floor = now.getTime() - keepDays * DAY_MS;

  return files
    .slice(Math.max(0, keepMin))
    .filter((f) => f.at.getTime() < floor)
    .map((f) => f.name);
}

/**
 * অনাথ `.sha256` — যার ব্যাকআপটাই আর নেই।
 *
 * ⚠️ সাইডকারটা লেখা হয় ডাম্পের **আগে** (integrity ছাড়া ব্যাকআপ যেন এক
 *    মুহূর্তও না থাকে)। ঠিক ওই দুই rename-এর মাঝখানে প্রসেস মরে গেলে
 *    সাইডকারটা পড়ে থাকে, আর তার ব্যাকআপ কোনোদিন আসে না। ছোট ফাইল,
 *    কিন্তু বছরের পর বছর জমে ফোল্ডারটা এমন হতো যেখানে কোনটা আসল
 *    ব্যাকআপ তাই বোঝা যেত না।
 *
 * ⚠️ শুধু সেগুলোই, যাদের নামের বাকি অংশটা **আমাদের প্যাটার্নে** পড়ে।
 *    কারো নিজের রাখা `notes.sha256` এই তালিকায় কখনো আসবে না।
 */
export function orphanSidecars(names: readonly string[]): string[] {
  const present = new Set(names);

  return names.filter((name) => {
    if (!name.endsWith(BACKUP_SHA_EXT)) return false;
    const base = name.slice(0, -BACKUP_SHA_EXT.length);
    if (!isBackupFile(base)) return false;
    return !present.has(base) && !present.has(base + BACKUP_PART_EXT);
  });
}

/**
 * পড়ে থাকা অসম্পূর্ণ ডাম্প — প্রসেস মাঝপথে মরে গেলে যা থেকে যায়।
 *
 * ⚠️ এখানে `mtime` ব্যবহার করা হয়েছে, নামের তারিখ নয় — কারণ প্রশ্নটা
 *    "কোন রাতের ব্যাকআপ" নয়, "এটা কি **এখনো লেখা হচ্ছে**"। চলতি ডাম্পের
 *    ফাইলটাও `.part`, আর সেটা মুছে ফেলা মানে চলমান ব্যাকআপ নষ্ট করা।
 */
export function stalePartFiles(
  entries: readonly { name: string; mtime: Date }[],
  now: Date,
  maxAgeHours = PART_MAX_AGE_HOURS,
): string[] {
  const floor = now.getTime() - maxAgeHours * HOUR_MS;
  return entries
    .filter((e) => isPartFile(e.name) && e.mtime.getTime() < floor)
    .map((e) => e.name);
}

// ════════════════════════════════════════════════════════════════════════════
// ৩. G04 — ব্যাকআপ নিয়ে কখন কথা বলব
// ════════════════════════════════════════════════════════════════════════════

export type BackupProblem =
  /** `BACKUP_PASSPHRASE` নেই — ব্যাকআপ চলছেই না */
  | 'not_configured'
  /** শেষ চেষ্টাটা ব্যর্থ হয়েছে */
  | 'failed'
  /** কখনো একটাও সফল ব্যাকআপ হয়নি */
  | 'never'
  /** সফল হয়েছিল, কিন্তু অনেক আগে — জবটা আর চলছে না */
  | 'stale'
  /** ডাম্প হয়েছে, কিন্তু এক্সটার্নাল ড্রাইভে কপি হয়নি (K03) */
  | 'copy_failed';

export interface BackupState {
  /** `BACKUP_PASSPHRASE` আছে কি না — না থাকলে ⭐ ব্যাকআপ চালানোই হয় না */
  configured: boolean;
  lastAttemptAt: Date | null;
  lastOutcome: 'ok' | 'failed' | null;
  lastSuccessAt: Date | null;
  /** টানা কতবার ব্যর্থ — সফল হলেই ০ */
  consecutiveFailures: number;
  /** K03 — শেষ কপির ফল। `null` = কপি কনফিগারই করা হয়নি */
  lastCopyOutcome: 'ok' | 'failed' | null;
  /**
   * কবে থেকে আমরা দেখছি (সার্ভার বুট বা প্রথম রেকর্ড)।
   *
   * ⚠️ এটা ছাড়া সদ্য ইনস্টল করা সার্ভার প্রথম মিনিটেই "ব্যাকআপ হয়নি" বলে
   *    চেঁচাত — অথচ প্রথম ব্যাকআপের সময়ই তখনো আসেনি।
   */
  observedSince: Date | null;
}

export interface BackupVerdict {
  problem: BackupProblem;
  severity: 'warning' | 'critical';
  hoursSinceSuccess: number | null;
  daysSinceSuccess: number | null;
}

/**
 * ⭐ **সফল হলে কিছুই বলে না** — `null` ফেরত।
 *
 * এটাই G04-এর মূল কথা। "ব্যাকআপ হয়েছে" রোজ জানালে ওই মেইলটা এক সপ্তাহেই
 * ফিল্টারে চলে যায়, আর তার সাথে যেদিন **হয়নি** সেই বার্তাটাও। নীরবতা
 * এখানে ইতিবাচক খবর, আর সেই নীরবতাই খবরটাকে মূল্য দেয়।
 *
 * severity বাড়ে দুই দিনে (`criticalDays`) — কারণ একরাতের ব্যর্থতা প্রায়ই
 * সাময়িক (ড্রাইভ খোলা ছিল না, ডিস্ক ভরা), কিন্তু টানা দুই রাত মানে কেউ
 * দেখেইনি, আর তখন প্রতিটা দিন পুনরুদ্ধারযোগ্য অতীতকে আরেকদিন পিছিয়ে দেয়।
 */
export function backupVerdict(
  state: BackupState,
  now: Date,
  staleHours = BACKUP_STALE_HOURS,
  criticalDays = BACKUP_CRITICAL_DAYS,
): BackupVerdict | null {
  const sinceSuccessMs = state.lastSuccessAt
    ? now.getTime() - state.lastSuccessAt.getTime()
    : null;
  const hoursSinceSuccess =
    sinceSuccessMs === null ? null : Math.floor(sinceSuccessMs / HOUR_MS);
  const daysSinceSuccess =
    sinceSuccessMs === null ? null : Math.floor(sinceSuccessMs / DAY_MS);

  const stale = sinceSuccessMs === null || sinceSuccessMs >= staleHours * HOUR_MS;

  // ⚠️ `consecutiveFailures` সরাসরি দিনের সাথে তুলনা করা হচ্ছে — জবটা দিনে
  //    একবারই চলে বলে "টানা ২ বার ব্যর্থ" ≈ "টানা ২ দিন"। কেউ হাতে বারবার
  //    চালিয়ে গেলে গোনাটা দ্রুত বাড়ত, কিন্তু তখন severity বাড়াই কাম্য —
  //    ভুলটা চেঁচানোর দিকে, চুপ থাকার দিকে নয়।
  const escalated =
    state.consecutiveFailures >= criticalDays ||
    (sinceSuccessMs !== null && sinceSuccessMs >= criticalDays * DAY_MS) ||
    // কখনো সফল হয়নি, অথচ আমরা দেখছি দুদিনের বেশি — এটাও গুরুতর
    (state.lastSuccessAt === null &&
      state.observedSince !== null &&
      now.getTime() - state.observedSince.getTime() >= criticalDays * DAY_MS);

  const withSeverity = (problem: BackupProblem): BackupVerdict => ({
    problem,
    severity: escalated ? 'critical' : 'warning',
    hoursSinceSuccess,
    daysSinceSuccess,
  });

  // ⭐ কনফিগই নেই — সবচেয়ে জোরে বলার মতো অবস্থা, কারণ এখানে কিছু "ব্যর্থ"
  //    হয়নি; ব্যাকআপ ব্যাপারটাই ঘটছে না, আর সেটা নীরবে ঘটছে।
  if (!state.configured) return withSeverity('not_configured');

  if (state.lastOutcome === 'failed') return withSeverity('failed');

  if (state.lastSuccessAt === null) {
    // এখনো কিছুই ঘটেনি, আর দেখাও শুরু হয়েছে সবে — চুপ থাকাই ঠিক
    if (
      state.lastAttemptAt === null &&
      (state.observedSince === null ||
        now.getTime() - state.observedSince.getTime() < staleHours * HOUR_MS)
    ) {
      return null;
    }
    return withSeverity('never');
  }

  if (stale) return withSeverity('stale');

  // ⚠️ ডাম্প ঠিকঠাক, কিন্তু এক্সটার্নাল ড্রাইভে যায়নি — এটাও ব্যর্থতা।
  //    একই ডিস্কে পড়ে থাকা ব্যাকআপ ওই ডিস্কটা মরে গেলে কোনো কাজেই আসে না,
  //    অথচ ড্যাশবোর্ডে "ব্যাকআপ ঠিক আছে" দেখাত।
  if (state.lastCopyOutcome === 'failed') {
    return { ...withSeverity('copy_failed'), severity: 'warning' };
  }

  return null;
}

/** অ্যালার্টের শিরোনাম ও বিস্তারিত — ⚠️ কোনো পাথ, পাসফ্রেজ বা হোস্ট নয় */
export function backupAlertText(verdict: BackupVerdict): {
  title: string;
  detail: string;
} {
  const age =
    verdict.daysSinceSuccess === null
      ? 'কখনো একটাও সফল ব্যাকআপ হয়নি'
      : `শেষ সফল ব্যাকআপ ${verdict.daysSinceSuccess} দিন ${(verdict.hoursSinceSuccess ?? 0) % 24} ঘণ্টা আগে`;

  switch (verdict.problem) {
    case 'not_configured':
      return {
        title: 'ব্যাকআপ চলছে না — BACKUP_PASSPHRASE বসানো হয়নি',
        detail:
          'এনক্রিপশনের পাসফ্রেজ না থাকায় রাতের ব্যাকআপ চালানোই হচ্ছে না। ' +
          'বেতন ও স্ক্রিনশটের ডাটাবেস প্লেইনটেক্সটে ডিস্কে ফেলে রাখার চেয়ে ' +
          'ব্যাকআপ বন্ধ থাকা ভালো — কিন্তু সেটা জেনে রাখা দরকার। ' +
          '`.env`-এ BACKUP_PASSPHRASE বসিয়ে সার্ভার রিস্টার্ট করুন।',
      };
    case 'failed':
      return {
        title: 'রাতের ব্যাকআপ ব্যর্থ হয়েছে',
        detail: `${age}। সার্ভারের লগে ops/backup দেখুন — pg_dump পাওয়া যাচ্ছে কি না, ডিস্কে জায়গা আছে কি না।`,
      };
    case 'never':
      return {
        title: 'একটাও ব্যাকআপ হয়নি',
        detail:
          'ব্যাকআপ জব চালু আছে, কিন্তু আজ পর্যন্ত একটাও সফল ডাম্প তৈরি হয়নি। ' +
          'সার্ভারের লগে ops/backup দেখুন।',
      };
    case 'stale':
      return {
        title: 'ব্যাকআপ থেমে গেছে',
        detail: `${age}। জবটা আদৌ চলছে কি না দেখুন — সার্ভার রাত ২:৩০-এ চালু ছিল তো?`,
      };
    case 'copy_failed':
      return {
        title: 'ব্যাকআপ এক্সটার্নাল ড্রাইভে কপি হয়নি',
        detail:
          'ডাম্প তৈরি হয়েছে, কিন্তু BACKUP_COPY_TO-এর ড্রাইভে কপি করা যায়নি। ' +
          'ড্রাইভটা লাগানো আছে কি না, আর তাতে জায়গা আছে কি না দেখুন। ' +
          'একই ডিস্কে পড়ে থাকা ব্যাকআপ ওই ডিস্ক নষ্ট হলে কোনো কাজে আসবে না।',
      };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ৪. K04 — সার্ভার হেলথের verdict
// ════════════════════════════════════════════════════════════════════════════

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthFacts {
  dbUp: boolean;
  /** `null` = ডিস্কের তথ্য পড়া যায়নি */
  diskUsedPct: number | null;
  /** ⭐ G04-এর ঠিক **একই** verdict — দুই জায়গায় দুরকম হিসাব হতে পারে না */
  backup: BackupVerdict | null;
  activeDevices: number;
  silentDevices: number;
  /** এখনো কোনো চ্যানেলে যায়নি এমন অ্যালার্ট */
  pendingAlerts: number;
}

export interface HealthVerdict {
  status: HealthStatus;
  /** মানুষের পড়ার মতো সমস্যার তালিকা — খালি মানে সব ঠিক */
  problems: string[];
}

/**
 * ⭐ "চুপ থাকা ডিভাইস" কখনোই status খারাপ করে না — শুধু গোনা হয়।
 *
 * সন্ধ্যা ৭টায় সবার PC বন্ধ, অর্থাৎ পনেরোটার মধ্যে পনেরোটাই চুপ। সেটাকে
 * "degraded" বললে হেলথ পাতাটা প্রতিদিন সন্ধ্যা থেকে সকাল পর্যন্ত লাল
 * থাকত — আর যে জিনিস অর্ধেক সময় লাল, সেটা কেউ আর দেখে না। কোন নীরবতাটা
 * আসলে খবর সেটা G01 (`isExpectedSilence`) ইতিমধ্যেই ঠিক করে; এখানে
 * তার একটা বোকা সংস্করণ বসানো মানে দুটো উত্তর, দুটোই অবিশ্বাস্য।
 */
export function healthVerdict(facts: HealthFacts): HealthVerdict {
  const problems: string[] = [];

  if (!facts.dbUp) {
    return { status: 'down', problems: ['ডাটাবেসে সংযোগ নেই'] };
  }

  if (facts.diskUsedPct === null) {
    problems.push('ডিস্কের তথ্য পড়া যায়নি');
  } else if (facts.diskUsedPct >= 95) {
    problems.push(
      `ডিস্ক ${Math.round(facts.diskUsedPct)}% ভরেছে — স্ক্রিনশট ইনজেস্ট যেকোনো সময় আটকে যাবে`,
    );
  } else if (facts.diskUsedPct >= 80) {
    problems.push(`ডিস্ক ${Math.round(facts.diskUsedPct)}% ভরেছে`);
  }

  if (facts.backup) {
    problems.push(backupAlertText(facts.backup).title);
  }

  if (facts.pendingAlerts > HEALTH_PENDING_ALERTS_MAX) {
    problems.push(
      `${facts.pendingAlerts}টি অ্যালার্ট পাঠানোর অপেক্ষায় — dispatcher আটকে আছে?`,
    );
  }

  return { status: problems.length === 0 ? 'ok' : 'degraded', problems };
}

// ════════════════════════════════════════════════════════════════════════════
// ৫. G08 — টেলিগ্রামে কতটুকু যাবে
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ টেলিগ্রামের বার্তা **allowlist** দিয়ে বানানো হয়, denylist দিয়ে নয়।
 *
 * টেলিগ্রাম একটা বাইরের সেবা — বার্তাটা Telegram-এর সার্ভারে জমা থাকে, আর
 * গ্রুপে যে-কেউ থাকতে পারে। তাই অ্যালার্টের `title`/`detail` **কখনোই**
 * হুবহু পাঠানো হয় না; ওগুলো ফ্রি-টেক্সট, আর ভবিষ্যতে কেউ একটা নতুন
 * অ্যালার্টে ডোমেইন, উইন্ডোর শিরোনাম বা টাকার অঙ্ক ঢোকালে denylist সেটা
 * চিনত না — আর ফাঁসটা নীরবে ঘটত, প্রতিদিন।
 *
 * এখানে যা যায়: **টাইপের বাংলা লেবেল · হোস্টনেম · কখন**। ব্যস।
 * কর্মীর নাম যায় না, কারণ "কে কী করেনি" কখনোই বাইরের চ্যানেলের বিষয় নয়।
 */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  agent_down: 'এজেন্ট চুপ',
  agent_killed: 'এজেন্ট বন্ধ বা আনইনস্টল হয়েছে',
  disk_warning: 'সার্ভারের ডিস্ক ভরে আসছে',
  disk_critical: 'সার্ভারের ডিস্ক প্রায় ভরা',
  backup_failed: 'ব্যাকআপ ব্যর্থ',
  clock_drift: 'এজেন্টের ঘড়ি সরে গেছে',
  no_activity_today: 'একজনের সারাদিনে কোনো কাজ নেই',
  device_overlap: 'একই ডিভাইসে একাধিক কর্মী',
};

/**
 * হোস্টনেম ছেঁকে নেওয়া।
 *
 * ⚠️ শুধু `A–Z a–z 0–9 . _ -` রাখা হয়, আর ৩২ অক্ষরে কাটা। হোস্টনেমের
 *    কলামটা যেকোনো স্ট্রিং নিতে পারে — এজেন্ট যা পাঠায় তাই বসে। কেউ
 *    হোস্টনেমে বাঁকা কিছু বসালে সেটা যেন সরাসরি বাইরে না যায়।
 */
export function safeHostname(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32);
  return cleaned.length > 0 ? cleaned : null;
}

export interface TelegramAlertFacts {
  type: string;
  severity: string;
  hostname?: string | null;
  createdAt: Date;
}

/** একটা অ্যালার্টের এক লাইন — ⚠️ title/detail এখানে ঢোকে না, ইচ্ছাকৃতভাবে */
export function telegramLine(alert: TelegramAlertFacts, now: Date): string {
  const label = TYPE_LABELS[alert.type] ?? 'অ্যালার্ট';
  const mark = alert.severity === 'critical' ? '🔴' : '🟡';
  const host = safeHostname(alert.hostname);
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - alert.createdAt.getTime()) / MINUTE_MS),
  );
  const when = minutes < 1 ? 'এইমাত্র' : `${minutes} মিনিট আগে`;

  return `${mark} ${label}${host ? ` — ${host}` : ''} · ${when}`;
}

/**
 * পুরো বার্তা। ⚠️ `parse_mode` ছাড়া প্লেইন টেক্সট হিসেবেই পাঠানো হয় —
 * Markdown/HTML দিলে হোস্টনেমের একটা `_` বা `<` গোটা বার্তাটা Telegram-এর
 * পার্সারে ভেঙে দিত (400), অর্থাৎ ঠিক যে অ্যালার্টটা জরুরি সেটাই যেত না।
 */
export function telegramMessage(
  alerts: readonly TelegramAlertFacts[],
  now: Date,
): string {
  const header =
    alerts.length === 1
      ? 'oXeio মনিটরিং'
      : `oXeio মনিটরিং — ${alerts.length}টি অ্যালার্ট`;

  return [header, '', ...alerts.map((a) => telegramLine(a, now))].join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// ৬. DATABASE_URL ভাঙা — pg_dump-কে যা যা দিতে হয়
// ════════════════════════════════════════════════════════════════════════════

export interface PgConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/**
 * `postgresql://user:pass@host:5432/db?schema=public` → pg_dump-এর অংশগুলো।
 *
 * ⚠️ ইউজারনেম ও পাসওয়ার্ড **ডিকোড** করা হয়। `URL` ওগুলো percent-encoded
 *    অবস্থায় ফেরত দেয়, তাই `p@ss` লেখা থাকে `p%40ss` হিসেবে। ডিকোড না
 *    করলে pg_dump ভুল পাসওয়ার্ড পাঠাত আর ব্যাকআপ প্রতি রাতে
 *    "authentication failed" বলে ব্যর্থ হতো — অথচ অ্যাপ নিজে দিব্যি চলত,
 *    কারণ Prisma ডিকোডটা করে। কারণ খুঁজে পাওয়া কঠিন এমন ব্যর্থতা।
 */
export function parsePgUrl(raw: string | undefined | null): PgConnection | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return null;
  }

  const database = decode(url.pathname.replace(/^\//, ''));
  if (!database) return null;

  return {
    // ⚠️ `hostname`, `host` নয় — `host` পোর্টসহ আসে, আর IPv6-এ `[::1]`
    //    বন্ধনী সমেত। pg_dump-এর `-h` দুটোরই কোনোটা চায় না।
    host: url.hostname || 'localhost',
    port: url.port || '5432',
    user: decode(url.username) || 'postgres',
    password: decode(url.password),
    database,
  };
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // অবৈধ `%` সিকোয়েন্স — যা আছে তাই ফেরত, নইলে পুরো ব্যাকআপ আটকে যেত
    return value;
  }
}
