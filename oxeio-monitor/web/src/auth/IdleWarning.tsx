import { useEffect, useRef } from 'react';

/**
 * I09 — "Signing out in 60 seconds"।
 *
 * ⚠️ `settings/ui.tsx`-এর `Modal` ব্যবহার করা হয়নি, ইচ্ছাকৃতভাবে: ওটা
 *    `document.body`-র স্ক্রল বন্ধ করে আর পুরো পর্দা ঢেকে দেয়। আধঘণ্টা ধরে
 *    রিপোর্ট পড়তে থাকা ব্যবহারকারীর সামনে হঠাৎ গোটা পাতা ঢেকে ফেলা মানে
 *    তার কাজেই বাধা — অথচ এই বার্তার উদ্দেশ্যই ছিল বাধা **কমানো**। তাই
 *    কোণায় বসা একটা toast; পেছনের পাতা পুরোপুরি ব্যবহারযোগ্য থাকে।
 *
 * ⚠️ `role="alertdialog"` + `aria-live` — সময়ের ব্যাপারটা স্ক্রিন রিডারে
 *    না শোনালে এটা ঠিক সেই "চুপচাপ লগআউট"-ই হতো, শুধু অন্য কারো জন্য।
 */
export function IdleWarning({
  secondsLeft,
  onStay,
  onLogoutNow,
}: {
  secondsLeft: number;
  onStay: () => void;
  onLogoutNow: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * ⚠️ **যেকোনো ক্লিকে বাতিল** — স্পেসিফিকেশনের শর্ত। `useIdleLogout`-এর
   *    নিজের লিসেনারও এটা করে, কিন্তু সেটা ৫ সেকেন্ড থ্রটল করা; সতর্কবার্তা
   *    চলাকালীন ওই দেরিটুকুও অস্বস্তিকর, কারণ ব্যবহারকারী ক্লিক করেও
   *    কাউন্টডাউন কমতে দেখত। তাই এখানে থ্রটল ছাড়া, capture ধাপে।
   *
   * ⚠️ বাক্সের **ভেতরের** ক্লিক বাদ — নইলে "এখনই বেরোই" কাজই করত না:
   *    `mousedown`-এই `onStay` চলে বাক্সটা unmount হয়ে যেত, আর `click`
   *    ইভেন্টটা আর কোনো বোতামে পৌঁছাত না।
   */
  useEffect(() => {
    const cancel = (e: Event): void => {
      const target = e.target;
      if (target instanceof Node && boxRef.current?.contains(target)) return;
      onStay();
    };
    const events = ['mousedown', 'keydown', 'touchstart'] as const;
    for (const ev of events) {
      window.addEventListener(ev, cancel, { capture: true });
    }
    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, cancel, { capture: true });
      }
    };
  }, [onStay]);

  return (
    <div
      ref={boxRef}
      role="alertdialog"
      aria-live="assertive"
      aria-label="Your session is about to end"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-sm rounded-xl border border-brand/40 bg-surface p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4"
    >
      {/*
        ⚠️ একবচন/বহুবচন — "1 seconds" লেখাটা কাউন্টডাউনের শেষ সেকেন্ডে
           প্রতিবারই চোখে পড়ত।
      */}
      <h2 className="text-[14px] font-semibold text-brand-ink">
        Signing out in {secondsLeft} second{secondsLeft === 1 ? '' : 's'}
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        Nothing has happened for a while, so the session will close for
        security. Any click or key press cancels this.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onStay}
          className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[13px] font-medium text-on-ink transition hover:bg-ink-strong focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          Stay signed in
        </button>
        <button
          type="button"
          onClick={onLogoutNow}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-brand hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          Sign out now
        </button>
      </div>
    </div>
  );
}
