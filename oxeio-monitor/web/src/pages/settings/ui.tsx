import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiError } from '../../api/client';
import { Button } from '../../components/Page';

/**
 * সেটিংস পর্দার নিজস্ব ছোট যন্ত্রপাতি — মোডাল, ফর্মের ঘর, নিশ্চিতকরণ,
 * আর "একবারই দেখা যাবে" গোপন কোডের বাক্স।
 *
 * ⭐ এগুলো ইচ্ছাকৃতভাবে `src/components/`-এ তোলা হয়নি: গোটা পণ্যে
 *    **লেখালেখির ফর্ম আছে কেবল এই এক পর্দায়** (স্টাফের জন্য কোনো বোতামই
 *    নেই — পণ্যের কঠিন নিয়ম)। সাধারণ ভাণ্ডারে রাখলে বাকি ছ-টা পেজ এমন
 *    কম্পোনেন্ট বয়ে বেড়াত যেগুলো তারা কোনোদিন ব্যবহার করবে না।
 */

const INPUT =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60';

// ── বার্তা ──────────────────────────────────────────────────────────────────

/**
 * ⚠️ সার্ভারের বার্তাগুলো **বাংলায় লেখা** (`dto.ts`, `*.service.ts`) — তাই
 *    সেগুলোই হুবহু দেখানো হয়, নিজের ভাষায় অনুবাদ করা হয় না। "বেতন
 *    '13000' ধাঁচে দিতে হবে" বার্তাটা "সেভ করা গেল না"-র চেয়ে হাজার গুণ
 *    কাজের, আর ওটাই মালিককে ভুলটা শুধরে দেয়।
 *
 * ব্যতিক্রম ৪০৩: সার্ভারের Nest-জেনারেটেড বার্তাটা ইংরেজি ("Forbidden
 * resource"), তাই ওটুকু নিজেরাই লিখি।
 */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "You don't have access";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

