import type { GalleryItem } from '../../api/screenshots';
import { formatTime } from '../../lib/format';
import type { FreshUrls } from './useFreshUrls';

/**
 * E06 — স্ক্রিনশটের গ্রিড (মকআপের `.shots`)।
 *
 * ⚠️ E12 — কলামের সংখ্যা `auto-fill` ঠিক করে, মিডিয়া ক্যোয়ারি নয়। ফোনে
 *    দুটো, ট্যাবে চার-পাঁচটা, বড় পর্দায় যত ধরে। থাম্বনেইলের নিচে সময় আর
 *    অ্যাপের নাম — ওই দুটোই খুঁজে বের করার আসল হাতিয়ার।
 */
export function ShotGrid({
  items,
  urls,
  showName,
  onOpen,
}: {
  items: GalleryItem[];
  urls: FreshUrls;
  /** "সবাই" দেখা হলে সত্যি — নইলে প্রতিটা ঘরে একই নাম লেখা থাকত */
  showName: boolean;
  onOpen: (index: number) => void;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
      {items.map((item, index) => (
        <li key={item.id}>
          <ShotTile
            item={item}
            urls={urls}
            showName={showName}
            onOpen={() => onOpen(index)}
          />
        </li>
      ))}
    </ul>
  );
}

function ShotTile({
  item,
  urls,
  showName,
  onOpen,
}: {
  item: GalleryItem;
  urls: FreshUrls;
  showName: boolean;
  onOpen: () => void;
}) {
  const dead = urls.isDead(item, 'thumb');
  const time = formatTime(item.capturedAt);

  return (
    <button
      type="button"
      onClick={onOpen}
      // ⚠️ পুরো ঘরটাই বোতাম — শুধু ছবিতে ক্লিক ধরলে নিচের সময়/অ্যাপের
      //    সরু পট্টিতে চাপ দিয়ে কিছুই হতো না, আর সেটা ভাঙা মনে হতো।
      className="block w-full overflow-hidden rounded-lg border border-line bg-surface text-left transition hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
      aria-label={`${showName ? `${item.fullName}, ` : ''}${time}-এর স্ক্রিনশট`}
    >
      <div className="relative aspect-[16/10] bg-paper">
        {dead ? (
          // ⭐ ভাঙা আইকনের বদলে ভদ্র একটা বার্তা — ধূসর, লাল নয়: এটা কারো
          // ভুল নয়, ফাইলটা মেয়াদ পেরিয়ে মুছে গেছে (retention, ADR-006)।
          <span className="absolute inset-0 grid place-items-center px-2 text-center text-[11px] text-ink-3">
            ছবিটা আর নেই
          </span>
        ) : (
          <img
            src={urls.urlOf(item, 'thumb')}
            alt=""
            // ⚠️ lazy না দিলে এক পাতায় ৬০টা ছবি একসাথে নামত — ব্রাউজার
            //    কয়েক সেকেন্ড বসে থাকত, আর স্ক্রল করার আগেই সব টোকেন খরচ।
            loading="lazy"
            decoding="async"
            onLoad={() => urls.reportLoad(item, 'thumb')}
            onError={() => urls.reportError(item, 'thumb')}
            className="absolute inset-0 size-full object-cover object-top"
          />
        )}

        {/* ⚠️ একই ৫ মিনিটের স্লটে দুই মনিটরের দুটো ছবি আসে — কোনটা কোনটা
            না বললে মনে হতো একই ছবি দুবার এসেছে */}
        {item.monitorIndex > 0 && (
          <span className="absolute top-1 right-1 rounded bg-black/55 px-1 py-px text-[10px] text-white">
            {/* ⚠️ `.num` শুধু সংখ্যাটার উপরে — মনো ফন্টে বাংলা গ্লিফ নেই */}
            মনিটর <span className="num">{item.monitorIndex + 1}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="num text-[11px] font-semibold">{time}</span>
        <span className="ml-auto truncate text-[10.5px] text-ink-3">
          {/* ⚠️ ফুল URL কখনো নয় (ADR-013) — `activeTitle`-এ শুধু উইন্ডোর
              শিরোনাম আর ডোমেইন থাকে, সার্ভারই সেটা নিশ্চিত করে */}
          {item.activeApp ?? '—'}
        </span>
      </div>

      {showName && (
        <div className="truncate border-t border-line px-2 py-1 text-[10.5px] text-ink-2">
          {item.fullName}
        </div>
      )}
    </button>
  );
}
