// ⚠️ টাইপটা `dashboard.math` থেকে — ওটাই আসল সংজ্ঞা, service নয়
import type { LiveStatus } from '../dashboard/dashboard.math';

/**
 * **ঘণ্টায় একবারের স্ন্যাপশট** — এখন কে কাজ করছে, কে করছে না।
 * খাঁটি নিয়ম, কোনো I/O নেই।
 *
 * ⚠️⚠️ **কেন প্রতি বিরতিতে অ্যালার্ট নয়:** মালিক প্রথমে চেয়েছিলেন কেউ
 * ১০ মিনিটের বেশি idle থাকলেই খবর। হিসাব করলে দাঁড়ায় ১২ জনের অফিসে
 * **দিনে ৬০–১৮০টা বার্তা** — চা, দুপুরের খাবার, বাথরুম, ফোন, মিটিং,
 * লম্বা নথি পড়া। এই মডিউলেরই `THROTTLE_HOURS`-এর ডকে লেখা আছে ওই পথের
 * পরিণতি: <i>"তারপর কেউ আর কোনো অ্যালার্ট পড়ত না, অর্থাৎ সত্যিকারের
 * সমস্যাটাও চোখ এড়িয়ে যেত।"</i>
 *
 * ⚠️ আর শুধু শব্দ নয়, **অন্যায্যও**: মিটিংয়ে বসা বা স্পেক পড়া মানুষ এই
 * মাপে "idle", অথচ তিনি কাজই করছেন।
 *
 * ⭐ তাই ঘণ্টায় **একটা** বার্তা, পুরো দলের ছবিসহ — দিনে ৮টা, ১৫০টা নয়।
 * একই তথ্য, কিন্তু পড়া হয়।
 */

export interface SnapshotPerson {
  fullName: string;
  status: LiveStatus;
  /** আজ এ পর্যন্ত কত সেকেন্ড গোনা হয়েছে */
  todayWorkedSec: number;
}

export interface SnapshotInput {
  people: readonly SnapshotPerson[];
  /** ঢাকার ঘড়িতে এখন কটা — বার্তার মাথায় বসে */
  clock: string;
}

/** ⚠️ ঘণ্টা:মিনিট, দশমিক নয় — "৩.৫ ঘণ্টা" পড়ে মাথায় হিসাব করতে হতো */
function hhmm(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * ⭐⭐ বার্তাটা **ছোট রাখা হয়** — কারা কাজ করছেন তাঁদের শুধু গোনা হয়,
 * নাম লেখা হয় না।
 *
 * ⚠️ সবার নাম লিখলে ১২ জনের তালিকায় বার্তাটা এত লম্বা হতো যে ঘণ্টায়
 * একবার পড়াও ক্লান্তিকর হয়ে যেত — আর তখন এটাও উপেক্ষিত হতো, ঠিক যা
 * এড়াতে চেয়ে স্ন্যাপশট বেছে নেওয়া। ⭐ **যাঁদের নিয়ে প্রশ্ন, শুধু
 * তাঁদের নাম** — idle, offline, আর agent down।
 */
export function snapshotMessage(input: SnapshotInput): string | null {
  const { people, clock } = input;

  // ⚠️ কেউ না থাকলে বার্তা নয় — খালি বার্তা পাঠানোর মানে নেই
  if (people.length === 0) return null;

  const working = people.filter((p) => p.status === 'active');
  const idle = people.filter((p) => p.status === 'idle');
  const offline = people.filter((p) => p.status === 'offline');
  const down = people.filter((p) => p.status === 'agent_down');

  const lines = [
    `oXeio · ${clock}`,
    '',
    `Working now: ${working.length}/${people.length}`,
  ];

  /**
   * ⚠️ idle-এর সাথে **আজকের ঘণ্টাও** দেওয়া হয়। শুধু "Ali idle" লিখলে
   * মনে হতো তিনি কিছুই করেননি; "Ali (5h 40m today)" বললে ছবিটা সৎ হয় —
   * তিনি হয়তো সারাদিন কাজ করে এখন চা খেতে গেছেন।
   */
  if (idle.length > 0) {
    lines.push(
      '',
      `Idle: ${idle.map((p) => `${p.fullName} (${hhmm(p.todayWorkedSec)} today)`).join(' · ')}`,
    );
  }

  if (offline.length > 0) {
    lines.push('', `Offline: ${offline.map((p) => p.fullName).join(' · ')}`);
  }

  /**
   * ⚠️⚠️ agent down **আলাদা করে শেষে** — এটাই একমাত্র সারি যেটা সত্যিকারের
   * সমস্যা (PC চালু, কিন্তু এজেন্ট সাড়া দিচ্ছে না)। idle-এর সাথে মিশিয়ে
   * দিলে ওটা রোজকার শব্দের নিচে চাপা পড়ত।
   */
  if (down.length > 0) {
    lines.push('', `⚠ Agent down: ${down.map((p) => p.fullName).join(' · ')}`);
  }

  return lines.join('\n');
}

/**
 * এখন কি স্ন্যাপশট পাঠানোর সময়?
 *
 * ⚠️⚠️ **কাজের সময়ের বাইরে পাঠানো হয় না।** রাত ২টায় "Working now: 0/12"
 * কোনো তথ্য নয়, শুধু শব্দ — আর ওই শব্দই দিনের বার্তাগুলোকে অগ্রাহ্য
 * করতে শেখায়।
 *
 * @param hour ঢাকার ঘড়িতে ঘণ্টা (০–২৩)
 */
export function shouldSendSnapshot(hour: number, from = 9, to = 19): boolean {
  return hour >= from && hour < to;
}
