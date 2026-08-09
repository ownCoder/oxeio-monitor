import { createHash } from 'node:crypto';

/**
 * মধ্যরাতে একটা রেকর্ড ভাগ হলে টুকরোগুলোর আলাদা `client_uuid` লাগে —
 * কিন্তু কলামটা UNIQUE, আর dedupe-ও ওটার উপরেই দাঁড়িয়ে (§ ২.১-ঘ)।
 *
 * তাই র‍্যান্ডম নয়, **নির্ধারিত** (deterministic) আইডি বানানো হয়:
 * এজেন্ট একই রেকর্ড আবার পাঠালে টুকরোগুলোও হুবহু একই আইডি পাবে,
 * ফলে `ON CONFLICT DO NOTHING` ঠিকঠাক কাজ করবে।
 *
 * index 0 মূল আইডিটাই রাখে, যাতে ভাগ না হওয়া রেকর্ড অপরিবর্তিত থাকে।
 */
export function deriveUuid(base: string, index: number): string {
  if (index === 0) return base;

  const digest = createHash('sha256').update(`${base}:${index}`).digest();
  const b = Buffer.from(digest.subarray(0, 16));

  // UUID v4-এর আকার দেওয়া হচ্ছে (আসলে র‍্যান্ডম নয়, কিন্তু Postgres-এর
  // uuid টাইপে বসতে হলে ফরম্যাটটা মানতে হয়)
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;

  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
