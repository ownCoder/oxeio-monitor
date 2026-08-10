import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { LiveCard, LiveStatus } from '../../api/dashboard';
import type { GalleryItem } from '../../api/screenshots';
import { Duration } from '../../components/Duration';
import { ProgressRing } from '../../components/ProgressRing';
import { StatusChip } from '../../components/StatusDot';
import { formatAgo, formatHours, formatTime } from '../../lib/format';

/**
 * E01 · E02 · E03 — বোর্ডের একটা কার্ড।
 *
 * মকআপের `.pcard` — বাঁয়ে ৩px স্ট্যাটাস-পটি, উপরে নাম + মাসিক রিং,
 * তারপর মাসের ঘণ্টা, আজকের ঘণ্টা আলাদা করে, সর্বশেষ স্ক্রিনশট, নিচে চিপ
 * ও শেষ heartbeat।
 */

/**
 * বাঁ দিকের পটির রঙ।
 *
 * ⚠️ `StatusDot`-এর ভেতরের `DOT_CLASS` এক্সপোর্ট করা নেই আর
 *    `src/components/` ছোঁয়া বারণ, তাই নিয়মটা এখানে আবার লেখা হলো —
 *    **হুবহু একই নিয়ম**: `agent_down` একমাত্র সলিড লাল (IT-র সমস্যা),
 *    `offline` ধূসর (কর্মী চলে গেছে — স্বাভাবিক)। দুটো মিলিয়ে ফেললে হয়
 *    মিথ্যা অভিযোগ হয়, নয় আসল সমস্যা চাপা পড়ে।
 */
const EDGE: Record<LiveStatus, string> = {
  active: 'bg-ink',
  idle: 'bg-ink-3/60',
  offline: 'bg-line',
  agent_down: 'bg-brand',
};

