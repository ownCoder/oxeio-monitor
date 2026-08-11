import type { LiveStatus } from '../api/dashboard';

/**
 * E01 — কার্ডের চারটে অবস্থা।
 *
 * ⭐⚠️ **`agent_down` আর `offline` কখনো একই রঙে দেখানো যাবে না।**
 *    · `agent_down` = এজেন্ট মরে গেছে → IT-র সমস্যা → **সলিড লাল**
 *      (`attention`, ব্র্যান্ডের লাল নয় — নাম দুটো আলাদা রাখাই আসল কথা)
 *    · `offline`    = কর্মী চলে গেছে → স্বাভাবিক → ধূসর
 *    একটাকে আরেকটার রঙে দেখালে হয় মিথ্যা অভিযোগ হয়, নয় আসল সমস্যা চাপা
 *    পড়ে — আর ঠিক এই দুটো ভুল ঠেকানোই ফিচারটার কারণ।
 *
 * ⭐ **`active` এখন সবুজ (`ok`), কালো নয়।** আগে কালো ছিল ("গোনা হওয়া
 *    কাজ"), কিন্তু Midnight থিমে কালো/সাদা পটভূমির সাথে মিশে গিয়ে
 *    বিন্দুটা প্রায় দেখাই যেত না, আর চারটে অবস্থার তিনটেই ধূসরের কোনো
 *    না কোনো ছায়া হয়ে দাঁড়াত। সবুজ · হলুদ · ধূসর · লাল — চারটে সত্যিই
 *    আলাদা।
 *
 * ⚠️ রং চারটে **`index.css`-এর টোকেন থেকেই** আসে (`ok`, `idle`,
 *    `offline`, `attention`) — এখানে হেক্স লিখবেন না। লেখার জন্য
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
  agent_down: 'Agent down',
};

/** টুলটিপে "কেন এই রঙ" — ব্যবহারকারী অনুমান করতে বাধ্য হবে না */
const STATUS_HINT: Record<LiveStatus, string> = {
  active: 'Was active in the last segment',
  idle: 'Agent is running, but nothing recent',
  offline: 'No response for over 90 seconds — PC off or no internet',
  agent_down: 'No response for over 10 minutes — the agent is not running',
};

const DOT_CLASS: Record<LiveStatus, string> = {
  active: 'bg-ok',
  idle: 'bg-idle',
  offline: 'bg-offline',
  // ⭐ একমাত্র সলিড লাল — মনোযোগ দাবি করে
  agent_down: 'bg-attention',
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
 * ⚠️ তিনটে চিপ **আউটলাইন**, একটাই ভরাট। সব কটা ভরাট করলে বোর্ডটা রঙের
 *    দেয়াল হয়ে যেত আর "এজেন্ট বন্ধ" আলাদা করে চোখে পড়ত না — অথচ
 *    বোর্ডটার পুরো কাজই ওইটুকু চোখে পড়ানো।
 */
const CHIP_CLASS: Record<LiveStatus, string> = {
  active: 'border-ok/45 bg-ok/10 text-ok',
  idle: 'border-idle/45 bg-idle/10 text-idle',
  offline: 'border-line bg-surface text-ink-3',
  // সলিড লাল — বাকি সবের চেয়ে আলাদা করে চোখে পড়ে
  agent_down: 'border-attention bg-attention text-white',
};

/** নামসহ চিপ — কার্ডের মাথায় বা টেবিলের কলামে */
export function StatusChip({ status }: { status: LiveStatus }) {
  return (
    <span
      title={STATUS_HINT[status]}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${CHIP_CLASS[status]}`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${
          status === 'agent_down' ? 'bg-white' : DOT_CLASS[status]
        }`}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * বোর্ডের নিচে রঙের ব্যাখ্যা।
 * ⚠️ এটা বাদ দেবেন না — চারটে ধূসর-কালো-লাল বিন্দুর মানে কেউ অনুমান করতে
 *    পারে না, আর ভুল অনুমানের ফল হয় ভুল অভিযোগ।
 */
export function StatusLegend() {
  const all: LiveStatus[] = ['active', 'idle', 'offline', 'agent_down'];
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
