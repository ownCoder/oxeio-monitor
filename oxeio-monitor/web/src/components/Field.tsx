import type { InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, id, ...props }: FieldProps) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </span>
      <input
        id={id}
        {...props}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[15px] outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function SubmitButton({
  children,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="w-full rounded-md bg-ink px-4 py-2.5 text-[15px] font-medium text-on-ink transition hover:bg-ink-strong focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? 'Please wait…' : children}
    </button>
  );
}

/**
 * ভুলের বার্তা — লাল, কারণ এটা মনোযোগ দাবি করে।
 *
 * ⚠️ ভরাট নয়, **আভা + লাল লেখা** (`brand-bg` / `brand-ink`)। ফর্মে একটার
 *    পর একটা ভুল আসতে পারে; ভরাট লাল বাক্স পরপর দুটো বসলে পুরো পর্দাটাই
 *    সংকটের মতো দেখাত।
 */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-brand/30 bg-brand-bg px-3 py-2 text-sm text-brand-ink"
    >
      {children}
    </p>
  );
}
