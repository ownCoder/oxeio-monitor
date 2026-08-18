import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { LiveCard } from '../../api/dashboard';
import { usePolling } from '../../api/useApi';
import { TodayMeter, ProgressBar } from '../../components/ProgressRing';
import { SectionHead } from '../../components/Page';
import { StatusChip, StatusLegend } from '../../components/StatusDot';
import { PersonCell, Table, type Column } from '../../components/Table';
import { Caveat } from '../../components/States';
import { formatAgo, formatDuration, formatHours } from '../../lib/format';
import type { GalleryItem } from '../../api/screenshots';
import { getLatestShots, NO_SHOTS } from './latestShots';
import { isWorking } from './onTheClock';
import { meterKind, restingStartsAt, rosterRows } from './roster';
import { ShotLightbox } from './ShotLightbox';

/**
 * **দলের রোস্টার — এক পর্দায় সবাই।**
 *
 * ⭐⭐ মালিকের বাছাই *(১৮ আগস্ট, তিনটে মকআপ দেখে — দিক "B · One-screen
 * roster")*। আগে এখানে ছিল কার্ডের গ্রিড; ১৩ জনের জন্য সেটা ছিল চার
 * কলামে চারটে সারি, আর <b>প্রতিটা কার্ডের ৫২% জায়গা</b> নিত এমন একটা
 * স্ক্রিনশট যেটা ওই মাপে পড়াই যায় না। "এখন কে কাজ করছে, কেউ কি আটকে
 * আছে" — উত্তর পেতে ১২টা কার্ড পড়তে হতো।
 *
 * ⚠️⚠️ <b>এটা Live Board-এর `TeamTable`-এর নকল নয়, আর হতেও দেওয়া যাবে
 * না।</b> ভাগটা স্পষ্ট রাখা হয়েছে:
 *
 * | | `TeamTable` (Live Board) | `TeamRoster` (Worklog) |
 * |---|---|---|
 * | প্রশ্ন | "লক্ষ্যের বিপরীতে কে কোথায়" | "**এখন** কে কাজ করছে" |
 * | ক্রম | অগ্রগতি অনুযায়ী | **এমপ্লয়ি-কোড, কখনো ঘণ্টা নয়** |
 * | কলাম | টার্গেট · অগ্রগতি | **স্ক্রিনশট · শেষ সাড়া** |
 *
 * ⚠️ দুটোর কলাম এক হয়ে গেলে একটাকে মুছে দিতে হবে — দুই পাতায় দু-রকম
 * "একই" টেবিল থাকা মানেই একদিন তারা দ্বিমত করবে (G88-এর শিক্ষা)।
 *
 * ⭐ মকআপের যে দুটো জিনিস <b>ইচ্ছাকৃতভাবে বসানো হয়নি</b>:
 *  ১· <b>দলের median দাগ</b> — প্রতিটা বারে বসালে গাণিতিকভাবেই রোজ
 *     অর্ধেক দল "দাগের নিচে" দেখাত, চিরকাল। সাজানোর ক্রম মালিক বদলাতে
 *     পারেন, কিন্তু ওই দাগ সবসময় জ্বলে থাকত — জ্যামিতিতে গাঁথা লিডারবোর্ড।
 *  ২· <b>sort-করার ভান করা হেডার</b> — `Table`-এ sort নেই, তাই তীরচিহ্ন
 *     থাকলে সেটা এমন একটা সামর্থ্যের বিজ্ঞাপন দিত যা নেই।
 */

/**
 * ছবির রিফ্রেশ — **৪ মিনিট**, বোর্ডের নিজের ছন্দের চেয়ে অনেক ধীরে।
 *
 * ⚠️⚠️ সংখ্যাটা কমানো যাবে না। কারণ `latestShots.ts`-এর মাথায়:
 * `GET /screenshots`-এর প্রতিটা কল একটা করে audit সারি লেখে (I08 — "কে
 * আমার স্ক্রিনশট দেখল"), আর ছবি এমনিতেই জমে **৫ মিনিট পরপর** — ঘন ঘন
 * ডাকলে একই ছবিই ফিরে আসে, শুধু খাতাটা মোটা হয়।
 */
const SHOT_REFRESH_MS = 4 * 60_000;