/**
 * ছোট বার্তার বাক্স।
 *
 * ⭐ রঙের নিয়ম: `attention` (সলিড লাল লেখা + লাল ব্যাকগ্রাউন্ড) শুধু
 *    **ভুল বা বিপদের** জন্য। শর্ত বা ব্যাখ্যা `info` — সরু ধূসর, কারণ
 *    সব কিছু লাল করে দিলে লাল রঙের মানেই হারিয়ে যায়।
 */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'attention';
  children: ReactNode;
}) {
  const style =
    tone === 'attention'
      ? 'border-brand/30 bg-brand-bg text-brand-ink'
      : 'border-line bg-paper text-ink-2';

  return (
    <p className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${style}`}>
      {children}
    </p>
  );
}

/** mutation ব্যর্থ হলে সার্ভারের বার্তাটাই দেখায়। `null` হলে কিছুই না। */
export function ServerError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <div role="alert">
      <Notice tone="attention">{messageOf(error)}</Notice>
    </div>
  );
}

// ── হুক ─────────────────────────────────────────────────────────────────────

export interface Mutation {
  busy: boolean;
  error: Error | null;
  /** কাজটা চালায়, ব্যর্থ হলে `error`-এ সার্ভারের বার্তা রেখে দেয় */
  run: (task: () => Promise<void>) => void;
  reset: () => void;
}

/**
 * লেখালেখির কাজের তিনটে অবস্থা এক জায়গায়: চলছে · ব্যর্থ · হয়ে গেছে।
 *
 * ⚠️ ব্যর্থ হলে মোডাল **বন্ধ হয় না** — ব্যবহারকারীর টাইপ করা সবকিছু
 *    ধরে রাখা হয়। বন্ধ করে দিলে "empCode-এ শুধু অক্ষর চলবে" বার্তা দেখে
 *    সে আবার গোটা ফর্মটা ভরত।
 */
export function useMutation(): Mutation {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = useCallback((task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    void task().then(
      () => {
        // সফল হলে বেশিরভাগ সময় মোডালটা বন্ধ হয়ে যায় (unmount) — তাই
        // বেঁচে আছে কি না দেখে তবেই state ছোঁয়া
        if (aliveRef.current) setBusy(false);
      },
      (err: unknown) => {
        if (!aliveRef.current) return;
        setBusy(false);
        setError(err instanceof Error ? err : new Error(String(err)));
      },
    );
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { busy, error, run, reset };
}

/**
 * টাইপ থামার পর মান স্থির হলে তবেই ফেরত দেয়।
 *
 * ⚠️ ছাড়া উপায় ছিল না: `useApi`-র deps-এ সরাসরি সার্চ বাক্সের মান দিলে
 *    প্রতিটা অক্ষরে একটা করে রিকোয়েস্ট যেত, আর deps বদলালে `data` শূন্য
 *    হয় বলে টেবিলটা প্রতি অক্ষরে ঝিকমিক করত।
 */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

// ── মোডাল ───────────────────────────────────────────────────────────────────

/**
 * মোডাল।
 *
 * ⚠️ `dismissible={false}` দিলে Escape বা বাইরে ক্লিকে বন্ধ হয় না —
 *    এনরোলমেন্ট কোডের মতো **একবারই দেখানো** জিনিসের জন্য। ওখানে ভুল করে
 *    Escape চাপলে কোডটা চিরতরে হারিয়ে যেত, আর নতুন কোড বানানো ছাড়া উপায়
 *    থাকত না।
 *
 * ⚠️ E12 — ফোনে মোডালটা নিচ থেকে ওঠে (`items-end`) আর পুরো চওড়া হয়;
 *    মাঝখানে বসালে ছোট পর্দায় কি-বোর্ড উঠে এলে ফর্মের অর্ধেক ঢেকে যেত।
 */
export function Modal({
  title,
  hint,
  onClose,
  children,
  footer,
  dismissible = true,
}: {
  title: ReactNode;
  hint?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissible, onClose]);

  // পেছনের পাতাটা যেন স্ক্রল না করে — নইলে ফোনে মোডাল টানতে গিয়ে
  // পেছনের তালিকাটাই সরে যায়
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/40 sm:items-center sm:p-4"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-t-xl border border-line bg-surface shadow-lg sm:rounded-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[14px] font-semibold tracking-tight">
              {title}
            </h2>
            {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close"
              className="rounded-md border border-line px-2 py-1 text-[13px] text-ink-2 transition hover:border-brand hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              ✕
            </button>
          )}
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

// ── ফর্মের ঘর ───────────────────────────────────────────────────────────────

function FieldShell({
  label,
  hint,
  htmlFor,
  required,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[12px] font-medium text-ink-2"
      >
        {label}
        {required && (
          <span aria-hidden className="ml-1 text-brand">
            *
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{hint}</p>
      )}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  type = 'text',
  required,
  disabled,
  mono,
  min,
  max,
  step,
  maxLength,
  autoFocus,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  /**
   * ⚠️ `'month'` যোগ করা হয়েছে জামানতের শুরুর মাসের জন্য — প্রশ্নটা
   *    "কোন মাস", তাই দিন চাওয়া মানে মালিককে এমন সিদ্ধান্ত নিতে বাধ্য
   *    করা যেটার কোনো অর্থই নেই। ব্রাউজার নিজেই `YYYY-MM` দেয়, তাই
   *    হাতে ধাঁচ মেলানোর ঝুঁকিও থাকে না।
   */
  /**
   * ⚠️ `password` — ব্রাউজার লেখাটা ঢেকে রাখে, আর সেটা এখানে **দরকার**:
   * মালিক কর্মীর পাসওয়ার্ড বসানোর সময় পাশে কেউ দাঁড়িয়ে থাকতে পারেন
   * (২৩ আগস্ট)।
   */
  type?: 'text' | 'email' | 'date' | 'number' | 'time' | 'month' | 'password';
  required?: boolean;
  disabled?: boolean;
  /** প্যাটার্ন, কোড, সংখ্যা — সমান প্রস্থের অক্ষরে পড়া সহজ */
  mono?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  maxLength?: number;
  /** মোডাল খুললে প্রথম ঘরেই কার্সার — একটা বাড়তি ক্লিক বাঁচে */
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} htmlFor={id} required={required}>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} ${mono ? 'num' : ''}`}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  rows = 3,
  required,
  maxLength,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} htmlFor={id} required={required}>
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </FieldShell>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  required,
  disabled,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  hint?: ReactNode;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} htmlFor={id} required={required}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** ফর্মের ঘরগুলোর গ্রিড — E12: ফোনে এক কলাম, বড় পর্দায় দুই */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3.5 sm:grid-cols-2">{children}</div>;
}

