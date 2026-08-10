import { useCallback, useEffect, useRef, useState } from 'react';

import { isAbortError } from '../../api/client';
import {
  getGallery,
  type GalleryItem,
  type GalleryQuery,
} from '../../api/screenshots';

/**
 * I07 — ⭐ **মেয়াদ শেষ হয়ে যাওয়া signed URL নিজে থেকে সারিয়ে নেওয়া।**
 *
 * সার্ভার প্রতিটা ছবির লিঙ্ক ৫ মিনিটের জন্য সই করে (দেখুন
 * `server/src/screenshots/signed-url.service.ts`)। কেউ গ্যালারি খুলে রেখে
 * চা খেতে গেলে ফিরে এসে **সব ছবি ভাঙা** দেখত — কোনো এরর বার্তা নয়, শুধু
 * ভাঙা আইকনের একটা গ্রিড। আর দেখে মনে হতো স্ক্রিনশটগুলোই হারিয়ে গেছে,
 * অথচ ফাইল সবই জায়গামতো আছে।
 *
 * ⭐ তাই ছবি লোড ব্যর্থ হলে **নীরবে** পুরো পাতাটা আবার আনা হয় (নতুন টোকেন
 * সহ) আর শুধু `src`-গুলো বদলে দেওয়া হয়। ব্যবহারকারীর কাছে ছবিটা এক
 * মুহূর্ত দেরিতে এসেছে — এর বেশি কিছু নয়। কোনো বোতাম টিপতে হয় না, কারণ
 * "রিফ্রেশ করুন" লেখা দেখানো মানেই দোষটা ব্যবহারকারীর ঘাড়ে চাপানো।
 *
 * ⚠️ চেষ্টা **একবারই**। দ্বিতীয়বারও ব্যর্থ হলে "ছবিটা আর নেই" — কারণ তখন
 *    সমস্যাটা আর মেয়াদের নয়, ফাইলটাই নেই (retention job মুছেছে, বা ingest
 *    DB-তে সারি লিখে ডিস্কে লেখার আগে ক্র্যাশ করেছিল)। অসীম রিট্রাই করলে
 *    প্রতিটা সত্যিকারের হারানো ছবি সার্ভারে হাতুড়ি পেটাত।
 *
 * ⚠️⚠️ **audit** — প্রতিটা রিফ্রেশ মানে একটা `GET /screenshots`, আর সেটা
 *    audit log-এ একটা সারি লেখে (I08, `screenshots.service.recordView`)।
 *    তাই এক পাতার ৬০টা ছবি একসাথে মরলেও রিফ্রেশ হয় **একবার**:
 *    `inFlightRef` সব ব্যর্থতাকে একটাই কলে জড়ো করে। এটা না থাকলে একবার
 *    ট্যাব ফেলে রাখলেই audit log-এ ৬০টা সারি ঢুকত, আর E11-এর ভিউয়ারে
 *    আসল ঘটনাগুলো তার নিচে চাপা পড়ে যেত।
 */

export type ShotVariant = 'thumb' | 'full';

export interface FreshUrls {
  /** এই ছবির জন্য এখন যে লিঙ্কটা `<img src>`-এ বসবে */
  urlOf: (item: GalleryItem, variant: ShotVariant) => string;
  /** দুবার চেষ্টার পরেও এল না — "ছবিটা আর নেই" দেখানোর সময় */
  isDead: (item: GalleryItem, variant: ShotVariant) => boolean;
  /** `<img onError>` থেকে */
  reportError: (item: GalleryItem, variant: ShotVariant) => void;
  /** `<img onLoad>` থেকে */
  reportLoad: (item: GalleryItem, variant: ShotVariant) => void;
}

/** `${id}:${variant}` — থাম্বনেইল আর ফুল ছবির হিসাব আলাদা রাখতে হয় */
type Slot = string;

const VARIANTS: readonly ShotVariant[] = ['thumb', 'full'];

const NO_URLS: ReadonlyMap<Slot, string> = new Map();
const NO_TRIES: ReadonlyMap<Slot, number> = new Map();

function slotOf(id: string, variant: ShotVariant): Slot {
  return `${id}:${variant}`;
}

function originalUrl(item: GalleryItem, variant: ShotVariant): string {
  return variant === 'thumb' ? item.thumbUrl : item.fullUrl;
}

