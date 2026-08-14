import { useEffect, useRef, useState } from 'react';

import type { GalleryItem } from '../../api/screenshots';
import {
  formatBytes,
  formatCount,
  formatDate,
  formatTime,
  workDateOf,
} from '../../lib/format';
import type { FreshUrls } from './useFreshUrls';

/**
 * E06 — লাইটবক্স: ফুল সাইজ ছবি, ← → দিয়ে আগের/পরের, Esc-এ বন্ধ।
 *
 * ⭐ **কম্পোনেন্টটা খোলা অবস্থাতেই mount হয়** (`{open && <Lightbox/>}`), তাই
 * নিচের effect-গুলোর `[]` deps মানে "যতবার খোলা হবে, ততবার"। লুকিয়ে রাখা
 * (`hidden`) কম্পোনেন্ট হলে স্ক্রল-লক আর ফোকাস ফেরানোর হিসাব রাখতে হতো
 * হাতে, আর একটাও ভুলে গেলে পেজটা চিরকাল স্ক্রল-বিহীন হয়ে থাকত।
 *
 * ⚠️ তিনটে জিনিস একসাথে না করলে কি-বোর্ড নেভিগেশন আর পেজ স্ক্রল গোলমাল
 *    পাকায়:
 *      · পেছনের পেজের স্ক্রল বন্ধ — নইলে ↓ চাপলে ছবির পেছনে গ্রিড সরত
 *      · ফোকাস লাইটবক্সেই আটকানো — নইলে Tab চেপে পেছনের বোতামে চলে যেত,
 *        আর তখন ← → আর কাজ করত না (কোনো এরর ছাড়াই)
 *      · বন্ধ করলে ফোকাস যেখান থেকে এসেছিল সেখানেই ফেরত
 */