/** পুরো চওড়া জুড়ে বসা ঘর (গ্রিডের ভেতরে) */
export function FullWidth({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>;
}

// ── টেবিলের ছোট বোতাম ও চিপ ─────────────────────────────────────────────────

/**
 * টেবিলের সারিতে বসার মতো ছোট বোতাম।
 *
 * ⚠️ সলিড লাল নয়, শুধু লেখাটা লাল (`danger`) — সলিড লাল মানে "মনোযোগ
 *    দরকার", আর প্রতিটা সারিতে একটা করে সলিড লাল বোতাম থাকলে গোটা
 *    টেবিলটাই বিপদের মতো দেখাত।
 */
export function MiniButton({
  children,
  onClick,
  tone = 'default',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger' | 'good';
  disabled?: boolean;
  title?: string;
}) {
  /**
   * ⭐ রং **করণীয় ধরে**, গুরুত্ব ধরে নয় *(২৩ আগস্ট, মালিকের চাওয়া)*:
   * সবুজ = কাজ শেষ, লাল = বাদ/মুছে ফেলা।
   *
   * ⚠️ কেবল **বর্ডার ও লেখা** রঙিন, ভরাট নয় — টার্গেটের তালিকায় এক
   * সারিতে চারটে বোতাম বসে, আর সবগুলো ভরাট হলে চোখ কোথায় যাবে বোঝাই
   * যেত না। ⚠️ রঙই একমাত্র সংকেত নয়: লেখাটাও ("Complete"/"Skip") নিজেই
   * বলে দেয়, তাই বর্ণান্ধ কারো কাছে কিছু হারায় না।
   */
  const style =
    tone === 'danger'
      ? 'border-brand/50 text-brand-ink hover:border-brand hover:bg-brand-bg'
      : tone === 'good'
        ? 'border-ok/50 text-ok-ink hover:border-ok hover:bg-ok-bg'
        : 'border-line text-ink-2 hover:border-brand hover:text-ink';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      /*
       * ⚠️ `tap` এখানে সবচেয়ে জরুরি — এই বোতামগুলো ছিল সবচেয়ে ছোট (~২৮px)
       *    আর `RowActions`-এ পাশাপাশি বসে, অর্থাৎ ভুল বোতামে চাপ পড়ার
       *    সম্ভাবনাও সবচেয়ে বেশি। সেটিংসে ভুল চাপ মানে ভুল কাজ হয়ে যাওয়া।
       */
      className={`tap rounded-md border bg-surface px-2 py-1 text-[12px] whitespace-nowrap transition focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
    >
      {children}
    </button>
  );
}

/** সারির কাজগুলো একসাথে — ফোনে নিচে নেমে যায় */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-1.5">{children}</div>;
}

/**
 * অবস্থার চিপ। ⭐ সলিড লাল **শুধু** সত্যিকারের সমস্যায় (বাতিল ডিভাইস) —
 * নিষ্ক্রিয় কর্মী সমস্যা নয়, সেটা ধূসর।
 */
export function Chip({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'counted' | 'muted' | 'attention' | 'pending';
}) {
  /**
   * ⚠️ `pending` আম্বার, `attention` লাল — পার্থক্যটা ইচ্ছাকৃত।
   * লাল মানে "কিছু ভেঙেছে"; আম্বার মানে "একটা কাজ বাকি"। সই না নেওয়া
   * কোনো ব্যর্থতা নয়, কিন্তু রোলআউটের আগে সেটা চোখে পড়া দরকার —
   * ট্রে জানালায় "পিছিয়ে আছে"-র জন্যও একই যুক্তিতে আম্বার।
   */
  const style =
    tone === 'attention'
      ? 'border-brand/40 bg-brand-bg text-brand-ink'
      : tone === 'pending'
        ? 'border-idle/40 text-idle-ink'
        : tone === 'counted'
          ? 'border-line bg-paper text-ink'
          : 'border-line bg-surface text-ink-3';

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap ${style}`}
    >
      {children}
    </span>
  );
}

/** সরানো যায় এমন ফিল্টার চিপ — audit log-এ "ইউজার: রিমা ✕" */
export function FilterChip({
  children,
  onClear,
}: {
  children: ReactNode;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-bg px-2.5 py-1 text-[11.5px] text-brand-ink">
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove filter"
        className="rounded-full px-1 leading-none transition hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
      >
        ✕
      </button>
    </span>
  );
}

// ── নিশ্চিতকরণ ──────────────────────────────────────────────────────────────

/**
 * বিপজ্জনক কাজের আগে নিশ্চিত করা।
 *
 * ⭐ `withReason` দিলে কারণ লেখা **বাধ্যতামূলক** (সার্ভারও ৩ অক্ষর চায়) —
 *    দূর থেকে কারো মেশিন থামিয়ে দেওয়া বা কাউকে নিষ্ক্রিয় করা এমন কাজ
 *    যার ব্যাখ্যা ছয় মাস পরেও লাগতে পারে, আর তখন কারো মনে থাকবে না।
 */
