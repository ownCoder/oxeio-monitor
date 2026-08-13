import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { LiveCard, LiveStatus } from '../../api/dashboard';
import type { GalleryItem } from '../../api/screenshots';
import { Duration } from '../../components/Duration';
import { StatusChip } from '../../components/StatusDot';
import { formatAgo, formatHours, formatTime } from '../../lib/format';
import { DayOffTag, targetText, TodayRing } from './TodayRing';

/**
 * E01 · E02 · E03 — বোর্ডের একটা কার্ড।
 *
 * মকআপের `.pcard` — বাঁয়ে ৩px স্ট্যাটাস-পটি, উপরে নাম + **আজকের** রিং,
 * তারপর আজকের ঘণ্টা বড় করে, মাসের হিসাব ছোট করে নিচে, সর্বশেষ স্ক্রিনশট,
 * নিচে চিপ ও শেষ heartbeat।
 *
 * ⭐ **আজ সামনে, মাস পেছনে** — রিং আর বড় সংখ্যা দুটোই এখন আজকের। কারণ
 *    মাসের ৭৮/২০৮ দেখে কেউ বলতে পারত না আজ দিনটা ঠিক যাচ্ছে কি না; ওই
 *    উত্তরটা পেতে হলে "মাসের কত ভাগ পেরিয়েছে" মাথায় হিসাব করতে হতো, আর
 *    সেটা ছুটির তালিকার উপর নির্ভর করে।
 *
 * ⚠️ **মাসের হিসাব মুছে ফেলা হয়নি**, শুধু ছোট হয়েছে — বেতনের ভিত্তি এখনো
 *    মাসিক ২০৮ ঘণ্টাই (§ ২.১-খ)। দৈনিক টার্গেট দেখানোর জিনিস, কাটার নয়।
 */

/**
 * বাঁ দিকের পটির রঙ।
 *
 * ⚠️ `StatusDot`-এর ভেতরের `DOT_CLASS` এক্সপোর্ট করা নেই, তাই নিয়মটা এখানে
 *    আবার লেখা হলো — **হুবহু একই নিয়ম**: `agent_down` একমাত্র সলিড লাল
 *    (IT-র সমস্যা), `offline` ধূসর (কর্মী চলে গেছে — স্বাভাবিক)। দুটো
 *    মিলিয়ে ফেললে হয় মিথ্যা অভিযোগ হয়, নয় আসল সমস্যা চাপা পড়ে।
 *
 * ⚠️⚠️ এই চারটে ক্লাস আর `StatusDot`-এর `DOT_CLASS` **একই কমিটে** বদলাতে
 *    হয়। একবার তা হয়নি, আর ফল হয়েছিল: একই কার্ডে বাঁয়ের পটি এক রং আর
 *    চিপের ভেতরের বিন্দু আরেক রং — দুটো পাশাপাশি বসে দুটো আলাদা কথা বলত।
 *    রং চারটে `index.css`-এর টোকেন (`ok`·`idle`·`offline`·`attention`),
 *    এখানে হেক্স লিখবেন না।
 */
