import type { AgentVersionView, DeviceView } from '../../api/admin';

/**
 * **ফ্লিটের ভার্সন — কে কোথায় দাঁড়িয়ে।**
 *
 * ⚠️⚠️ **কেন এটা দরকার হলো — মাঠের প্রশ্ন, ১৮ আগস্ট।** মালিক জানতে
 * চাইলেন *"kon staff er pc te kon ver er agent"* — আর উত্তরটা পর্দার
 * **কোথাও ছিল না**। `GET /api/v1/devices` রুটটা সবই ফেরায়, ওয়েবে
 * `DeviceView` টাইপটাও লেখা ছিল, কিন্তু ওই রুট কেউ কোনোদিন ডাকেনি —
 * *চুক্তি লেখা আছে, কলার লেখা হয়নি*-র আরেকটা রূপ।
 *
 * ⚠️ **নতুন "Devices" পর্দা নয়** (G89 — মালিক নিজেই ওটা তুলে দিতে
 * বলেছিলেন)। এই তালিকা বসে **Agent updates**-এর ভেতরে, যার নিজের
 * বর্ণনাই লেখা *"Which build each PC is offered"*।
 *
 * ⭐ সিদ্ধান্তগুলো এখানে, খাঁটি ও টেস্টযোগ্য — বিশেষ করে ভার্সন তুলনা,
 * যেটা স্ট্রিং হিসেবে করলে **০.৪.১০ < ০.৪.৯** হয়ে যেত।
 */

/**
 * ⭐⭐ **০.৪.১-এর আগের এজেন্ট নিজে থেকে আপডেট নিতে পারে না।**
 *
 * ⚠️⚠️ ট্রে-তে "Install update" মেনুটা এসেছে **০.৪.১-এ**
 * ([09 § ৩ভ৯](../../../../docs/09-Build-Log.md)); ০.৩.৭-এর `UpdateStager`
 * MSI নামায় ঠিকই, কিন্তু `msiexec` চালানোর কোনো পথ নেই। মানে ওই PC-গুলোয়
 * রোলআউট `all` করলেও কিচ্ছু ঘটে না — ফাইলটা নেমে পড়ে থাকে, আর কেউ জানে
 * না। ⭐ তাই ওদের আলাদা করে দেখানো হয়: ওখানে **হাতে বসানো ছাড়া উপায় নেই**।
 */
export const TRAY_UPDATE_MIN = '0.4.1';

/**
 * এতক্ষণ চুপ থাকলে সারিতে চিহ্ন বসে।
 *
 * ⚠️ এটা `agent_down` অ্যালার্টের **প্রতিদ্বন্দ্বী নয়** — ওটা ১০ মিনিটে
 * বাজে, আর ওটাই "এখন ডাউন কি না" প্রশ্নের মালিক। এখানকার প্রশ্ন আলাদা:
 * *"এই PC-র ভার্সনটা কি আদৌ তাজা খবর?"* একটা চালু এজেন্ট প্রতি ৫ মিনিটে
 * সাড়া দেয়, তাই **পুরো একটা দিন** চুপ মানে মেশিনটা বন্ধ বা ভাঙা — আর
 * ২৪ ঘণ্টা বাছা হয়েছে যাতে **সারারাত বন্ধ থাকা কখনো এতে না পড়ে**
 * (সন্ধ্যা ৬টা → সকাল ৯টা = ১৫ ঘণ্টা)।
 */
export const QUIET_HOURS = 24;

/**
 * ⭐ সার্ভারের `isNewer()`-এর হুবহু নকল (`server/src/agent/rollout.ts`)।
 *
 * ⚠️⚠️ **স্ট্রিং তুলনা এখানে ভুল**, আর ভুলটা নীরব: `'0.4.10' < '0.4.9'`
 * বর্ণক্রমে সত্যি। আজ কোনো ক্ষতি হতো না (এখনো ০.৪.৯), কিন্তু পরের
 * রিলিজেই গোটা পর্দাটা উল্টো বলত — সবচেয়ে নতুন বিল্ডটাকে "পিছিয়ে"
 * দেখাত।
 *
 * ⚠️ দুই জায়গায় দু-রকম হলে সার্ভার যাকে আপডেট অফার করত, পর্দা তাকেই
 * "up to date" বলত — তাই নিয়মটা এক রাখা হয়েছে, কপি করেই।
 */