export function TeamRoster({
  cards,
  canView,
  withTarget,
}: {
  cards: readonly LiveCard[];
  /** ⚠️ স্টাফের ব্রাউজার যেন অকারণে ৪০৩ না কুড়ায় */
  canView: boolean;
  /** আজ কতজনের টার্গেট আছে — ছুটির দিনে ০, আর তখন হেডারের লেখা বদলায় */
  withTarget: number;
}) {
  const [openFor, setOpenFor] = useState<number | null>(null);

  const shots = usePolling(
    (signal) => (canView ? getLatestShots(signal) : Promise.resolve(NO_SHOTS)),
    SHOT_REFRESH_MS,
    [canView],
  );

  const byEmployee = shots.data?.byEmployee ?? null;

  const rows = rosterRows(cards);
  const restingAt = restingStartsAt(rows);
  const workingCount = restingAt === -1 ? rows.length : restingAt;
  const restingCount = rows.length - workingCount;

  const openCard = rows.find((c) => c.employeeId === openFor) ?? null;
  const openShot = openFor === null ? null : byEmployee?.get(openFor) ?? null;

  const columns: Column<LiveCard>[] = [
    {
      key: 'person',
      header: `Staff · ${rows.length}`,
      className: 'min-w-[190px]',
      render: (c) => (
        <Link
          to={`/staff/${c.employeeId}`}
          className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <PersonCell fullName={c.fullName} empCode={c.empCode} />
        </Link>
      ),
    },
    {
      key: 'today',
      header: 'Today',
      align: 'right',
      className: 'min-w-[140px]',
      render: (c) => <TodayCell card={c} />,
    },
    {
      key: 'month',
      /* ⚠️ "/ 208h" হেডারে লেখা যাবে না — টার্গেট কর্মীভেদে আলাদা ও
         proration-নির্ভর (G37), তাই সংখ্যাটা প্রতিটা সারিতেই থাকতে হবে */
      header: 'This month',
      align: 'right',
      className: 'hidden min-w-[150px] sm:table-cell',
      render: (c) => <MonthCell card={c} />,
    },
    {
      key: 'screen',
      header: 'Screen',
      /* ⚠️ ছোট পর্দায় প্রথমে এটাই যায় — ৬৪px ছবিতে এমনিতেও কিছু পড়া যায় না */
      className: 'hidden w-[84px] lg:table-cell',
      render: (c) => (
        <ShotThumb
          card={c}
          shot={byEmployee?.get(c.employeeId) ?? null}
          onOpen={() => setOpenFor(c.employeeId)}
        />
      ),
    },
    {
      key: 'seen',
      header: 'Last seen',
      className: 'hidden whitespace-nowrap md:table-cell',
      render: (c) => (
        <span className="text-[12px] text-ink-3">{heartbeatLabel(c)}</span>
      ),
    },
    {
      /* ⭐ যে কলামটা মালিকের প্রশ্নের উত্তর দেয়, সেটাই **সবার শেষে** ঝরে —
         সরু পর্দাতেও "কে কাজ করছে" টিকে থাকে */
      key: 'status',
      header: '',
      align: 'right',
      render: (c) => <StatusChip status={c.status} />,
    },
  ];

  return (
    <div className="space-y-3">
      <SectionHead
        title="Who is on the clock"
        hint={
          withTarget === 0
            ? 'A day off for everyone — anything done today still counts toward the month'
            : "Ordered by employee code — never by hours. This is not a ranking."
        }
      />

      {/* ⭐ এক লাইনে দলের অবস্থা — কার্ড গোনার আগেই উত্তর */}
      <CountsStrip
        total={rows.length}
        working={workingCount}
        resting={restingCount}
        cards={rows}
      />

      <Table
        columns={columns}
        rows={rows}
        rowKey={(c) => String(c.employeeId)}
        rowMuted={(c) => !isWorking(c.status)}
        groupBefore={(_c, i) =>
          i === restingAt && restingAt > 0 ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                Not working · {restingCount}
              </div>
              {/*
                ⚠️ এই বাক্যটা সাজসজ্জা নয়। এটা না থাকলে নিচের ধূসর সারিগুলো
                   একটা অভিযোগের তালিকার মতো পড়ত — অথচ PC বন্ধ করে বাড়ি
                   যাওয়াটাই স্বাভাবিক, আর তাতে ঠিক করার মতো কিছুই নেই।
              */}
              <div className="text-[12px] text-ink-3">
                Off the clock is normal — the agent is healthy, nothing to fix.
              </div>
            </div>
          ) : null
        }
      />

      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-ink-3">
          Nobody has been added to the team yet.
        </p>
      )}

      <StatusLegend />

      {/*
        ⭐ `/live` কোনো `caveat` ফিল্ড পাঠায় না, কিন্তু শর্তটা সত্যি —
           সেখানে worked সেকেন্ড **যোগফল**, UNION নয়।
      */}
      <Caveat>
        When one person runs more than one PC at the same time, that stretch is
        counted twice, so hours can read a little high. An overlap longer than
        15 minutes raises its own alert.
      </Caveat>

      {/* ⚠️ ছবি আনতে না পারা পাতা ভেঙে যাওয়া নয় — তাই ছোট করে, আলাদা করে */}
      {shots.error && !shots.data && (
        <p className="mt-2 text-xs text-ink-3">
          Screenshots couldn&rsquo;t be loaded — the Screen column stays empty.
        </p>
      )}

      {openCard && (
        <ShotLightbox
          card={openCard}
          shot={openShot}
          onClose={() => setOpenFor(null)}
          onRefresh={shots.reload}
        />
      )}
    </div>
  );
}

