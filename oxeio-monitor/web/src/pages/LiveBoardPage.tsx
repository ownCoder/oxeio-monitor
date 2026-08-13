import { useState, type ReactNode } from 'react';

import { getLiveBoard, getTeamPulse, type LiveCard } from '../api/dashboard';
import { usePolling } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, Stat, StatRow } from '../components/Card';
import { Button, Page, SectionHead } from '../components/Page';
import { Caveat, Empty, ErrorBox, Loading } from '../components/States';
import { StatusLegend } from '../components/StatusDot';
import { Tabs } from '../components/Tabs';
import {
  dhakaHourNow,
  formatDate,
  formatDuration,
  formatTime,
} from '../lib/format';
import { DayPulse } from './live/DayPulse';
import { StatusStrip, TargetBars } from './live/TeamBars';
import { PersonCard } from './live/PersonCard';
import { getLatestShots, NO_SHOTS } from './live/latestShots';
import { isWorking, splitBoard } from './live/onTheClock';
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

/**
 * ⭐ দিনের ছন্দ **২ মিনিটে** — বোর্ডের ৩০ সেকেন্ডে নয়।
 *
 * ⚠️ বালতিগুলো এক ঘণ্টার। ৩০ সেকেন্ডে ডাকলে একই উত্তর ঘণ্টায় ১২০ বার
 *    আসত, আর প্রতিটাই একটা করে গোটা দিনের সেগমেন্ট-কোয়েরি। চার্টটা
 *    তাতে এক চুলও তাজা হতো না।
 */
