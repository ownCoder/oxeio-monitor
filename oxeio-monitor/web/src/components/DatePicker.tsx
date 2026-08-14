import { shiftWorkDate, todayInDhaka } from '../lib/format';

/**
 * তারিখ বাছাই — একটা দিন, আর from–to রেঞ্জ।
 *
 * ⭐⚠️ `<input type="date">`-এর মান ঠিক `YYYY-MM-DD`, অর্থাৎ সার্ভার যা চায়
 *    হুবহু তাই। কোথাও `new Date(...)` দিয়ে ঘুরিয়ে আনার দরকার নেই — আর
 *    আনলেই টাইমজোনের ফাঁদে পড়তে হতো (`toISOString()` UTC দেয়, ঢাকায়
 *    রাত ১২টার পর সেটা **আগের তারিখ**)।
 *
 * ⚠️ `max` ডিফল্টভাবে **ঢাকার আজ** — ভবিষ্যতের তারিখ বাছার কোনো মানে নেই,
 *    আর বাছলে খালি পর্দা দেখে মনে হতো ডেটা হারিয়ে গেছে।
 */
export function DatePicker({
  value,
  onChange,
  label = 'Date',
  max = todayInDhaka(),
  min,
  /** ◀ ▶ দিয়ে আগের/পরের দিন — টাইমলাইন পেজে খুব কাজে লাগে */
  withArrows = false,
}: {
  value: string;
  onChange: (date: string) => void;
  label?: string;
  max?: string;
  min?: string;
  withArrows?: boolean;
}) {
  const atMax = max !== undefined && value >= max;

  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] text-ink-3">{label}</span>
      <span className="flex items-center gap-1">
        {withArrows && (
          <ArrowButton
            label="Previous day"
            onClick={() => onChange(shiftWorkDate(value, -1))}
            disabled={min !== undefined && value <= min}
          >
            ◀
          </ArrowButton>
        )}

        <input
          type="date"
          value={value}
          max={max}
          min={min}
          onChange={(e) => {
            // ⚠️ ব্যবহারকারী হাতে মুছে ফেললে `''` আসে — সেটা সার্ভারে
            //    পাঠালে ৪০০ হতো, তাই খালি মান উপেক্ষা করা হয়।
            if (e.target.value) onChange(e.target.value);
          }}
          className="num rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
        />

        {withArrows && (
          <ArrowButton
            label="Next day"
            onClick={() => onChange(shiftWorkDate(value, 1))}
            disabled={atMax}
          >
            ▶
          </ArrowButton>
        )}
      </span>
    </label>
  );
}

/**
 * from–to রেঞ্জ।
 *
 * ⚠️ `from > to` হলে সার্ভার ৪০০ দেয়। তাই এখানেই আটকানো হয়: একটা প্রান্ত
 *    বদলে উল্টো হয়ে গেলে অন্যটাও সাথে সরে যায় — ব্যবহারকারী এরর দেখার
 *    আগেই ব্যাপারটা মিটে যায়।
 *
 * ⚠️ রেঞ্জের সর্বোচ্চ দৈর্ঘ্য সার্ভারে ৩৭০ দিন (রিপোর্ট) / ৩৬৬ দিন
 *    (activity)। এক বছরের বেশি চাইলে ৪০০ আসবে — বার্তাটা `<ErrorBox>`
 *    নিজেই দেখাবে।
 */
export function DateRange({
  from,
  to,
  onChange,
  max = todayInDhaka(),
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  max?: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <DatePicker
        label="From"
        value={from}
        max={max}
        onChange={(next) => onChange({ from: next, to: next > to ? next : to })}
      />
      <DatePicker
        label="To"
        value={to}
        min={from}
        max={max}
        onChange={(next) =>
          onChange({ from: next < from ? next : from, to: next })
        }
      />
    </div>
  );
}

/**
 * মাস বাছাই — পে-রোল (`YYYY-MM`) ও মাসিক অগ্রগতির জন্য।
 * ⚠️ `<input type="month">`-এর মানও ঠিক `YYYY-MM`, সার্ভার যা চায়।
 */
export function MonthPicker({
  value,
  onChange,
  label = 'Month',
  max = todayInDhaka().slice(0, 7),
}: {
  value: string;
  onChange: (month: string) => void;
  label?: string;
  max?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] text-ink-3">{label}</span>
      <input
        type="month"
        value={value}
        max={max}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className="num rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
      />
    </label>
  );
}

function ArrowButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      /*
       * ⚠️ `tap` — তারিখের ◀▶ ফোনে সবচেয়ে বেশি ব্যবহৃত বোতামগুলোর একটা
       *    (আগের দিন দেখা), অথচ ছিল ~৩০px। `min-w-11`-ও দেওয়া হলো: এদের
       *    ভেতরে একটাই সরু অক্ষর, তাই শুধু উচ্চতা বাড়ালে লক্ষ্যটা লম্বা
       *    কিন্তু সরু হয়ে থাকত।
       */
      className="tap min-w-11 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-ink-2 transition hover:border-brand hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-0"
    >
      {children}
    </button>
  );
}
