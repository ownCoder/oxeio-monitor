import { useState } from 'react';

import {
  closeMonth,
  listMonthClosures,
  reopenMonth,
  type MonthClosureView,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Caveat, ErrorBox, Loading } from '../../components/States';
import { formatDate } from '../../lib/format';
import {
  ConfirmDialog,
  MiniButton,
  Modal,
  RowActions,
  ServerError,
  TextField,
  orUndefined,
  useMutation,
} from './ui';

/**
 * R1 — **মাস বন্ধ করা।** owner-only (রুটটাও, `App.tsx`-এ)।
 *
 * ⚠️⚠️ কেন এই পর্দাটা দরকার: মাস বন্ধ করাই একমাত্র জিনিস যা
 * `monthly_summary`-র সংখ্যাগুলো **স্থির** করে। ওটা ছাড়া ছুটির একটা তারিখ
 * নড়লেই গত মাসের d ও D বদলায় — আর পে-রোল ওখান থেকেই পড়ে, অর্থাৎ বেতন
 * দিয়ে দেওয়ার পরেও হিসাব নড়ে।
 *
 * ⭐⭐ **তালিকাটা মাস ধরে, বন্ধ-রেকর্ড ধরে নয়** — সার্ভার কেবল বন্ধ মাসগুলো
 * ফেরায়, কিন্তু পর্দায় শেষ ১২ মাসই দেখানো হয়, প্রতিটার পাশে অবস্থা।
 * কারণ মালিকের প্রশ্নটা "কোনগুলো বন্ধ করেছি" নয়, **"কোনটা এখনো বাকি"** —
 * আর অনুপস্থিতি দিয়ে সেটা বোঝা যায় না। খালি তালিকা দেখিয়ে "সব ঠিক আছে"
 * ভাব তৈরি করা এই প্রকল্পে নিষিদ্ধ।
 */
