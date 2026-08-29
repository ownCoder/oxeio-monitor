import { useState } from 'react';

import {
  completeTarget,
  myTargets,
  skipTarget,
  undoTarget,
  type MyTarget,
} from '../api/targets';
import { useApi } from '../api/useApi';
import { Card } from '../components/Card';
import { ErrorBox, Loading } from '../components/States';
import { formatAgo } from '../lib/format';
import { blockedNotice, openInTabs } from '../lib/popups';
import { Chip, MiniButton, Notice, ServerError, useMutation } from './settings/ui';

/**
 * **ডিজাইনারের নিজের টার্গেট** *(২২ আগস্ট ২০২৬)* — `/me` পাতায়।
 *
 * ⚠️⚠️ **"Complete" বোতামটা কেন দরকার হলো** *(২৩ আগস্ট, মালিকের প্রশ্নে)*।
 * প্রথমে ভাবা হয়েছিল সিস্টেম নিজেই শেষ হওয়া ধরে ফেলবে — কিন্তু এজেন্ট
 * শিরোনামে নম্বরটা দেখে ফাইল **খোলার** মুহূর্তে, শেষ করার নয়। ফলে
 * টার্গেট খোলামাত্র বন্ধ হয়ে যেত।
 *
 * ⭐ এখন ভাগ করা: **সিস্টেম বলে "শুরু হয়েছে"**, আর **শেষ হওয়া বলেন
 * ডিজাইনার নিজে**। প্রত্যেকে যা সত্যিই জানে, সেটুকুই বলে।
 *
 * ⚠️ oXeio-র নিয়মটা তাতেও ভাঙে না ([ADR-032](../../../../docs/05-Options-Decisions.md)):
 * বোতামটা **কোনো মাপা সংখ্যা বদলায় না** — ঘণ্টা নয়, ডিজাইনের গোনাও নয়
 * (ওটা ফাইলের নাম থেকেই আসে)। এটা কেবল একটা কাজের ঘোষণা।
 *
 * ⚠️ কারো টার্গেট না থাকলে কার্ডটাই বসে না — গবেষক বা ম্যানেজারের পাতায়
 * একটা খালি "কোনো টার্গেট নেই" বাক্স বসিয়ে লাভ নেই।
 */
