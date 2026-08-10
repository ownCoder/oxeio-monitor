import type { LiveStatus } from '../api/dashboard';

/**
 * E01 — কার্ডের চারটে অবস্থা।
 *
 * ⭐⚠️ **`agent_down` আর `offline` কখনো একই রঙে দেখানো যাবে না।**
 *    · `agent_down` = এজেন্ট মরে গেছে → IT-র সমস্যা → **সলিড লাল**
 *    · `offline`    = কর্মী চলে গেছে → স্বাভাবিক → ধূসর
 *    একটাকে আরেকটার রঙে দেখালে হয় মিথ্যা অভিযোগ হয়, নয় আসল সমস্যা চাপা
 *    পড়ে — আর ঠিক এই দুটো ভুল ঠেকানোই ফিচারটার কারণ।
 *
 * ⭐ `active` কালো, কারণ কালো = গোনা হওয়া কাজ। সবুজ নেই — ব্র্যান্ডে
 *    মাত্র তিনটে রঙ (কালো · সাদা · লাল)।
 */
export const STATUS_LABEL: Record<LiveStatus, string> = {
  active: 'কাজ করছেন',
  idle: 'নিষ্ক্রিয়',
  offline: 'অফলাইন',
  agent_down: 'এজেন্ট বন্ধ',
};

/** টুলটিপে "কেন এই রঙ" — ব্যবহারকারী অনুমান করতে বাধ্য হবে না */
const STATUS_HINT: Record<LiveStatus, string> = {
  active: 'শেষ সেগমেন্টে সক্রিয় ছিলেন',
  idle: 'এজেন্ট চলছে, কিন্তু সাম্প্রতিক কোনো কাজ নেই',
  offline: '90 সেকেন্ডের বেশি সাড়া নেই — PC বন্ধ বা ইন্টারনেট নেই',
  agent_down: '10 মিনিটের বেশি সাড়া নেই — এজেন্ট চলছে না, দেখা দরকার',
};

const DOT_CLASS: Record<LiveStatus, string> = {
  active: 'bg-ink',
  idle: 'bg-ink-3/60',
  offline: 'bg-line',
  // ⭐ একমাত্র সলিড লাল — মনোযোগ দাবি করে
  agent_down: 'bg-brand',
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

const CHIP_CLASS: Record<LiveStatus, string> = {
  active: 'border-ink/25 bg-paper text-ink',
  idle: 'border-line bg-paper text-ink-2',
  offline: 'border-line bg-surface text-ink-3',
  // সলিড লাল — বাকি সবের চেয়ে আলাদা করে চোখে পড়ে
  agent_down: 'border-brand bg-brand text-white',
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
