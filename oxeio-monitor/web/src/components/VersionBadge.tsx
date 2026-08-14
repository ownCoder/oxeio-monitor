import { useEffect, useState } from 'react';

/**
 * ⭐⭐ কোণায় বসা বিল্ড-নম্বর — **কোন কোডটা এই মুহূর্তে চলছে**।
 *
 * ⚠️ সংখ্যাটা হাতে লেখা হয় না, **git থেকে আসে** (`git rev-list --count`,
 *    `deploy/vps-update.sh` বিল্ডের সময় ভরে দেয়)। প্রতি কমিটে ঠিক এক
 *    বাড়ে, তাই "প্রতিটা বদলে ভার্সন বাড়বে" কথাটা কারো মনে রাখার উপর
 *    নির্ভর করে না।
 *
 * ⚠️⚠️ **হাতে বাড়ানো সংখ্যা একদিন পিছিয়ে পড়ত**, আর তখন পর্দা বলত নতুন
 *    কোড চলছে অথচ চলত পুরোনোটা। ভুল ভার্সন না-থাকা ভার্সনের চেয়ে খারাপ,
 *    কারণ ওটা দেখে মানুষ **অন্য জায়গায়** ভুল খুঁজতে শুরু করে।
 */

const BUILD = import.meta.env.VITE_APP_BUILD || 'dev';
const COMMIT = import.meta.env.VITE_APP_COMMIT || 'local';
const BUILT_AT = import.meta.env.VITE_APP_BUILT_AT || '';

interface ApiVersion {
  build: string;
  commit: string;
}

export function VersionBadge() {
  const [api, setApi] = useState<ApiVersion | null>(null);

  /**
   * ⭐ API-র ভার্সনও একবার আনা হয় — **অর্ধেক ডিপ্লয় ধরার একমাত্র উপায়**।
   *
   * ⚠️ নতুন ওয়েব + পুরোনো api একটা সম্পূর্ণ নীরব অবস্থা: পাতা নতুন
   *    দেখায়, অথচ API পুরোনো উত্তর দেয়। এই মিলটা না দেখালে "ফিক্সটা তো
   *    বসিয়েছি, কাজ করছে না কেন" প্রশ্নের উত্তর খুঁজতে ঘণ্টা যেত।
   *
   * ⚠️ একবারই ডাকা হয়, পোলিং নয় — ভার্সন পাতার আয়ুতে বদলায় না। আর
   *    `/health` লগইন ছাড়াই খোলে, তাই লগইন পাতাতেও ব্যাজটা সত্যি বলে।
   */
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/health', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ApiVersion | null) => {
        if (alive && j) setApi({ build: j.build, commit: j.commit });
      })
      // ⚠️ চুপচাপ — ভার্সন দেখাতে না পারা কখনো পাতার সমস্যা নয়।
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * ⚠️ মিল না হলেই সতর্কতা — তবে `dev` বিল্ডে নয়, নইলে ডেভেলপারের মেশিনে
   *    ব্যাজটা সারাক্ষণ লাল থাকত আর কেউ আর তাকাত না।
   */
  const mismatch =
    api !== null && BUILD !== 'dev' && api.build !== 'dev' && api.build !== BUILD;

  const detail = [
    `web #${BUILD} · ${COMMIT}`,
    api ? `api #${api.build} · ${api.commit}` : 'api version unknown',
    BUILT_AT ? `built ${BUILT_AT}` : null,
    mismatch ? 'Web and API are from different builds — redeploy' : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    /*
      ⚠️ `fixed` + `pointer-events-none` — ব্যাজটা কোণে বসে থাকে, কিন্তু
         নিচের বোতাম বা লিঙ্কে ক্লিক আটকায় না। শুধু ভেতরের লেখাটুকু
         hover ধরে, যাতে বিস্তারিত দেখা যায়।
      ⚠️ `z-40` — মোডাল (z-50) ও তার ছায়ার নিচে। ব্যাজ কোনোদিন ডায়ালগের
         উপরে বসতে পারে না।
    */
    <div className="pointer-events-none fixed right-2 bottom-2 z-40 select-none">
      <span
        className={`pointer-events-auto num rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${
          mismatch
            ? 'bg-brand-bg text-brand-ink'
            : 'bg-surface/70 text-ink-3 hover:text-ink-2'
        }`}
        title={detail}
      >
        {mismatch ? '⚠ ' : ''}#{BUILD}
      </span>
    </div>
  );
}
