import { api } from './client';
import { qs } from './query';

/**
 * E06 — স্ক্রিনশট গ্যালারি।
 *
 * সার্ভারের উৎস: `server/src/screenshots/` (screenshots.controller.ts ·
 * screenshots.service.ts)।
 *
 * ⭐ এখানে `@Roles` **নেই** — owner, manager আর স্টাফ তিনজনেই ঢোকে। কে কী
 * দেখবে সেটা role নয়, **স্কোপ** ঠিক করে: `role = employee` হলে সার্ভার
 * সেশন থেকে employeeId নেয়, আর অন্যের আইডি চাইলে ৪০৩ (J05)।
 *
 * ⚠️ **ফুল URL কখনো জমা হয় না** (ADR-013) — `activeTitle`-এ উইন্ডোর
 * শিরোনাম ও ডোমেইন থাকে, তার বেশি কিছু নয়।
 */

export interface GalleryItem {
  /** ⚠️ স্ট্রিং — সার্ভারে BigInt */
  id: string;
  employeeId: number;
  empCode: string;
  fullName: string;
  /** ISO instant */
  capturedAt: string;
  slotStart: string;
  monitorIndex: number;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  activeApp: string | null;
  activeTitle: string | null;
  /**
   * ⭐⚠️ **৫ মিনিটে মেয়াদ শেষ** (I07)। relative পথ, সরাসরি
   * `<img src={item.thumbUrl}>`-এ বসানো যায়।
   *
   * ⚠️ লিঙ্কটা মরে গেলে ছবি ৪০৩ হয়ে ভাঙা আইকন দেখায়। গ্যালারি পেজে
   *    `<img onError>` ধরে "লিঙ্কের মেয়াদ শেষ — রিফ্রেশ করুন" দেখানো দরকার,
   *    নইলে দশ মিনিট খোলা রাখা ট্যাবে সব ছবি নীরবে ভাঙা দেখাত।
   */
  thumbUrl: string;
  /** লাইটবক্সে ফুল ছবি — আলাদা টোকেন, একই ৫ মিনিটের মেয়াদ */
  fullUrl: string;
}

export interface GalleryPage {
  /** `YYYY-MM-DD` */
  date: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: GalleryItem[];
}

export interface GalleryQuery {
  /** ⚠️ role=employee হলে এটা উপেক্ষিত নয় — নিজের আইডি ছাড়া দিলে ৪০৩ */
  employeeId?: number;
  /** না দিলে ঢাকার আজকের কর্মদিবস */
  date?: string;
  /** ১ থেকে শুরু। ⚠️ সর্বোচ্চ ১০,০০০ */
  page?: number;
}

/**
 * E06 — `GET /api/v1/screenshots?employeeId=&date=&page=`
 *
 * ⭐ এই কলটা **audit-এ লেখা হয়** (I08) — "কে আমার স্ক্রিনশট দেখল" প্রশ্নের
 * উত্তর এখানেই তৈরি হয়। পাতাপ্রতি একটা সারি, তাই অকারণে বারবার ডাকলে
 * audit log ভরে যায়; পোলিং করবেন না।
 */
export function getGallery(
  query: GalleryQuery = {},
  signal?: AbortSignal,
): Promise<GalleryPage> {
  return api<GalleryPage>(`/screenshots${qs({ ...query })}`, { signal });
}
