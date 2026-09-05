import type { LiveCard } from '../../api/dashboard';
import { DesignCell } from './DesignCell';
import { dayDuty, designView } from './roster';
import { ProgressBar } from '../../components/ProgressRing';
import { StatusChip } from '../../components/StatusDot';
import { PersonCell, Table, type Column } from '../../components/Table';
import { formatDuration, pctOf } from '../../lib/format';

/**
 * ⭐⭐ **E01 — দলের টেবিল, মকআপ ক-এর ছ-টা কলামেই**: কর্মী · আজ · টার্গেট ·
 * মাস · অগ্রগতি · অবস্থা।
 *
 * ⚠️⚠️ **এটা `TargetBars`-এর জায়গা নিয়েছে, আর সেটা একটা সচেতন উলটপালট।**
 * প্রথম দফায় টেবিলটা ইচ্ছাকৃতভাবে বানানো হয়নি — যুক্তি ছিল, বার ইতিমধ্যেই
 * নাম · অবস্থা · অগ্রগতি · ঘণ্টা দেখায়, আর টেবিলে গেলে ফোনের বিন্যাস ও
 * বারের রঙের যত্ন করে লেখা নিয়মগুলো হারাত। ⭐ মালিক মকআপটা দেখে অনুমোদন
 * করেছিলেন **টেবিলসহ**, আর পরে বলেছেন "এর মতো পুরোপুরি হয়নি" — তাই
 * যুক্তিটা টিকল না। ⭐⭐ তবে **নিয়মগুলো টিকেছে**: নিচের প্রতিটা মন্তব্য
 * বারের কোড থেকে সরাসরি আনা, কারণ ওগুলো বিন্যাসের নয়, **সত্যের** নিয়ম।
 *
 * ⭐ ফোনে টেবিলটা নিজের ফ্রেমে ডানে-বাঁয়ে স্ক্রল করে আর **প্রথম কলাম আটকে
 * থাকে** (`Table`-এর G124) — নইলে ছ-কলামে সরালে কার সারি দেখছি সেটাই
 * হারিয়ে যেত।
 */
