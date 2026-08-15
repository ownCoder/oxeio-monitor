import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { getTopUsage } from '../api/activity';
import { listAlerts } from '../api/alerts';
import {
  getLiveBoard,
  getTeamPulse,
  getTeamTrend,
  type LiveCard,
  type TrendDay,
} from '../api/dashboard';
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
import { OpenAlerts } from './live/OpenAlerts';
import { TopApps } from './live/TopApps';
import { StatusStrip } from './live/TeamBars';
import { TeamTable } from './live/TeamTable';
import { MonthCard, TopPerformers, WeekBars } from './live/WeekAndMonth';
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

/**
 * ⭐ Top performers-এর জানালা। **৩০ দিন আগে**, কারণ ওটাই ডিফল্ট — আর
 * `Tabs` প্রথম আইটেমটাকেই সবার বাঁয়ে বসায়।
 *
 * ⚠️ লেবেলে "30 days"/"All time" — সংখ্যাটা নয়, **জানালাটা** বোঝাতে।
 *    "Total"/"Recent" লিখলে কোনটা কত লম্বা তা পর্দা থেকে বোঝা যেত না।
 */
const LEADER_WINDOWS = [
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
] as const;

type LeaderWindow = (typeof LEADER_WINDOWS)[number]['id'];

export function LiveBoardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  /**
   * ⚠️ `/live` শুধু owner ও manager-এর (live.controller.ts-এ ক্লাস-লেভেল
   *    `@Roles`)। স্টাফ এখানে এলে ৪০৩ পাবে — সেটা `<ErrorBox>` নিজেই
   *    "You don't have access" বলে দেখায়। কিন্তু `/screenshots` স্টাফের
   *    জন্যও খোলা (স্কোপ দিয়ে নিজেরটা), তাই ওটা আলাদা করে আটকাতে হয়:
   *    নইলে যে পাতাটা সে দেখতেই পাচ্ছে না, তার জন্য প্রতি ৪ মিনিটে "নিজের
   *    ছবি দেখল" বলে একটা করে মিথ্যা অডিট সারি লেখা হতো।
   */
  const canViewBoard = user?.role === 'owner' || user?.role === 'manager';
  // ⚠️ অ্যালার্টে হোস্টনেম ও কর্মীর নাম একসাথে থাকে (§ ৪.৩) — owner-only,
  //    `Layout.tsx`-এর NAV-এ হুবহু একই নিয়ম।
  const isOwner = user?.role === 'owner';

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
   * ⭐ সাত দিন ও মাস — একই তালে (`pulse`-এর মতো ধীরে)। দুটোই ১৫ মিনিটের
   *    rollup জব থেকে আসে, তাই দ্রুত ডাকার কোনো লাভ নেই।
   */
  const trend = usePolling(
    (signal) =>
      canViewBoard ? getTeamTrend(signal) : Promise.resolve(null),
    PULSE_REFRESH_MS,
    [canViewBoard],
  );

  /**
   * ⭐ **আজ দলটা কোন অ্যাপে সময় দিয়েছে।** `employeeId` ইচ্ছাকৃতভাবে নেই —
   *    ওটা না দিলে সার্ভার গোটা দলের হিসাব দেয় (D08)।
   *
   * ⚠️⚠️ **`from` ও `to` দুটোই পাঠাতেই হবে।** না পাঠালে `resolveRange()`
   *    ডিফল্টে ধরে **মাসের ১ তারিখ থেকে আজ** — অর্থাৎ কার্ডের শিরোনাম
   *    "Where today went" বলত, কিন্তু সংখ্যাটা হতো গোটা মাসের। প্রথম
   *    খসড়ায় ঠিক এই ভুলটাই ছিল, আর ধরা পড়ত না: সংখ্যাগুলো দেখতে যুক্তিসঙ্গতই
   *    লাগত, শুধু কয়েক গুণ বড়।
   *
   * ⭐ তারিখটা **বোর্ডের নিজের `workDate`** থেকে, ক্লায়েন্টের ঘড়ি থেকে নয় —
   *    তাহলে কার্ডটা আর উপরের সংখ্যাগুলো কখনো আলাদা দিনের কথা বলতে পারে না।
   *    ⚠️ বোর্ড আসার আগে কলটা করা হয় না; ওই মুহূর্তে "আজ" কোনটা তা আমরা
   *    জানিই না, আর অনুমান করলে দিনের সীমানায় ভুল দিন ধরত।
   *
   * ⚠️ `limit: 6` — পর্দায় বসে পাঁচটা, ষষ্ঠটা আনা হয় শুধু "everything else"
   *    সংখ্যাটা যাতে বেশি না দেখায়। ⚠️ ওই সংখ্যাটা `totalSec` থেকে বাদ
   *    দিয়ে বেরোয়, তালিকা থেকে নয় — নইলে "টপ ৫-ই সব" বলে মিথ্যা হতো।
   */
  const workDate = board.data?.workDate;
  const apps = usePolling(
    (signal) =>
      canViewBoard && workDate
        ? getTopUsage({ from: workDate, to: workDate, limit: 6 }, signal)
        : Promise.resolve(null),
    PULSE_REFRESH_MS,
    [canViewBoard, workDate],
  );

  /**
   * ⚠️ অ্যালার্ট **owner-only** — ম্যানেজারকে ব্যাজও দেখানো হয় না
   *    (`Layout.tsx`-এর NAV-এ একই নিয়ম)। এখানে না দেখলে ম্যানেজারের
   *    ব্রাউজার প্রতিবার একটা ৪০৩ কুড়াত।
   * ⚠️ `limit: 3` — বাক্সে তিনটেই বসে; মোট সংখ্যাটা আসে `openCount` থেকে,
   *    সারি গুনে নয়।
   */
  const alerts = usePolling(
    (signal) =>
      isOwner ? listAlerts({ limit: 3 }, signal) : Promise.resolve(null),
    PULSE_REFRESH_MS,
    [isOwner],
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

  /**
   * ⚠️ পছন্দটা মনে রাখা হয় না — উপরের `who`-এর মতোই একই কারণে। বোর্ড
   *    সারাদিন খোলা থাকে; কেউ একবার "All time" রেখে ভুলে গেলে পরদিন
   *    খুলে দেখতেন ক্রমটা বদলায়নি, আর ভাবতেন কেউ কাজ করেনি।
   */
  const [leaderWindow, setLeaderWindow] = useState<LeaderWindow>('30d');

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

        {/*
          ⭐⭐ **ছ-টা টাইল, মকআপ ক-এর ক্রমেই** — কাজ করছেন · আজকের ঘণ্টা ·
          দলের pace · জনপ্রতি গড় · এজেন্ট সচল · খোলা অ্যালার্ট।

          ⭐ প্রতিটার নিচে **এক লাইনের প্রেক্ষাপট** (`sub`), আর ওটাই এই
          সারির আসল কাজ: একটা কাঁচা সংখ্যা প্রায়ই দুভাবে পড়া যায়, আর তখন
          মানুষ যেটা ভয় পান সেটাই ধরে নেন। "pace −৬ঘ" ভয়ংকর শোনায় যতক্ষণ
          না জানা যায় গোনা শুরুই হয়েছে তিন দিন আগে।

          ⚠️⚠️ **যা জানা নেই তা লেখা হয় না।** মকআপে টাইলের নিচে ছিল
          "৩ জন ছুটিতে" ও "১ কর্মদিবস পেরিয়েছে" — দুটোর কোনোটাই বোর্ডের
          ডেটায় নেই (`/live` ছুটি জানে না, `TrendMonth`-এ কর্মদিবসের
          সংখ্যাও নেই)। ⭐ তাই ওই দুটো জায়গায় **অন্য সত্যি কথা** বসেছে যা
          একই ভুল-পড়া ঠেকায়: কতজনের আজ টার্গেটই নেই, আর কবে থেকে গোনা হচ্ছে।
          অনুমান করে লিখলে টাইলটা এমন কিছু দাবি করত যা সে জানে না।
        */}
        <StatRow>
          <Stat
            label="Working now"
            value={stats.active}
            unit={`/${stats.total}`}
            sub={
              stats.total - stats.withTarget > 0
                ? `${stats.total - stats.withTarget} on a day off`
                : undefined
            }
          />

          {/*
            ⭐ মকআপের "▲ গতকালের চেয়ে ২ঘ ১০মি" — তুলনাটা `trend.days` থেকে,
               নতুন কোনো কল ছাড়াই।

            ⚠️⚠️ গতকাল **ট্র্যাক করা না থাকলে তুলনা দেখানো হয় না**। ওই দিনের
               `workedSec` তখন ০, আর "▲ ১৮ঘ বেশি" লিখলে সেটা সরাসরি মিথ্যা —
               কাল কেউ কম কাজ করেনি, কাল আমরা দেখিইনি।
            ⚠️ আজকের দিনটা এখনো চলছে, তাই দুপুরে তুলনাটা প্রায় সবসময় ঋণাত্মক।
               সেটা ভুল নয়, আর সেজন্যই এটা রঙিন নয় — কেবল তথ্য।
          */}
          <Stat
            label="Hours today"
            value={formatDuration(stats.todaySec)}
            sub={yesterdayDelta(trend.data?.days, stats.todaySec)}
          />

          {/*
            ⭐⭐ **মাসের pace — গোটা অ্যাপের কেন্দ্রীয় সংখ্যাটা।** "আমরা কি
               পিছিয়ে আছি" প্রশ্নটাই বোর্ড খোলার সবচেয়ে সাধারণ কারণ।

            ⭐ রংটা **লাল** — মকআপ ক-এ ওটাই ছিল *(মালিক: "১০০% same")*।
            ⚠️ এখানে আগে হলুদ (`behind`) ছিল, যুক্তি ছিল "পর্দায় একটাই লাল
               টাইল, নইলে লাল রঙের মানেই হারিয়ে যায়"। যুক্তিটা এখনো খাটে,
               তাই **দামটা লিখে রাখা হলো**: পিছিয়ে থাকা আর এজেন্ট বন্ধ এখন
               একই রঙে, অথচ একটা মাসজুড়ে সারানো যায়, অন্যটায় ঠিক এই
               মুহূর্তে ঘণ্টা হারাচ্ছে।
            ⚠️ `trackedFrom` না থাকলে জানালাটাই খালি, অর্থাৎ **সংখ্যা নেই** —
               তখন `০` নয়, `—`, নইলে "ঠিক আছে" বলে মিথ্যা দাবি হতো।
          */}
          <Stat
            label={
              trend.data?.month.paceSec != null && trend.data.month.paceSec < 0
                ? 'Behind pace'
                : 'Ahead of pace'
            }
            value={
              trend.data?.month.trackedFrom == null
                ? '—'
                : formatDuration(Math.abs(trend.data.month.paceSec))
            }
            tone={
              trend.data?.month.trackedFrom == null
                ? 'muted'
                : trend.data.month.paceSec < 0
                  ? 'attention'
                  : 'counted'
            }
            sub={
              trend.data?.month.trackedFrom
                ? `counted from ${formatDate(trend.data.month.trackedFrom)}`
                : 'no finished day counted yet'
            }
          />

          {/*
            ⚠️ হর `workedToday`, `total` নয় — যাঁরা আজ শুরুই করেননি তাঁদের
               শূন্য দিয়ে ভাগ করলে গড়টা "দল কেমন করছে" নয়, "কতজন এসেছে"
               বলত। ⭐ `sub`-এ দৈনিক টার্গেট, কিন্তু **কেবল সবার এক হলে**।
          */}
          <Stat
            label="Average today"
            value={
              stats.workedToday === 0
                ? '—'
                : formatDuration(stats.todaySec / stats.workedToday)
            }
            tone={stats.workedToday === 0 ? 'muted' : 'counted'}
            sub={
              commonDailyTarget(cards) != null
                ? `target ${formatDuration(commonDailyTarget(cards) as number)}`
                : undefined
            }
          />

          {/*
            ⭐ মকআপ ক-এর মতো **ইতিবাচক দিক থেকে** — "কতগুলো সচল", "কতগুলো
               মরা" নয়। সাতটার সাতটাই চললে সংখ্যাটা তখন একটা আশ্বাস, আর
               সেটাই বোর্ড খোলার একটা বৈধ কারণ।

            ⚠️⚠️ **লাল এখানেই, আর পর্দায় এটাই একমাত্র লাল।** এজেন্ট বন্ধ
               মানে ঠিক এই মুহূর্তে কারো ঘণ্টা **হারিয়ে যাচ্ছে** — সেটা
               খোলা অ্যালার্টের চেয়ে ভিন্ন জাতের, কারণ অ্যালার্ট ইতিমধ্যে
               ঘটে যাওয়া কিছুর খবর। তাই পাশের টাইলটা হলুদ, এটা লাল।
          */}
          <Stat
            label="Agents up"
            value={stats.total - stats.agentDown}
            unit={`/${stats.total}`}
            tone={stats.agentDown > 0 ? 'attention' : 'counted'}
            sub={
              stats.agentDown > 0
                ? `${stats.agentDown} silent — hours are being lost`
                : 'every heartbeat is fresh'
            }
          />

          {/*
            ⚠️ owner ছাড়া কেউ অ্যালার্ট দেখেন না (`listAlerts` owner-only),
               তাই ম্যানেজারের কাছে টাইলটা `—` দেখাত। ⭐ তার বদলে টাইলটাই
               বসে না — খালি ঘর একটা প্রশ্ন তৈরি করত যার উত্তর তাঁর জন্য নেই।
          */}
          {isOwner && (
            <Stat
              label="Open alerts"
              value={alerts.data ? alerts.data.total : '—'}
              tone={
                !alerts.data
                  ? 'muted'
                  : alerts.data.total > 0
                    ? 'behind'
                    : 'counted'
              }
              sub={
                alerts.data && alerts.data.total > 0
                  ? alerts.data.rows[0]?.title
                  : undefined
              }
            />
          )}
        </StatRow>

        {/*
          ⚠️⚠️ **ফোনে ক্রমটা উল্টে যায়, আর সেটা ইচ্ছাকৃত।** নিচের স্তরগুলো
             `lg`-এর নিচে এক কলামে নামে, অর্থাৎ আটটা কার্ড উপর-নিচে দাঁড়ায় —
             তখন মানুষের তালিকাটা ছয়-সাত পর্দা নিচে চলে যেত। কিন্তু মালিকের
             কথায় বোর্ডের আসল প্রশ্নটাই ওটা: *"Live Board e ami shudhu
             working staff dekhte cai."* সবচেয়ে চাওয়া জিনিসটা সবচেয়ে দূরে
             থাকা মানে ফোনে বোর্ডটা কার্যত অকেজো ([G122](../../../docs/08-Gap-Analysis.md))।

          ⭐ সমাধান `order`, DOM নয় — **পড়ার ক্রম ও কি-বোর্ডের ক্রম অক্ষত
             থাকে**, শুধু ছোট পর্দায় দলটা উপরে ওঠে। সীমা `lg`, `sm` নয়:
             ঠিক ওখানেই স্তরগুলো দুই কলাম থেকে এক কলামে নামে, তাই সমস্যাটাও
             ওখান থেকেই শুরু।
        */}
        <div className="flex flex-col">
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
        {/*
          ⭐⭐ **মকআপ ক-এর বিন্যাস — হুবহু দুটো সারি।**

          ⚠️⚠️ এখানে আগে **চারটে** সারি ছিল, প্রতিটাই `3fr 2fr`। কার্ডগুলো একই
          ছিল, শুধু পাতাটা প্রায় দ্বিগুণ লম্বা — আর তাতে মকআপ ক-এর গোটা
          যুক্তিটাই ("সবচেয়ে বেশি তথ্য এক পর্দায়") মিথ্যা হয়ে যেত।

          ⚠️ মালিক দুটো পাশাপাশি রেখে ধরিয়ে দিয়েছেন। আমি ছ-টা ফারাক গুনে
          "মিলে গেছে" বলেছিলাম — রং, কলাম আর লেবেল মিলিয়ে। **গ্রিডটা মিলিয়ে
          দেখিনি**, অথচ পর্দার আকৃতি ওটাই ঠিক করে।

          ⭐ মকআপের `.r-2-1-1` ও `.r-3-2`: সারি ১ `2fr 1fr 1fr`, সারি ২
          `3fr 2fr` — যার ডান কলামে দুটো কার্ড **খাড়াখাড়ি**।
        */}
        <div className="mt-3 grid gap-3 lg:grid-cols-[2fr_1fr_1fr]">
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
          <Card
            title="Last 7 days"
            hint="Per day · dashed = before tracking"
            padded={false}
          >
            {trend.data ? (
              <WeekBars days={trend.data.days} />
            ) : (
              <div className="px-4 pt-1 pb-3">
                <div className="h-24 rounded bg-line/40" />
              </div>
            )}
          </Card>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[3fr_2fr]">
          {/*
            ⭐ ছুটির দিনে কার্ডটার **নামও বদলায়** *(১৫ আগস্ট)*। "Against
               today's target" যখন কারো কোনো টার্গেটই নেই, তখন শিরোনামটাই
               একটা স্ববিরোধ। ঘণ্টাগুলো তবু সত্যি — আর বারগুলো তখন
               **এক কর্মদিবসের** বিপরীতে আঁকা হয়, সবুজ রঙে (`TeamBars`)।
          */}
          <Card
            title={
              stats.withTarget === 0 ? 'Hours today' : "Against today's target"
            }
            hint={
              stats.withTarget === 0
                ? 'Day off — green shows today’s hours against a normal working day'
                : 'Furthest along first · green means the target is met'
            }
            padded={false}
          >
            <TeamTable cards={cards} />
          </Card>
          {/*
            ⭐ মকআপের ডান কলাম — দুটো কার্ড **খাড়াখাড়ি**, পাশাপাশি নয়।
            ⚠️ owner ছাড়া "Needs attention" নেই, তখন কলামে একটাই কার্ড থাকে।
               গ্রিডটা তবু `3fr 2fr` — নইলে ম্যানেজারের পর্দায় টেবিলটা হঠাৎ
               পুরো চওড়া হয়ে যেত, আর একই বোর্ড দুই ভূমিকায় দু-রকম দেখাত।
          */}
          <div className="grid content-start gap-3">
          <Card
            title="Where today went"
            hint="Whole team · counted app time only"
            padded={false}
          >
            {apps.data ? (
              <TopApps usage={apps.data.apps} />
            ) : (
              <div className="px-4 py-8">
                <div className="h-24 rounded bg-line/40" />
              </div>
            )}
          </Card>
          {isOwner && (
            <Card
              title="Needs attention"
              hint="Not acknowledged yet"
              padded={false}
            >
              {alerts.data ? (
                <OpenAlerts page={alerts.data} />
              ) : (
                <div className="px-4 py-8">
                  <div className="h-24 rounded bg-line/40" />
                </div>
              )}
            </Card>
          )}
          </div>
        </div>

        {/*
          ⚠️⚠️ **এই সারিটা মকআপ ক-এ নেই।** দুটোই পরে যোগ হওয়া, আর দুটোই
          মালিকের নিজের চাওয়া: "This month", আর "Top performers" (⭐ শেষ ৩০
          দিনের জানালা — ওটাও তাঁরই সংশোধন)।
          ⭐ মুছে ফেললে মকআপের সাথে অক্ষরে অক্ষরে মিলত, কিন্তু তিনি নিজে যা
          চেয়েছেন তা-ই হারাত। তাই মকআপের দুটো সারির **পরে**, আগে নয়।
        */}
        <div className="mt-3 grid gap-3 lg:grid-cols-[3fr_2fr]">
          {/*
            ⭐⭐ **দুটো জানালা, একটাই কার্ড।**

            ⚠️ মালিক আগে "আজীবন মোট ঘণ্টা" বেছেছিলেন, পরে ৩০ দিন চেয়েছেন।
               দুটো আলাদা কার্ড বসালে পাশাপাশি প্রায় একই পাঁচটা নাম দুবার
               দেখা যেত — জঞ্জাল। তাই একটাই কার্ড, ভেতরে জানালা বদলানোর সুইচ,
               আর আগের পছন্দটাও কেড়ে নেওয়া হয়নি।

            ⭐ ডিফল্ট **৩০ দিন**, কারণ আজীবনের ক্রমে ঘণ্টা কেবল জমে —
               যিনি আগে যোগ দিয়েছেন তিনি স্থায়ীভাবে উপরে, আর নতুন কেউ যত
               ভালোই করুন ধরতে পারেন না। ওই তালিকা "কে ভালো করছে" নয়,
               "কে বেশিদিন আছে" বলে।
          */}
          <Card
            title="Top performers"
            hint={
              leaderWindow === '30d'
                ? 'Most hours counted in the last 30 days'
                : 'Most hours counted, all time'
            }
            padded={false}
            actions={
              <Tabs
                items={LEADER_WINDOWS}
                active={leaderWindow}
                onChange={setLeaderWindow}
                label="Top performers window"
              />
            }
          >
            {trend.data ? (
              <TopPerformers
                leaders={
                  leaderWindow === '30d'
                    ? trend.data.leaders30
                    : trend.data.leaders
                }
              />
            ) : (
              <div className="px-4 py-8">
                <div className="h-24 rounded bg-line/40" />
              </div>
            )}
          </Card>
          <Card
            title="This month"
            hint="Counted against the team target"
            padded={false}
          >
            {trend.data ? (
              <MonthCard month={trend.data.month} />
            ) : (
              <div className="px-4 pt-1 pb-3">
                <div className="h-24 rounded bg-line/40" />
              </div>
            )}
          </Card>
        </div>

        {/* ⚠️ `order-first` কেবল `lg`-এর নিচে — উপরের নোট দেখুন */}
        <div className="mt-5 order-first lg:order-none">
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
        </div>
      </>
    );
  }

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          Live Board
          {/*
            ⭐ মকআপ ক-এর `LIVE` ব্যাজ — এই পাতাটা নিজে থেকেই নতুন হয়, সেটা
               বলার জন্য। বাকি পাতাগুলো হয় না, তাই পার্থক্যটা বলার মতো।

            ⚠️⚠️ **শেষ রিফ্রেশ ব্যর্থ হলে ব্যাজটা নেভে**, আর এটাই এর একমাত্র
               শর্ত। সবুজ বিন্দু জ্বলতে থাকলে ওটা দাবি করে "যা দেখছেন তা
               এইমাত্রকার" — অথচ নিচের সংখ্যাগুলো তখন কয়েক মিনিটের পুরোনো।
               ঠিক ওই মুহূর্তে ব্যাজটাই হতো পর্দার সবচেয়ে বড় মিথ্যা।
          */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
              board.error
                ? 'bg-line/60 text-ink-3'
                : 'bg-ok/10 text-ok-ink'
            }`}
            title={
              board.error
                ? 'The last refresh failed — the numbers below are older'
                : 'This page refreshes itself every 30 seconds'
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                board.error ? 'bg-ink-3' : 'animate-pulse bg-ok'
              }`}
              aria-hidden
            />
            {board.error ? 'STALE' : 'LIVE'}
          </span>
        </span>
      }
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
              /**
               * ⚠️ **তিনটেই** — এখানে `pulse` বাদ পড়েছিল, আর ফাঁকটা নীরব:
               * বোতামের নাম "Refresh", কিন্তু দিনের ছন্দের চার্টটা নিজের
               * দু-মিনিটের তালেই থাকত। কেউ চার্ট বাসি দেখে Refresh চেপে
               * একই ছবি পেতেন আর ভাবতেন ডেটাই আসছে না।
               *
               * ⭐ নিয়মটা সাধারণ: **যে বোতাম "সব নতুন করে আনো" বলে, তাকে
               * পর্দার প্রতিটা উৎস ছুঁতে হয়** — নইলে নামটাই মিথ্যা।
               */
              board.reload();
              shots.reload();
              pulse.reload();
              trend.reload();
            }}
            title="Now, without waiting 30 seconds"
          >
            Refresh
          </Button>
          {/*
            ⭐ মকআপ ক-এর তৃতীয় বোতাম। ⚠️ মকআপে একটা "আজ" বোতামও ছিল —
               সেটা বসানো হয়নি, কারণ বোর্ড **কেবল আজকেরই** দেখায়, অন্য
               তারিখ বাছার পথ নেই। যে বোতাম কিছু বদলায় না, সেটা পর্দায়
               থাকলে ব্যবহারকারী ধরে নিতেন অন্য তারিখও দেখা যায়।
          */}
          {canViewBoard && (
            <Button
              onClick={() => navigate('/reports')}
              title="Excel and PDF for any date range"
            >
              Reports
            </Button>
          )}
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

