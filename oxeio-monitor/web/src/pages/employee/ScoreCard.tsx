import type { CSSProperties } from 'react';

import { getDailyProductivity, type ProductivityScore } from '../../api/activity';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Duration } from '../../components/Duration';
import { SectionHead } from '../../components/Page';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import { formatPct, pctOf } from '../../lib/format';

/**
 * D07 — একদিনের productivity স্কোর।
 *
 * ⭐⚠️ **স্কোরের পাশে "কত শতাংশ সময় অচেনা" সবসময় থাকে** — ইংরেজি পর্দায়
 * "… % uncategorised"। ৯০% সময় অচেনা হলে ৮০% স্কোর কার্যত অর্থহীন — অথচ
 * শুধু বড় করে "80%" লিখে দিলে কেউ সেটাকে দিনের রায় ধরে নিত, আর তার
 * ভিত্তিতে কথা শোনাত। দুটো সংখ্যা পাশাপাশি না থাকলে এই পর্দাটা মিথ্যে বলে।
 *
 * ⚠️ পুরো ড্যাশবোর্ডে একটাই শব্দ — **uncategorised** (uncategorized,
 * unknown বা unmatched নয়)। D07-এর টাইল, ব্রেকডাউনের ভাগ আর D08-এর
 * ক্যাটাগরি-লেবেল তিন জায়গাতেই এক, নইলে পাঠক ভাবত তিনটে আলাদা জিনিস।
 *
 * ⭐ `scorePct === null` মানে **তথ্য নেই**, শূন্য নয়। `formatPct()` সেটা
 * `'—'` দেখায়; কোথাও `?? 0` লেখা হয়নি।
 */

/**
 * ⚠️ "অচেনা" ভাগটা ডোরাকাটা, নিরেট নয়। চারটে ধূসরের শেড পাশাপাশি বসালে
 * "নিরপেক্ষ" আর "অচেনা" আলাদা করা যেত না — অথচ দুটো সম্পূর্ণ আলাদা কথা:
 * একটা "জানি, এবং নিরপেক্ষ", অন্যটা "জানিই না"। রঙ দুটোই ব্র্যান্ড টোকেন।
 */
const UNKNOWN_STRIPES: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, var(--color-paper) 0 3px, var(--color-line) 3px 6px)',
};

interface Slice {
  key: string;
  label: string;
  hint: string;
  seconds: number;
  className: string;
  style?: CSSProperties;
}

export function ScoreCard({
  employeeId,
  date,
  nonce,
}: {
  employeeId: number;
  date: string;
  nonce: number;
}) {
  const { data, error, loading, reload } = useApi(
    // ⚠️ একদিন মানে `from === to`। প্যারামিটার camelCase, নইলে ৪০০।
    (signal) =>
      getDailyProductivity({ employeeId, from: date, to: date }, signal),
    [employeeId, date, nonce],
  );

  // employeeId দিলে সার্ভার ঠিক একজনকেই ফেরত দেয় (না থাকলে ৪০৪)
  const score = data?.employees[0]?.total;

  return (
    <section>
      <SectionHead
        title="Productivity score"
        hint="From the category rules · this number never touches pay"
      />

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !score || score.totalSec === 0 ? (
        <Empty
          title="No app or site records on this day"
          hint="The score comes from app-usage rows. With no rows there is nothing to score — and zero is not shown, because zero would claim that none of the day was work."
        />
      ) : (
        <>
          <Card>
            <Numbers score={score} />
            <Explain score={score} />
            <Breakdown score={score} />
          </Card>
          {data && <Caveat>{data.caveat}</Caveat>}
        </>
      )}
    </section>
  );
}