/**
 * ⭐ দলের অবস্থা এক লাইনে — **শুধু যা সত্যিই জানা যায়**।
 *
 * ⚠️⚠️ এখানে "Agents reporting 13/13" জাতীয় কিছু লেখা হয়নি, যদিও মকআপে
 * ছিল। `/live` ওই সংখ্যাটা দেয় না (`agent_down` ১৭ আগস্ট `LiveStatus`
 * থেকে উঠে গেছে, ওই খবর এখন Alerts-এ)। যা দেয় তা-ই লেখা: কে কাজ করছে,
 * আর কার এজেন্টই বসেনি/বন্ধ করা আছে। ⭐ না-জানা সংখ্যা আত্মবিশ্বাসের
 * সাথে ছাপাটাই এই কোডবেসের সবচেয়ে দামি ভুল ছিল।
 */
function CountsStrip({
  total,
  working,
  resting,
  cards,
}: {
  total: number;
  working: number;
  resting: number;
  cards: readonly LiveCard[];
}) {
  const noAgent = cards.filter(
    (c) => c.agentPresence !== 'installed',
  ).length;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
      <span>
        <span className="num font-medium text-ink-2">{working}</span> working
      </span>
      <span className="text-line">·</span>
      <span>
        <span className="num font-medium text-ink-2">{resting}</span> not
        working
      </span>
      <span className="text-line">·</span>
      <span>
        <span className="num font-medium text-ink-2">{total}</span> on the team
      </span>
      {/* ⚠️ শূন্য হলে লাইনটাই নেই — "0 problems" লেখা মানে রোজ একটা
          অ-খবরকে খবরের জায়গা দেওয়া */}
      {noAgent > 0 && (
        <>
          <span className="text-line">·</span>
          <span className="text-idle-ink">
            <span className="num font-medium">{noAgent}</span> without a working
            agent
          </span>
        </>
      )}
    </div>
  );
}

/**
 * আজকের ঘর — সংখ্যা, তার নিচে মিটার।
 *
 * ⚠️ টার্গেটটা **সার্ভারের `dailyTargetSec`**, "8h" নয় — ২৭ কর্মদিবসের
 *    মাসে সেটা নিজে থেকেই "7h 42m" দেখাবে, আর কর্মীভেদেও আলাদা।
 */
function TodayCell({ card }: { card: LiveCard }) {
  const kind = meterKind(card);
  const hasTarget = card.todayIsWorkday && card.dailyTargetSec > 0;

  return (
    <div className="inline-block w-full max-w-[130px] text-right">
      <div className="flex items-baseline justify-end gap-1.5">
        <span
          className={`num text-[14px] font-semibold ${
            kind === 'counted' ? '' : 'text-ink-3'
          }`}
        >
          {/* ⚠️ শূন্য আর অজানা — সংখ্যাতেও আলাদা, শুধু বারে নয় */}
          {kind === 'unknown' ? '—' : formatDuration(card.todayWorkedSec)}
        </span>
        <span className="num text-[11px] text-ink-3">
          {hasTarget ? `/ ${targetText(card.dailyTargetSec)}` : 'day off'}
        </span>
      </div>

      {hasTarget && (
        <TodayMeter
          kind={kind}
          value={card.todayWorkedSec}
          max={card.dailyTargetSec}
          className="mt-1.5"
        />
      )}
    </div>
  );
}