export function compareVersion(a: string, b: string): number {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0);
  const y = b.split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }

  return 0;
}

/**
 * ⭐⭐ **কোন বিল্ডটা "সবচেয়ে নতুন" — সার্ভার যেভাবে বাছে, ঠিক সেভাবেই।**
 *
 * ⚠️⚠️ `UpdateService.offerFor` বাছে **প্রকাশের সময় ধরে** (`releasedAt
 * desc`), ভার্সন নম্বর ধরে নয় — আর `halted` বাদ দিয়ে। এখানে ভার্সন নম্বর
 * ধরে বাছলে দুটো আলাদা "নতুন" জন্মাত: পর্দা একটাকে লক্ষ্য বলত, সার্ভার
 * আরেকটা বিলি করত। তাই তালিকাটা যে ক্রমে আসে (API-ও `releasedAt desc`)
 * সেই ক্রমেই প্রথম non-halted সারিটা নেওয়া হয়।
 *
 * ⚠️ সব ভার্সন halted থাকলে `null` — তখন কেউ "পিছিয়ে" নয়, কারণ
 * এগোনোর জায়গাই নেই।
 */
export function newestOffered(versions: readonly AgentVersionView[]): string | null {
  return versions.find((v) => v.rolloutStage !== 'halted')?.version ?? null;
}

/**
 * একটা PC লক্ষ্যের তুলনায় কোথায়।
 *
 * - `newest` — লক্ষ্যেই আছে
 * - `behind` — পিছিয়ে, কিন্তু **নিজে থেকেই** আপডেট নিতে পারবে
 * - `stranded` — এত পুরোনো যে ট্রে-তে আপডেটের মেনুই নেই; হাতে বসাতে হবে
 * - `unknown` — এজেন্ট কখনো নিজের ভার্সন বলেনি
 */
export type FleetLag = 'newest' | 'behind' | 'stranded' | 'unknown';

/**
 * ⚠️ `newest === null` (সব ভার্সন halted, বা কিছুই প্রকাশ করা হয়নি) মানে
 * **লক্ষ্যই নেই**, তাই কেউ পিছিয়েও নেই। ⚠️⚠️ কিন্তু তখন পর্দায় "up to
 * date" লেখা **মিথ্যা** হতো — কেউ হালনাগাদ নয়, শুধু মাপার কিছু নেই।
 * সেই কারণে পর্দাটা ওই অবস্থায় চিহ্ন ও অগ্রগতির বার দুটোই লুকিয়ে রাখে
 * (`FleetCard`); এখানে শুধু "পিছিয়ে নেই" বলাটুকুই যথেষ্ট।
 */
export function lagOf(version: string | null, newest: string | null): FleetLag {
  if (version === null) return 'unknown';
  if (newest === null || compareVersion(version, newest) >= 0) return 'newest';

  /**
   * ⚠️ `>= 0` — শুধু `=== 0` নয়। কেউ হাতে **লক্ষ্যের চেয়েও নতুন** একটা
   * বিল্ড বসালে (আমরা নিজেরাই যেটা করি) সে "পিছিয়ে" নয়; অথচ সমান-না-হলেই
   * পিছিয়ে ধরলে পর্দা তাকে লাল দেখাত।
   */
  return compareVersion(version, TRAY_UPDATE_MIN) >= 0 ? 'behind' : 'stranded';
}

/**
 * ⚠️ কখনো সাড়া না দিলেও "চুপ" — `null` মানে এখানে "সমস্যা নেই" নয়।
 * এনরোল হয়ে একবারও না বলা এজেন্ট ঠিক ততটাই অদৃশ্য।
 */
export function isQuiet(lastSeenAt: string | null, now: Date): boolean {
  if (lastSeenAt === null) return true;

  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return true;

  return now.getTime() - seen > QUIET_HOURS * 3_600_000;
}

export interface FleetRow {
  deviceId: number;
  /** কারো সাথে যুক্ত না থাকলে `null` — তবু সারিটা দেখানো হয় */
  employee: { empCode: string; fullName: string } | null;
  hostname: string;
  windowsUsername: string;
  lastSeenAt: string | null;
  quiet: boolean;
  driftSec: number;
}

export interface FleetGroup {
  /** `null` মানে এজেন্ট নিজের ভার্সন বলেনি */
  version: string | null;
  lag: FleetLag;
  rows: FleetRow[];
}

