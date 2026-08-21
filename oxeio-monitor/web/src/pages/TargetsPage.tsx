import { useState } from 'react';

import {
  addTargets,
  distributeTargets,
  listTargets,
  REJECT_TEXT,
  targetStats,
  type BulkResult,
  type TargetRow,
  type TargetStatus,
} from '../api/targets';
import { useApi } from '../api/useApi';
import { Card } from '../components/Card';
import { Button, Page } from '../components/Page';
import { ErrorBox, Loading } from '../components/States';
import { Table } from '../components/Table';
import { useAuth } from '../auth/AuthContext';
import { Chip, MiniButton, Notice, ServerError, useMutation } from './settings/ui';

/**
 * **ডিজাইন-টার্গেট জমা** *(২২ আগস্ট ২০২৬)*।
 *
 * ⭐ গবেষকেরা রোজ ~৫০০টা Amazon URL জমা দেন; সকাল ৮টায় ডিজাইনারদের
 * মধ্যে র‍্যান্ডম বণ্টন হয়।
 *
 * ⚠️⚠️ **পাতাটা সাইডবারে, Settings-এ নয়** *(মালিকের সিদ্ধান্ত)* — গবেষক
 * এখানে **রোজ** আসবেন, আর Settings একবার বসিয়ে ভুলে যাওয়ার জায়গা।
 * ঠিক এই কারণেই Deposits-ও সাইডবারে গেছে (09 § ৩ঃ)।
 */
export function TargetsPage() {
  const { user } = useAuth();
  const stats = useApi(targetStats, []);
  const submit = useMutation();
  const spread = useMutation();

  const [text, setText] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);

  const canDistribute = user?.role === 'owner' || user?.role === 'manager';
  const s = stats.data;

  return (
    <Page
      title="Design targets"
      subtitle="Amazon links the designers will work from"
    >
      <div className="space-y-3">
        <Card title="The pool" hint="Where every collected link sits">
          <div className="p-4">
            {stats.loading && !s && <Loading />}
            {stats.error && !s && <ErrorBox error={stats.error} retry={stats.reload} />}

            {s && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile n={s.pool} label="Waiting in the pool" tone="text-ink" />
                <Tile n={s.assigned} label="In hand" tone="text-data" />
                <Tile n={s.done} label="Done" tone="text-ok" />
                {/*
                  ⚠️ "বাদ দেওয়া" লুকোনো হয় না — সংখ্যাটা বাড়তে থাকলে
                     বোঝা যায় সংগ্রহের মান পড়ছে, আর সেটা জানা দরকার।
                */}
                <Tile n={s.skipped} label="Skipped" tone="text-ink-3" />
              </div>
            )}
          </div>
        </Card>

        <Card title="Add links" hint="One per line — paste as many as you like">
          <div className="space-y-3 p-4">
            <Notice>
              Paste them however they come — <span className="num">/dp/</span>,{' '}
              <span className="num">/gp/product/</span>,{' '}
              <span className="num">.co.uk</span>, even a bare ASIN.{' '}
              <b>The same product twice is dropped on its own</b>, so you never
              have to check first.
            </Notice>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              rows={8}
              placeholder="https://www.amazon.com/dp/B0DJBD22LW"
              className="num w-full rounded-lg border border-line bg-paper p-3 text-[12.5px] text-ink"
            />

            <ServerError error={submit.error ?? spread.error} />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                tone="primary"
                disabled={submit.busy || text.trim().length === 0}
                onClick={() =>
                  submit.run(async () => {
                    const res = await addTargets(text);
                    setResult(res);
                    // ⚠️ বাক্সটা খালি করা হয় **সফল হলে তবেই** — নইলে
                    //    নেটওয়ার্ক ভাঙলে ৫০০ লাইন হারিয়ে যেত
                    setText('');
                    stats.reload();
                  })
                }
              >
                {submit.busy ? 'Adding…' : 'Add to pool'}
              </Button>

              {/*
                ⚠️ owner/manager-only: বণ্টন একবার হয়ে গেলে ফেরানো যায় না
                   (কাজের নম্বর বসে যায়), তাই বোতামটা সবার হাতে নয়।
              */}
              {canDistribute && (
                <Button
                  disabled={spread.busy}
                  onClick={() =>
                    spread.run(async () => {
                      await distributeTargets();
                      stats.reload();
                    })
                  }
                >
                  {spread.busy ? 'Distributing…' : 'Distribute now'}
                </Button>
              )}

              <span className="text-[12px] text-ink-3">
                Distribution runs on its own at 8:00 every morning
              </span>
            </div>

            {result && <BulkOutcome result={result} />}
          </div>
        </Card>

        <TargetList />
      </div>
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

function Tile({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2.5">
      <div className={`num text-[22px] font-semibold ${tone}`}>{n}</div>
      <div className="text-[11px] tracking-wide text-ink-3 uppercase">{label}</div>
    </div>
  );
}

/**
 * ⭐⭐ **যা নেওয়া গেল না, তার পুরো হিসাব।**
 *
 * ⚠️⚠️ ৫০০-র মধ্যে ৬টা বাদ পড়লে গবেষকের জানা দরকার **কোন ৬টা** — লাইন
 * নম্বর, যা লেখা ছিল, আর কারণ। না দেখালে ওই ছটা লিঙ্ক চিরতরে হারাত,
 * আর কেউ বুঝতেই পারত না কিছু হারিয়েছে।
 */
function BulkOutcome({ result }: { result: BulkResult }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-ok/40 bg-ok-bg px-3 py-2.5 text-[13.5px] text-ok-ink">
        <span className="num font-semibold">{result.added}</span> added ·{' '}
        {/* ⚠️ "আগে থেকেই ছিল" ভুল নয়, কিন্তু সংখ্যাটা লুকোনোও নয় */}
        <span className="num font-semibold">{result.alreadyKnown}</span> already
        known · <span className="num font-semibold">{result.rejected.length}</span>{' '}
        could not be used — pool is now{' '}
        <span className="num font-semibold">{result.poolSize}</span>
      </div>

      {result.rejected.length > 0 && (
        <Table
          rows={result.rejected}
          rowKey={(r) => String(r.line)}
          columns={[
            {
              key: 'line',
              header: 'Line',
              align: 'right',
              className: 'w-16',
              render: (r) => <span className="num text-ink-3">{r.line}</span>,
            },
            {
              key: 'text',
              header: 'What was pasted',
              render: (r) => (
                // ⚠️ `truncate` নয় — লিঙ্কটা পুরো দেখা দরকার, নইলে
                //    গবেষক মিলিয়ে নিতে পারতেন না কোনটা
                <span className="num break-all text-[12px] text-ink-2">{r.text}</span>
              ),
            },
            {
              key: 'why',
              header: '',
              render: (r) => (
                <Chip tone={r.reason === 'not_amazon' ? 'attention' : 'pending'}>
                  {REJECT_TEXT[r.reason]}
                </Chip>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