const PULSE_REFRESH_MS = 2 * 60_000;

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
   * ⚠️ `/live/pulse`-ও owner + manager (একই ক্লাস-লেভেল `@Roles`), তাই
   *    `canViewBoard` না দেখলে স্টাফের ব্রাউজার প্রতি দু-মিনিটে একটা করে
   *    ৪০৩ কুড়াত — কোনো লাভ ছাড়াই।
   */
  const pulse = usePolling(
    (signal) =>
      canViewBoard ? getTeamPulse(signal) : Promise.resolve(null),
    PULSE_REFRESH_MS,
    [canViewBoard],
  );

  /**
   * ⭐ কোন কার্ডের ছবি বড় করে খোলা — **আইডি**, ছবির কপি নয়। কপি ধরে
   *    রাখলে রিফ্রেশে নতুন টোকেন এলেও মোডালে পুরোনো (মেয়াদোত্তীর্ণ)
   *    লিঙ্কটাই আটকে থাকত।
   */
  const [openFor, setOpenFor] = useState<number | null>(null);

  /**
   * ⭐ ডিফল্ট **`working`** — বোর্ড খুললে প্রথম যে প্রশ্নটা মাথায় আসে
   * ("এখন কে কাজ করছে?") তার উত্তর যেন কোনো ক্লিক ছাড়াই সামনে থাকে।
   *
   * ⚠️ পছন্দটা মনে রাখা হয় না (localStorage নেই) — ইচ্ছাকৃত। বোর্ডটা
   * সারাদিন খোলা থাকে আর নিজে নিজে রিফ্রেশ হয়; কেউ একবার অন্য ট্যাবে
   * গিয়ে ভুলে গেলে পরদিন খুলে দেখতেন "কেউ কাজ করছে না", অথচ আসলে তিনি
   * অন্য ট্যাবে দাঁড়িয়ে আছেন।
   */
  const [who, setWho] = useState<'working' | 'resting'>('working');

  const data = board.data;
  const cards = data?.cards ?? [];

  // ⭐ ভাগটা `onTheClock.ts`-এ — উপরের "Working now" টাইলও **একই**
  //    `isWorking` ব্যবহার করে, তাই দুটো সংখ্যা কখনো আলাদা হতে পারে না।
  const { working, resting } = splitBoard(cards);
  const shown = who === 'working' ? working : resting;
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

        {/*
          ⭐⭐ **cockpit-এর স্তরগুলো, উপর থেকে নিচে একটা প্রশ্নের ক্রমে:**
            ১· সংখ্যা — "আজ কতটা হয়েছে?"        (উপরের টাইল)
            ২· ছন্দ  — "দিনটা কেমন গেল?"          (২৪ ঘণ্টার কলাম)
            ৩· অবস্থা — "এই মুহূর্তে কে কোথায়?"    (স্তরে-ভাগ স্ট্রিপ)
            ৪· ব্যক্তি — "কে কতদূর?"               (টার্গেট-বার)
            ৫· মুখ    — "সে আসলে কী করছে?"        (কার্ড ও স্ক্রিনশট)

          ⚠️ ক্রমটা এলোমেলো নয়: প্রতিটা স্তর আগেরটার উত্তর থেকে **জন্ম নেওয়া
             পরের প্রশ্নটার** উত্তর দেয়। উল্টো সাজালে বোর্ড খুলেই দশটা মুখ
             দেখা যেত, আর "আজ দিনটা কেমন" জানতে নিচে স্ক্রল করতে হতো।
        */}
        <div className="mt-3 grid gap-3 lg:grid-cols-[3fr_2fr]">
          <Card
            title="Shape of the day"
            hint="Hours the whole team put in, by hour · Dhaka time"
            padded={false}
          >
            {pulse.data ? (
              <DayPulse
                hours={pulse.data.hours}
                currentHour={dhakaHourNow()}
              />
            ) : (
              /*
                ⚠️ স্পিনার নয়, **কঙ্কাল** — চার্টের জায়গাটা আগেই দখল করে
                   রাখে, তাই ডেটা এলে পাতাটা লাফায় না। বোর্ড ৩০ সেকেন্ডে
                   রিফ্রেশ হয়; প্রতিবার লাফালে পড়াই যেত না।
              */
              <div className="px-4 pt-1 pb-3">
                <div className="mb-2 h-4 w-40 rounded bg-line/70" />
                <div className="h-24 rounded bg-line/40" />
              </div>
            )}
          </Card>

          <Card
            title="Right now"
            hint="Every card falls in exactly one of these"
            padded={false}
          >
            <StatusStrip cards={cards} />
          </Card>
        </div>

        <div className="mt-3">
          <Card
            title="Against today's target"
            hint={
              stats.withTarget === 0
                ? 'No target today — weekly off or holiday'
                : 'Furthest along first · green means the target is met'
            }
            padded={false}
          >
            <TargetBars cards={cards} />
          </Card>
        </div>

        <div className="mt-5">
          <SectionHead
            title={`Team · ${stats.total}`}
            hint={
              stats.withTarget === 0
                ? 'No target today — weekly off or holiday · hours still count if someone works'
                : "Ring = today's target · no fixed shift, any hour of the day counts"
            }
          />

          {/*
            ⭐ **কারা এখন কাজ করছেন — সেটাই বোর্ডের আসল প্রশ্ন।** আগে সবাই
               একসাথে থাকত, তাই ১৫ জনের অফিসে কাজ করা ৩ জনকে খুঁজে বের করতে
               চোখ বুলাতে হতো। মালিকের কথায়: *"Live Board e ami shudhu
               working staff dekhte cai."*

            ⚠️⚠️ **লুকিয়ে ফেলা নয়, সরিয়ে রাখা।** যাঁরা কাজ করছেন না তাঁরা
               পাশের ট্যাবেই, আর সংখ্যাটা ট্যাবের গায়ে লেখা — নইলে "কেউ
               বাদ পড়ে গেল কি না" প্রশ্নটা মাথায় থেকে যেত।

            ⚠️ 🔴 **agent down কখনো চাপা পড়ে না** — উপরের লাল টাইলটা সবসময়
               দেখা যায়, আর সংখ্যা শূন্য না হলে ট্যাবের গায়েও আলাদা করে
               লেখা থাকে। ওটাই একমাত্র অবস্থা যেটা সত্যিই **সমস্যা**,
               বাকিগুলো শুধু "এখন কাজ করছেন না"।
          */}
          <Tabs
            label="Who is on the board"
            active={who}
            onChange={setWho}
            items={[
              { id: 'working', label: `Working · ${working.length}` },
              {
                id: 'resting',
                label:
                  stats.agentDown > 0
                    ? `Not working · ${resting.length} · ${stats.agentDown} down`
                    : `Not working · ${resting.length}`,
              },
            ]}
          />

          {/* E12 — ফোনে এক কলাম, ট্যাবে দুই, ডেস্কটপে তিন-চার */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((card) => (
              <PersonCard
                key={card.employeeId}
                card={card}
                shot={byEmployee?.get(card.employeeId) ?? null}
                onOpenShot={() => setOpenFor(card.employeeId)}
              />
            ))}
          </div>

          {/*
            ⚠️ খালি ট্যাব চুপ করে থাকতে পারে না — ফাঁকা জায়গা দেখলে
               ব্যবহারকারী ভাবেন পাতাটা ভেঙে গেছে, ডেটা লোড হয়নি।
          */}
          {shown.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-3">
              {who === 'working'
                ? 'Nobody is working right now.'
                : 'Everyone is working right now.'}
            </p>
          )}

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
    // ⚠️ ট্যাবের ভাগের সাথে **একই** শর্ত — দুই জায়গায় দুবার লিখলে
    //    একদিন একটা বদলাত আর অন্যটা নয়, আর বোর্ড নিজেই নিজেকে কাটত।
    if (isWorking(card.status)) active += 1;
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
