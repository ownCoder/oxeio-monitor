import {
  completeTarget,
  myTargets,
  skipTarget,
  type MyTarget,
} from '../api/targets';
import { useApi } from '../api/useApi';
import { Card } from '../components/Card';
import { ErrorBox, Loading } from '../components/States';
import { formatAgo } from '../lib/format';
import { Chip, MiniButton, Notice, useMutation } from './settings/ui';

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

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} retry={reload} />;
  if (!data || data.length === 0) return null;

  return (
    <Card
      title="Your design targets"
      hint={`${data.length} in hand — oldest first`}
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

        {data.map((t) => (
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