export function MyTargets() {
  const { data, loading, error, reload } = useApi(myTargets, []);
  const skip = useMutation();

  /**
   * ⚠️ পপ-আপ আটকানোর বার্তা `skip.error`-এর সাথে মেশানো হয়নি — ওটা
   *    সার্ভারের না-বলা, আর এটা ব্রাউজারের। দুটো এক ঘরে বসালে একটা
   *    আরেকটাকে মুছে দিত, অথচ কারণ দুটো আলাদা।
   */
  const [tabsNotice, setTabsNotice] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} retry={reload} />;
  if (!data || data.length === 0) return null;

  /**
   * ⭐⭐ **দুই ভাগ** *(মালিকের রিপোর্ট, ২৫ আগস্ট)*।
   *
   * ⚠️⚠️ আগে Complete চাপার সাথে সাথে সারিটা **পর্দা থেকেই উধাও** হতো,
   * কারণ সার্ভার কেবল `assigned` পাঠাত। ⭐ ভুলে চেপে ফেললে ফেরানোর
   * বোতাম দূরে থাক, জিনিসটাই আর দেখা যেত না।
   *
   * ⚠️ সার্ভার **আজকের** শেষ করাগুলোই পাঠায়, তাই এখানে দিন গোনার
   * দরকার নেই — `completedAt` থাকা মানেই "আজ, আর এখনো ফেরানো যায়"।
   */
  const inHand = data.filter((t) => t.completedAt === null);
  const finished = data.filter((t) => t.completedAt !== null);

  /**
   * ⭐⭐ **এক চাপে হাতের সব কটা Amazon পাতা** *(মালিকের চাওয়া, ২৯ আগস্ট
   * ২০২৬: "30 design gula ek sathe open korar ekta button")*।
   *
   * ⚠️ **হাতেরগুলোই খোলে, আজ শেষ করাগুলো নয়** — নিচের "Finished today"
   * ভাগটা একটা রসিদ, করণীয় নয়। ওগুলোও খুললে রোজ ৩০টার বদলে ৬০টা ট্যাব
   * খুলত, আর অর্ধেকের কোনো কাজই বাকি নেই।
   *
   * ⚠️⚠️ ব্রাউজার বেশিরভাগটাই আটকাবে **প্রথমবার** — সেটা ভাঙা নয়, নিয়ম
   * ([popups.ts](../lib/popups.ts))। তাই কী ঘটল সেটা গুনে বার্তায় বসে,
   * আর অনুমতি একবার দিলে পরের দিন থেকে ৩০টাই খোলে।
   */
  function openAll() {
    const { blocked } = openInTabs(
      inHand.map((t) => t.url),
      (url) => window.open(url, '_blank'),
    );
    setTabsNotice(blockedNotice(inHand.length, blocked));
  }

  return (
    <Card
      title="Your Design Targets"
      hint={`${inHand.length} in hand — oldest first`}
      /*
        ⭐ বোতামটা কার্ডের মাথায়, প্রতিটা সারিতে নয় — কাজটা গোটা তালিকার,
           একটা টার্গেটের নয়। ⚠️ সংখ্যাটা লেখাতেই বসে ("Open all 30"),
           কারণ ৩০টা ট্যাব খোলা ফেরানো কঠিন; চাপার আগেই জানা দরকার কত
           আসছে।
      */
      actions={
        inHand.length > 0 ? (
          <MiniButton
            title="Opens every target in hand in its own tab"
            onClick={openAll}
          >
            Open all {inHand.length} ↗
          </MiniButton>
        ) : null
      }
    >
      <div className="space-y-3 p-4">
        {/*
          ⭐⭐ এই এক লাইনটাই গোটা কার্ডের কারণ। ডিজাইনারের একমাত্র কাজ
             নম্বরটা ফাইলের নামে বসানো — সেটা না জানলে কোনো টার্গেটই
             কোনোদিন বন্ধ হতো না, আর সবাই ভাবত সিস্টেম ভাঙা।
        */}
        <Notice>
          Start the file name with the number —{' '}
          <span className="num">1000042-Funny Cat T-Shirt.ai</span>, then press{' '}
          <b>Complete</b> when the design is finished.
        </Notice>

        {/*
          ⚠️ বার্তাটা এখানেই দেখাতে হয় — Undo আটকে গেলে (কেউ বানান দেখে
             ফেলেছেন, বা কাজটা গতকালের) সার্ভার **কেন** আটকাল সেটা বলে,
             আর সেটা না দেখালে ডিজাইনার ভাবতেন বোতামটা ভাঙা।
        */}
        <ServerError error={skip.error} />

        {/*
          ⚠️ ব্রাউজার ট্যাব আটকালে **এখানেই** বলা হয় — ঠিকানা-বারের ছোট
             আইকনটা মানুষ খেয়ালই করে না, আর তখন বোতামটাকে ভাঙা মনে হয়।
        */}
        {tabsNotice && <Notice tone="attention">{tabsNotice}</Notice>}

        {inHand.map((t) => (
          <TargetRow
            key={t.id}
            target={t}
            busy={skip.busy}
            onDone={() =>
              skip.run(async () => {
                await completeTarget(t.id);
                reload();
              })
            }
            onSkip={() => skip.run(async () => { await skipTarget(t.id); reload(); })}
          />
        ))}

        {/*
          ⭐⭐ **আজ যা শেষ করেছেন** — ভুল শোধরানোর একমাত্র জানালা।

          ⚠️ ভাগটা **ইচ্ছাকৃতভাবে শান্ত**: হালকা লেখা, কম রঙ। এটা কাজের
             তালিকা নয়, একটা রসিদ — চোখ এখানে আটকানোর কথা নয়।

          ⚠️⚠️ Undo বোতামটা **সব সারিতেই** বসে, কারণ সার্ভার এখানে যা
             পাঠায় তার সবই ফেরানোযোগ্য। কেউ মাঝপথে বানান দেখে ফেললে
             পরের রিফ্রেশে সারিটা এমনিতেই চলে যাবে, আর ততক্ষণে চাপলে
             সার্ভার কারণ লিখে আটকাবে।
        */}
        {finished.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
              Finished today · {finished.length}
            </div>
            {finished.map((t) => (
              <FinishedRow
                key={t.id}
                target={t}
                busy={skip.busy}
                onUndo={() =>
                  skip.run(async () => {
                    await undoTarget(t.id);
                    reload();
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function TargetRow({
  target,
  busy,
  onDone,
  onSkip,
}: {
  target: MyTarget;
  busy: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-paper px-3 py-2.5">
      {/*
        ⭐ নম্বরটাই সবচেয়ে বড় লেখা, ASIN নয় — ASIN ডিজাইনারের কোনো কাজে
           লাগে না, লিঙ্কটা লাগে; আর নম্বরটা ছাড়া কাজ শেষই হয় না।
      */}
      <span className="num min-w-[104px] text-[19px] font-semibold tracking-tight text-ink">
        {target.jobNumber ?? '—'}
      </span>

      <span className="min-w-0 flex-1">
        <span className="num block text-[13px] text-ink">{target.asin}</span>
        {/*
          ⭐ "কাজ চলছে" — সিস্টেম ফাইলটা খুলতে দেখেছে। ⚠️ এটা উৎসাহ নয়,
             তথ্য: ডিজাইনার দেখেন কোনটায় তিনি হাত দিয়ে ফেলেছেন।
        */}
        <span className="block text-[11.5px] text-ink-3">
          {target.startedAt
            ? `Started ${formatAgo(target.startedAt)}`
            : target.assignedAt
              ? formatAgo(target.assignedAt)
              : 'just now'}
        </span>
      </span>

      <a
        href={target.url}
        target="_blank"
        // ⚠️ `noopener` — নতুন ট্যাব `window.opener` দিয়ে এই পাতাটা
        //    সরিয়ে দিতে পারত (tabnabbing)
        rel="noreferrer noopener"
        className="text-[12.5px] whitespace-nowrap text-data hover:underline"
      >
        Open on Amazon ↗
      </a>

      {/*
        ⭐ Copy — ২৫ বার হাতে টাইপ করলে একদিন একটা অঙ্ক ভুল হবেই, আর
           তখন টার্গেটটা চিরকাল খোলা থেকে যেত আর কেউ কারণ বুঝত না।
        ⚠️ `navigator.clipboard` না থাকলে (পুরোনো ব্রাউজার, http) বোতামটা
           চুপচাপ কিছুই করে না — তাই আগে দেখে নেওয়া হয়।
      */}
      {target.jobNumber !== null && typeof navigator.clipboard !== 'undefined' && (
        <MiniButton
          onClick={() => void navigator.clipboard.writeText(String(target.jobNumber))}
        >
          Copy
        </MiniButton>
      )}

      {/*
        ⭐⭐ **Complete** — শেষ হওয়া বলার একমাত্র পথ। ⚠️ `tone` নেই বলে
           এটা Skip-এর মতোই দেখতে; আলাদা করে বড় করা হয়নি, কারণ দিনে
           ২৫ বার চাপতে হবে — চোখে লাগলে ক্লান্তিকর হতো।
      */}
      <MiniButton tone="good" disabled={busy} onClick={onDone}>
        Complete
      </MiniButton>

      <MiniButton tone="danger" disabled={busy} onClick={onSkip}>
        Skip
      </MiniButton>
    </div>
  );
}

/**
 * ⭐⭐ **আজ শেষ করা একটা সারি** *(২৫ আগস্ট)* — আর তার পাশে Undo।
 *
 * ⚠️ উপরের `TargetRow`-এর সাথে জুড়ে দেওয়া যেত (একটা `done` prop দিয়ে),
 * কিন্তু তখন একটাই কম্পোনেন্টে দুটো আলাদা কাজের বোতাম-সেট থাকত, আর
 * প্রতিটা শর্ত দুবার করে লিখতে হতো। ⭐ আলাদা রাখলে দুটোই ছোট থাকে।
 */
function FinishedRow({
  target,
  busy,
  onUndo,
}: {
  target: MyTarget;
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-line px-3 py-2">
      <span className="num min-w-[104px] text-[15px] font-semibold text-ink-2">
        {target.jobNumber ?? '—'}
      </span>

      <span className="min-w-0 flex-1">
        <span className="num block text-[12.5px] text-ink-2">{target.asin}</span>
        <span className="block text-[11.5px] text-ink-3">
          {target.completedAt ? `Done ${formatAgo(target.completedAt)}` : 'Done'}
        </span>
      </span>

      {/*
        ⚠️ নামটা **"Undo"**, "Not done" নয় — ডিজাইনার যা চাপতে চান সেটা
           একটা ভুল **ফেরানো**, কোনো নতুন ঘোষণা নয়। শব্দটা কাজটাই বলে।
      */}
      <MiniButton disabled={busy} onClick={onUndo}>
        Undo
      </MiniButton>
    </div>
  );
}

/** ⭐ আজকের অগ্রগতি — কার্ডের শিরোনামের পাশে বসানোর জন্য */
export function TargetProgress({
  done,
  target,
}: {
  done: number;
  target: number;
}) {
  return (
    <Chip tone={done >= target ? 'counted' : 'muted'}>
      {done}/{target} today
    </Chip>
  );
}
