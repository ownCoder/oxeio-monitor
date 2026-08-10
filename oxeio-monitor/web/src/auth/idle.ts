/**
 * I09 — নিষ্ক্রিয়তার খাঁটি হিসাব।
 *
 * ⚠️ এটা `server/src/auth/idle-timeout.ts`-এর **হুবহু নকল**। সার্ভার আর
 *    ওয়েব আলাদা npm প্যাকেজ, তাই import করা যায় না। **সার্ভারের ফাইলটাই
 *    সত্যের উৎস** — ওখানকার টেস্ট (`server/test/totp.spec.ts`) এই
 *    আচরণটাই পাহারা দেয়। এখানে কিছু বদলালে ওখানেও বদলাতে হবে, নইলে
 *    ব্রাউজার একরকম গুনবে আর সার্ভার আরেকরকম।
 *
 * ⚠️ এই হিসাবটা কোনো **নিরাপত্তা** দেয় না — আসল তালা সার্ভারের JWT-র
 *    মেয়াদ। এখানকার কাজ শুধু ভদ্রতা: চুপচাপ বের করে না দিয়ে আগে সতর্ক করা।
 */

export type IdlePhase = 'active' | 'warning' | 'expired';

export interface IdleState {
  phase: IdlePhase;
  /** আর কত মিলিসেকেন্ড বাকি; `expired` হলে ০ */
  msLeft: number;
}

/**
 * ⚠️ ঘড়ি পিছিয়ে গেলে (ল্যাপটপ ঘুম থেকে ওঠা, NTP সিংক) বিয়োগটা ঋণাত্মক
 *    হতো আর `msLeft` টাইমআউটের চেয়েও বড় দেখাত — সতর্কবার্তা কখনো আসত না।
 */
export function idleStateAt(
  lastActivityMs: number,
  nowMs: number,
  timeoutMs: number,
  warnBeforeMs: number,
): IdleState {
  const elapsed = Math.max(0, nowMs - lastActivityMs);
  const msLeft = Math.max(0, timeoutMs - elapsed);

  if (msLeft <= 0) return { phase: 'expired', msLeft: 0 };
  if (msLeft <= warnBeforeMs) return { phase: 'warning', msLeft };
  return { phase: 'active', msLeft };
}

export function shouldPingSession(
  lastPingMs: number,
  nowMs: number,
  refreshAfterMs: number,
): boolean {
  return nowMs - lastPingMs >= refreshAfterMs;
}