export function useFreshUrls(query: GalleryQuery): FreshUrls {
  /**
   * ⭐ নতুন লিঙ্কগুলো **আঠালো**: একবার বসলে আর পুরোনোটায় ফেরত যায় না।
   * ফেরত গেলে ছবি লোড হওয়ার পর আবার মেয়াদ-শেষ লিঙ্কে ফিরে গিয়ে অসীম
   * লুপ হতো — লোড, ভাঙা, লোড, ভাঙা।
   */
  const [overrides, setOverrides] = useState(NO_URLS);
  /** কোন ছবিটা তার শেষ সফল লোডের পর কতবার ব্যর্থ হয়েছে */
  const [tries, setTries] = useState(NO_TRIES);

  // ⚠️ সিদ্ধান্তগুলো (রিফ্রেশ ডাকব কি না, মৃত ধরব কি না) নিতে হয় ইভেন্টের
  //    ভেতরেই, রেন্ডারের অপেক্ষা না করে — তাই state-এর পাশে ref-আয়না।
  const overridesRef = useRef(overrides);
  const triesRef = useRef(tries);
  /** যেগুলো এই মুহূর্তে পর্দায় আঁকা আছে — এদের `src` ছোঁয়া যাবে না */
  const paintedRef = useRef(new Set<Slot>());
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    // ⚠️ StrictMode-এ effect দুবার চলে, তাই প্রতিবার `true` বসাতেই হয়
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // ⚠️ তারিখ/স্টাফ/পাতা বদলালে সব হিসাব শূন্য — আগের দিনের মৃত ছবির স্মৃতি
  //    নিয়ে নতুন দিনের গ্রিড আঁকলে ভালো ছবিও "আর নেই" দেখাত।
  useEffect(() => {
    overridesRef.current = NO_URLS;
    triesRef.current = NO_TRIES;
    paintedRef.current = new Set();
    inFlightRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    // একই ধ্রুবক ফিরিয়ে দিলে React অকারণে আবার রেন্ডার করে না
    setOverrides(NO_URLS);
    setTries(NO_TRIES);
  }, [query]);

  const commitTries = useCallback((next: ReadonlyMap<Slot, number>) => {
    triesRef.current = next;
    setTries(next);
  }, []);

  /** রেন্ডার আর ইভেন্ট — দুই জায়গায় একই উত্তর দিতে হবে, তাই এক জায়গায় */
  const urlNow = useCallback(
    (item: GalleryItem, variant: ShotVariant) =>
      overridesRef.current.get(slotOf(item.id, variant)) ??
      originalUrl(item, variant),
    [],
  );

  /**
   * যারা একবার ব্যর্থ হয়ে নতুন লিঙ্কের অপেক্ষায় ছিল অথচ পেল না — তাদের আর
   * ঝুলিয়ে রাখা যায় না।
   *
   * ⚠️ এটা না থাকলে ছবিটা চিরকাল "লোড হচ্ছে" অবস্থায় ঝুলে থাকত: না ছবি,
   *    না বার্তা। আর ঠিক সেটাই ঘটত সবচেয়ে সাধারণ ক্ষেত্রে — DB-তে সারি
   *    আছে কিন্তু ডিস্কে ফাইল নেই, তখন `/file` সাথে সাথেই ৪০৪ দেয়।
   */
  const giveUpPending = useCallback(
    (gotFresh: ReadonlyMap<Slot, string>) => {
      const next = new Map(triesRef.current);
      let changed = false;
      for (const [slot, count] of next) {
        if (count === 1 && !gotFresh.has(slot)) {
          next.set(slot, 2);
          changed = true;
        }
      }
      if (changed) commitTries(next);
    },
    [commitTries],
  );

  const refresh = useCallback(() => {
    // ⭐ একসাথে ৬০টা ছবি মরলেও সার্ভারে যাবে একটাই কল (audit log-এর জন্য)
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    void getGallery(query, controller.signal).then(
      (page) => {
        inFlightRef.current = false;
        // ⚠️ রেসপন্সটা এসে গিয়ে `.then` সারিতে অপেক্ষা করার মধ্যেই তারিখ
        //    বদলে যেতে পারে — তখন abort আর কিছু থামাতে পারে না। এই মিলটা
        //    না দেখলে আগের দিনের লিঙ্ক নতুন দিনের গ্রিডে বসে যেত।
        if (!aliveRef.current || abortRef.current !== controller) return;

        const fresh = new Map<Slot, string>();
        for (const item of page.items) {
          for (const variant of VARIANTS) {
            const slot = slotOf(item.id, variant);

            // ⚠️ যে ছবিটা এই মুহূর্তে পর্দায় আঁকা, তার `src` বদলালে সেটা
            //    আবার নামতে শুরু করত — এক ঝলক ফাঁকা ঘর, কোনো লাভ ছাড়াই।
            if (paintedRef.current.has(slot)) continue;

            const next = originalUrl(item, variant);

            /**
             * ⚠️⚠️ **হুবহু একই লিঙ্ক ফিরে আসতে পারে।** টোকেনের মেয়াদ
             * সেকেন্ডের নিখুঁততায় লেখা (`signed-url.ts` → `expiresAtSec`),
             * তাই একই সেকেন্ডে দুবার সই করলে দুটো টোকেন অভিন্ন। ফাইলটা
             * ডিস্কে নেই বলে `/file` তাৎক্ষণিক ৪০৪ দিলে ঠিক এটাই ঘটে:
             * ব্যর্থতা আর রিফ্রেশ দুটোই এক সেকেন্ডের ভেতরে।
             *
             * তখন `src` বদলায় না, ব্রাউজার আর চেষ্টাই করে না, আর ছবিটা
             * চিরকাল নীরবে ভাঙা থেকে যেত। বাদ দিলে `giveUpPending` একে
             * মৃত ধরে নেয় — আর ব্যবহারকারী অন্তত সত্যি কথাটা দেখতে পায়।
             */
            if (next === urlNow(item, variant)) continue;

            fresh.set(slot, next);
          }
        }

        if (fresh.size > 0) {
          const merged = new Map([...overridesRef.current, ...fresh]);
          overridesRef.current = merged;
          setOverrides(merged);
        }
        giveUpPending(fresh);
      },
      (err: unknown) => {
        inFlightRef.current = false;
        // বাতিল হওয়া কল ব্যর্থতা নয় — পাতা বদলালেই এটা ঘটে
        if (isAbortError(err) || !aliveRef.current) return;
        // রিফ্রেশই ব্যর্থ (নেটওয়ার্ক, ৪০৩) — অপেক্ষমাণ সবাইকে ছেড়ে দাও
        giveUpPending(NO_URLS);
      },
    );
  }, [query, giveUpPending, urlNow]);

  const reportError = useCallback(
    (item: GalleryItem, variant: ShotVariant) => {
      const slot = slotOf(item.id, variant);

      // ⚠️⚠️ ভেঙে যাওয়া ছবি আর "আঁকা" নয়। এটা না মুছলে যে ছবিটা একবার
      //    ঠিকঠাক এসেছিল আর পরে মেয়াদ শেষে ভেঙেছে, রিফ্রেশে তাকে বাদ
      //    দেওয়া হতো (আঁকা বলে) — ফলে নতুন লিঙ্ক পেত না, আর সাথে সাথেই
      //    "ছবিটা আর নেই" দেখাত। অর্থাৎ ঠিক যে ক্ষেত্রটার জন্য এই পুরো
      //    হুকটা লেখা, সেটাই ভাঙত।
      paintedRef.current.delete(slot);

      const count = (triesRef.current.get(slot) ?? 0) + 1;
      const next = new Map(triesRef.current);
      next.set(slot, count);
      commitTries(next);

      // ⚠️ শুধু প্রথম ব্যর্থতাতেই রিফ্রেশ। দ্বিতীয়বার মানে নতুন লিঙ্ক দিয়েও
      //    হয়নি — সেটা মেয়াদের সমস্যা নয়, ফাইলটাই নেই।
      if (count === 1) refresh();
    },
    [commitTries, refresh],
  );

  const reportLoad = useCallback(
    (item: GalleryItem, variant: ShotVariant) => {
      const slot = slotOf(item.id, variant);
      paintedRef.current.add(slot);

      // ⭐ সফল হলে গোনা শূন্য — লিঙ্ক আবার আধ ঘণ্টা পরে মরলে সেটা **নতুন**
      // ঘটনা, আগেরটার শাস্তি বয়ে বেড়ানোর কিছু নেই। (`overrides` আঠালো বলে
      // এতে পুরোনো মেয়াদ-শেষ লিঙ্কে ফিরে যাওয়ার ভয় নেই।)
      if (!triesRef.current.has(slot)) return;
      const next = new Map(triesRef.current);
      next.delete(slot);
      commitTries(next);
    },
    [commitTries],
  );

  const urlOf = useCallback(
    (item: GalleryItem, variant: ShotVariant) =>
      overrides.get(slotOf(item.id, variant)) ?? originalUrl(item, variant),
    [overrides],
  );

  const isDead = useCallback(
    (item: GalleryItem, variant: ShotVariant) =>
      (tries.get(slotOf(item.id, variant)) ?? 0) >= 2,
    [tries],
  );

  return { urlOf, isDead, reportError, reportLoad };
}
