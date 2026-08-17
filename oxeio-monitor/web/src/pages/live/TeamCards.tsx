import { useState } from 'react';

import type { LiveCard } from '../../api/dashboard';
import { Caveat } from '../../components/States';
import { StatusLegend } from '../../components/StatusDot';
import { SectionHead } from '../../components/Page';
import { Tabs } from '../../components/Tabs';
import { getLatestShots, NO_SHOTS } from './latestShots';
import { PersonCard } from './PersonCard';
import { ShotLightbox } from './ShotLightbox';
import { splitBoard } from './onTheClock';
import { usePolling } from '../../api/useApi';

/**
 * **দলের কার্ড — কে এখন কাজ করছেন, কে করছেন না।**
 *
 * ⭐⭐ ১৭ আগস্ট এটা Live Board থেকে **Worklog পাতায় সরানো হয়েছে**, মালিকের
 * অনুরোধে। বোর্ডে কার্ডগুলো ছিল সবার নিচে — ছ-টা টাইল ও চারটে চার্ট
 * পেরিয়ে; "এখন কে কাজ করছে" প্রশ্নের উত্তরে পৌঁছাতে গোটা পাতা স্ক্রল
 * করতে হতো, অথচ ওটাই সবচেয়ে বেশি দেখা জিনিস।
 *
 * ⚠️⚠️ **কম্পোনেন্ট হিসেবে আলাদা করা হয়েছে, কেটে বসানো হয়নি।** মার্কআপটা
 * দুই পাতায় নকল করলে একদিন একটা বদলাত আর অন্যটা নয় — আর তখন একই বোর্ড
 * দু-জায়গায় দু-রকম দেখাত। এখন ঘরটা একটাই।
 *
 * ⚠️ নিজের ছবি নিজেই আনে (`usePolling`), কারণ Worklog পাতায় Live Board-এর
 * আর কিছুই নেই। ⭐ ছবির ছন্দ **ইচ্ছাকৃতভাবে ধীর** — কারণটা
 * `latestShots.ts`-এর মাথায়: প্রতিটা কল একটা করে audit সারি লেখে।
 */

/** ছবির রিফ্রেশ — বোর্ডের চেয়ে ধীরে, দেখুন `latestShots.ts` */
const SHOT_REFRESH_MS = 120_000;

export function TeamCards({
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
  /**
   * ⭐ ডিফল্ট **`working`** — পাতা খুললে প্রথম যে প্রশ্নটা মাথায় আসে
   * ("এখন কে কাজ করছে?") তার উত্তর যেন কোনো ক্লিক ছাড়াই সামনে থাকে।
   *
   * ⚠️ পছন্দটা মনে রাখা হয় না (localStorage নেই) — ইচ্ছাকৃত। পাতাটা
   * সারাদিন খোলা থাকে আর নিজে নিজে রিফ্রেশ হয়; কেউ একবার অন্য ট্যাবে
   * গিয়ে ভুলে গেলে পরদিন খুলে দেখতেন "কেউ কাজ করছে না", অথচ আসলে তিনি
   * অন্য ট্যাবে দাঁড়িয়ে আছেন।
   */
  const [who, setWho] = useState<'working' | 'resting'>('working');
  const [openFor, setOpenFor] = useState<number | null>(null);

  const shots = usePolling(
    (signal) => (canView ? getLatestShots(signal) : Promise.resolve(NO_SHOTS)),
    SHOT_REFRESH_MS,
    [canView],
  );

  // ⭐ ভাগটা `onTheClock.ts`-এ — উপরের "Working now" টাইলও **একই**
  //    `isWorking` ব্যবহার করে, তাই দুটো সংখ্যা কখনো আলাদা হতে পারে না।
  const { working, resting } = splitBoard(cards);
  const shown = who === 'working' ? working : resting;
  const byEmployee = shots.data?.byEmployee;

  const openCard =
    openFor === null ? null : (cards.find((c) => c.employeeId === openFor) ?? null);
  const openShot = openFor === null ? null : (byEmployee?.get(openFor) ?? null);

  return (
    <div>
      <SectionHead
        title={`Team · ${cards.length}`}
        hint={
          withTarget === 0
            ? 'No target today — weekly off or holiday · hours still count if someone works'
            : "Ring = today's target · no fixed shift, any hour of the day counts"
        }
      />

      {/*
        ⭐ **কারা এখন কাজ করছেন — সেটাই এই পাতার আসল প্রশ্ন।** আগে সবাই
           একসাথে থাকত, তাই ১৫ জনের অফিসে কাজ করা ৩ জনকে খুঁজে বের করতে
           চোখ বুলাতে হতো। মালিকের কথায়: *"Live Board e ami shudhu
           working staff dekhte cai."*

        ⚠️⚠️ **লুকিয়ে ফেলা নয়, সরিয়ে রাখা।** যাঁরা কাজ করছেন না তাঁরা
           পাশের ট্যাবেই, আর সংখ্যাটা ট্যাবের গায়ে লেখা — নইলে "কেউ
           বাদ পড়ে গেল কি না" প্রশ্নটা মাথায় থেকে যেত।
      */}
      <Tabs
        label="Who is on the board"
        active={who}
        onChange={setWho}
        items={[
          { id: 'working', label: `Working · ${working.length}` },
          // ⚠️ আগে এখানে "· 1 down" জুড়ত। সেটা `agent_down` স্ট্যাটাস
          //    থেকে আসত, আর ওটাই ভুল ছিল — বাড়ি চলে যাওয়া কর্মীকেও
          //    গুনত, ফলে ট্যাবের নামেই মিথ্যা অভিযোগ বসে থাকত।
          { id: 'resting', label: `Not working · ${resting.length}` },
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
      */}
      <Caveat>
        When one person runs more than one PC at the same time, that stretch is
        counted twice, so hours can read a little high. An overlap longer than
        15 minutes raises its own alert.
      </Caveat>

      {/* ⚠️ ছবি আনতে না পারা পাতা ভেঙে যাওয়া নয় — তাই ছোট করে, আলাদা করে */}
      {shots.error && !shots.data && (
        <p className="mt-2 text-xs text-ink-3">
          Screenshots couldn&rsquo;t be loaded — the image area on each card
          stays empty.
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
