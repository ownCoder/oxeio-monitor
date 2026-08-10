import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';

/**
 * স্ক্রিনশট ও অন্যান্য ফাইল কোথায় জমে — **একটাই সংজ্ঞা**।
 *
 * ⚠️ আগে এই লাইনটা **পাঁচ জায়গায় নকল** ছিল: ingest, retention, gallery,
 * disk alert, update। নকলের বিপদটা তাত্ত্বিক নয় —
 * <b>retention জব যদি ingest-এর চেয়ে আলাদা ফোল্ডার হিসাব করত, তাহলে সে
 * ডাটাবেসের সারি মুছত কিন্তু ডিস্কের ছবি রেখে দিত।</b> ডিস্ক নীরবে ভরে
 * যেত, আর গ্যালারিতে ভাঙা ছবি দেখাত — দুটোরই কারণ খুঁজে পাওয়া কঠিন।
 *
 * fallback পথটা ইচ্ছাকৃতভাবে রিপোর ভেতরে (`.data/storage`) — ডেভেলপারের
 * মেশিনে `STORAGE_ROOT` না বসালেও কাজ করে, আর গিটে যায় না।
 */
export function storageRoot(config: ConfigService): string {
  return (
    config.get<string>('STORAGE_ROOT') ??
    join(process.cwd(), '..', '.data', 'storage')
  );
}