const EDGE: Record<LiveStatus, string> = {
  active: 'bg-ok',
  idle: 'bg-idle',
  offline: 'bg-offline',
  agent_down: 'bg-attention',
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

  /**
   * ⚠️ `todayIsWorkday` ছাড়াও `dailyTargetSec > 0` দেখা হয়। পুরো মাস ছুটি
   *    হলে সার্ভার ০ পাঠায় (`dailyTargetSec()`-এ Infinity ঠেকানো আছে), আর
   *    তখন রিং ০-এর বিপরীতে ১০০% দেখাত — অর্থাৎ কিছু না করেই সবাই টার্গেট
   *    ছুঁয়ে ফেলত।
   */
  const hasTarget = card.todayIsWorkday && card.dailyTargetSec > 0;

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

        {/* ⭐ রিংটা **আজকের** টার্গেটের বিপরীতে; ছুটির দিনে রিং-ই নেই */}
        {hasTarget ? (
          <TodayRing
            workedSec={card.todayWorkedSec}
            targetSec={card.dailyTargetSec}
          />
        ) : (
          <DayOffTag />
        )}
      </div>

      <div>
        {/* ⭐ বড় সংখ্যা = **আজ**। শূন্য হলে ধূসর: ধূসর = গোনা হয়নি। */}
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <Duration
            seconds={card.todayWorkedSec}
            tone={worked ? 'counted' : 'muted'}
            className="text-[17px] font-semibold tracking-tight"
          />
          <span className="text-[11.5px] text-ink-3">
            {/*
              ⚠️ টার্গেটটা **সার্ভারের সংখ্যা**, "8h" লেখা নয় — ২৭
                 কর্মদিবসের মাসে এটা নিজে থেকেই "7h 42m" দেখাবে।
            */}
            {hasTarget ? (
              <>
                of <span className="num">{targetText(card.dailyTargetSec)}</span>{' '}
                today
              </>
            ) : (
              'no target today'
            )}
          </span>
        </div>

        {/* ⚠️ মাসেরটা আজকেরটার সাথে মিশে যাওয়া চলবে না — দুটো আলাদা প্রশ্নের
            উত্তর, আর বেতন গোনা হয় নিচের সংখ্যাটা দিয়ে। */}
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[11.5px] text-ink-3">
          This month
          <Duration seconds={card.monthWorkedSec} tone="muted" />
          {/* ⚠️ `/` আর টার্গেট এক টুকরোয় — নইলে সরু কার্ডে স্ল্যাশটা একা
              পরের লাইনে নেমে যেত আর সংখ্যাটা এতিম দেখাত। */}
          <span className="num whitespace-nowrap">
            / {formatHours(card.monthTargetSec, 0)}h
          </span>
        </div>
      </div>

      <Thumb card={card} shot={shot} onOpen={onOpenShot} />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip status={card.status} />
        {/* ⚠️⚠️ heartbeat না থাকার **তিনটে আলাদা কারণ**, আর মালিকের
            করণীয়ও তিন রকম। আগে তিনটেই "Never checked in" পড়ত — তাই
            একই কার্ডে ১৬:৫০-এর স্ক্রিনশট আর "কখনো সাড়া দেয়নি" পাশাপাশি
            বসত, যা নিজেই নিজেকে মিথ্যা প্রমাণ করত। */}
        <span className="text-[11px] text-ink-3">{heartbeatLabel(card)}</span>
      </div>
    </article>
  );
}

/**
 * ⭐ স্ট্যাটাস চিপের পাশের ছোট লেখাটা — **কী করতে হবে** বলার শেষ সুযোগ।
 *
 * ⚠️ "Agent switched off" ইচ্ছাকৃতভাবে আলাদা: কর্মী নিষ্ক্রিয় করলে তাঁর
 * সব ডিভাইস revoke হয়, আর আবার সক্রিয় করলে সেগুলো **ফেরে না** (ইচ্ছাকৃত —
 * ফিরে আসা কর্মীর পুরোনো টোকেন আপনাআপনি জেগে ওঠা উচিত নয়)। ফলে এজেন্ট
 * চলতে থাকলেও বোর্ডে সে অদৃশ্য। ওই অবস্থায় করণীয় Settings → Devices →
 * Staff →
 * ওই সারির "Turn agent on", আর সেটা "কখনো বসেনি" থেকে সম্পূর্ণ আলাদা কাজ।
 */
function heartbeatLabel(card: LiveCard): string {
  if (card.lastHeartbeatAt !== null) return `Seen ${formatAgo(card.lastHeartbeatAt)}`;

  switch (card.agentPresence) {
    case 'switched_off':
      return 'Agent switched off — Settings → Staff';
    case 'never_installed':
      return 'No agent yet';
    default:
      // সচল ডিভাইস আছে, অথচ একবারও সাড়া দেয়নি — বসানো হয়েছে, চালু হয়নি
      return 'Never checked in';
  }
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
    // ⚠️ খালি জায়গাটা `aspect-video` ছিল, অর্থাৎ ছবি না থাকলেও ছবির সমান
    //    উঁচু একটা ফাঁকা বাক্স। ১২টা কার্ডের কারো ছবি না এলে (রাত ১১টার
    //    পর, বা সবে বসানো অফিসে) পুরো বোর্ড ফাঁকা বাক্সে ভরে যেত আর এক
    //    পর্দায় মাত্র চারটে কার্ড দেখা যেত — অথচ বোর্ডের পুরো উদ্দেশ্যই
    //    এক নজরে সবাইকে দেখা।
    //    এখন এক লাইন, তাই ছবিহীন কার্ড ছোট হয়ে যায়।
    return (
      <div className="rounded-lg border border-dashed border-line bg-paper px-2 py-2 text-center text-[11px] text-ink-3">
        No screenshot yet today
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open full size"
      className="relative z-10 block aspect-video w-full overflow-hidden rounded-lg border border-line bg-paper transition hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <img
        src={shot.thumbUrl}
        alt={`Latest screenshot of ${card.fullName}`}
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
          Link expired — refresh
        </span>
      )}
    </button>
  );
}