export function TeamTable({ cards }: { cards: LiveCard[] }) {
  /**
   * ⚠️ ছুটিতে থাকা কর্মী **তালিকার শেষে** — শূন্যের বিপরীতে অগ্রগতি সাজানো
   *    মানে ছুটির দিনটাকেই ব্যর্থতার মতো দেখানো।
   */
  const rows = [...cards].sort((a, b) => {
    const ta = hasTarget(a);
    const tb = hasTarget(b);
    if (ta !== tb) return ta ? -1 : 1;
    if (ta && tb) {
      const pa = pctOf(a.todayWorkedSec, a.dailyTargetSec);
      const pb = pctOf(b.todayWorkedSec, b.dailyTargetSec);
      if (pa !== pb) return pb - pa;
    }
    return b.todayWorkedSec - a.todayWorkedSec;
  });

  if (rows.length === 0) return null;

  const columns: Column<LiveCard>[] = [
    {
      key: 'person',
      header: 'Staff',
      className: 'min-w-40',
      render: (c) => <PersonCell fullName={c.fullName} empCode={c.empCode} />,
    },
    {
      key: 'today',
      header: 'Today',
      align: 'right',
      render: (c) => (
        <span className="num font-semibold">
          {formatDuration(c.todayWorkedSec)}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      align: 'right',
      render: (c) =>
        /*
          ⚠️ ছুটির দিনে `—`, `0` নয়। শূন্য একটা টার্গেটের দাবি করে যেটা
             পূরণ হয়নি; ড্যাশ বলে **আজ কোনো টার্গেটই ছিল না**।
          ⚠️ সংখ্যাটা হার্ডকোড ৮ ঘণ্টা নয় — ২৭ কর্মদিবসের মাসে ৭ঘ ৪২মি।
        */
        hasTarget(c) ? (
          <span className="num text-ink-2">
            {formatDuration(c.dailyTargetSec)}
          </span>
        ) : (
          /*
            ⭐ G130 — ড্যাশটা কেন, সেটা hover-এ বলা থাকে। ⚠️ আগে সবসময়
               "Weekly off or holiday" লেখা থাকত, অথচ কারণটা ব্যক্তিগত
               ছুটিও হতে পারে — আর তখন লেখাটা সরাসরি ভুল ছিল।
          */
          <span
            className="text-ink-3"
            title={
              dayDuty(c) === 'leave'
                ? 'On approved leave today'
                : 'Weekly off or holiday'
            }
          >
            —
          </span>
        ),
    },
    /*
      ⚠️⚠️ এখানে একটা **Month** কলাম ছিল — "এই মাসে কার কত ঘণ্টা"
      *(মালিকের নির্দেশে তুলে দেওয়া, ২৩ আগস্ট)*।

      ⭐ যোগ করার কারণ ছিল "Monthly পাতায় যেতে হতো"। কিন্তু বোর্ডের এই
      টেবিলের প্রশ্ন **আজ** নিয়ে — Today · Target · Designs · Progress।
      মাসের সংখ্যাটা ওখানে অন্য প্রশ্নের উত্তর দিচ্ছিল, আর টেবিলটাকে
      চওড়া করছিল।

      ⚠️ তথ্যটা হারায়নি: **Monthly** পাতায় আছে, আর **Worklog**-এর
      রোস্টারেও `This month` কলাম আছে। এক ক্লিক দূরে, মুছে যায়নি।
    */
    /**
     * ⭐⭐ **আজকের ডিজাইন** *(২৩ আগস্ট ২০২৬, মালিকের চাওয়া)* — "ei colame
     * kon staff koto design korlo today seta bosiye dao"।
     *
     * ⚠️ কোষটা `DesignCell`-এ **ভাগ করা** — Worklog-এর রোস্টারেও একই
     * জিনিস। নকল করলে একদিন একটা বদলাত আর অন্যটা নয়।
     *
     * ⚠️⚠️ কলামটা **কেবল তখনই** বসে যখন দলে অন্তত একজনের ডিজাইন আছে।
     * সবসময় বসালে গবেষকদের সারিতে রোজ একটা খালি ঘর থাকত, আর খালি ঘর
     * দেখতে "ডেটা আসেনি"-র মতো লাগে — অথচ মাপটাই তাঁদের নয়।
     */
    ...(cards.some((c) => designView(c) !== null)
      ? [
          {
            key: 'designs',
            header: 'Designs',
            align: 'right' as const,
            className: 'whitespace-nowrap',
            render: (c: LiveCard) => <DesignCell card={c} />,
          },
        ]
      : []),
    {
      key: 'progress',
      header: 'Progress',
      className: 'w-40 min-w-32',
      render: (c) => <TodayBar card={c} />,
    },
    {
      key: 'status',
      header: 'Status',
      /*
        ⭐ মকআপের রঙিন পিল — আর সেটা নতুন করে লেখা হয়নি, `StatusChip`
           আগে থেকেই ছিল (কার্ডের মাথায় ব্যবহৃত)। ⚠️ নিজে বানালে চারটে
           অবস্থার রং দ্বিতীয়বার সংজ্ঞায়িত হতো, আর একদিন একটা বদলে অন্যটা
           থেকে যেত — এই ফাইলেই তার নাম G88।

        ⚠️ মকআপে পিলের ভেতর সময়ও ছিল ("অফলাইন ৪০মি")। বসানো হয়নি:
           `LiveCard`-এ কেবল `lastHeartbeatAt` আছে, আর ওটা **এজেন্ট শেষ
           কবে কথা বলেছে** — "কতক্ষণ ধরে নিষ্ক্রিয়" নয়। দুটো এক নয়, আর
           heartbeat-এর সময়টাকে নিষ্ক্রিয়তার দৈর্ঘ্য বলে দেখালে পিলটা
           এমন কিছু দাবি করত যা সে জানে না।
      */
      render: (c) => <StatusChip status={c.status} />,
    },
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(c) => String(c.employeeId)}
      /*
        ⚠️ ছুটিতে থাকা সারিটা হালকা — তালিকার শেষে থাকাটাই যথেষ্ট সংকেত নয়,
           কারণ ক্রম দেখে বোঝা যায় না ওটা "সবচেয়ে পিছিয়ে" নাকি "আজ ছুটি"।
      */
      rowMuted={(c) => !hasTarget(c) && c.todayWorkedSec === 0}
    />
  );
}

