import { useState } from 'react';

import {
  addTargets,
  distributeTargets,
  REJECT_TEXT,
  targetStats,
  type BulkResult,
} from '../api/targets';
import { useApi } from '../api/useApi';
import { Card } from '../components/Card';
import { Button, Page } from '../components/Page';
import { ErrorBox, Loading } from '../components/States';
import { Table } from '../components/Table';
import { useAuth } from '../auth/AuthContext';
import { Chip, Notice, ServerError, useMutation } from './settings/ui';

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
      </div>
    </Page>
  );
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
