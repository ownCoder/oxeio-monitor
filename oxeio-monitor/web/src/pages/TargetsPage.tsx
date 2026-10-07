import { useState } from 'react';

import {
  addTargets,
  REJECT_TEXT,
  type BulkResult,
} from '../api/targets';
import { Card } from '../components/Card';
import { Button, Page } from '../components/Page';
import { Chip, Notice, ServerError, useMutation } from './settings/ui';
import { Table } from '../components/Table';

/**
 * **ডিজাইন-টার্গেট জমা** *(২২ আগস্ট ২০২৬)* — সাইডবারে "Add Design Targets"।
 *
 * ⚠️ তালিকাটা **আলাদা পাতায়** *(২৩ আগস্ট, মালিকের সিদ্ধান্ত)*: জমা
 * দেওয়া আর ঘেঁটে দেখা দুটো আলাদা কাজ, আর এক পাতায় থাকলে ৫০০ লাইন
 * পেস্ট করতে গিয়ে প্রতিবার তালিকাটাও লোড হতো।
 *
 * ⭐ গবেষকেরা রোজ ~৫০০টা Amazon URL জমা দেন; সকাল ৮টায় ডিজাইনারদের
 * মধ্যে র‍্যান্ডম বণ্টন হয়।
 *
 * ⚠️⚠️ **পাতাটা সাইডবারে, Settings-এ নয়** *(মালিকের সিদ্ধান্ত)* — গবেষক
 * এখানে **রোজ** আসবেন, আর Settings একবার বসিয়ে ভুলে যাওয়ার জায়গা।
 * ঠিক এই কারণেই Deposits-ও সাইডবারে গেছে (09 § ৩ঃ)।
 */
export function TargetsPage() {
  const submit = useMutation();

  const [text, setText] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);

  return (
    <Page
      title="Add design targets"
      subtitle="Amazon links the designers will work from"
    >
      <div className="space-y-3">
        <Card title="Add Links" hint="One per line — paste as many as you like">
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

            <ServerError error={submit.error} />

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
                  })
                }
              >
                {submit.busy ? 'Adding…' : 'Add to pool'}
              </Button>


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
        known · <span className="num font-semibold">{result.rejectedTotal}</span>{' '}
        could not be used — pool is now{' '}
        <span className="num font-semibold">{result.poolSize}</span>
      </div>

      {/*
        ⚠️⚠️ ছাদ তোলার পর ৪৫,০০০ লাইন পেস্ট করা সম্ভব। ভুল ফাইল পেস্ট
        করলে সবগুলোই বাদ পড়ত, আর গোটা তালিকা আঁকতে গেলে ব্রাউজার জমে
        যেত। ⭐ তাই সার্ভার ২০০টা পাঠায়, কিন্তু **সংখ্যাটা সত্যি থাকে** —
        আর কতগুলো দেখানো হচ্ছে না সেটাও লেখা হয়, নীরবে কাটা হয় না।
      */}
      {result.rejectedTotal > result.rejected.length && (
        <div className="text-[12px] text-ink-3">
          Showing the first{' '}
          <span className="num">{result.rejected.length}</span> of{' '}
          <span className="num">{result.rejectedTotal}</span> — enough to see
          what went wrong.
        </div>
      )}

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