/**
 * ⭐ "▲ গতকালের চেয়ে ২ঘ ১০মি" — মকআপ ক-এর টাইলে যা ছিল।
 *
 * ⚠️⚠️ **গতকাল ট্র্যাক করা না থাকলে `undefined`**, শূন্য নয়। ওই দিনের
 * `workedSec` তখনো ০ আসে, আর সেটাকে তুলনায় বসালে টাইল বলত "▲ ১৮ঘ বেশি" —
 * সরাসরি মিথ্যা: কাল কেউ কম কাজ করেনি, কাল **আমরা দেখিইনি**। এটাই এই
 * ফাইলের সবচেয়ে পুরোনো নিয়ম (`tracked` ঘরটার জন্মই এই কারণে)।
 *
 * ⚠️ শেষ সারিটা আজকের, তাই গতকাল **শেষ থেকে দ্বিতীয়**।
 */
function yesterdayDelta(
  days: readonly TrendDay[] | undefined,
  todaySec: number,
): string | undefined {
  if (!days || days.length < 2) return undefined;

  const yesterday = days[days.length - 2];
  if (!yesterday.tracked) return undefined;

  /**
   * ⚠️⚠️ **গতকাল সবার ছুটি হলে তুলনাই হয় না** — আর এটা মাঠে ধরা পড়েছে,
   * বসানোর কয়েক মিনিট পরেই। শনিবারের বোর্ডে টাইলটা বলছিল
   * *"▲ ৭১ঘ ৭মি vs yesterday"*, কারণ গতকাল শুক্রবার ছিল: `tracked` সত্যি
   * (সার্ভার দিনটা দেখেছে), কিন্তু `workedSec` শূন্য (কারো টার্গেটই ছিল না)।
   *
   * ⭐ সংখ্যাটা মিথ্যা ছিল না, **তুলনাটা** ছিল — কেউ গতকাল ৭১ ঘণ্টা কম
   * কাজ করেনি, গতকাল কাজের দিনই ছিল না। `expectedStaff === 0` মানে ঠিক
   * সেটাই, আর ঘরটা এই কারণেই আছে।
   */
  if (yesterday.expectedStaff === 0) return 'yesterday was a day off';

  const delta = todaySec - yesterday.workedSec;
  // ⚠️ ৫ মিনিটের কম ফারাক দেখানো হয় না — "▲ ২মি" কোনো খবর নয়, কেবল কালি
  if (Math.abs(delta) < 300) return 'about the same as yesterday';

  return `${delta > 0 ? '▲' : '▼'} ${formatDuration(Math.abs(delta))} vs yesterday`;
}

/**
 * সবার দৈনিক টার্গেট এক হলে সেই সংখ্যাটা, নইলে `null`।
 *
 * ⚠️ আলাদা নীতিতে থাকা দল হলে একটা সংখ্যা বেছে দেখানো যেত না — তখন টাইল
 * এমন একটা "টার্গেট" দাবি করত যা কারো কারো ক্ষেত্রে ভুল। ⭐ আর ছুটির দিনে
 * সবার টার্গেট ০, তাই তখনো কিছু দেখানো হয় না।
 */
function commonDailyTarget(cards: readonly LiveCard[]): number | null {
  const withTarget = cards.filter((c) => c.dailyTargetSec > 0);
  if (withTarget.length === 0) return null;

  const first = withTarget[0].dailyTargetSec;
  return withTarget.every((c) => c.dailyTargetSec === first) ? first : null;
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
