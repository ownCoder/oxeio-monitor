import { useState, type ReactNode } from 'react';

import { getLiveBoard, type LiveCard } from '../api/dashboard';
import { usePolling } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Stat, StatRow } from '../components/Card';
import { Button, Page, SectionHead } from '../components/Page';
import { Caveat, Empty, ErrorBox, Loading } from '../components/States';
import { StatusLegend } from '../components/StatusDot';
import {
  formatDate,
  formatDuration,
  formatPct,
  formatTime,
  pctOf,
} from '../lib/format';
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
   *    "অনুমতি নেই" বলে দেখায়। কিন্তু `/screenshots` স্টাফের জন্যও খোলা
   *    (স্কোপ দিয়ে নিজেরটা), তাই ওটা আলাদা করে আটকাতে হয়: নইলে যে পাতাটা
   *    সে দেখতেই পাচ্ছে না, তার জন্য প্রতি ৪ মিনিটে "নিজের ছবি দেখল" বলে
   *    একটা করে মিথ্যা অডিট সারি লেখা হতো।
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
    body = <Loading label="বোর্ড লোড হচ্ছে…" />;
  } else if (!data) {
    body = <ErrorBox error={board.error} retry={board.reload} />;
  } else if (cards.length === 0) {
    body = (
      <Empty
        title="বোর্ডে দেখানোর মতো কেউ নেই"
        hint="সক্রিয় কোনো কর্মী যোগ করা হয়নি। স্টাফ যোগ করে তাদের PC-তে এজেন্ট বসালে প্রথম heartbeat আসার সাথে সাথেই কার্ড এখানে দেখা যাবে।"
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
            হালনাগাদ করা যায়নি — নিচের সংখ্যাগুলো{' '}
            <span className="num">{formatTime(isoOf(board.updatedAt))}</span>-এর।
          </p>
        )}

        <StatRow>
          <Stat
            label="এখন কাজ করছেন"
            value={stats.active}
            unit={`/${stats.total}`}
          />
          <Stat
            label="আজ কাজ হয়েছে"
            value={stats.workedToday}
            unit={`/${stats.total}`}
            tone={stats.workedToday === 0 ? 'muted' : 'counted'}
          />
          <Stat label="আজকের মোট" value={formatDuration(stats.todaySec)} />
          <Stat
            label="আজ গড়ে"
            value={
              stats.workedToday === 0
                ? '—'
                : formatDuration(stats.todaySec / stats.workedToday)
            }
            tone={stats.workedToday === 0 ? 'muted' : 'counted'}
          />
          <Stat
            label="গড় মাসিক অগ্রগতি"
            value={formatPct(stats.avgMonthPct)}
            tone={stats.avgMonthPct === null ? 'muted' : 'counted'}
          />
          {/* ⚠️ পর্দায় একটাই লাল টাইল — নইলে লাল রঙের মানেই হারিয়ে যায় */}
          <Stat
            label="এজেন্ট বন্ধ"
            value={stats.agentDown}
            tone={stats.agentDown > 0 ? 'attention' : 'muted'}
          />
        </StatRow>

        <div className="mt-5">
          <SectionHead
            title={`টিম · ${stats.total} জন`}
            hint="রিং = মাসের টার্গেটের কতটা হয়েছে · নির্দিষ্ট শিফট নেই, দিনের যেকোনো ঘণ্টা গোনা হয়"
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
          */}
          <Caveat>
            একজনের একাধিক PC একসাথে চললে ওই সময়টা দুবার গোনা হয়, তাই ঘণ্টা
            সামান্য বেশি দেখাতে পারে। ১৫ মিনিটের বেশি এমন হলে আলাদা অ্যালার্ট
            ওঠে।
          </Caveat>

          {/* ⚠️ ছবি আনতে না পারা বোর্ড ভেঙে যাওয়া নয় — তাই ছোট করে, আলাদা করে */}
          {shots.error && !shots.data && (
            <p className="mt-2 text-xs text-ink-3">
              স্ক্রিনশট আনা যায়নি — কার্ডে ছবির জায়গাটা খালি থাকবে।
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <Page
      title="লাইভ বোর্ড"
      subtitle={
        data ? `${formatDate(data.workDate)} · ঢাকার সময়` : 'এখনকার অবস্থা'
      }
      actions={
        <div className="flex items-center gap-2">
          {board.updatedAt && (
            <span className="text-[11.5px] text-ink-3">
              হালনাগাদ{' '}
              <span className="num">{formatTime(isoOf(board.updatedAt))}</span>
            </span>
          )}
          <Button
            onClick={() => {
              board.reload();
              shots.reload();
            }}
            title="৩০ সেকেন্ড অপেক্ষা না করে এখনই"
          >
            হালনাগাদ
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
  workedToday: number;
  todaySec: number;
  /** ⚠️ কারো টার্গেট না থাকলে `null` — ০% নয়, "তথ্য নেই" */
  avgMonthPct: number | null;
  agentDown: number;
}

/**
 * মকআপের `.summary` টাইলগুলো।
 *
 * ⭐ মকআপে "Behind target" নামে একটা টাইল আছে, এখানে **ইচ্ছাকৃতভাবে নেই**।
 *    কে পিছিয়ে সেটা বলতে হলে মাসের কত ভাগ কর্মদিবস পেরিয়েছে জানতে হয়, আর
 *    সেটা ছুটির তালিকার উপর নির্ভর করে (`/holidays`) — `GET /live` ওই তথ্য
 *    পাঠায় না। ক্যালেন্ডারের দিন গুনে আন্দাজ করলে ছুটির পরদিন গোটা টিমকে
 *    "পিছিয়ে" দেখাত, আর সেই সংখ্যা দিয়েই কেউ কারো জবাবদিহি চাইত।
 *    আন্দাজ করা সংখ্যার চেয়ে না থাকা ভালো।
 */
function summarize(cards: LiveCard[]): BoardStats {
  let active = 0;
  let workedToday = 0;
  let todaySec = 0;
  let agentDown = 0;
  let pctSum = 0;
  let pctCount = 0;

  for (const card of cards) {
    if (card.status === 'active') active += 1;
    if (card.status === 'agent_down') agentDown += 1;
    if (card.todayWorkedSec > 0) workedToday += 1;
    todaySec += card.todayWorkedSec;

    if (card.monthTargetSec > 0) {
      pctSum += pctOf(card.monthWorkedSec, card.monthTargetSec);
      pctCount += 1;
    }
  }

  return {
    total: cards.length,
    active,
    workedToday,
    todaySec,
    agentDown,
    avgMonthPct: pctCount === 0 ? null : pctSum / pctCount,
  };
}

/** ⚠️ `formatTime` ISO স্ট্রিং চায়, `updatedAt` একটা `Date` */
function isoOf(at: Date | null): string | null {
  return at ? at.toISOString() : null;
}