export function PersonCard({
  card,
  shot,
  onOpenShot,
}: {
  card: LiveCard;
  /** সর্বশেষ স্ক্রিনশট — আজ কোনো ছবি না থাকলে `null` */
  shot: GalleryItem | null;
  onOpenShot: () => void;
}) {
  const worked = card.todayWorkedSec > 0;

  return (
    <article className="relative flex flex-col gap-2.5 overflow-hidden rounded-xl border border-line bg-surface p-3 transition hover:border-brand/40">
      {/* মকআপের `.pcard::before` — এক নজরে অবস্থা */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[3px] ${EDGE[card.status]}`}
      />

      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          {/*
            ⭐ পুরো কার্ডটাই লিঙ্ক, কিন্তু `<a>`-এর **ভেতরে** বোতাম বসানো
               যায় না (স্ক্রিনশটের থাম্বনেইলটা বোতাম)। তাই লিঙ্কটা শুধু
               নামের উপরে, আর `after:inset-0` দিয়ে সেটাকে পুরো কার্ডে
               ছড়িয়ে দেওয়া হয়েছে — থাম্বনেইল তার উপরে (`z-10`) বসে।
               ফলে কি-বোর্ডে দুটো আলাদা গন্তব্য পাওয়া যায়, HTML-ও বৈধ থাকে।
          */}
          <Link
            to={`/staff/${card.employeeId}`}
            className="block truncate text-[13.5px] font-semibold tracking-tight after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            title={card.fullName}
          >
            {card.fullName}
          </Link>
          <div className="truncate text-[11px] text-ink-3">
            <span className="num">{card.empCode}</span>
            {card.designation ? ` · ${card.designation}` : ''}
          </div>
        </div>

        {/* ⭐ E02 — রিংটা **মাসের**, দিনের নয় */}
        <ProgressRing value={card.monthWorkedSec} max={card.monthTargetSec} />
      </div>

      <div>
        <div className="flex items-baseline gap-1.5">
          <Duration
            seconds={card.monthWorkedSec}
            className="text-[17px] font-semibold tracking-tight"
          />
          <span className="text-[11.5px] text-ink-3">
            / <span className="num">{formatHours(card.monthTargetSec, 0)}</span>ঘ ·
            এই মাসে
          </span>
        </div>

        {/* ⚠️ আজকের ঘণ্টা মাসেরটার সাথে মিশে যাওয়া চলবে না — দুটো আলাদা
            প্রশ্নের উত্তর। শূন্য হলে ধূসর: ধূসর = গোনা হয়নি। */}
        <div className="mt-0.5 flex items-baseline gap-1.5 text-[11.5px] text-ink-3">
          আজ
          <Duration
            seconds={card.todayWorkedSec}
            tone={worked ? 'counted' : 'muted'}
            className="text-[12.5px] font-semibold"
          />
        </div>
      </div>

      <Thumb card={card} shot={shot} onOpen={onOpenShot} />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip status={card.status} />
        {/* ⚠️ heartbeat কখনো না এলে "সাড়া কখনো নয়" পড়তে অদ্ভুত লাগে —
            আর ওটা আলাদা ঘটনাও: এজেন্ট বসানোই হয়নি। */}
        <span className="text-[11px] text-ink-3">
          {card.lastHeartbeatAt === null
            ? 'কখনো সাড়া দেয়নি'
            : `সাড়া ${formatAgo(card.lastHeartbeatAt)}`}
        </span>
      </div>
    </article>
  );
}

/**
 * E03 — থাম্বনেইল, ক্লিকে বড়।
 *
 * ⭐⚠️ লিঙ্কের মেয়াদ **৫ মিনিট** (I07)। মেয়াদ ফুরোলে ছবিটা ৪০৩ হয়ে
 *    ব্রাউজারের ভাঙা আইকন দেখায় — কোনো এরর নয়, কোনো বার্তা নয়। তাই
 *    `onError` ধরে স্পষ্ট করে বলা হয় কী হয়েছে, নইলে দশ মিনিট খোলা রাখা
 *    ট্যাবে পনেরোটা কার্ডই নীরবে ভাঙা দেখাত আর মনে হতো এজেন্ট ছবি
 *    পাঠাচ্ছে না।
 */
function Thumb({
  card,
  shot,
  onOpen,
}: {
  card: LiveCard;
  shot: GalleryItem | null;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);

  /**
   * ⚠️ প্রতি রিফ্রেশে নতুন টোকেন মানে নতুন URL। ভাঙা অবস্থাটা মুছে না
   *    দিলে একবার মেয়াদ ফুরোনোর পর কার্ডটা চিরকাল "মেয়াদ শেষ" দেখাত,
   *    যদিও ততক্ষণে নতুন লিঙ্ক চলে এসেছে।
   *
   * ⚠️ `key` দিয়ে remount করা হয়নি ইচ্ছে করেই — তাহলে প্রতি ৪ মিনিটে
   *    `<img>` নোডটা মুছে গিয়ে ছবিটা এক ঝলক সাদা হয়ে যেত। একই নোডে শুধু
   *    `src` বদলালে ব্রাউজার নতুনটা আসা পর্যন্ত পুরোনো ফ্রেমটাই দেখায়।
   */
  useEffect(() => setBroken(false), [shot?.thumbUrl]);

  if (!shot) {
    return (
      <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-line bg-paper px-2 text-center text-[11px] text-ink-3">
        আজ এখনো কোনো স্ক্রিনশট নেই
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title="বড় করে দেখুন"
      className="relative z-10 block aspect-video w-full overflow-hidden rounded-lg border border-line bg-paper transition hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <img
        src={shot.thumbUrl}
        alt={`${card.fullName}-এর সর্বশেষ স্ক্রিনশট`}
        // ⚠️ A06 আসার আগ পর্যন্ত সার্ভার থাম্বনেইলের বদলে **ফুল ছবিই**
        //    পাঠায় (screenshots.service.ts-এর মন্তব্য দেখুন)। তাই lazy —
        //    নইলে পনেরোটা ফুল-রেজ়লিউশন ছবি একসাথে নামত।
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="size-full object-cover object-top"
      />

      <span className="num absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        {formatTime(shot.capturedAt)}
      </span>

      {broken && (
        <span className="absolute inset-0 grid place-items-center bg-surface/95 px-2 text-center text-[11px] text-ink-3">
          লিঙ্কের মেয়াদ শেষ — হালনাগাদ করুন
        </span>
      )}
    </button>
  );
}