/** ⭐ দুটো সংখ্যা সবসময় একসাথে — একটা ছাড়া অন্যটা পড়া যাবে না */
function Numbers({ score }: { score: ProductivityScore }) {
  // ⚠️ অচেনার অংশ বড় হলে সেটাই দিনের আসল খবর, তাই তখন মনোযোগের রঙ।
  //    এই কার্ডে লাল টাইল একটার বেশি নেই।
  const alarming = score.unknownPct >= 50;

  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4">
      <div>
        <div className="text-[11.5px] text-ink-3">Score</div>
        <div className="num mt-0.5 text-3xl leading-none font-semibold text-ink">
          {formatPct(score.scorePct)}
        </div>
        <div className="mt-1 text-[11px] text-ink-3">
          {score.scorePct === null
            ? 'No known time to score'
            : 'Share of known time spent on work'}
        </div>
      </div>

      <div>
        <div className="text-[11.5px] text-ink-3">Uncategorised</div>
        <div
          className={`num mt-0.5 text-3xl leading-none font-semibold ${
            alarming ? 'text-brand-ink' : 'text-ink-3'
          }`}
        >
          {formatPct(score.unknownPct)}
        </div>
        <div className="mt-1 text-[11px] text-ink-3">
          of the day matched no rule — left out of the score
        </div>
      </div>
    </div>
  );
}

function Explain({ score }: { score: ProductivityScore }) {
  return (
    <p className="mt-4 rounded-md border border-line bg-paper px-3 py-2 text-xs leading-relaxed text-ink-3">
      The score sits on the{' '}
      <Duration
        seconds={score.categorizedSec}
        className="font-semibold text-ink-2"
      />{' '}
      of <b>known</b> time in this day, not on the full{' '}
      <Duration seconds={score.totalSec} className="font-semibold text-ink-2" />
      {' — '}
      {/*
        ⭐⚠️ "…% uncategorised" বাক্যটা **শর্তহীন**, স্কোরের ঠিক নিচেই।
           আগে এটা শুধু ৩০%+ হলে দেখাত, ফলে ২৯% অচেনা থাকলে পর্দায় সংখ্যাটা
           কোথাও লেখাই থাকত না — অথচ দিনের প্রায় এক-তৃতীয়াংশ তখনো অজানা।
           টাইলটা উপরে আছে বটে, কিন্তু ওখানে লেবেল আগে আর সংখ্যা পরে; পুরো
           কথাটা এক টানে পড়া যায় শুধু এই লাইনে।
      */}
      <b>{formatPct(score.unknownPct)} uncategorised</b>.
      {score.unknownPct >= 30 && (
        <>
          {' '}
          With that much of the day unmatched, the number cannot stand as a
          verdict on anyone. Adding category rules will change it.
        </>
      )}
    </p>
  );
}

function Breakdown({ score }: { score: ProductivityScore }) {
  const slices: Slice[] = [
    {
      key: 'productive',
      label: 'Productive',
      hint: 'Marked productive by a rule',
      seconds: score.productiveSec,
      className: 'bg-ink',
    },
    {
      key: 'neutral',
      label: 'Neutral',
      hint: 'Known, but neither way',
      seconds: score.neutralSec,
      className: 'bg-ink-3/45',
    },
    {
      key: 'unproductive',
      label: 'Unproductive',
      hint: 'Marked unproductive by a rule — hours are still never cut',
      seconds: score.unproductiveSec,
      className: 'bg-brand-ink',
    },
    {
      key: 'unknown',
      label: 'Uncategorised',
      hint: 'Matched no rule',
      seconds: score.unknownSec,
      className: 'bg-paper',
      style: UNKNOWN_STRIPES,
    },
  ];

  return (
    <>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full border border-line">
        {slices
          .filter((s) => s.seconds > 0)
          .map((s) => (
            <div
              key={s.key}
              title={`${s.label} · ${formatPct(pctOf(s.seconds, score.totalSec))}`}
              className={s.className}
              style={{
                width: `${pctOf(s.seconds, score.totalSec)}%`,
                ...s.style,
              }}
            />
          ))}
      </div>

      <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {slices.map((s) => (
          <div
            key={s.key}
            title={s.hint}
            className="flex items-center gap-2 text-[12.5px]"
          >
            <span
              aria-hidden
              className={`size-2.5 flex-none rounded-[2px] border border-line ${s.className}`}
              style={s.style}
            />
            <span className="min-w-0 truncate text-ink-2">{s.label}</span>
            <span className="ml-auto flex items-baseline gap-2">
              <Duration
                seconds={s.seconds}
                tone={s.key === 'productive' ? 'counted' : 'muted'}
              />
              <span className="num w-10 text-right text-[11px] text-ink-3">
                {formatPct(pctOf(s.seconds, score.totalSec))}
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
