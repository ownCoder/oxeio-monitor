import { useState } from 'react';

import { getGallery, type GalleryItem } from '../../api/screenshots';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { formatTime } from '../../lib/format';
import { Lightbox } from '../gallery/Lightbox';
import { useFreshUrls, type FreshUrls } from '../gallery/useFreshUrls';

/**
 * ওই দিনের স্ক্রিনশট, কর্মীর নিজের পাতায় ([07 § ৫](../../../../docs/07-Technical-Spec.md))।
 *
 * ⭐ <b>কেন গ্যালারি পাতা থাকা সত্ত্বেও এটা দরকার:</b> কারো একটা দিন নিয়ে
 * প্রশ্ন উঠলে — "এই ৩ ঘণ্টায় কী হয়েছিল" — উত্তরটা টাইমলাইন, ঘণ্টা-চার্ট
 * আর ছবি <b>একসাথে</b> দেখলে তবেই মেলে। আলাদা পাতায় গিয়ে আবার স্টাফ ও
 * তারিখ বেছে নিতে হলে কেউ মেলাতই না।
 *
 * ⚠️ এই কলটা <b>audit-এ লেখা হয়</b> (I08) — "কে আমার স্ক্রিনশট দেখল"
 * প্রশ্নের উত্তর এখান থেকেই তৈরি হয়। তাই পোলিং নেই, আর তারিখ/কর্মী
 * বদলালে তবেই আবার ডাকা হয়।
 */
export function DayShots({
  employeeId,
  date,
  nonce,
}: {
  employeeId: number;
  date: string;
  nonce: number;
}) {
  const [open, setOpen] = useState<number | null>(null);

  // ⭐ লিঙ্কের মেয়াদ (৫ মিনিট, I07) সামলানোর কাজটা গ্যালারি পাতার সাথে
  //    **একই হুকে** — নিজে আবার লিখলে একদিন দুটো আলাদা আচরণ হতো, আর
  //    "কোন পাতায় ছবি ভাঙে" ধরনের বাগ শুরু হতো।
  const urls = useFreshUrls({ employeeId, date });

  const { data, error, loading, reload } = useApi(
    (signal) => getGallery({ employeeId, date }, signal),
    [employeeId, date, nonce],
  );

  if (loading && !data) return <Loading label="Loading screenshots…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <Card
        title="Screenshots"
        hint="One per 5-minute slot · 07:00–23:00 only"
      >
        <Empty
          title="No screenshots for this day"
          // ⚠️ "কিছু নেই" বললে মনে হতো সিস্টেম ভাঙা। তিনটে **স্বাভাবিক**
          //    কারণই এখানে লেখা, যাতে কেউ অকারণে আইটিকে না ডাকে।
          hint="Pictures are only taken while someone is working, and only between 07:00 and 23:00. A day off or an idle day has none."
        />
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Screenshots"
        hint={`${data?.total ?? items.length} this day · click to enlarge`}
      >
        {/* ⚠️ প্রথম পাতাটাই দেখানো হয় — একদিনে ১৯২টা পর্যন্ত ছবি হতে পারে
            (১৬ ঘণ্টা × ১২)। সব একসাথে আনলে audit log-ও ভরত, ব্রাউজারও বসত।
            পুরোটা দরকার হলে গ্যালারি পাতা আছে। */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((shot, i) => (
            <Thumb
              key={shot.id}
              shot={shot}
              urls={urls}
              onOpen={() => setOpen(i)}
            />
          ))}
        </div>

        {data && data.total > items.length && (
          <p className="mt-3 text-[11.5px] text-ink-3">
            Showing the first {items.length} of {data.total} — open the
            Screenshots page for the rest.
          </p>
        )}
      </Card>

      {open !== null && (
        <Lightbox
          items={items}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          urls={urls}
        />
      )}
    </>
  );
}

function Thumb({
  shot,
  urls,
  onOpen,
}: {
  shot: GalleryItem;
  urls: FreshUrls;
  onOpen: () => void;
}) {
  const dead = urls.isDead(shot, 'thumb');

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${formatTime(shot.capturedAt)}${shot.activeApp ? ` · ${shot.activeApp}` : ''}`}
      className="group relative overflow-hidden rounded-md border border-line bg-paper transition hover:border-brand focus:border-brand focus:outline-none"
    >
      {dead ? (
        // ⚠️ signed URL ৫ মিনিটে মরে (I07)। ভাঙা আইকনের বদলে কারণটা লেখা —
        //    নইলে দশ মিনিট খোলা রাখা ট্যাবে সব ছবি নীরবে ভাঙা দেখাত।
        <span className="grid aspect-video place-items-center px-1 text-center text-[10px] text-ink-3">
          Picture is gone
        </span>
      ) : (
        <img
          src={urls.urlOf(shot, 'thumb')}
          alt={`Screen at ${formatTime(shot.capturedAt)}`}
          loading="lazy"
          onError={() => urls.reportError(shot, 'thumb')}
          onLoad={() => urls.reportLoad(shot, 'thumb')}
          className="aspect-video w-full object-cover"
        />
      )}

      <span className="num absolute right-1 bottom-1 rounded bg-chrome/80 px-1 text-[10px] text-white">
        {formatTime(shot.capturedAt)}
      </span>
    </button>
  );
}