export function MonthsTab() {
  const { data, error, loading, reload } = useApi(listMonthClosures, []);
  const mutation = useMutation();

  const [closing, setClosing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reopening, setReopening] = useState<MonthClosureView | null>(null);

  if (loading && !data) return <Loading label="Loading months…" />;
  if (!data) return <ErrorBox error={error} retry={reload} />;

  const closed = new Map(data.rows.map((r) => [r.yearMonth, r]));
  const months = lastMonths(12);

  return (
    <>
      <ServerError error={mutation.error} />

      <Card
        title="Closing the Month"
        hint="Once closed, that month's hours and targets stop moving"
        padded={false}
      >
        <ul className="divide-y divide-line">
          {months.map((ym) => {
            const row = closed.get(ym);
            /**
             * ⚠️ চলতি মাস আলাদা করে দেখানো হয় — সার্ভার ওটা বন্ধ করতে দেয়
             *    না (মাস এখনো চলছে), তাই বোতামটাও থাকা উচিত নয়। বোতাম
             *    রেখে ৪০০ ফেরানো মানে ব্যবহারকারীকে একটা দেয়ালে পাঠানো।
             */
            const isCurrent = ym === currentMonth();

            return (
              <li
                key={ym}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <span className="num min-w-24 text-[13px] font-medium">
                  {monthLabel(ym)}
                </span>

                <span className="min-w-0 flex-1 text-[12px] text-ink-3">
                  {row ? (
                    <>
                      <span className="text-ok-ink">Closed</span>{' '}
                      {formatDate(row.closedAt.slice(0, 10))} · {row.closedBy}
                      {row.note && (
                        <span className="block text-ink-2">{row.note}</span>
                      )}
                    </>
                  ) : isCurrent ? (
                    'Still running — can be closed once the month is over'
                  ) : (
                    'Open — figures can still move'
                  )}
                </span>

                <RowActions>
                  {row ? (
                    <MiniButton tone="danger" onClick={() => setReopening(row)}>
                      Reopen
                    </MiniButton>
                  ) : (
                    !isCurrent && (
                      <MiniButton
                        onClick={() => {
                          setNote('');
                          setClosing(ym);
                        }}
                      >
                        Close
                      </MiniButton>
                    )
                  )}
                </RowActions>
              </li>
            );
          })}
        </ul>

        {/*
          ⚠️ এই ব্যাখ্যাটা এখানে থাকা জরুরি, নইলে "বন্ধ" শব্দটা শুনে মনে
             হতো ডেটা মুছে যাচ্ছে বা পর্দা বন্ধ হচ্ছে।
        */}
        <Caveat>
          Closing a month freezes its totals: the daily rollup stops
          recalculating it, and time corrections for those dates are refused.
          Screenshots, reports and everything else stay exactly as they are.
          Payroll reads the frozen numbers, so a holiday edited later can no
          longer change a month you have already paid.
        </Caveat>
      </Card>

      {closing && (
        <Modal title={`Close ${monthLabel(closing)}`} onClose={() => setClosing(null)}>
          <p className="text-[13px] text-ink-2">
            After this, {monthLabel(closing)} stops recalculating and time
            corrections for those dates are refused. You can reopen it later —
            both actions are recorded in the audit log.
          </p>

          <div className="mt-3">
            <TextField
              label="Note (optional)"
              value={note}
              onChange={setNote}
              placeholder="Paid on 3 September"
            />
          </div>

          <RowActions>
            <MiniButton onClick={() => setClosing(null)}>Cancel</MiniButton>
            <MiniButton
              disabled={mutation.busy}
              onClick={() =>
                mutation.run(async () => {
                  await closeMonth(closing, orUndefined(note));
                  setClosing(null);
                  reload();
                })
              }
            >
              Close the month
            </MiniButton>
          </RowActions>
        </Modal>
      )}

      {/*
        ⚠️⚠️ খোলার জন্য নিশ্চিতকরণ — কারণ এটাই একমাত্র পথ যাতে **দেওয়া
           বেতনের ভিত্তি** আবার নড়তে পারে। বন্ধ করার চেয়ে খোলাটা বেশি ভারী,
           তাই বোতামটাও `danger`।
      */}
      {reopening && (
        <ConfirmDialog
          title={`Reopen ${monthLabel(reopening.yearMonth)}?`}
          intro={
            <>
              Closed on {formatDate(reopening.closedAt.slice(0, 10))} by{' '}
              {reopening.closedBy}. Both the closing and this reopening stay in
              the audit log.
            </>
          }
          warning="Its figures can move again — a holiday edit or a time correction will recalculate them. If this month has already been paid, the numbers behind that payment can change."
          confirmLabel="Reopen"
          busy={mutation.busy}
          error={mutation.error}
          onClose={() => setReopening(null)}
          onConfirm={() =>
            mutation.run(async () => {
              await reopenMonth(reopening.yearMonth);
              setReopening(null);
              reload();
            })
          }
        />
      )}
    </>
  );
}

/** ঢাকার আজকের মাস — `YYYY-MM` */
function currentMonth(): string {
  return dhakaNow().slice(0, 7);
}

/**
 * শেষ `n` মাস, নতুনটা আগে — চলতি মাস সহ।
 *
 * ⚠️ ঢাকার তারিখ ধরে, ব্রাউজারের নয়। নইলে মধ্যরাতের কাছাকাছি অন্য
 *    টাইমজোনের কেউ পর্দা খুললে তালিকাটা এক মাস পিছিয়ে/এগিয়ে দেখাত।
 */
function lastMonths(n: number): string[] {
  const [y, m] = dhakaNow().slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** ⚠️ ঢাকা UTC+৬ — সার্ভারের সাথে একই দিন বোঝাতে */
function dhakaNow(): string {
  return new Date(Date.now() + 6 * 3600_000).toISOString();
}

/** `2026-08` → `August 2026` */
function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
