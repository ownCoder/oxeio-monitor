/**
 * ডিজাইন "শেষ" হলে টেলিগ্রামে একটা নোটিশ যাবে কি না — খাঁটি নিয়ম।
 *
 * পাঠানোর কাজ এখানে নেই। এখানে শুধু: কোন ঘটনায় বার্তা, কোন ঘটনায় নয়,
 * আর বার্তার লেখা।
 */

/** `.env`-এর নাম। খালি বা না-থাকা মানে চালু। */
export const DESIGN_DONE_TELEGRAM_ENV = 'DESIGN_DONE_TELEGRAM';

/**
 * `settings` টেবিলের চাবি। সারি থাকলে এবং `enabled` বুলিয়ান হলে সেটা
 * `.env`-এর উপর জিতে — টেলিগ্রামের বট সেটিংসের মতোই।
 */
export const DESIGN_DONE_TELEGRAM_SETTING_KEY = 'telegram.design_done';

const CYCLE_RESET = new Set(['added', 'assigned', 'returned']);

export type DesignNotice = 'done' | 'undone' | 'none';

/**
 * চালু কি না।
 *
 * ডাটাবেসে স্পষ্ট `enabled` থাকলে সেটাই। না থাকলে env। env খালি, `true`,
 * `1`, `yes`, `on` — বা চেনা না এমন কিছু — চালু। `false` / `0` / `no` /
 * `off` বন্ধ। ডিফল্ট চালু, যাতে নতুন ফ্ল্যাগ বসানো ভুলে নোটিশ চুপ না থাকে।
 */
export function designDoneTelegramEnabled(
  envValue: string | undefined | null,
  stored: unknown,
): boolean {
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const enabled = (stored as { enabled?: unknown }).enabled;
    if (typeof enabled === 'boolean') return enabled;
  }
  return envDefaultsOn(envValue);
}

export function envDefaultsOn(value: string | undefined | null): boolean {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off')
    return false;
  return true;
}

/** env-এর মান চেনা কি না। চেনা না হলেও চালু থাকে, কিন্তু লগে একবার বলা যায়। */
export function designDoneEnvRecognized(
  value: string | undefined | null,
): boolean {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw === '') return true;
  return (
    raw === '0' ||
    raw === '1' ||
    raw === 'false' ||
    raw === 'true' ||
    raw === 'no' ||
    raw === 'yes' ||
    raw === 'off' ||
    raw === 'on'
  );
}

/**
 * ইতিহাসের **শেষ** ঘটনাটা নোটিশের যোগ্য কি না।
 *
 * `completed` শুধু এই বণ্টন-চক্রের **প্রথম** শেষে। Undo করে আবার Done
 * চাপলে দ্বিতীয় `completed` আসে — সেটাতে আর "শেষ" বার্তা যায় না।
 * অন্য ঘটনা (started, updated, skipped, checked…) কিছুই পাঠায় না।
 * Undo (`undone`) শুধু তখন, যখন এই চক্রে একটাই শেষ হয়েছিল — ছোট একটা
 * "আবার খোলা" নোট। দ্বিতীয়বার খুললে নোটও যায় না।
 *
 * চক্র ভাঙে `added` / `assigned` / `returned`-এ। পুলে ফিরে নতুন করে
 * বণ্টন হলে পরের শেষটা আবার প্রথম, তাই নোটিশ যায়।
 */
export function noticeForLatest(actions: readonly string[]): DesignNotice {
  const latest = actions[actions.length - 1];
  if (latest !== 'completed' && latest !== 'undone') return 'none';
  const completed = currentCycle(actions).filter(
    (action) => action === 'completed',
  ).length;
  if (latest === 'completed') return completed === 1 ? 'done' : 'none';
  return completed === 1 ? 'undone' : 'none';
}

function currentCycle(actions: readonly string[]): string[] {
  let start = 0;
  for (let i = 0; i < actions.length; i++) {
    if (CYCLE_RESET.has(actions[i])) start = i + 1;
  }
  return actions.slice(start);
}

export interface DesignNoticeFacts {
  /** যাঁর হাতে ডিজাইনটা ছিল */
  designerName: string;
  /** যিনি Done/Undo চেপেছেন — আলাদা হলে বার্তায় আলাদা লাইন */
  markedByName: string | null;
  asin: string;
  jobNumber: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Undo-এর সময়, বা completedAt না থাকলে শেষের সময় */
  at: Date;
}

export function designDoneMessage(facts: DesignNoticeFacts): string {
  const lines = [
    'oXeio Monitoring',
    '',
    '✅ ডিজাইন শেষ',
    `ডিজাইনার: ${shownDesigner(facts)}`,
    `ডিজাইন: ${designLabel(facts.jobNumber, facts.asin)}`,
  ];
  const taken = formatTimeTaken(facts.startedAt, facts.completedAt);
  if (taken) lines.push(`সময় লেগেছে: ${taken}`);
  lines.push(`শেষ হয়েছে: ${formatDhaka(facts.completedAt ?? facts.at)}`);
  const marker = differentMarker(facts);
  if (marker) lines.push(`চিহ্ন দিয়েছেন: ${marker}`);
  return lines.join('\n');
}

export function designUndoneMessage(facts: DesignNoticeFacts): string {
  const lines = [
    'oXeio Monitoring',
    '',
    '↩️ ডিজাইন আবার খোলা',
    `ডিজাইনার: ${shownDesigner(facts)}`,
    `ডিজাইন: ${designLabel(facts.jobNumber, facts.asin)}`,
    `খোলা হয়েছে: ${formatDhaka(facts.at)}`,
  ];
  const marker = differentMarker(facts);
  if (marker) lines.push(`খুলেছেন: ${marker}`);
  return lines.join('\n');
}

export function formatTimeTaken(
  startedAt: Date | null,
  completedAt: Date | null,
): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = completedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '1m-এর কম';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
}

export function formatDhaka(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return `${parts} (ঢাকা)`;
}

function shownDesigner(facts: DesignNoticeFacts): string {
  return (
    oneLine(facts.designerName, 80) ||
    oneLine(facts.markedByName ?? '', 80) ||
    'অজানা'
  );
}

function differentMarker(facts: DesignNoticeFacts): string | null {
  const designer = oneLine(facts.designerName, 80);
  const marker = oneLine(facts.markedByName ?? '', 80);
  if (!designer || !marker || designer === marker) return null;
  return marker;
}

export function designLabel(jobNumber: number | null, asin: string): string {
  const cleanAsin = oneLine(asin, 16);
  if (jobNumber !== null && Number.isInteger(jobNumber))
    return `#${jobNumber} · ${cleanAsin}`;
  return cleanAsin;
}

function oneLine(value: string, max: number): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}
