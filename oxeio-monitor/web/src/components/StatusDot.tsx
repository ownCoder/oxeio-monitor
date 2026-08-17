import type { LiveStatus } from '../api/dashboard';

/**
 * E01 — কার্ডের **তিনটে** অবস্থা: কাজ করছেন · থেমে আছেন · নেই।
 *
 * ⚠️⚠️ **এখানে একটা চতুর্থ অবস্থা ছিল — `agent_down`, সলিড লাল।** সেটা
 *    তুলে দেওয়া হয়েছে *(১৭ আগস্ট)*, কারণ বোর্ড কোনোদিনই নিশ্চিত করে
 *    বলতে পারত না এজেন্ট মরেছে নাকি PC বন্ধ। দুবার নিয়ম বদলেও ভুল
 *    থেকে গেছে, আর দুবারই বাড়ি চলে যাওয়া কর্মী লাল দেখিয়েছেন।
 *
 * ⭐ **এখন তিনটেই কর্মীর কথা বলে, যন্ত্রের নয়।** যন্ত্রের খবর অ্যালার্টে,
 *    যেখানে এক লাইনের ব্যাখ্যা আঁটে — রঙে আঁটে না।
 *
 * ⭐ **`active` সবুজ (`ok`), কালো নয়।** আগে কালো ছিল ("গোনা হওয়া কাজ"),
 *    কিন্তু Midnight থিমে পটভূমির সাথে মিশে গিয়ে বিন্দুটা প্রায় দেখাই
 *    যেত না। সবুজ · হলুদ · ধূসর — তিনটে সত্যিই আলাদা।
 *
 * ⚠️ রং তিনটে **`index.css`-এর টোকেন থেকেই** আসে (`ok`, `idle`,
 *    `offline`) — এখানে হেক্স লিখবেন না। লেখার জন্য
 *    `text-ok`/`text-idle`, ভরাট/বিন্দুতে `bg-ok`/`bg-idle`: index.css-এর
 *    সেতুটা `text-*` দুটোকে পড়ার মতো গাঢ় জোড়ায় পাঠায়।
 *
 * ⚠️ **"Idle" ≠ "Inactive"** — এটা এই মুহূর্তের অবস্থা (কি-বোর্ড-মাউস
 *    চুপচাপ), চাকরি ছেড়ে যাওয়া নয়। ওটা `EmployeePicker`-এ "Inactive"।
 */
export const STATUS_LABEL: Record<LiveStatus, string> = {
  active: 'Working',
  idle: 'Idle',
  offline: 'Offline',
};

/** টুলটিপে "কেন এই রঙ" — ব্যবহারকারী অনুমান করতে বাধ্য হবে না */
const STATUS_HINT: Record<LiveStatus, string> = {
  active: 'Was active in the last segment',
  idle: 'Agent is running, but nothing recent',
  offline: 'No response for over 90 seconds — PC off, asleep, or no internet',
};

const DOT_CLASS: Record<LiveStatus, string> = {
  active: 'bg-ok',
  idle: 'bg-idle',
  offline: 'bg-offline',
};

export function StatusDot({
  status,
  className = '',
}: {
  status: LiveStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-block size-2 flex-none rounded-full ${DOT_CLASS[status]} ${className}`}
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={`${STATUS_LABEL[status]} — ${STATUS_HINT[status]}`}
    />
  );
}

/**
 * ⚠️ তিনটেই **আউটলাইন** চিপ, কোনোটাই ভরাট নয়। আগে `agent_down` ভরাট লাল
 *    ছিল যাতে আলাদা করে চোখে পড়ে; সেটা উঠে যাওয়ায় এখন তিনটে সমান
 *    ওজনের — আর সেটাই ঠিক, কারণ তিনটেই সমান স্বাভাবিক ঘটনা।
 */
const CHIP_CLASS: Record<LiveStatus, string> = {
  active: 'border-ok/45 bg-ok/10 text-ok',
  idle: 'border-idle/45 bg-idle/10 text-idle',
  offline: 'border-line bg-surface text-ink-3',
};

/** নামসহ চিপ — কার্ডের মাথায় বা টেবিলের কলামে */
export function StatusChip({ status }: { status: LiveStatus }) {
  return (
    <span
      title={STATUS_HINT[status]}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${CHIP_CLASS[status]}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${DOT_CLASS[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * বোর্ডের নিচে রঙের ব্যাখ্যা।
 * ⚠️ এটা বাদ দেবেন না — বিন্দুর রঙের মানে কেউ অনুমান করতে পারে না, আর
 *    ভুল অনুমানের ফল হয় ভুল অভিযোগ।
 */
export function StatusLegend() {
  const all: LiveStatus[] = ['active', 'idle', 'offline'];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-3">
      {all.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <StatusDot status={status} />
          {STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  );
}
