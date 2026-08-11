import type { ReactNode } from 'react';

import { ApiError } from '../api/client';

/**
 * ⭐ **প্রতিটা পেজে তিনটে অবস্থা** — লোড হচ্ছে · ভুল হয়েছে · কিছু নেই।
 *
 * ⚠️ খালি অবস্থাটা ভুলবেন না। নতুন অফিসে প্রথম দিন সব পেজই খালি থাকবে,
 *    আর তখন সাদা পর্দা দেখলে মনে হবে সিস্টেমটা ভাঙা। `<Empty>`-এর `hint`
 *    সবসময় বলে দেবে **এরপর কী করতে হবে**।
 *
 * ব্যবহারের ছাঁচ:
 * ```tsx
 * if (loading && !data) return <Loading />;
 * if (error) return <ErrorBox error={error} retry={reload} />;
 * if (!data || data.rows.length === 0)
 *   return <Empty title="No activity on this day" hint="…" />;
 * ```
 */

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="grid place-items-center rounded-xl border border-line bg-surface px-6 py-14 text-sm text-ink-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5">
        {/* সরু ব্র্যান্ড-লাল রিং — ঘুরছে মানে "কাজ চলছে", ভুল নয় */}
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-line border-t-brand"
        />
        {label}
      </div>
    </div>
  );
}

/**
 * ভুলের বাক্স।
 *
 * ⭐ **৪০৩ আলাদা করে দেখানো হয়** — ম্যানেজার owner-only ডেটা চাইলে
 * "সার্ভারে সমস্যা" নয়, "You don't have access" বলা দরকার। আর তখন
 * "Retry" বোতামটাও দেখানো হয় না: বারবার চাপলেও অনুমতি আসবে না, শুধু
 * বিভ্রান্তি বাড়ত।
 *
 * ⚠️ ৪০৩ যেন প্রথমেই না আসে — owner-only জিনিস ম্যানেজারকে **দেখানোই
 *    হবে না** (`useAuth().user.role`)। এই বাক্সটা শেষ রক্ষাকবচ।
 *
 * ⚠️⚠️ **`error.message` সার্ভারের নিজের বার্তা** — ৪০৩/৪০৪ ছাড়া বাকি
 *    ভুলে পর্দায় ওটাই হুবহু বসে। ইচ্ছাকৃত: বার্তাটা এখানে বানানো হয় না,
 *    শুধু দেখানো হয়, কারণ "কী ভুল হলো" সবচেয়ে ভালো জানে সার্ভারই।
 *    সার্ভারের ব্যবহারকারী-মুখী বার্তাগুলো এখন ইংরেজি (একসাথে অনুবাদ করা
 *    হয়েছে), তাই পর্দা মিশ্র ভাষায় থাকে না।
 *
 * ⚠️ ক্লায়েন্টে অনুবাদের টেবিল **বসাবেন না** — তাহলে সার্ভারে নতুন কোনো
 *    বার্তা যোগ হলে সেটা নীরবে অনূদিত-না-হয়ে বেরোত আর কেউ ধরতে পারত না।
 *    ভাষা ঠিক করার জায়গা সার্ভার, এখানে নয়।
 */
export function ErrorBox({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  const status = error instanceof ApiError ? error.status : null;
  const forbidden = status === 403;
  const notFound = status === 404;

  const message = forbidden
    ? "You don't have access"
    : notFound
      ? "What you're looking for isn't here"
      : (error?.message ?? 'Something went wrong');

  return (
    <div
      role="alert"
      className="rounded-xl border border-brand/30 bg-brand-bg px-5 py-6 text-center"
    >
      <p className="text-sm font-medium text-brand-ink">{message}</p>

      {!forbidden && (
        <p className="mt-1 text-xs text-ink-3">
          If the server can't be reached, try again in a moment.
        </p>
      )}

      {retry && !forbidden && (
        <button
          type="button"
          onClick={retry}
          className="mt-3 rounded-md border border-brand/40 bg-surface px-3 py-1.5 text-[13px] font-medium text-brand-ink transition hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * কিছু নেই।
 *
 * ⚠️ `hint` ঐচ্ছিক নয় বললেই চলে — "কিছু নেই" একা বললে ব্যবহারকারী বুঝতে
 *    পারে না এটা স্বাভাবিক না কি ভাঙা। "এজেন্ট বসানো হয়েছে তো?" ধরনের
 *    একটা বাক্যই পার্থক্যটা তৈরি করে।
 */
export function Empty({
  title,
  hint,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** "Add staff" ধরনের পরের পদক্ষেপ */
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-3">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * ছোট্ট সতর্কবার্তা — সার্ভারের `caveat` ফিল্ড দেখানোর জন্য।
 *
 * ⭐ কিছু রেসপন্সে `caveat` আসে: "When one person runs more than one device
 * the time is added up…"। ⚠️ ওটা **লুকিয়ে ফেলা যাবে না** — অনুপাত ঠিক
 * থাকলেও পরম সেকেন্ডকে কাজের ঘণ্টা ধরা যায় না, আর সেটা না জানালে কেউ ভুল
 * সিদ্ধান্ত নেবে।
 * সরু আউটলাইন, সলিড লাল নয় — এটা ভুল নয়, শুধু একটা শর্ত।
 */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md border border-line bg-paper px-3 py-2 text-xs text-ink-3">
      <span aria-hidden className="mr-1.5">
        ⚠
      </span>
      {children}
    </p>
  );
}
