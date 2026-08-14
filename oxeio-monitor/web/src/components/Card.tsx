import type { ReactNode } from 'react';

/**
 * সাদা কার্ড — পেজের প্রতিটা আলাদা অংশ এর ভেতরে বসে।
 *
 * ⚠️ ভেতরে টেবিল বা চার্ট বসালে `padded={false}` দিন, নইলে `<Table>`-এর
 *    নিজের স্ক্রল-ফ্রেমের সাথে দুটো প্যাডিং জমে গিয়ে মোবাইলে জায়গা নষ্ট হয়।
 */
export function Card({
  title,
  hint,
  actions,
  children,
  padded = true,
}: {
  title?: ReactNode;
  /** শিরোনামের নিচে ছোট ব্যাখ্যা */
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[13.5px] font-semibold tracking-tight">
                {title}
              </h3>
            )}
            {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

/**
 * একটা সংখ্যার টাইল (মকআপের `.stat`)।
 *
 * ⭐ রঙের নিয়ম: `tone="counted"` = নিরেট `ink` (গোনা হওয়া কাজ), `"muted"`
 * = ধূসর (গোনা হয়নি), `"attention"` = লাল (ঘাটতি, এজেন্ট বন্ধ)। ⚠️ সব
 * টাইল লাল করে দিলে লাল রঙের মানেই হারিয়ে যায় — একটা পর্দায় একটার বেশি
 * লাল টাইল রাখবেন না।
 *
 * ⚠️ `ink`-কে "কালো" ভাববেন না — Midnight থিমে ওটা প্রায় সাদা (#e8ecf1)।
 * পার্থক্যটা **নিরেট বনাম ম্লান**, কালো বনাম ধূসর নয়; পর্দার লেখাতেও তাই
 * রঙের নাম না লিখে "Solid / grey" লেখা হয়।
 *
 * ⚠️ `value` সবসময় `.num` ক্লাসে বসে — নইলে ঘণ্টার হিসাব প্রতি রিফ্রেশে লাফাত।
 */
export function Stat({
  label,
  value,
  unit,
  tone = 'counted',
}: {
  label: ReactNode;
  value: ReactNode;
  /** `/15` বা `%` — ছোট করে পাশে বসে */
  unit?: ReactNode;
  /**
   * ⚠️⚠️ `attention` (লাল) **পর্দায় একটাই** — নইলে লাল রঙের মানেই হারিয়ে
   *    যায়। যা "ভালো নয় কিন্তু জরুরিও নয়" (যেমন pace পিছিয়ে থাকা), তার
   *    জন্য `behind` — হলুদ, ঠিক যেভাবে বোর্ডের বাকি জায়গায় `idle` মানে
   *    "চলছে, কিন্তু গোনা হচ্ছে না"। দুটোকে এক রঙে দেখালে মালিক আর আলাদা
   *    করতে পারতেন না কোনটায় এখনই হাত দিতে হবে।
   */
  tone?: 'counted' | 'muted' | 'attention' | 'behind';
}) {
  const color =
    tone === 'attention'
      ? 'text-brand-ink'
      : tone === 'behind'
        ? 'text-idle-ink'
        : tone === 'muted'
          ? 'text-ink-3'
          : 'text-ink';

  return (
    <div className="bg-surface px-3.5 py-2.5">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className={`num mt-0.5 text-xl leading-tight font-semibold ${color}`}>
        {value}
        {unit && (
          <small className="ml-1 text-xs font-medium text-ink-3">{unit}</small>
        )}
      </div>
    </div>
  );
}

/**
 * `<Stat>`-গুলোর গ্রিড — এক পিক্সেল ফাঁক দিয়ে বানানো রেখা (মকআপের `.summary`)।
 * E12 — ফোনে নিজে থেকেই কম কলামে নেমে আসে।
 */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(126px,1fr))] gap-px overflow-hidden rounded-xl border border-line bg-line">
      {children}
    </div>
  );
}
