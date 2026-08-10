import type { ReactNode } from 'react';

/**
 * পেজের শিরোনাম + অ্যাকশন বার।
 *
 * ⭐ ছ-টা পেজেই এটা দিয়ে শুরু হলে শিরোনামের আকার, ফাঁক আর মোবাইলের
 * ভাঙাটা এক জায়গায় ঠিক করা যায়।
 *
 * ⚠️ E12 — ফোনে `actions` শিরোনামের **নিচে** নেমে যায় (`flex-wrap`)।
 *    একই সারিতে জোর করে রাখলে তারিখ বাছাই আর বোতাম চেপে গিয়ে অপঠ্য হতো।
 */
export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  /** এক লাইনের ব্যাখ্যা — কী দেখানো হচ্ছে, কোন তারিখের */
  subtitle?: ReactNode;
  /** তারিখ বাছাই, ডাউনলোড, রিফ্রেশ — ডানদিকে */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-end gap-2">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * পেজের ভেতরের অংশের শিরোনাম।
 * ডানদিকে ছোট ব্যাখ্যা (`hint`) — যেমন "রিং = মাসের 208 ঘণ্টার অংশ"।
 */
export function SectionHead({
  title,
  hint,
  actions,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * সাধারণ বোতাম — সরু আউটলাইন, hover-এ ব্র্যান্ড লাল।
 *
 * ⚠️ **সলিড লাল বোতাম বানাবেন না** — সলিড লাল মানে "মনোযোগ দরকার"
 *    (ভুল, এজেন্ট বন্ধ)। বিপজ্জনক কাজে `tone="danger"`, বাকি সব জায়গায়
 *    ডিফল্ট। প্রধান কাজে `tone="primary"` (কালো, লাল নয়)।
 */
export function Button({
  children,
  onClick,
  type = 'button',
  tone = 'default',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  tone?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
}) {
  const style =
    tone === 'primary'
      ? 'bg-ink text-white border-ink hover:bg-black'
      : tone === 'danger'
        ? 'bg-brand text-white border-brand hover:bg-brand-ink'
        : 'bg-surface text-ink-2 border-line hover:border-brand hover:text-ink';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md border px-3 py-1.5 text-[13px] font-medium transition focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
    >
      {children}
    </button>
  );
}
