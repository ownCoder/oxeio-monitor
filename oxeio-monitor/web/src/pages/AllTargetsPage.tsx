import { useState } from 'react';

import {
  deleteTarget,
  listTargets,
  updateTarget,
  type TargetRow,
  type TargetStatus,
} from '../api/targets';
import { useApi } from '../api/useApi';
import { Card } from '../components/Card';
import { Page } from '../components/Page';
import { ErrorBox, Loading } from '../components/States';
import { Table } from '../components/Table';
import { formatDateTime } from '../lib/format';
import { Chip, MiniButton, ServerError, useMutation } from './settings/ui';

/**
 * **সব ডিজাইন-টার্গেট** *(২৩ আগস্ট, মালিকের চাওয়া)* — সাইডবারে
 * "All Design Targets"।
 *
 * ⚠️ জমা দেওয়ার পাতাটা আলাদা: দুটো আলাদা কাজ, আর এক পাতায় থাকলে
 * ৫০০ লাইন পেস্ট করতে গিয়ে প্রতিবার ৩৯ হাজারের তালিকাও লোড হতো।
 */
export function AllTargetsPage() {
  return (
    <Page title="All design targets" subtitle="Every link, and where it stands">
      <TargetList />
    </Page>
  );
}

const FILTERS: { key: TargetStatus | 'all'; label: string }[] = [
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
function TargetList() {
  const [filter, setFilter] = useState<TargetStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const edit = useMutation();

  const data = useApi(
    (signal) =>
      listTargets(
        {
          ...(filter === 'all' ? {} : { status: filter }),
          ...(q.trim() ? { q: q.trim() } : {}),
          page,
        },
        signal,
      ),
    [filter, q, page],
  );

  /** ⚠️ ছাঁকনি বা খোঁজা বদলালে পাতা ১-এ ফেরত — নইলে ৫ নম্বর পাতায় বসে
   *  থেকে "কিছু নেই" দেখা যেত, অথচ ফল আছে */
  const change = (next: () => void) => {
    setPage(1);
    next();
  };

  return (
    <Card
      title="Every target"
      hint={data.data ? `${data.data.total} in total` : 'Loading…'}
      padded={false}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => change(() => setFilter(f.key))}
            className={`rounded-full border px-3 py-1 text-[12.5px] transition ${
              filter === f.key
                ? 'border-brand bg-brand-bg font-semibold text-brand-ink'
                : 'border-line text-ink-2 hover:border-brand'
            }`}
          >
            {f.label}
          </button>
        ))}

        <input
          value={q}
          onChange={(e) => change(() => setQ(e.target.value))}
          placeholder="Paste a link or ASIN…"
          className="num ml-auto w-full max-w-[260px] rounded-md border border-line bg-paper px-2.5 py-1 text-[12.5px] text-ink"
        />
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
                render: (r) =>
                  r.assignedTo ? (
                    <span className="text-ink">{r.assignedTo.fullName}</span>
                  ) : r.sourceNote ? (
                    <span className="num text-[12px] text-ink-3">{r.sourceNote}</span>
                  ) : (
                    <span className="text-ink-3">—</span>
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
  onDelete,
}: {
  row: TargetRow;
  busy: boolean;
  onChange: (status: TargetStatus) => void;
  onDelete: () => void;
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
      {row.status !== 'skipped' && (
        <MiniButton tone="danger" disabled={busy} onClick={() => onChange('skipped')}>
          Skip
        </MiniButton>
      )}
      <MiniButton tone="danger" disabled={busy} onClick={() => setConfirming(true)}>
        Delete
      </MiniButton>
    </span>
  );
}