/**
 * ⚠️ মাসের বারে কোনো pace-দাগ **নেই**, ইচ্ছাকৃতভাবে — মাঝ-মাসের দাগ
 * প্রতিটা সারিকে একটা অভিযোগে বদলে দিত। মাস এখানে প্রেক্ষাপট, রায় নয়।
 */
function MonthCell({ card }: { card: LiveCard }) {
  /**
   * ⚠️⚠️ একই সততার নিয়ম মাসের ঘরেও। এজেন্টই বসেনি এমন কর্মীর মাস
   * `0m / 208h` লিখলে সেটা "এ মাসে কিছুই করেননি" বলে দাঁড়াত — অথচ তাঁকে
   * মাপাই হয়নি। ⭐ তবে শর্তটা **সংখ্যার উপরেও**: এজেন্ট আজ সরানো হলেও
   * মাসের আগের ঘণ্টাগুলো সত্যিই মাপা, তাই সেগুলো লুকোনো হয় না।
   */
  const unknown = meterKind(card) === 'unknown' && card.monthWorkedSec === 0;

  return (
    <div className="inline-block w-full max-w-[140px] text-right">
      <div className="num text-[12.5px] text-ink-2">
        {unknown ? <span className="text-ink-3">—</span> : formatDuration(card.monthWorkedSec)}
        <span className="text-ink-3"> / {formatHours(card.monthTargetSec, 0)}h</span>
      </div>
      {unknown ? (
        <TodayMeter
          kind="unknown"
          value={0}
          max={card.monthTargetSec}
          ariaLabel="This month"
          className="mt-1.5"
        />
      ) : (
        <ProgressBar
          value={card.monthWorkedSec}
          max={card.monthTargetSec}
          ariaLabel="This month"
          className="mt-1.5 opacity-70"
        />
      )}
    </div>
  );
}

/**
 * ৬৪×৪০ থাম্বনেইল — পড়ার জন্য নয়, **চিনে নেওয়ার** জন্য।
 *
 * ⭐ ক্লিক করলে পুরো ছবি (`ShotLightbox`)। ⚠️ ছবি না থাকলে ফাঁকা গর্ত নয়,
 * একটা ছোট ড্যাশ-করা ঘর — "নেই" আর "লোড হয়নি" এক দেখানো চলবে না।
 */
function ShotThumb({
  card,
  shot,
  onOpen,
}: {
  card: LiveCard;
  shot: GalleryItem | null;
  onOpen: () => void;
}) {
  if (!shot) {
    return (
      <div
        className="h-10 w-16 rounded border border-dashed border-line"
        title="No screenshot yet today"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Latest screenshot of ${card.fullName}`}
      className="block h-10 w-16 overflow-hidden rounded border border-line transition hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <img
        src={shot.thumbUrl}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
    </button>
  );
}

/** পুরো ঘণ্টা হলে `8h`, নইলে `7h 42m` — সার্ভারের সংখ্যা থেকেই */
function targetText(targetSec: number): string {
  return targetSec % 3600 === 0
    ? `${formatHours(targetSec, 0)}h`
    : formatDuration(targetSec);
}

/**
 * ⚠️⚠️ heartbeat না থাকার **তিনটে আলাদা কারণ**, আর মালিকের করণীয়ও তিন
 * রকম। আগে তিনটেই "Never checked in" পড়ত — তাই একই সারিতে ১৬:৫০-এর
 * স্ক্রিনশট আর "কখনো সাড়া দেয়নি" পাশাপাশি বসত, যা নিজেই নিজেকে মিথ্যা
 * প্রমাণ করত (G88)।
 */
function heartbeatLabel(card: LiveCard): string {
  if (card.lastHeartbeatAt !== null) return formatAgo(card.lastHeartbeatAt);

  switch (card.agentPresence) {
    case 'switched_off':
      return 'Agent switched off';
    case 'never_installed':
      return 'No agent yet';
    default:
      return 'Never checked in';
  }
}
