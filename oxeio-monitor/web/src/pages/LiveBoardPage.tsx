import { useState, type ReactNode } from 'react';

import { getLiveBoard, type LiveCard } from '../api/dashboard';
import { usePolling } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Stat, StatRow } from '../components/Card';
import { Button, Page, SectionHead } from '../components/Page';
import { Caveat, Empty, ErrorBox, Loading } from '../components/States';
import { StatusLegend } from '../components/StatusDot';
import { formatDate, formatDuration, formatTime } from '../lib/format';
import { PersonCard } from './live/PersonCard';
import { getLatestShots, NO_SHOTS } from './live/latestShots';
import { ShotLightbox } from './live/ShotLightbox';

/**
 * E01 · E02 · E03 · E12 — ড্যাশবোর্ডের হোম।
 *
 * ⭐ **রিফ্রেশে পুরো পর্দা লোডিং-এ যায় না।** `usePolling` পুরোনো ডেটা ধরে
 *    রাখে, তাই প্রথমবার ছাড়া সংখ্যাগুলো জায়গামতোই থাকে, শুধু নীরবে বদলায়।
 *    উল্টোটা হলে প্রতি ৩০ সেকেন্ডে গোটা বোর্ড ঝিকমিক করত আর কেউ একটা
 *    কার্ডও পড়ে শেষ করতে পারত না।
 *
 * ⭐ **আজকের টার্গেট সামনে, মাসেরটা পেছনে** (`dailyTargetSec`,
 *    `todayIsWorkday`)। মাসের ৭৮/২০৮ দেখে "আজ দিনটা ঠিক যাচ্ছে কি না"
 *    বলা যেত না — ওই উত্তরের জন্য মাসের কত ভাগ পেরিয়েছে জানতে হতো, আর
 *    সেটা ছুটির তালিকার উপর নির্ভরশীল। মাসের হিসাব তবু রয়ে গেছে (কার্ডে
 *    ছোট করে), কারণ **বেতনের ভিত্তি এখনো মাসিক ২০৮ ঘণ্টাই**।
 */

/** E01 — ৩০ সেকেন্ড */
const BOARD_REFRESH_MS = 30_000;

/**
 * ⭐⚠️ স্ক্রিনশট বোর্ডের সাথে **এক তালে রিফ্রেশ হয় না**, আর সেটা ইচ্ছাকৃত:
 *
 *  · ছবির লিঙ্ক **৫ মিনিটে** মরে (I07), তাই ৪ মিনিটে একবার আনলেই কার্ডের
 *    ছবিগুলো কখনো ভাঙা দেখাবে না।
 *  · `GET /screenshots` প্রতিটি কলে **audit সারি লেখে** (I08)। ৩০ সেকেন্ডে
 *    ডাকলে দিনে হাজারখানেক সারি জমত — অথচ এজেন্ট ছবি পাঠায়ই ৫ মিনিট
 *    পরপর, মানে ৮ বারের ৭ বারই হুবহু একই ছবি ফিরত।
 *  · ট্যাব লুকোনো থাকলে `usePolling` টাইমার বন্ধ রাখে, তাই খোলা রেখে
 *    বাড়ি চলে গেলে সারারাত অডিট লগ ভরবে না।
 */
const SHOT_REFRESH_MS = 4 * 60_000;