/**
 * ⭐⭐ **ভার্সন ধরে দল, নতুন থেকে পুরোনো** — মালিকের বাছাই (১৮ আগস্ট)।
 *
 * এভাবে সাজালে "৫০% বলেছিলাম, কতদূর পৌঁছাল?" প্রশ্নটার উত্তর **না গুনেই**
 * দেখা যায়, আর এই ট্যাবের কাজই তো সেটা।
 *
 * ⚠️⚠️ **কেবল `active` ডিভাইস** — কারণ পাশের টেবিলের "PCs on it" কলামটাও
 * তাই গোনে (`agent-versions.service.ts`, `where: { status: 'active' }`)।
 * revoke করা PC ধরলে **একই পর্দায় দুটো আলাদা সংখ্যা** বসত, আর তখন কোনটা
 * সত্যি সেটা বোঝার উপায় থাকত না — এই প্রকল্পে ঠিক ওই ভুলটা একবার
 * হয়েছে (G88)।
 *
 * ⚠️ দলের **ভেতরে** ক্রম `empCode` ধরে, ঘণ্টা বা শেষ-সাড়া ধরে নয় — এটা
 * মানুষ খোঁজার তালিকা, র‌্যাঙ্কিং নয়।
 */
export function fleetGroups(
  devices: readonly DeviceView[],
  newest: string | null,
  now: Date,
): FleetGroup[] {
  const byVersion = new Map<string | null, FleetRow[]>();

  for (const d of devices) {
    if (d.status !== 'active') continue;

    const key = d.agentVersion ?? null;
    const rows = byVersion.get(key) ?? [];
    rows.push({
      deviceId: d.id,
      employee: d.employee
        ? { empCode: d.employee.empCode, fullName: d.employee.fullName }
        : null,
      hostname: d.hostname,
      windowsUsername: d.windowsUsername,
      lastSeenAt: d.lastSeenAt,
      quiet: isQuiet(d.lastSeenAt, now),
      driftSec: d.lastDriftSec,
    });
    byVersion.set(key, rows);
  }

  const groups: FleetGroup[] = [...byVersion.entries()].map(([version, rows]) => ({
    version,
    lag: lagOf(version, newest),
    rows: rows.sort((a, b) => {
      // ⚠️ কর্মীর সাথে যুক্ত নয় এমন ডিভাইস শেষে — নইলে খালি ঘরগুলো
      //    তালিকার মাথায় বসে পড়ত। ⚠️ শর্তটা **আলাদা করে** লেখা, কোনো
      //    বড়-অক্ষরের সেন্টিনেল দিয়ে নয়: localeCompare-এর ক্রম লোকেল
      //    ধরে বদলায়, তাই সেন্টিনেল একদিন মাঝখানে বসে যেতে পারত।
      if ((a.employee === null) !== (b.employee === null)) {
        return a.employee === null ? 1 : -1;
      }
      return (a.employee?.empCode ?? a.hostname).localeCompare(
        b.employee?.empCode ?? b.hostname,
      );
    }),
  }));

  return groups.sort((a, b) => {
    // ⚠️ অজানা ভার্সন সবার শেষে — ওটা কোনো "দল" নয়, একটা ফাঁক
    if (a.version === null) return 1;
    if (b.version === null) return -1;
    return compareVersion(b.version, a.version);
  });
}

export interface FleetTally {
  newest: number;
  behind: number;
  stranded: number;
  unknown: number;
  total: number;
}

/**
 * উপরের বারটার জন্য গোনা।
 *
 * ⭐ `stranded` আলাদা করে গোনা হয় কারণ **করণীয় আলাদা**: `behind` PC-গুলো
 * নিজে থেকেই আপডেট নেবে (অপেক্ষা করলেই হয়), `stranded`-গুলোয় কাউকে গিয়ে
 * MSI বসাতে হবে। দুটোকে একসাথে "পুরোনো" বললে ওই তফাতটাই হারাত।
 */
export function fleetTally(groups: readonly FleetGroup[]): FleetTally {
  const tally: FleetTally = {
    newest: 0,
    behind: 0,
    stranded: 0,
    unknown: 0,
    total: 0,
  };

  for (const g of groups) {
    tally[g.lag] += g.rows.length;
    tally.total += g.rows.length;
  }

  return tally;
}