export function ConfirmDialog({
  title,
  intro,
  warning,
  confirmLabel,
  tone = 'danger',
  withReason = false,
  reasonLabel = 'Reason',
  reasonHint = 'At least 3 characters — this is what the audit log will keep',
  extra,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: ReactNode;
  intro?: ReactNode;
  /** যা ঘটবে তার স্পষ্ট পরিণাম — লুকোনো যাবে না */
  warning?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  withReason?: boolean;
  reasonLabel?: string;
  reasonHint?: ReactNode;
  /** অতিরিক্ত ঘর — যেমন "শেষ কর্মদিবস" তারিখ */
  extra?: ReactNode;
  busy: boolean;
  error: Error | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const tooShort = withReason && reason.trim().length < 3;

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone={tone}
            disabled={busy || tooShort}
            onClick={() => onConfirm(reason.trim())}
            title={tooShort ? 'Write a reason (at least 3 characters)' : undefined}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {intro && <p className="text-[13px] text-ink-2">{intro}</p>}
        {warning && <Notice tone="attention">{warning}</Notice>}
        {extra}
        {withReason && (
          <TextAreaField
            label={reasonLabel}
            hint={reasonHint}
            value={reason}
            onChange={setReason}
            required
            maxLength={500}
            rows={2}
          />
        )}
        <ServerError error={error} />
      </div>
    </Modal>
  );
}

// ── একবারই দেখা যাবে ────────────────────────────────────────────────────────

/**
 * ⭐⚠️ এনরোলমেন্ট কোড ও অস্থায়ী পাসওয়ার্ড — সার্ভারে শুধু hash জমা থাকে,
 * তাই **এই একটিবারই** দেখা যাবে।
 *
 * তাই তিনটে রক্ষাকবচ একসাথে:
 *   ১· মোডালটা `dismissible={false}` — Escape বা বাইরে ক্লিকে বন্ধ হয় না
 *   ২· বন্ধ করার বোতামটা ততক্ষণ নিষ্ক্রিয় যতক্ষণ না "সংরক্ষণ করেছি" টিক পড়ে
 *   ৩· কোডটা বড় করে, সমান-প্রস্থ অক্ষরে — টুকে নিতে গিয়ে যেন ভুল না হয়
 */
export function SecretModal({
  title,
  label,
  secret,
  note,
  meta,
  onClose,
}: {
  title: ReactNode;
  label: string;
  secret: string;
  /** কবে পর্যন্ত চলবে, কার জন্য — কোডের নিচে ছোট করে */
  note?: ReactNode;
  meta?: ReactNode;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');

  const copy = (): void => {
    // ⚠️ `navigator.clipboard` শুধু নিরাপদ origin-এ থাকে (HTTPS বা
    //    localhost)। http-এ চালালে এটা `undefined` — তখন বোতামটা নীরবে
    //    কিছুই করত না, আর ব্যবহারকারী ভাবত কপি হয়ে গেছে।
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      setCopyState('failed');
      return;
    }

    void clipboard.writeText(secret).then(
      () => {
        setCopyState('ok');
        // কপি হয়ে গেলে টিকটাও বসিয়ে দেওয়া — তবু বোতামটা এক ধাপ দূরেই
        // থাকে, যাতে "বন্ধ" চাপার আগে চোখ একবার কোডটায় পড়ে
        setSaved(true);
      },
      () => setCopyState('failed'),
    );
  };

  return (
    <Modal
      title={title}
      dismissible={false}
      onClose={onClose}
      footer={
        <Button tone="primary" disabled={!saved} onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-3">
        <Notice tone="attention">
          This {label} will not be shown again — the server keeps only its
          hash. Copy it now.
        </Notice>

        <div className="rounded-lg border border-line bg-paper px-4 py-4 text-center">
          <div className="num text-xl font-semibold break-all text-ink select-all sm:text-2xl">
            {secret}
          </div>
          {note && <div className="mt-1.5 text-[11.5px] text-ink-3">{note}</div>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={copy}>Copy</Button>
          {copyState === 'ok' && (
            <span className="text-xs text-ink-3">Copied</span>
          )}
          {copyState === 'failed' && (
            <span className="text-xs text-brand-ink">
              Could not copy — select the text and copy it by hand
            </span>
          )}
        </div>

        {meta && <div className="text-xs text-ink-3">{meta}</div>}

        <label className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 accent-brand"
          />
          <span>I have copied or written down the {label}</span>
        </label>
      </div>
    </Modal>
  );
}

// ── ছোট সাহায্যকারী ─────────────────────────────────────────────────────────

/**
 * ফাঁকা ইনপুট বাক্স → `undefined` (POST-এ "ফিল্ডটা পাঠিয়ো না")।
 * ⚠️ `''` পাঠালে `@IsEmail`/`@Matches` ভেঙে ৪০০ হতো।
 */
export function orUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * ফাঁকা ইনপুট বাক্স → `null` (PATCH-এ "মানটা মুছে দাও")।
 * ⚠️ সার্ভার `undefined` (হাত দিও না) আর `null` (মুছে দাও) আলাদা করে।
 */
export function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
