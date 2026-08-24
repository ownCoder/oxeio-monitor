import { useState } from 'react';

import {
  deleteTarget,
  listTargetDesigners,
  listTargets,
  markLive,
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

type Stage = 'to_upload' | 'to_live';
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
  key === 'to_upload' || key === 'to_live' ? key : undefined;

const FILTERS: { key: FilterKey; label: string; stage?: Stage }[] = [
  { key: 'to_upload', label: 'To upload', stage: 'to_upload' },
  { key: 'to_live', label: 'To make live', stage: 'to_live' },
  { key: 'all', label: 'All' },
  { key: 'pool', label: 'Waiting' },
  { key: 'assigned', label: 'In hand' },
  { key: 'done', label: 'Done' },
  { key: 'skipped', label: 'Skipped' },
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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const edit = useMutation();

  const designers = useApi(listTargetDesigners, []);
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
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          page,
        },
        signal,
      ),
    [filter, q, staffId, from, to, page],
  );

  /** ⚠️ ছাঁকনি বা খোঁজা বদলালে পাতা ১-এ ফেরত — নইলে ৫ নম্বর পাতায় বসে
   *  থেকে "কিছু নেই" দেখা যেত, অথচ ফল আছে */
  const change = (next: () => void) => {
    setPage(1);
    next();
  };

  return (
    <Card
      title="Every Target"
      hint={data.data ? `${data.data.total} in total` : 'Loading…'}
      padded={false}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => change(() => setFilter(f.key))}
            title={
              f.stage === 'to_upload'
                ? 'Designs finished since 23 August that have not been sent to Amazon yet'
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
            {f.stage && stats.data ? (
              <span className="num ml-1.5 text-ink-3">
                {f.stage === 'to_upload' ? stats.data.toUpload : stats.data.toLive}
              </span>
            ) : null}
          </button>
        ))}

        {/*
          ⭐⭐ **"আজ শেষ হয়েছে"** *(২৩ আগস্ট, মালিকের চাওয়া)* — ভুল করে
          Complete চাপা কাজ খুঁজে বের করার সবচেয়ে ছোট পথ।

          ⚠️ হাতে তিনটে ঘর সাজানোর বদলে এক ক্লিক, কারণ এটাই সবচেয়ে
          বেশি দরকার হবে — আর দরকারের মুহূর্তে মানুষ ফর্ম ভরতে চায় না।
        */}
        <button
          type="button"
          onClick={() =>
            change(() => {
              setFilter('done');
              setStaffId('');
              setFrom(dhakaToday());
              setTo(dhakaToday());
            })
          }
          className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 transition hover:border-brand"
        >
          Completed today
        </button>

        <input
          value={q}
          onChange={(e) => change(() => setQ(e.target.value))}
          placeholder="Paste a link or ASIN…"
          className="num ml-auto w-full max-w-[260px] rounded-md border border-line bg-paper px-2.5 py-1 text-[12.5px] text-ink"
        />
      </div>

      {/*
        ⭐ দ্বিতীয় সারি — কর্মী ও তারিখ। ⚠️ প্রথম সারিতে ঢোকানো হয়নি:
        অবস্থার চিপগুলো রোজ ব্যবহার হয়, আর এই দুটো মাঝেমধ্যে; এক সারিতে
        রাখলে চিপগুলো ছোট পর্দায় নিচে নেমে যেত।
      */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <select
          value={staffId}
          onChange={(e) => change(() => setStaffId(e.target.value))}
          className="rounded-md border border-line bg-paper px-2 py-1 text-[12.5px] text-ink"
        >
          <option value="">Everyone</option>
          {(designers.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.empCode} · {d.fullName}
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

        {/*
          ⚠️ ছাঁকনি বসানো থাকলে সেটা **দেখা যেতে হবে** — নইলে কেউ কাল
          এসে খালি তালিকা দেখে ভাবত ডেটা হারিয়ে গেছে, অথচ গতকালের
          তারিখটাই বসে ছিল।
        */}
        {(staffId || from || to) && (
          <button
            type="button"
            onClick={() =>
              change(() => {
                setStaffId('');
                setFrom('');
                setTo('');
              })
            }
            className="text-[12px] text-data hover:underline"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-[11.5px] text-ink-3">
          Newest activity first
        </span>
      </div>

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
              {
                key: 'asin',
                header: 'ASIN',
                render: (r) => (
                  <a
                    href={r.url}
                    target="_blank"
                    // ⚠️ tabnabbing ঠেকাতে — নতুন ট্যাব যেন এই পাতা সরাতে না পারে
                    rel="noreferrer noopener"
                    className="num text-data hover:underline"
                  >
                    {r.asin}
                  </a>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => <StatusChip row={r} />,
              },
              {
                key: 'no',
                header: 'Job no.',
                align: 'right',
                render: (r) => (
                  <span className="num text-ink-3">{r.jobNumber ?? '—'}</span>
                ),
              },
              {
                key: 'when',
                header: 'When',
                /*
                  ⭐ **কোন তারিখটা দেখানো হচ্ছে সেটাও বলা হয়** — শেষ
                     হওয়ার, শুরুর, নাকি বরাদ্দের। শুধু একটা তারিখ বসালে
                     পাঠক ধরে নিতেন ওটা "কবে হয়েছে", আর পুলে পড়ে থাকা
                     সারিতেও একটা তারিখ দেখে বিভ্রান্ত হতেন।
                */
                render: (r) => <WhenCell row={r} />,
              },
              {
                key: 'who',
                header: 'Designer',
                /*
                  ⚠️ ইমপোর্ট করা পুরোনো সারিতে `assignedTo` **নেই** — নামটা
                     কাঁচা লেখায় (`Hafiz-24-05-2026`), কারণ ওই কর্মীদের
                     অনেকেই আর সিস্টেমে নেই। তাই দুটোই দেখানো হয়।
                */
                render: (r) => (
                  <span className="block">
                    {r.assignedTo ? (
                      <span className="text-ink">{r.assignedTo.fullName}</span>
                    ) : r.sourceNote ? (
                      <span className="num text-[12px] text-ink-3">{r.sourceNote}</span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}

                    {/*
                      ⭐⭐ **কে "শেষ" বলেছেন** *(২৩ আগস্ট, মালিকের রিপোর্ট)*।
                      আগে কেবল বরাদ্দ পাওয়া মানুষের নাম দেখাত, তাই মালিক
                      নিজে Complete চাপলেও ডিজাইনারের নামই উঠত — সরাসরি
                      ভুল তথ্য।

                      ⚠️ নামটা তখনই আসে যখন কেউ সত্যিই চেপেছেন। পুরোনো
                      সারিগুলোয় (Excel থেকে আনা, বা সংশোধনের আগের) ঘরটা
                      খালি থাকে — অনুমান করে কিছু বসানো হয় না।
                    */}
                    {r.completedBy && (
                      <span className="block text-[11.5px] text-ink-3">
                        ✓ marked by {r.completedBy.fullName}
                      </span>
                    )}
                  </span>
                ),
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
function WhenCell({ row }: { row: TargetRow }) {
  const when =
    row.completedAt ?? row.startedAt ?? row.assignedAt ?? null;
  if (when === null) return <span className="text-ink-3">—</span>;

  const what = row.completedAt
    ? 'done'
    : row.startedAt
      ? 'started'
      : 'given';

  return (
    <span className="num whitespace-nowrap text-[12px] text-ink-2">
      {formatDateTime(when)}
      <span className="text-ink-3"> · {what}</span>
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
  onLive,
  onDelete,
  mayDelete,
}: {
  row: TargetRow;
  busy: boolean;
  onChange: (status: TargetStatus) => void;
  onUploaded: () => void;
  onLive: () => void;
  onDelete: () => void;
  /** ⚠️ `false` হলে Delete বোতামটাই বসে না — গবেষকের হাতে ওটা থাকবে না */
  mayDelete: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

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

  return (
    <span className="flex justify-end gap-1.5 whitespace-nowrap">
      {/* ⭐ কারো হাত থেকে তুলে নেওয়া — মালিকানাও ছেড়ে যায় */}
      {row.status !== 'pool' && (
        <MiniButton disabled={busy} onClick={() => onChange('pool')}>
          To pool
        </MiniButton>
      )}
      {/*
        ⚠️ নামটা **"Complete"**, "Done" নয় — ডিজাইনারের পাতায় ঠিক এই
           বোতামটাই ওই নামে আছে, আর দুটো আলাদা শব্দ মানে মালিক ভাবতেন
           দুটো আলাদা কাজ (মালিকের প্রশ্ন, ২৩ আগস্ট)।
        ⭐ নিয়মটা: **বোতামে ক্রিয়া** (Complete · Skip), **চিহ্নে অবস্থা**
           (Done · Skipped)।
      */}
      {row.status !== 'done' && (
        <MiniButton tone="good" disabled={busy} onClick={() => onChange('done')}>
          Complete
        </MiniButton>
      )}
      {/*
        ⭐⭐ **পরের দুটো ধাপ** *(২৩ আগস্ট ২০২৬)* — শেষ হওয়ার পরে আপলোড,
        আপলোডের পরে লাইভ।

        ⚠️⚠️ বোতামটা **ক্রম মেনে দেখা যায়**: শেষ না হলে "Uploaded" নেই,
        আপলোড না হলে "Live" নেই। সবগুলো একসাথে দেখালে যে-কেউ যেকোনো
        ক্রমে চাপতে পারতেন, আর তখন পাইপলাইনের সংখ্যাগুলোই অর্থ হারাত।
        সার্ভারও একই পাহারা দেয় — পর্দা একমাত্র রক্ষী নয়।
      */}
      {row.completedAt !== null && row.uploadedAt === null && (
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
        ⚠️⚠️ **Delete কেবল owner ও manager-এর** *(২৪ আগস্ট ২০২৬)*।
        এতদিন পাতাটা `useAuth` ডাকতই না, তাই ছটা বোতামই শর্তহীন ছিল —
        কেউ খুলত না বলে চোখে পড়েনি। ⭐ এখন গবেষককে রোজ এই পাতায় পাঠানো
        হচ্ছে, তাই আগে বিপজ্জনক বোতামটা তুলে নেওয়া।

        ⚠️ মুছলে ডুপ্লিকেট-প্রহরী ওই ASIN **ভুলে যায়**, অর্থাৎ কাল কেউ
        আবার জমা দিলে পুরোনো কাজ নতুন হয়ে ঢুকবে — ফেরানোর উপায় নেই।
      */}
      {mayDelete && (
        <MiniButton tone="danger" disabled={busy} onClick={() => setConfirming(true)}>
          Delete
        </MiniButton>
      )}
    </span>
  );
}

