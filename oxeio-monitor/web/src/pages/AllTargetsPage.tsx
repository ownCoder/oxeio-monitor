import { useState, type ReactNode } from 'react';

import {
  deleteTarget,
  listTargetAdders,
  listTargetDesigners,
  listTargets,
  markLive,
  markChecked,
  markFixed,
  markUploaded,
  targetStats,
  type TargetRow,
  type TargetStatus,
  updateTarget,
} from '../api/targets';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card } from '../components/Card';
import { Page } from '../components/Page';
import { ErrorBox, Loading } from '../components/States';
import { Table } from '../components/Table';
import { formatDateTime } from '../lib/format';
import { Chip, MiniButton, ServerError, useMutation } from './settings/ui';

/**
 * **সব ডিজাইন-টার্গেট** *(২৩ আগস্ট, মালিকের চাওয়া)* — সাইডবারে
 * **"Design Pool"** *(মালিকের দেওয়া নাম, ২৩ আগস্ট)*।
 *
 * ⚠️ ফাইলের নাম `AllTargetsPage` রয়ে গেছে ইচ্ছাকৃতভাবে — রুট
 * (`targets/all`), import আর App.tsx সব একসাথে বদলানো মানে অকারণ churn,
 * অথচ ব্যবহারকারী ফাইলের নাম দেখেন না। ⭐ পর্দার নাম আর ফাইলের নাম
 * আলাদা হলে বিভ্রান্তি হতে পারে, তাই কথাটা এখানে লেখা রইল।
 *
 * ⚠️⚠️ **"Pool" শব্দটা এই পাতাতেই আবার আসে** — অবস্থার চিপে (`Pool` =
 * এখনো কারো হাতে যায়নি)। অর্থাৎ পাতার নাম "Design Pool" হলেও পাতাটা
 * **সব অবস্থাই** দেখায়, কেবল pool নয়। subtitle ("Every link, and where
 * it stands") ইচ্ছাকৃতভাবে রাখা হয়েছে ঠিক সেই কারণেই।
 *
 * ⚠️ জমা দেওয়ার পাতাটা আলাদা: দুটো আলাদা কাজ, আর এক পাতায় থাকলে
 * ৫০০ লাইন পেস্ট করতে গিয়ে প্রতিবার ৩৯ হাজারের তালিকাও লোড হতো।
 */
export function AllTargetsPage() {
  return (
    <Page title="Design Pool" subtitle="Every link, and where it stands">
      <TargetList />
    </Page>
  );
}

type Stage = 'to_check' | 'to_fix' | 'to_upload' | 'to_live';
type FilterKey = TargetStatus | 'all' | Stage;

/**
 * ⭐⭐ **প্রথম দুটো গবেষকের রোজকার কিউ** *(২৪ আগস্ট ২০২৬)*।
 *
 * ⚠️⚠️ ক্রমটা ইচ্ছাকৃত — কাজের দুটো সবার আগে, তদারকির ছাঁকনিগুলো পরে।
 * Uploaded ও Live বোতাম দুটো প্রতিটা সারিতে **আগে থেকেই ছিল**, আর অনুমতিও
 * গবেষকের ছিল; যা ছিল না তা হলো *"কোনগুলো"* — ৩৯ হাজার সারির স্তূপ থেকে
 * আজকের কাজটা আলাদা করার উপায়। ⭐ ফলে ২৭,৬৩২টার মধ্যে বোতামটা চাপা
 * পড়েছিল **মাত্র ১ বার**।
 *
 * ⚠️ এগুলো `status` নয়, **ধাপ** — `uploadedAt`/`liveAt` তারিখ, অবস্থা নয়
 * (নইলে সারিটা `done` থেকে সরে গিয়ে সব গণনা নীরবে কমে যেত)।
 */
/** ⭐ চিপটা ধাপ না অবস্থা — এক জায়গায় ঠিক হয়, দুই জায়গায় নয় */
const stageOf = (key: FilterKey): Stage | undefined =>
  key === 'to_check' || key === 'to_fix' || key === 'to_upload' || key === 'to_live'
    ? key
    : undefined;

/**
 * ⭐⭐ **চিপে কেবল কাজের কিউ** *(মালিকের সিদ্ধান্ত, ২৫ আগস্ট:
 * "khubi gatharing lagoche dekhote")*।
 *
 * ⚠️⚠️ আগে এখানে নয়টা চিপ ছিল — চারটে কিউ আর পাঁচটা **অবস্থা**
 * (All · Waiting · In hand · Done · Skipped)। কিন্তু অবস্থাগুলো
 * পরস্পরের **বিকল্প**: একসাথে কখনো দুটো বাছা যায় না। ⭐ যা থেকে
 * একটাই বাছা যায়, সেটা চিপের সারি নয়, ড্রপডাউন
 * (`STATUS_OPTIONS`) — আর তাতে পাঁচটা কন্ট্রোল একটায় নামে।
 *
 * ⚠️ কিউ চারটে চিপই থাকল, কারণ **ওগুলোয় সংখ্যা আছে** — আর সংখ্যাটাই
 * ক্লিক করার আগে বলে দেয় আজ কাজ আছে কি না। ড্রপডাউনে ঢুকিয়ে দিলে
 * সংখ্যাটা দেখতে হলে খুলতে হতো, আর তখন কেউ খুলতই না।
 */