/** Tab-এর ফাঁদ পাতার জন্য — `tabindex="-1"` (মোড়কটা নিজে) বাদ */
const FOCUSABLE =
  'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
  urls,
}: {
  items: GalleryItem[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  urls: FreshUrls;
}) {
  const item = items[index];
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * ⚠️ `ready`-টা state-এ না রেখে "কোন src লোড হয়েছে" রাখা হয়েছে। state-এ
   *    রাখলে ছবি বদলানোর পরেও এক রেন্ডার আগেরটার `ready=true` থেকে যেত,
   *    আর নতুন ছবির উপরে পুরোনোটার নাম বসে থাকত।
   */
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  const src = urls.urlOf(item, 'full');
  const dead = urls.isDead(item, 'full');
  const ready = loadedSrc === src;

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  // ── কি-বোর্ড ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (index > 0) onIndex(index - 1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (index < items.length - 1) onIndex(index + 1);
        return;
      }
      if (event.key === 'Tab') trapTab(event, dialogRef.current);
    };

    // ⚠️ document-এ, capture ধাপে — কম্পোনেন্টের ভেতরে `onKeyDown` দিলে
    //    ফোকাস কোনোভাবে বেরিয়ে গেলে (ব্রাউজারের address bar থেকে ফিরে
    //    এলে) ← → নীরবে কাজ করা বন্ধ করত।
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [index, items.length, onIndex, onClose]);

  // ── স্ক্রল-লক ও ফোকাস ───────────────────────────────────────────────
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // ⚠️ আগের মানটা মনে রাখা হয় — অন্য কেউ (ভবিষ্যতের কোনো ড্রয়ার) ইতিমধ্যে
    //    লক করে থাকলে বন্ধ করার সময় তার লকটাও খুলে যেত।
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.fullName}, screenshot at ${formatTime(item.capturedAt)}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 outline-none"
    >
      <header className="flex items-center gap-3 px-3 py-2.5 text-white">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">
            {item.fullName}
            <span className="ml-1.5 text-[11.5px] text-white/55">
              {item.empCode}
            </span>
          </div>
          {/* ⚠️ `.num` **শুধু** ঘড়ির সংখ্যার উপরে। তারিখে মাসের নাম থাকে
              ("10 August 2026") — গোটাটা `.num` করলে মাসের নামটাও মনো
              ফন্টে চলে যেত, আর tabular-nums-এর সমান-প্রস্থ অক্ষরে শব্দটা
              টেলিগ্রামের মতো ছড়িয়ে বসত। অঙ্ক মনোয়, শব্দ নয়। */}
          <div className="text-[11.5px] text-white/55">
            {formatDate(workDateOf(item.capturedAt))}
            {' · '}
            <span className="num">{formatTime(item.capturedAt)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto rounded-md border border-white/20 px-2.5 py-1.5 text-xs text-white/85 transition hover:border-brand hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
        >
          Close ✕
        </button>
      </header>

      {/* ⚠️ ছবির চারপাশের ফাঁকা জায়গায় ক্লিক করলে বন্ধ — কিন্তু ছবিতে নয়।
          `e.target === e.currentTarget` না মিলিয়ে দিলে ছবিতে ক্লিক করেও
          লাইটবক্স বন্ধ হয়ে যেত, আর জুম করতে গিয়ে বারবার বেরিয়ে আসতে হতো। */}
      <div
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        className="relative grid min-h-0 flex-1 place-items-center px-3"
      >
        {dead ? (
          <p className="max-w-sm text-center text-[13px] text-white/70">
            Image no longer available
            <span className="mt-1 block text-[11.5px] text-white/45">
              The expired link was fetched again, but the file still wasn't
              there.
            </span>
          </p>
        ) : (
          <>
            {!ready && (
              <span
                aria-hidden
                className="absolute size-5 animate-spin rounded-full border-2 border-white/25 border-t-brand"
              />
            )}
            <img
              // ⚠️ `key` বদলালে React পুরোনো <img>-টা ফেলে নতুন বসায় — নইলে
              //    আগের ছবিটা নতুনটা নামা পর্যন্ত পর্দায় থেকে যেত, আর ← →
              //    চেপে মনে হতো কিছুই বদলায়নি।
              key={src}
              src={src}
              alt={`${item.fullName}, screenshot at ${formatTime(item.capturedAt)}`}
              decoding="async"
              onLoad={() => {
                setLoadedSrc(src);
                urls.reportLoad(item, 'full');
              }}
              onError={() => urls.reportError(item, 'full')}
              /**
               * ⚠️⚠️ **`max-h-full` এখানে কিছুই আটকায় না** — আর ক্লাসগুলো
               *    পড়ে সেটা বোঝার উপায় নেই, তাই ভুলটা এতদিন টিকে ছিল।
               *
               *    শতাংশ `max-height` তখনই খাটে যখন অভিভাবকের উচ্চতা
               *    "definite"। ঘরটা `grid` + `place-items-center`, আর
               *    `align-items: center` বসালে item নিজের কনটেন্ট থেকে মাপ
               *    নেয় — "১০০% কীসের?" প্রশ্নটা চক্রাকার হয়ে যায়, তাই
               *    ব্রাউজার সীমাটা **উপেক্ষা করে**।
               *
               *    ⚠️ ফলে `object-contain`-ও অকেজো: ১৯২০×১০৮০ ছবি ৮৫৫px
               *    পর্দায় **১০৬৭px** উঁচু হয়ে বসত (মেপে দেখা), ৭২৩px ঘর
               *    উপচে গোটা পর্দা ঢেকে ফেলত, আর নিচের ফুটার ও ← →
               *    বোতামগুলো বাইরে চলে যেত।
               *
               * ⭐ তাই **viewport-ভিত্তিক** সীমা — কোনো অভিভাবকের উপর
               *    নির্ভর করে না, তাই ভবিষ্যতে কেউ মোড়কের layout বদলালেও
               *    ভাঙবে না। `100dvh` মোবাইলের ঠিকানা-বার লুকোলে/দেখালেও
               *    সঠিক থাকে, আর ১১rem হেডার+ফুটারের জায়গা।
               */
              style={{ maxHeight: 'calc(100dvh - 11rem)' }}
              className={`max-w-full object-contain transition-opacity ${
                ready ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-white">
        <button
          type="button"
          onClick={() => onIndex(index - 1)}
          disabled={!hasPrev}
          className={NAV_BUTTON}
        >
          ◀ Previous
        </button>
        <button
          type="button"
          onClick={() => onIndex(index + 1)}
          disabled={!hasNext}
          className={NAV_BUTTON}
        >
          Next ▶
        </button>

        <span className="num text-[11.5px] text-white/55">
          {formatCount(index + 1)} / {formatCount(items.length)}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-white/55">
          {/* ⭐ স্লট আর তোলার সময় আলাদা করে দেখানো — এটাই বোঝায় ছবিটা ৫
              মিনিটের ঘরে **এলোমেলো মুহূর্তে** তোলা, ঘড়ি ধরে নয় (§ ২.৩) */}
          <span>
            Slot <span className="num">{formatTime(item.slotStart)}</span> ·
            captured{' '}
            <span className="num">{formatTime(item.capturedAt)}</span>
          </span>
          {item.monitorIndex > 0 && (
            <span>
              Monitor <span className="num">{item.monitorIndex + 1}</span>
            </span>
          )}
          {/* ⚠️ রেজ়লিউশনে হাজারের কমা বসে না — `formatCount` দিলে
              "1,920×1,080" হতো, যেটা কেউ রেজ়লিউশন বলে চেনে না */}
          {item.width !== null && item.height !== null && (
            <span className="num">
              {item.width}×{item.height}
            </span>
          )}
          {item.sizeBytes !== null && (
            <span className="num">{formatBytes(item.sizeBytes)}</span>
          )}
        </div>

        <p className="w-full text-[11px] text-white/40">
          {/* ⚠️ ফুল URL কখনো জমা হয় না — এখানে যা দেখছেন সেটা উইন্ডোর
              শিরোনাম, বড়জোর ডোমেইন (ADR-013) */}
          {item.activeApp ?? '—'}
          {item.activeTitle ? ` · ${item.activeTitle}` : ''}
          <span className="ml-2 hidden sm:inline">
            ← → previous/next · Esc to close
          </span>
        </p>
      </footer>
    </div>
  );
}

const NAV_BUTTON =
  'rounded-md border border-white/20 px-2.5 py-1.5 text-xs text-white/85 transition hover:border-brand hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-white/20';

/**
 * ফোকাস লাইটবক্সের ভেতরেই ঘোরে।
 *
 * ⚠️ ভেতরে কোনো ফোকাসযোগ্য জিনিস না থাকলে (তাত্ত্বিকভাবে) Tab মোড়কেই ফিরে
 *    আসে — নইলে ফোকাস পেছনের পেজে চলে যেত আর ব্যবহারকারী বুঝতে পারত না
 *    সে কোথায় আছে।
 */
function trapTab(event: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;

  const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (nodes.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }

  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  const inside = active instanceof Node && root.contains(active);

  if (!inside) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
