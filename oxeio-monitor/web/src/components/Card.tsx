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
  sub,
  tone = 'counted',
}: {
  label: ReactNode;
  value: ReactNode;
  /** `/15` বা `%` — ছোট করে পাশে বসে */
  unit?: ReactNode;
  /**
   * ⭐⭐ সংখ্যার নিচে **এক লাইনের প্রেক্ষাপট** — মকআপ ক-এর টাইলে যা ছিল
   * ("১ কর্মদিবস পেরিয়েছে", "টার্গেট ৮ঘ", "সব heartbeat তাজা")।
   *
   * ⚠️⚠️ এটা সাজসজ্জা নয়। একটা কাঁচা সংখ্যা প্রায়ই **দুভাবে পড়া যায়**, আর
   * তখন মানুষ যেটা ভয় পান সেটাই ধরে নেন: "pace −৬ঘ" ভয়ংকর শোনায় যতক্ষণ না
   * জানা যায় মাসের **একটাই** কর্মদিবস পেরিয়েছে। ⭐ নিয়মটা তাই — এখানে
   * বসবে কেবল সেই কথাটা যা **সংখ্যাটাকে ভুল পড়া থেকে বাঁচায়**, ফাঁকা
   * থাকলে কিছুই নয়। "সব ঠিক আছে" জাতীয় আশ্বাস এখানে নিষিদ্ধ।
   */
  sub?: ReactNode;
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
      {/* ⭐ মকআপের `.kpi .lbl` — ছোট, বড় হাতের, ফাঁকা-অক্ষরে */}
      <div className="text-[9px] tracking-[0.07em] text-ink-3 uppercase">
        {label}
      </div>
      <div className={`num mt-0.5 text-xl leading-tight font-semibold ${color}`}>
        {value}
        {unit && (
          <small className="ml-1 text-xs font-medium text-ink-3">{unit}</small>
        )}
      </div>
      {/*
        ⚠️ `min-h` নেই — যে টাইলে প্রেক্ষাপট নেই সেখানে খালি জায়গা রাখা
           হয় না। গ্রিডের সারি এমনিতেই সবচেয়ে লম্বা টাইলের মাপে মেলে,
           তাই সবগুলোর নিচের কিনারা এক থাকে।
      */}
      {sub && (
        <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{sub}</div>
      )}
    </div>
  );
}

/**
 * `<Stat>`-গুলোর গ্রিড — এক পিক্সেল ফাঁক দিয়ে বানানো রেখা (মকআপের `.summary`)।
 * E12 — ফোনে নিজে থেকেই কম কলামে নেমে আসে।
 */
export function StatRow({ children }: { children: ReactNode }) {
  /*
    ⭐⭐ **মকআপ ক-এর KPI সারি — টাইলের মাঝে শুধু খাড়া রেখা, বাক্স নয়।**

    ⚠️ এখানে আগে গোটা সারিটার চারপাশে বর্ডার + `rounded-xl` ছিল, অর্থাৎ
    দেখতে আরেকটা কার্ড। মকআপে ওটা কার্ড নয় — পাতার **মাথা**, আর তাই
    নিচের আসল কার্ডগুলোর সাথে প্রতিযোগিতা করে না।

    ⚠️⚠️ **আর এখানে আমি একবার উল্টো দিকে গিয়েছিলাম** — বর্ডারটা তুলে
    `border-y` করে দিয়েছিলাম, "মকআপে বাক্স নেই" ভেবে। মকআপের CSS আসলে
    বলে `border: 1px solid var(--line); border-radius: 8px` — বাক্সটা
    আছেই। ⭐ চোখে আন্দাজ না করে **CSS-টা পড়ে** ধরা পড়েছে।

    ⭐ `gap-px` + পটভূমির রং = ভাগ-রেখা, বর্ডার নয়। বর্ডার দিলে ফোনে
    সারি বদলানোর সময় দুটো রেখা পাশাপাশি পড়ে মোটা দেখাত।
  */
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(126px,1fr))] gap-px overflow-hidden rounded-lg border border-line bg-line">
      {children}
    </div>
  );
}