export function LiveBoardPage() {
  const { user } = useAuth();

  /**
   * ⚠️ `/live` শুধু owner ও manager-এর (live.controller.ts-এ ক্লাস-লেভেল
   *    `@Roles`)। স্টাফ এখানে এলে ৪০৩ পাবে — সেটা `<ErrorBox>` নিজেই
   *    "You don't have access" বলে দেখায়। কিন্তু `/screenshots` স্টাফের
   *    জন্যও খোলা (স্কোপ দিয়ে নিজেরটা), তাই ওটা আলাদা করে আটকাতে হয়:
   *    নইলে যে পাতাটা সে দেখতেই পাচ্ছে না, তার জন্য প্রতি ৪ মিনিটে "নিজের
   *    ছবি দেখল" বলে একটা করে মিথ্যা অডিট সারি লেখা হতো।
   */
  const canViewBoard = user?.role === 'owner' || user?.role === 'manager';

  const board = usePolling(getLiveBoard, BOARD_REFRESH_MS, []);

  const shots = usePolling(
    (signal) => (canViewBoard ? getLatestShots(signal) : Promise.resolve(NO_SHOTS)),
    SHOT_REFRESH_MS,
    [canViewBoard],
  );

  /**
   * ⭐ কোন কার্ডের ছবি বড় করে খোলা — **আইডি**, ছবির কপি নয়। কপি ধরে
   *    রাখলে রিফ্রেশে নতুন টোকেন এলেও মোডালে পুরোনো (মেয়াদোত্তীর্ণ)
   *    লিঙ্কটাই আটকে থাকত।
   */
  const [openFor, setOpenFor] = useState<number | null>(null);

  const data = board.data;
  const cards = data?.cards ?? [];
  const byEmployee = shots.data?.byEmployee;

  const openCard =
    openFor === null ? null : (cards.find((c) => c.employeeId === openFor) ?? null);
  const openShot = openFor === null ? null : (byEmployee?.get(openFor) ?? null);

  let body: ReactNode;

  if (board.loading && !data) {
    body = <Loading label="Loading the board…" />;
  } else if (!data) {
    body = <ErrorBox error={board.error} retry={board.reload} />;
  } else if (cards.length === 0) {
    body = (
      <Empty
        title="Nobody on the board yet"
        hint="No active staff have been added. Add staff, install the agent on their PC, and a card shows up here with the first heartbeat."
      />
    );
  } else {
    const stats = summarize(cards);

    body = (
      <>
        {/*
          ⭐ বাসি ডেটা মুছে ফেলার চেয়ে বাসি ডেটা + স্পষ্ট বার্তা ভালো।
             এক দফা নেটওয়ার্ক হোঁচটে গোটা বোর্ড উধাও হলে ব্যবহারকারী ভাবত
             সবাই একসাথে অফলাইন হয়ে গেছে।
        */}
        {board.error && (
          <p
            role="status"
            className="mb-3 rounded-md border border-brand/30 bg-brand-bg px-3 py-2 text-xs text-brand-ink"
          >
            Couldn&rsquo;t refresh — the numbers below are from{' '}
            <span className="num">{formatTime(isoOf(board.updatedAt))}</span>.
          </p>
        )}

        <StatRow>
          <Stat
            label="Working now"
            value={stats.active}
            unit={`/${stats.total}`}
          />
          {/*
            ⭐ হর **`withTarget`**, `total` নয় — ছুটিতে থাকা কর্মী "টার্গেট
               ছোঁয়নি" দলে পড়লে ছুটির দিনটাই ব্যর্থতার মতো দেখাত।
          */}
          <Stat
            label="Met today's target"
            value={stats.withTarget === 0 ? '—' : stats.metTarget}
            unit={stats.withTarget === 0 ? undefined : `/${stats.withTarget}`}
            tone={
              stats.withTarget === 0 || stats.metTarget === 0
                ? 'muted'
                : 'counted'
            }
          />
          <Stat label="Hours today" value={formatDuration(stats.todaySec)} />
          <Stat
            label="Average today"
            value={
              stats.workedToday === 0
                ? '—'
                : formatDuration(stats.todaySec / stats.workedToday)
            }
            tone={stats.workedToday === 0 ? 'muted' : 'counted'}
          />
          {/* ⚠️ পর্দায় একটাই লাল টাইল — নইলে লাল রঙের মানেই হারিয়ে যায় */}
          <Stat
            label="Agent down"
            value={stats.agentDown}
            tone={stats.agentDown > 0 ? 'attention' : 'muted'}
          />
        </StatRow>

        <div className="mt-5">
          <SectionHead
            title={`Team · ${stats.total}`}
            hint={
              stats.withTarget === 0
                ? 'No target today — weekly off or holiday · hours still count if someone works'
                : "Ring = today's target · no fixed shift, any hour of the day counts"
            }
          />

          {/* E12 — ফোনে এক কলাম, ট্যাবে দুই, ডেস্কটপে তিন-চার */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => (
              <PersonCard
                key={card.employeeId}
                card={card}
                shot={byEmployee?.get(card.employeeId) ?? null}
                onOpenShot={() => setOpenFor(card.employeeId)}
              />
            ))}
          </div>

          <StatusLegend />

          {/*
            ⭐ `/live` কোনো `caveat` ফিল্ড পাঠায় না (dashboard.service.ts
               দেখে নেওয়া), কিন্তু শর্তটা সত্যি — সেখানে worked সেকেন্ড
               **যোগফল**, UNION নয়। তাই কথাটা এখানে লেখা আছে। লুকিয়ে
               ফেললে কেউ দুই PC-র যোগ হওয়া ঘণ্টাকে আসল কাজ ধরে নিত।

            ⚠️ অন্য পাতার `caveat` সার্ভার থেকে **বাংলায়** আসে
               (activity.service.ts) — সেগুলো যেমন আসে তেমনই দেখানো হয়।
               এই লেখাটা ক্লায়েন্টেরই, তাই এটা ইংরেজি।
          */}
          <Caveat>
            When one person runs more than one PC at the same time, that stretch
            is counted twice, so hours can read a little high. An overlap longer
            than 15 minutes raises its own alert.
          </Caveat>

          {/* ⚠️ ছবি আনতে না পারা বোর্ড ভেঙে যাওয়া নয় — তাই ছোট করে, আলাদা করে */}
          {shots.error && !shots.data && (
            <p className="mt-2 text-xs text-ink-3">
              Screenshots couldn&rsquo;t be loaded — the image area on each card
              stays empty.
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <Page
      title="Live Board"
      subtitle={data ? `${formatDate(data.workDate)} · Dhaka time` : 'Right now'}
      actions={
        <div className="flex items-center gap-2">
          {board.updatedAt && (
            <span className="text-[11.5px] text-ink-3">
              Updated{' '}
              <span className="num">{formatTime(isoOf(board.updatedAt))}</span>
            </span>
          )}
          <Button
            onClick={() => {
              board.reload();
              shots.reload();
            }}
            title="Now, without waiting 30 seconds"
          >
            Refresh
          </Button>
        </div>
      }
    >
      {body}

      {openCard && (
        <ShotLightbox
          card={openCard}
          shot={openShot}
          onClose={() => setOpenFor(null)}
          onRefresh={shots.reload}
        />
      )}
    </Page>
  );
}

interface BoardStats {
  total: number;
  active: number;
  /** আজ যাদের কিছু না কিছু গোনা হয়েছে — গড়ের **হর** */
  workedToday: number;
  todaySec: number;
  /** ⚠️ আজ যাদের সত্যিই টার্গেট আছে (ছুটিতে থাকা কেউ এতে নেই) */
  withTarget: number;
  metTarget: number;
  agentDown: number;
}

/**
 * মকআপের `.summary` টাইলগুলো।
 *
 * ⭐ আগে এখানে "Behind target" টাইল **ইচ্ছাকৃতভাবে ছিল না**: কে পিছিয়ে
 *    সেটা বলতে মাসের কত ভাগ কর্মদিবস পেরিয়েছে জানতে হয়, আর `GET /live` ওই
 *    তথ্য পাঠাত না। এখন সার্ভার `dailyTargetSec` ও `todayIsWorkday` পাঠায়,
 *    তাই **আজকের** প্রশ্নটার উত্তর আর আন্দাজ নয় — "Met today's target"
 *    গোনা যায়।
 *
 * ⚠️ তবু **মাসের** "পিছিয়ে/এগিয়ে" এখানে নেই, আর কারণটা আগের মতোই: তার
 *    জন্য মাসের কতগুলো কর্মদিবস পেরিয়েছে জানা দরকার, যেটা `/live`-এ আসে
 *    না। ক্যালেন্ডারের দিন গুনে আন্দাজ করলে ছুটির পরদিন গোটা টিমকে
 *    "পিছিয়ে" দেখাত, আর সেই সংখ্যা দিয়েই কেউ কারো জবাবদিহি চাইত।
 *    আন্দাজ করা সংখ্যার চেয়ে না থাকা ভালো।
 */
function summarize(cards: LiveCard[]): BoardStats {
  let active = 0;
  let workedToday = 0;
  let todaySec = 0;
  let agentDown = 0;
  let withTarget = 0;
  let metTarget = 0;

  for (const card of cards) {
    if (card.status === 'active') active += 1;
    if (card.status === 'agent_down') agentDown += 1;
    if (card.todayWorkedSec > 0) workedToday += 1;
    todaySec += card.todayWorkedSec;

    /**
     * ⚠️ `dailyTargetSec > 0`-ও দেখা হয়: পুরো মাস ছুটি হলে সার্ভার ০
     *    পাঠায়, আর তখন "০ সেকেন্ড ≥ ০ টার্গেট" সত্যি হয়ে সবাই টার্গেট
     *    ছুঁয়ে ফেলত — কেউ এক মিনিটও কাজ না করে।
     */
    if (card.todayIsWorkday && card.dailyTargetSec > 0) {
      withTarget += 1;
      if (card.todayWorkedSec >= card.dailyTargetSec) metTarget += 1;
    }
  }

  return {
    total: cards.length,
    active,
    workedToday,
    todaySec,
    withTarget,
    metTarget,
    agentDown,
  };
}

/** ⚠️ `formatTime` ISO স্ট্রিং চায়, `updatedAt` একটা `Date` */
function isoOf(at: Date | null): string | null {
  return at ? at.toISOString() : null;
}