const FILTERS: { key: FilterKey; label: string; stage: Stage }[] = [
  { key: 'to_check', label: 'To check', stage: 'to_check' },
  { key: 'to_fix', label: 'To fix', stage: 'to_fix' },
  { key: 'to_upload', label: 'To upload', stage: 'to_upload' },
  { key: 'to_live', label: 'To make live', stage: 'to_live' },
];

/**
 * ⭐ অবস্থার ড্রপডাউন — চিপ থেকে নামিয়ে আনা পাঁচটা।
 *
 * ⚠️ `done_today` আসল কোনো অবস্থা **নয়** — এটা একটা শর্টকাট যা
 * `filter='done'` + আজকের দুটো তারিখ একসাথে বসায়। আগে এটা একটা আলাদা
 * বোতাম ছিল ("Completed today"), আর সেটা ভুল করে Complete চাপা কাজ
 * খুঁজে বের করার সবচেয়ে ছোট পথ — তাই তুলে দেওয়া হয়নি, সরানো হয়েছে।
 */
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All targets' },
  { value: 'pool', label: 'Waiting' },
  { value: 'assigned', label: 'In hand' },
  { value: 'done', label: 'Done' },
  { value: 'done_today', label: 'Done · today' },
  { value: 'skipped', label: 'Skipped' },
];

/**
 * ⭐⭐ **পুরো তালিকা** *(২৩ আগস্ট, মালিকের চাওয়া)*।
 *
 * ⚠️⚠️ **পাতা ভাগ ছাড়া এটা বানানো যেত না** — টেবিলে ৩৯ হাজারের বেশি
 * সারি। সব একসাথে আনলে উত্তরটা কয়েক MB হতো, আর ব্রাউজার টেবিলটা আঁকতে
 * গিয়ে জমে যেত।
 *
 * ⭐ খোঁজার ঘরে **URL বা ASIN** দুটোই চলে — গবেষক একটা লিঙ্ক পেস্ট করে
 * দেখে নিতে পারেন ওটা আগে হয়ে গেছে কি না, আর কে করেছিল।
 */
/** ঢাকার আজকের তারিখ, `YYYY-MM-DD` */
function dhakaToday(): string {
  // ⚠️ `toISOString()` UTC দেয় — ঢাকায় ভোর ৬টার আগে সেটা গতকাল দেখাত
  return new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
}

