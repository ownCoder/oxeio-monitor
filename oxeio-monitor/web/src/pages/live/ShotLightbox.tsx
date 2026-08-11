import { useEffect, useRef, useState } from 'react';

import type { LiveCard } from '../../api/dashboard';
import type { GalleryItem } from '../../api/screenshots';
import { Button } from '../../components/Page';
import { formatBytes, formatDateTime } from '../../lib/format';

/**
 * E03 — থাম্বনেইলে ক্লিক করলে ফুল ছবি।
 *
 * ⭐ `shot` আসে **প্যারেন্টের সর্বশেষ ডেটা থেকে**, কোনো কপি ধরে রাখা হয় না।
 *    তাই "আবার আনুন" চাপলে নতুন টোকেনসহ নতুন URL এখানেও নিজে থেকেই বসে
 *    যায়। ছবিটা state-এ জমিয়ে রাখলে মেয়াদ ফুরোনো লিঙ্কটাই আটকে থাকত আর
 *    রিফ্রেশ করেও কিছু হতো না।
 *
 * ⚠️ `shot` `null` হতে পারে — রিফ্রেশের পর ওই কর্মীর ছবি শেষ পাতা থেকে
 *    সরে যেতে পারে। তখন মোডালটা হুট করে বন্ধ না করে কী হয়েছে সেটা বলা হয়।
 */
export function ShotLightbox({
  card,
  shot,
  onClose,
  onRefresh,
}: {
  card: LiveCard;
  shot: GalleryItem | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [shot?.fullUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // ⚠️ পেছনের বোর্ডটা স্ক্রল হওয়া বন্ধ — ফোনে মোডাল খোলা রেখে আঙুল
    //    টানলে নিচের পাতাটাই সরত, আর মনে হতো ছবিটা আটকে গেছে।
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    closeRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Latest screenshot of ${card.fullName}`}
        // ⚠️ ভেতরে ক্লিক করলে যেন বন্ধ না হয় — ছবিটা দেখতে গিয়ে ভুল করে
        //    মোডাল বন্ধ হয়ে যাওয়াটা বিরক্তিকর।
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13.5px] font-semibold tracking-tight">
              {card.fullName}
            </h2>
            <p className="truncate text-[11.5px] text-ink-3">
              <span className="num">{card.empCode}</span>
              {shot ? ` · ${formatDateTime(shot.capturedAt)}` : ''}
              {shot && shot.monitorIndex > 0
                ? ` · Monitor ${shot.monitorIndex + 1}`
                : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onRefresh}>Fetch again</Button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink-2 transition hover:border-brand hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-paper">
          {!shot ? (
            <p className="px-6 py-14 text-center text-sm text-ink-3">
              This shot is no longer in the latest set. Every shot from the day
              is on the Screenshots page.
            </p>
          ) : broken ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm text-ink-2">Link expired (5 minutes)</p>
              <p className="mt-1 text-xs text-ink-3">
                Image links are made to be short-lived — “Fetch again” gets a
                fresh one.
              </p>
            </div>
          ) : (
            <img
              src={shot.fullUrl}
              alt={`Latest screenshot of ${card.fullName}`}
              onError={() => setBroken(true)}
              className="mx-auto block h-auto w-full"
            />
          )}
        </div>

        {shot && (
          <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
            {shot.activeApp && <span className="truncate">{shot.activeApp}</span>}
            {/* ⚠️ শুধু উইন্ডোর শিরোনাম ও ডোমেইন — ফুল URL কখনো জমাই হয় না (§ ৭) */}
            {shot.activeTitle && (
              <span className="min-w-0 flex-1 truncate" title={shot.activeTitle}>
                {shot.activeTitle}
              </span>
            )}
            <span className="num ml-auto">
              {shot.width && shot.height ? `${shot.width}×${shot.height} · ` : ''}
              {formatBytes(shot.sizeBytes)}
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}