/**
 * ⭐⭐ **বার সবুজ — মকআপ ক-এর মতোই** *(মালিক: "ami mockup er moto 100% same
 * chai", ১৫ আগস্ট)*।
 *
 * ⚠️ এখানে আগে বার **নিরপেক্ষ** ছিল, আর কারণটা ছিল আসল: চলতি অগ্রগতি
 * একসময় ব্র্যান্ড-লালে আঁকা হতো, ফলে রোজ কাজ করা প্রতিটা মানুষের সারিতে
 * সারাদিন লাল জ্বলত আর দু-দিনেই লাল মানে "কিছু না" হয়ে যেত।
 *
 * ⭐ সবুজে ওই সমস্যাটা ফেরে না — সবুজ এই অ্যাপে "ঠিক আছে", আর কাজ চলা
 * সত্যিই ঠিক আছে। ⚠️ তবে দাম আছে, আর সেটা লিখে রাখা দরকার: **টার্গেট
 * ছোঁয়া আর না-ছোঁয়া এখন এক রঙে**। আগে সবুজ মানে ছিল "হয়ে গেছে"; এখন
 * পার্থক্যটা কেবল বারের **দৈর্ঘ্য** আর পাশের শতাংশে।
 */
function TodayBar({ card }: { card: LiveCard }) {
  const targeted = hasTarget(card);

  /**
   * ⭐⭐ **ছুটির দিনে করা কাজও বারে দেখা যায়, আর সেটা সবুজ**
   * *(মালিকের চাওয়া, ১৫ আগস্ট)*।
   *
   * ⚠️ আগে ছুটির দিনে সবার পাশে একটা **খালি ধূসর রেল** থাকত, অথচ সংখ্যা
   *    বলত সবাই ৩ ঘণ্টা, ২ ঘণ্টা করে কাজ করেছেন। খালি রেল দেখতে হুবহু
   *    "শূন্য শতাংশ"-এর মতো — একই সারিতে সংখ্যা আর ছবি উল্টো কথা বলত,
   *    আর মানুষ ছবিটাই বিশ্বাস করে।
   *
   * ⚠️ রংটা শুরু থেকেই সবুজ, কারণ ছুটির দিনে **"হয়নি" বলে কিছু নেই** —
   *    যতটুকু হয়েছে পুরোটাই বাড়তি।
   */
  const bonus =
    !targeted && card.todayWorkedSec > 0 && card.dailyTargetSec > 0;

  // ⚠️ কিছুই না করলে বার নেই — ছুটির দিনে শূন্য কোনো ঘাটতি নয়, আর
  //    শূন্য-ভরা রেল ঠিক ওই দাবিটাই করত।
  if (!targeted && !bonus) {
    return (
      <div
        className="h-1.5 rounded-full bg-line/60"
        title="Weekly off or holiday — nothing is expected today"
      />
    );
  }

  const pct = Math.round(pctOf(card.todayWorkedSec, card.dailyTargetSec));

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <ProgressBar
          value={card.todayWorkedSec}
          max={card.dailyTargetSec}
          // ⭐ সবসময় সবুজ — মকআপ ক-এর টেবিলে বারগুলো আংশিক অবস্থাতেও সবুজ
          tone="ok"
          ariaLabel={
            bonus
              ? `${card.fullName} — worked on a day off, against a normal day`
              : `${card.fullName} — today's target`
          }
        />
      </div>
      {/* `w-9` — শতাংশগুলো ডানদিকে এক রেখায় বসানোর জন্য */}
      <span className="num w-9 shrink-0 text-right text-[11px] text-ink-3">
        {pct}%
      </span>
    </div>
  );
}

/**
 * আজ এই কর্মীর সত্যিই টার্গেট আছে কি না — ছুটির দিনে নেই।
 *
 * ⚠️ নিয়মটা এখানে আর **লেখা নেই**, `roster.ts`-এর `dayDuty()`-তে। আগে
 *    তিনটে পর্দায় তিনবার লেখা ছিল, আর G130-এর ব্যক্তিগত ছুটিটা তখন
 *    একটাতে বসত আর দুটোতে বসত না।
 */
function hasTarget(card: LiveCard): boolean {
  return dayDuty(card) === 'target';
}