function TargetList() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');
  const [staffId, setStaffId] = useState('');
  /** ⭐ কে এনেছেন — `users.id`, `staffId`-র (`employees.id`) থেকে আলাদা */
  const [addedById, setAddedById] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  /** ⭐ বাকি ছাঁকনিগুলো খোলা আছে কি না *(২৫ আগস্ট)* — ডিফল্টে বন্ধ */
  const [showFilters, setShowFilters] = useState(false);
  const edit = useMutation();

  const designers = useApi(listTargetDesigners, []);
  /**
   * ⭐⭐ **কে কতগুলো এনেছেন** *(মালিকের চাওয়া, ২৫ আগস্ট)*।
   *
   * ⚠️ সংখ্যাটা ড্রপডাউনের ভেতরেই লেখা থাকে, তাই মালিক **কিছু না চেপেই**
   * উত্তরটা পান — ছাঁকাটা তার পরের ধাপ, বাধ্যতামূলক নয়।
   */
  const adders = useApi(listTargetAdders, []);
  /** ⭐ চিপের পাশের সংখ্যাটা — ক্লিক করার **আগেই** জানা দরকার কাজ আছে কি না */
  const stats = useApi(targetStats, []);

  /**
   * ⭐ শর্তটার **নাম আছে** — `role !== 'employee'` লেখা হয়নি।
   *
   * ⚠️ এই প্রকল্পে নাম না দেওয়া অধিকার-শর্ত বারবার বাগ তৈরি করেছে
   * (G134: ম্যানেজার নেভে Settings দেখতেন, চাপলে "There's nothing at this
   * address")। নাম থাকলে বদলানোর সময় সব জায়গা একসাথে বদলায়।
   */
  const { user } = useAuth();
  const mayDelete = user?.role === 'owner' || user?.role === 'manager';

  const data = useApi(
    (signal) =>
      listTargets(
        {
          /**
           * ⚠️ কিউ দুটো `status` নয় — তাই আলাদা করে পাঠাতে হয়। `stage`
           *    থাকলে `status` পাঠানো হয় **না**, নইলে দুটো ছাঁকনি একসাথে
           *    বসে কিউটা খালি দেখাত।
           */
          ...(stageOf(filter)
            ? { stage: stageOf(filter) }
            : filter === 'all'
              ? {}
              : { status: filter as TargetStatus }),
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(staffId ? { staffId: Number(staffId) } : {}),
          ...(addedById ? { addedById: Number(addedById) } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          page,
        },
        signal,
      ),
    [filter, q, staffId, addedById, from, to, page],
  );

  /**
   * ⭐⭐ **গোটানো ছাঁকনির গায়ের সংখ্যাটা** *(২৫ আগস্ট)*।
   *
   * ⚠️⚠️ লুকোনো ছাঁকনি নিজেই একটা ফাঁদ: কেউ কাল এসে খালি তালিকা দেখে
   * ভাবত ডেটা হারিয়ে গেছে, অথচ গতকালের তারিখটাই বসে ছিল। এই সংখ্যাটাই
   * সেই ফাঁদটা বন্ধ করে — বোতামে সংখ্যা থাকলে সেটা লালও হয়ে থাকে।
   */
  const activeFilters =
    (staffId ? 1 : 0) + (addedById ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);

  /**
   * ⭐ ড্রপডাউনে কী দেখাবে — কিউ-চিপ বাছা থাকলে `all`।
   *
   * ⚠️ চিপ আর ড্রপডাউন **একই চলক** (`filter`) ধরে চলে, তাই একটা বাছলে
   * অন্যটা নিজে থেকেই ছেড়ে দেয়। দুটো আলাদা চলক রাখলে একদিন দুটোই
   * বসে যেত, আর তালিকা খালি দেখাত।
   *
   * ⚠️⚠️ `done_today` আসল অবস্থা নয় — তাই মিলিয়ে দেখা হয়, মনে রাখা হয়
   * না। মনে রাখলে মালিক হাতে তারিখ বদলানোর পরেও ড্রপডাউন "আজ" বলত।
   */
  const today = dhakaToday();
  const statusValue =
    stageOf(filter) !== undefined
      ? 'all'
      : filter === 'done' && from === today && to === today
        ? 'done_today'
        : filter;

  /** ⚠️ ছাঁকনি বা খোঁজা বদলালে পাতা ১-এ ফেরত — নইলে ৫ নম্বর পাতায় বসে
   *  থেকে "কিছু নেই" দেখা যেত, অথচ ফল আছে */
  const change = (next: () => void) => {
    setPage(1);
    next();
  };

  return (
    <Card
      title="Every Target"
      /*
        ⚠️ "Newest activity first" আগে ছাঁকনির সারিতে একটা আলাদা লেখা
           ছিল — একটা গোটা কন্ট্রোলের জায়গা নিত, অথচ কিছুই করত না।
        ⭐ কথাটা সত্যি আর দরকারি, তাই মোছা হয়নি — সংখ্যাটার পাশে এসেছে।
      */
      hint={
        data.data
          ? `${data.data.total} in total · newest activity first`
          : 'Loading…'
      }
      padded={false}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => change(() => setFilter(f.key))}
            title={
              f.stage === 'to_check'
                ? 'Finished designs whose spelling has not been checked yet'
                : f.stage === 'to_fix'
                  ? 'A spelling error was found — waiting to be fixed'
                  : f.stage === 'to_upload'
                    ? 'Checked or not yet checked, and not sent to Amazon. Designs with an unfixed error are held back.'
                    : f.stage === 'to_live'
                      ? 'Sent to Amazon, not live yet'
                      : undefined
            }
            className={`rounded-full border px-3 py-1 text-[12.5px] transition ${
              filter === f.key
                ? 'border-brand bg-brand-bg font-semibold text-brand-ink'
                : 'border-line text-ink-2 hover:border-brand'
            }`}
          >
            {f.label}
            {/*
              ⭐ সংখ্যাটা চিপেই — ক্লিক করার **আগেই** জানা দরকার আজ কাজ
                 আছে কি না। ⚠️ ০ হলেও দেখানো হয়, কারণ "০" মানে
                 "শেষ করেছি", আর সেটাই একমাত্র পুরস্কার এখানে।
            */}
            {stats.data ? (
              <span className="num ml-1.5 text-ink-3">
                {f.stage === 'to_check'
                  ? stats.data.toCheck
                  : f.stage === 'to_fix'
                    ? stats.data.toFix
                    : f.stage === 'to_upload'
                      ? stats.data.toUpload
                      : stats.data.toLive}
              </span>
            ) : null}
          </button>
        ))}

        {/*
          ⭐⭐ **পাঁচটা অবস্থা-চিপের বদলে একটা ড্রপডাউন** *(২৫ আগস্ট)*।

          ⚠️ `done_today` বেছে নিলে তারিখ দুটোও বসে যায়, তাই মানটা
             ফিরে আসে `done` হিসেবে — নিচের `statusValue` সেটা মিলিয়ে
             দেখে আবার `done_today` দেখায়। ⭐ ছাঁকনি যা করেছে, ড্রপডাউন
             ঠিক তা-ই বলে; দুটো আলাদা হলে কেউ বিশ্বাস করত না।
        */}
        <select
          value={statusValue}
          onChange={(e) =>
            change(() => {
              const v = e.target.value;
              if (v === 'done_today') {
                setFilter('done');
                setFrom(dhakaToday());
                setTo(dhakaToday());
                return;
              }
              setFilter(v as FilterKey);
              // ⚠️ "আজ" থেকে বেরোলে তারিখ দুটোও ছাড়তে হয়, নইলে কেউ
              //    "Done" বেছে খালি তালিকা দেখে ভাবত ডেটা হারিয়ে গেছে
              if (statusValue === 'done_today') {
                setFrom('');
                setTo('');
              }
            })
          }
          className={`rounded-md border px-2 py-1 text-[12.5px] transition ${
            statusValue === 'all'
              ? 'border-line bg-paper text-ink'
              : 'border-brand bg-brand-bg font-semibold text-brand-ink'
          }`}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {/*
          ⭐⭐ **বাকি ছাঁকনিগুলো গোটানো** *(২৫ আগস্ট)*।

          ⚠️⚠️ চারটে ঘরই (ডিজাইনার · কে এনেছেন · দুটো তারিখ) বেশিরভাগ
             সময় **খালি পড়ে থাকে**, অথচ রোজ পর্দার একটা গোটা সারি নেয়।

          ⚠️ কিন্তু লুকোনো ছাঁকনি নিজেই একটা ফাঁদ — কেউ কাল এসে খালি
             তালিকা দেখে ভাবত ডেটা হারিয়ে গেছে। ⭐ তাই বোতামের গায়ে
             **সংখ্যা** বসে, আর সংখ্যা থাকলে বোতামটা লাল হয়ে থাকে।
             লুকোনো, কিন্তু নীরব নয়।
        */}
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={`rounded-md border px-2.5 py-1 text-[12.5px] transition ${
            activeFilters > 0
              ? 'border-brand bg-brand-bg font-semibold text-brand-ink'
              : 'border-line text-ink-2 hover:border-brand'
          }`}
        >
          Filters
          {activeFilters > 0 && <span className="num ml-1.5">{activeFilters}</span>}
          <span className="ml-1 text-ink-3">{showFilters ? '▴' : '▾'}</span>
        </button>

        <input
          value={q}
          onChange={(e) => change(() => setQ(e.target.value))}
          placeholder="Paste a link or ASIN…"
          className="num ml-auto w-full max-w-[260px] rounded-md border border-line bg-paper px-2.5 py-1 text-[12.5px] text-ink"
        />
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <select
            value={staffId}
            onChange={(e) => change(() => setStaffId(e.target.value))}
            className="rounded-md border border-line bg-paper px-2 py-1 text-[12.5px] text-ink"
          >
            <option value="">Any designer</option>
            {(designers.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.empCode} · {d.fullName}
              </option>
            ))}
          </select>

          {/*
            ⚠️⚠️ পাশের ড্রপডাউনের সাথে দেখতে এক, অথচ **ভিন্ন টেবিলের id**
               — ওটা `employees`, এটা `users`। লেখাদুটো তাই আলাদা রাখা,
               নইলে ওরা যমজ দেখাত।
            ⭐ প্রতিটা নামের পাশে সংখ্যা — মালিক ছাঁকার **আগেই** দেখেন কে
               কতটা এনেছেন।
          */}
          <select
            value={addedById}
            onChange={(e) => change(() => setAddedById(e.target.value))}
            className="rounded-md border border-line bg-paper px-2 py-1 text-[12.5px] text-ink"
          >
            <option value="">Added by anyone</option>
            {(adders.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName} · {a.count.toLocaleString()}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => change(() => setFrom(e.target.value))}
              className="num rounded-md border border-line bg-paper px-2 py-1 text-[12.5px] text-ink"
            />
          </label>

          <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
            to
            <input
              type="date"
              value={to}
              onChange={(e) => change(() => setTo(e.target.value))}
              className="num rounded-md border border-line bg-paper px-2 py-1 text-[12.5px] text-ink"
            />
          </label>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() =>
                change(() => {
                  setStaffId('');
                  setAddedById('');
                  setFrom('');
                  setTo('');
                })
              }
              className="text-[12px] text-data hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="px-4">
        <ServerError error={edit.error} />
      </div>

      {data.loading && !data.data && <Loading />}
      {data.error && <ErrorBox error={data.error} retry={data.reload} />}

      {data.data && data.data.rows.length === 0 && (
        <div className="px-4 py-6 text-[13px] text-ink-3">
          Nothing matches that.
        </div>
      )}

      {data.data && data.data.rows.length > 0 && (
        <>
          <Table
            rows={data.data.rows}
            rowKey={(r) => String(r.id)}
            columns={[
              /*
                ⭐⭐ **সাতটা কলাম থেকে চারটে** *(মালিকের সিদ্ধান্ত, ২৫
                   আগস্ট: "khubi gatharing lagoche dekhote")*।

                ⚠️⚠️ কোনো তথ্য মোছা হয়নি — **জোড়া লাগানো হয়েছে**, আর
                   জোড়াগুলো ইচ্ছেমতো নয়:
                     · Job no. → ASIN-এর নিচে  (দুটোই *পরিচয়*)
                     · তারিখ  → Stage-এর নিচে  (একই কথা: কোন ধাপে, কবে)
                     · কে এনেছেন → কে করছেন    (একটা *বাক্য*, দুটো ঘর নয়)
              */
              {
                key: 'design',
                header: 'Design',
                render: (r) => (
                  <span className="block">
                    <a
                      href={r.url}
                      target="_blank"
                      // ⚠️ tabnabbing ঠেকাতে — নতুন ট্যাব যেন এই পাতা সরাতে না পারে
                      rel="noreferrer noopener"
                      className="num text-data hover:underline"
                    >
                      {r.asin}
                    </a>
                    {/*
                      ⚠️ কাজের নম্বর **না থাকলে লাইনটাই বসে না** — একটা
                         "—" দেখানোর চেয়ে ফাঁকা জায়গাই শান্ত, আর পুলে
                         পড়ে থাকা সারির নম্বর থাকেই না।
                    */}
                    {r.jobNumber !== null && (
                      <span className="num block text-[11.5px] text-ink-3">
                        Job {r.jobNumber}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: 'stage',
                header: 'Stage',
                render: (r) => (
                  <span className="block">
                    <StatusChip row={r} />
                    <WhenCell row={r} />
                  </span>
                ),
              },
              {
                key: 'people',
                header: 'People',
                /*
                  ⭐⭐ **"কে এনেছেন → কে করছেন"** — একটা সারির গোটা গল্প।

                  ⚠️⚠️ দুটো আলাদা id-র জগৎ এক ঘরে বসছে (`users` →
                     `employees`), আর তীরচিহ্নটা সেটাই বোঝায়: বাঁয়ে যিনি
                     কাজটা **এনেছেন**, ডানে যিনি **করছেন**।

                  ⚠️ আনার নামটা **ধূসর**, করার নামটা গাঢ় — রোজকার কাজে
                     ডিজাইনারের নামটাই বেশি দরকার হয়, তাই ওজনটা সেদিকে।
                */
                className: 'hidden sm:table-cell',
                render: (r) => <PeopleCell row={r} />,
              },
              {
                key: 'edit',
                header: '',
                render: (r) => (
                  <RowActions
                    row={r}
                    busy={edit.busy}
                    onChange={(status) =>
                      edit.run(async () => {
                        await updateTarget(r.id, status);
                        data.reload();
                      })
                    }
                    onChecked={(ok) =>
                      edit.run(async () => {
                        await markChecked(r.id, ok);
                        data.reload();
                        stats.reload();
                      })
                    }
                    onFixed={() =>
                      edit.run(async () => {
                        await markFixed(r.id);
                        data.reload();
                        stats.reload();
                      })
                    }
                    onUploaded={() =>
                      edit.run(async () => {
                        await markUploaded(r.id);
                        data.reload();
                      })
                    }
                    onLive={() =>
                      edit.run(async () => {
                        await markLive(r.id);
                        data.reload();
                      })
                    }
                    mayDelete={mayDelete}
                    mayProofread={user?.canProofread === true}
                    onDelete={() =>
                      edit.run(async () => {
                        await deleteTarget(r.id);
                        data.reload();
                      })
                    }
                  />
                ),
              },
            ]}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-ink-3">
            <span className="num">
              Page {data.data.page} of {data.data.pages}
            </span>
            <span className="flex gap-2">
              <MiniButton
                disabled={data.data.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </MiniButton>
              <MiniButton
                disabled={data.data.page >= data.data.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </MiniButton>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * ⚠️ "শেষ" হলে **কীভাবে** শেষ হলো সেটাও বলা হয় — সিস্টেম ফাইলের নাম
 * থেকে ধরেছে, নাকি কেউ হাতে বলেছে, নাকি পুরোনো তালিকা থেকে এসেছে।
 * সংখ্যাটা এক, কিন্তু ভরসা এক নয়।
 */
function StatusChip({ row }: { row: TargetRow }) {
  if (row.status === 'done') {
    /*
      ⚠️ পুরোনো Excel থেকে আসা সারিগুলো আলাদা করে বলা হয় — ওগুলোর
         সংখ্যাটা সত্যি, কিন্তু oXeio সেটা **মাপেনি**, শুধু ইতিহাস
         হিসেবে নিয়েছে। ভরসার মাত্রা এক নয়।
      ⚠️ `filename` আর আসে না (২৩ আগস্ট থেকে ওটা "শুরু"); পুরোনো সারিতে
         থাকতে পারে বলে ঘরটা রাখা।
    */
    return (
      <Chip tone="counted">
        {row.completedVia === 'import' ? 'Done (old list)' : 'Done'}
      </Chip>
    );
  }
  // ⭐ "কাজ চলছে" আলাদা করে দেখানো — মালিক দেখেন কোনগুলোয় সত্যিই হাত
  //    পড়েছে, আর কোনগুলো পড়ে আছে
  if (row.status === 'assigned') {
    return row.startedAt ? (
      <Chip tone="pending">Started</Chip>
    ) : (
      <Chip tone="muted">In hand</Chip>
    );
  }
  if (row.status === 'skipped') return <Chip tone="attention">Skipped</Chip>;

  return <Chip>Waiting</Chip>;
}

/**
 * ⭐ কোন তারিখ, আর **কীসের** তারিখ।
 *
 * ⚠️ শুধু একটা তারিখ বসালে পুলে পড়ে থাকা সারিতেও কিছু একটা দেখাত, আর
 * পাঠক ধরে নিতেন ওটা "কবে হয়েছে"।
 */
/**
 * ⭐ Stage-এর নিচের ছোট তারিখটা *(২৫ আগস্ট থেকে আলাদা কলাম নয়)*।
 *
 * ⚠️⚠️ **কোন তারিখটা দেখানো হচ্ছে সেটাও বলা হয়** — শেষ হওয়ার, শুরুর,
 * নাকি বরাদ্দের। শুধু একটা তারিখ বসালে পাঠক ধরে নিতেন ওটা "কবে
 * হয়েছে"। উপরের চিপটা অবস্থা বলে, কিন্তু `In hand` সারিতে তারিখটা
 * শুরুরও হতে পারে, বরাদ্দেরও — চিপ ওই দুটো আলাদা করে না।
 *
 * ⭐ পুলে পড়ে থাকা সারির কোনো কাজের তারিখ নেই, তাই আগে এখানে `—` বসত।
 * এখন **কবে এসেছে** সেটা বসে — ওটাই ওই সারির একমাত্র খবর, আর ঘরটা
 * খালি রাখার চেয়ে সত্যি কথা বলা ভালো।
 */
function WhenCell({ row }: { row: TargetRow }) {
  const when =
    row.completedAt ?? row.startedAt ?? row.assignedAt ?? row.addedAt;

  const what = row.completedAt
    ? 'done'
    : row.startedAt
      ? 'started'
      : row.assignedAt
        ? 'given'
        : 'added';

  return (
    <span className="num mt-0.5 block whitespace-nowrap text-[11.5px] text-ink-3">
      {formatDateTime(when)} · {what}
    </span>
  );
}

/**
 * ⭐⭐ **কে এনেছেন → কে করছেন** *(২৫ আগস্ট)*।
 *
 * ⚠️ আগে এটা দুটো আলাদা কলাম ছিল ("Added by" আর "Designer"), আর দুটোই
 * মানুষের নাম — পাশাপাশি বসে সেটা গাদাগাদি লাগত। ⭐ এক ঘরে তীরচিহ্ন
 * দিয়ে লিখলে ওটা একটা **বাক্য** হয়ে যায়: কাজটা কোথা থেকে এসে কার
 * কাছে গেছে।
 */
function PeopleCell({ row }: { row: TargetRow }) {
  return (
    <span className="block">
      <span className="whitespace-nowrap">
        {/* ⚠️ আনার নামটা ধূসর — রোজকার কাজে ডিজাইনারের নামটাই বেশি দরকার */}
        <span className="text-ink-3">{row.addedBy.fullName}</span>
        <span className="px-1 text-ink-3">→</span>
        {row.assignedTo ? (
          <span className="text-ink">{row.assignedTo.fullName}</span>
        ) : row.sourceNote ? (
          /*
            ⚠️ ইমপোর্ট করা পুরোনো সারিতে `assignedTo` **নেই** — নামটা
               কাঁচা লেখায় (`Hafiz-24-05-2026`), কারণ ওই কর্মীদের অনেকেই
               আর সিস্টেমে নেই।
          */
          <span className="num text-[12px] text-ink-3">{row.sourceNote}</span>
        ) : (
          <span className="text-ink-3">nobody yet</span>
        )}
      </span>

      {/*
        ⭐⭐ **কে "শেষ" বলেছেন** *(২৩ আগস্ট, মালিকের রিপোর্ট)*। আগে কেবল
        বরাদ্দ পাওয়া মানুষের নাম দেখাত, তাই মালিক নিজে Complete চাপলেও
        ডিজাইনারের নামই উঠত — সরাসরি ভুল তথ্য।

        ⚠️ নামটা তখনই আসে যখন কেউ সত্যিই চেপেছেন। পুরোনো সারিগুলোয় ঘরটা
        খালি থাকে — অনুমান করে কিছু বসানো হয় না।
      */}
      {row.completedBy && (
        <span className="block text-[11.5px] text-ink-3">
          ✓ marked by {row.completedBy.fullName}
        </span>
      )}
    </span>
  );
}

/**
 * ⭐⭐ **সম্পাদনা** *(২৩ আগস্ট)* — owner · manager · গবেষক।
 *
 * ⚠️⚠️ **ASIN বদলানোর পথ নেই** — ওটা সারিটার পরিচয়। বদলালে
 * ডুপ্লিকেট-প্রহরীর গোটা ভিত্তিটাই নড়ে যেত, আর ইতিহাসে "এই পণ্যটা
 * হয়েছিল" কথাটা মিথ্যা হয়ে যেত।
 *
 * ⚠️ **Delete-এর একটা নীরব দাম আছে**, তাই আলাদা করে জিজ্ঞেস করা হয়:
 * শেষ হওয়া একটা সারি মুছলে প্রহরী ওই ASIN **ভুলে যায়**, আর কাল কেউ
 * আবার জমা দিলে সেটা নতুন কাজ হিসেবে ঢুকবে।
 */
function RowActions({
  row,
  busy,
  onChange,
  onUploaded,
  onChecked,
  onFixed,
  onLive,
  onDelete,
  mayDelete,
  mayProofread,
}: {
  row: TargetRow;
  busy: boolean;
  onChange: (status: TargetStatus) => void;
  onUploaded: () => void;
  /** ⭐ `true` = বানান ঠিক · `false` = ভুল পাওয়া গেছে */
  onChecked: (ok: boolean) => void;
  onFixed: () => void;
  onLive: () => void;
  onDelete: () => void;
  /** ⚠️ `false` হলে Delete বোতামটাই বসে না — গবেষকের হাতে ওটা থাকবে না */
  mayDelete: boolean;
  /**
   * ⭐ `false` হলে বানান-যাচাইয়ের তিনটে বোতাম বসে না *(২৫ আগস্ট)*।
   *
   * ⚠️ সারির অবস্থার সাথে **এবং** করে দেখা হয়, বদলে নয় — অধিকার
   * থাকলেও ক্রম মানতে হয়: দেখা হয়ে গেলে "Spelling OK" আর ওঠে না।
   */
  mayProofread: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  /**
   * ⭐⭐ **বাকি বোতামগুলো খোলা আছে কি না** *(মালিকের সিদ্ধান্ত, ২৫ আগস্ট:
   * "khubi gatharing lagoche dekhote")*।
   *
   * ⚠️⚠️ একটা সারি **একটাই** ধাপে থাকে, তবু আগে পাইপলাইনের সব বোতাম
   * একসাথে বসত — একটা শেষ-হওয়া সারিতে ছটা পর্যন্ত। ⭐ এখন এই সারির
   * *পরের ধাপটা* সামনে, বাকিগুলো `⋯`-এ।
   *
   * ⚠️ **কোনো বোতাম মুছে যায়নি** — সবই এক ক্লিক দূরে। পপ-আপ মেনু না
   * করে সারির ভেতরেই খোলা হয়: মেনু বসাতে হলে জায়গা মাপা, বাইরে ক্লিক
   * ধরা, কি-বোর্ড সামলানো — তিনটে নতুন ফাঁদ, একটাও দরকার নেই।
   */
  const [open, setOpen] = useState(false);

  if (confirming) {
    return (
      <span className="flex justify-end gap-1.5 whitespace-nowrap">
        <MiniButton tone="danger" disabled={busy} onClick={onDelete}>
          Really delete
        </MiniButton>
        <MiniButton disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </MiniButton>
      </span>
    );
  }

  /**
   * ⭐⭐ **এই সারির পরের ধাপ** — শেকলের ক্রম মেনে, উপর থেকে নিচে।
   *
   * ⚠️⚠️ ক্রমটাই এখানকার আসল সিদ্ধান্ত: একটা শেষ-হওয়া সারিতে "বানান
   * দেখা" আর "আপলোড" **দুটোই** সম্ভব, কিন্তু আগে বানান। উল্টো করলে
   * না-দেখা ডিজাইন Amazon-এ চলে যেত, আর কিউটা কখনো খালি হতো না।
   *
   * ⚠️ যাচাইয়ের ধাপে **দুটো** বোতাম, কারণ ওটা একটা কাজ নয় — একটা
   * সিদ্ধান্ত (ঠিক আছে, নাকি ভুল আছে)। একটায় নামানো যেত না।
   */
  const broken = row.errorFoundAt !== null && row.fixedAt === null;

  const next: ReactNode =
    mayProofread && broken ? (
      <MiniButton tone="good" disabled={busy} onClick={onFixed}>
        Fixed
      </MiniButton>
    ) : mayProofread && row.completedAt !== null && row.checkedAt === null ? (
      <>
        <MiniButton tone="good" disabled={busy} onClick={() => onChecked(true)}>
          Spelling OK
        </MiniButton>
        <MiniButton tone="danger" disabled={busy} onClick={() => onChecked(false)}>
          Has error
        </MiniButton>
      </>
    ) : row.completedAt !== null && row.uploadedAt === null && !broken ? (
      <MiniButton disabled={busy} onClick={onUploaded}>
        Uploaded
      </MiniButton>
    ) : row.uploadedAt !== null && row.liveAt === null ? (
      <MiniButton tone="good" disabled={busy} onClick={onLive}>
        Live
      </MiniButton>
    ) : row.status !== 'done' ? (
      /*
        ⚠️ নামটা **"Complete"**, "Done" নয় — ডিজাইনারের পাতায় ঠিক এই
           বোতামটাই ওই নামে আছে, আর দুটো আলাদা শব্দ মানে মালিক ভাবতেন
           দুটো আলাদা কাজ (মালিকের প্রশ্ন, ২৩ আগস্ট)।
        ⭐ নিয়মটা: **বোতামে ক্রিয়া** (Complete · Skip), **চিহ্নে অবস্থা**
           (Done · Skipped)।
      */
      <MiniButton tone="good" disabled={busy} onClick={() => onChange('done')}>
        Complete
      </MiniButton>
    ) : null;

  if (!open) {
    return (
      <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
        {next}
        <MiniButton disabled={busy} onClick={() => setOpen(true)}>
          {'⋯'}
        </MiniButton>
      </span>
    );
  }

  /**
   * খোলা অবস্থা — সব কিছু, ক্রম মেনে।
   *
   * ⚠️⚠️ বোতামগুলো **ক্রম মেনেই দেখা যায়**: শেষ না হলে "Uploaded" নেই,
   * আপলোড না হলে "Live" নেই। সবগুলো একসাথে দেখালে যে-কেউ যেকোনো ক্রমে
   * চাপতে পারতেন, আর তখন পাইপলাইনের সংখ্যাগুলোই অর্থ হারাত। সার্ভারও
   * একই পাহারা দেয় — পর্দা একমাত্র রক্ষী নয়।
   */
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {/* ⭐ কারো হাত থেকে তুলে নেওয়া — মালিকানাও ছেড়ে যায় */}
      {row.status !== 'pool' && (
        <MiniButton disabled={busy} onClick={() => onChange('pool')}>
          To pool
        </MiniButton>
      )}
      {row.status !== 'done' && (
        <MiniButton tone="good" disabled={busy} onClick={() => onChange('done')}>
          Complete
        </MiniButton>
      )}
      {mayProofread && row.completedAt !== null && row.checkedAt === null && (
        <>
          <MiniButton tone="good" disabled={busy} onClick={() => onChecked(true)}>
            Spelling OK
          </MiniButton>
          <MiniButton tone="danger" disabled={busy} onClick={() => onChecked(false)}>
            Has error
          </MiniButton>
        </>
      )}
      {mayProofread && broken && (
        <MiniButton tone="good" disabled={busy} onClick={onFixed}>
          Fixed
        </MiniButton>
      )}
      {/*
        ⚠️⚠️ **ভুল পাওয়া অথচ ঠিক-না-হওয়া ডিজাইনে "Uploaded" বোতামই ওঠে না**
        *(মালিকের সিদ্ধান্ত, ২৫ আগস্ট)* — জানা-ভাঙা জিনিস Amazon-এ যাবে না।
        ⭐ কিন্তু **এখনো দেখা হয়নি** এমন সারি আটকায় না; আটকালে কিউটা
        রাতারাতি ০ হয়ে যেত আর কেউ শুরুই করত না।
      */}
      {row.completedAt !== null && row.uploadedAt === null && !broken && (
        <MiniButton disabled={busy} onClick={onUploaded}>
          Uploaded
        </MiniButton>
      )}
      {row.uploadedAt !== null && row.liveAt === null && (
        <MiniButton tone="good" disabled={busy} onClick={onLive}>
          Live
        </MiniButton>
      )}
      {row.status !== 'skipped' && (
        <MiniButton tone="danger" disabled={busy} onClick={() => onChange('skipped')}>
          Skip
        </MiniButton>
      )}
      {/*
        ⚠️ গবেষকের হাতে Delete থাকবে না — ৪৬ হাজার সারির মধ্যে একটা
           ভুল ডিলিট কেউ খুঁজেই পেত না।
      */}
      {mayDelete && (
        <MiniButton tone="danger" disabled={busy} onClick={() => setConfirming(true)}>
          Delete
        </MiniButton>
      )}
      <MiniButton disabled={busy} onClick={() => setOpen(false)}>
        {'×'}
      </MiniButton>
    </span>
  );
}

