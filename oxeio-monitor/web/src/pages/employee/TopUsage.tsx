import type { Productivity, UsageReport, UsageTally } from '../../api/activity';
import { getTopUsage } from '../../api/activity';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Duration } from '../../components/Duration';
import { SectionHead } from '../../components/Page';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import { formatCount, formatPct } from '../../lib/format';

/**
 * D08 — টপ ১০ অ্যাপ ও টপ ১০ সাইট।
 *
 * ⭐⚠️ **সাইটে শুধু ডোমেইন।** সার্ভার পুরো URL জমাই করে না, উইন্ডোর
 * শিরোনামও পাঠায় না — কাজেই এখানে "কোন পেজ" বের করার কোনো চেষ্টা নেই, আর
 * থাকা উচিতও নয় (docs/09 § ৪-এর কঠিন নিয়ম)। কথাটা পর্দাতেও লেখা আছে,
 * কারণ যে কর্মীর ডেটা দেখা হচ্ছে তার এটা জানার অধিকার আছে।
 *
 * ⚠️ অ্যাপ আর সাইটের সময় **যোগ করা যাবে না** — `chrome.exe`-এর ৩ ঘণ্টার
 * ভেতরেই `youtube.com`-এর ১ ঘণ্টা বসে আছে। সার্ভারের `caveat` সেটাই বলে,
 * আর সেটা লুকোনো হয়নি।
 */

const TOP_LIMIT = 10;

/** ⚠️ শব্দগুলো D07-এর `ScoreCard`-এর ব্রেকডাউনের সাথে হুবহু এক রাখতে হবে */
const CAT_LABEL: Record<Productivity | 'unknown', string> = {
  productive: 'Productive',
  neutral: 'Neutral',
  unproductive: 'Unproductive',
  unknown: 'Uncategorised',
};

/**
 * ⚠️ মকআপের `--st-*` মেনে: নিরেট `ink` · ধূসর · গাঢ় লাল · খালি।
 *
 * ⚠️ "Uncategorised" বিন্দুটা `bg-paper`, `bg-surface` নয় — কার্ডের
 *    পটভূমিই `surface`, তাই surface বিন্দু দিলে সারিটা দেখে মনে হতো
 *    বিন্দুটা বসাতেই ভুলে গেছি। (Midnight থিমেও নিয়মটা একই: paper গাঢ়,
 *    surface তার চেয়ে হালকা — তফাতটা দুই থিমেই টিকে থাকে।)
 */
const CAT_CLASS: Record<Productivity | 'unknown', string> = {
  productive: 'bg-ink',
  neutral: 'bg-ink-3/50',
  unproductive: 'bg-brand-ink',
  unknown: 'bg-paper',
};

export function TopUsage({
  employeeId,
  date,
  nonce,
}: {
  employeeId: number;
  date: string;
  nonce: number;
}) {
  const { data, error, loading, reload } = useApi(
    (signal) =>
      getTopUsage(
        { employeeId, from: date, to: date, limit: TOP_LIMIT },
        signal,
      ),
    [employeeId, date, nonce],
  );

  const nothing =
    data !== null &&
    data.apps.rows.length === 0 &&
    data.sites.rows.length === 0;

  return (
    <section>
      <SectionHead
        title="Most used"
        hint={`Top ${TOP_LIMIT} for this day`}
      />

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !data || nothing ? (
        <Empty
          title="No app or site records on this day"
          hint="The agent reports the foreground app once per slot. Nothing at all means either the PC or the agent wasn't running."
        />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <UsagePanel
              title="Top apps"
              hint="By process name"
              report={data.apps}
              emptyText="No app rows on this day"
              unitLabel="app"
            />
            {/*
              ⚠️ hint-টা পর্দাতেই থাকতে হবে (docs/09 § ৪) — যার ডেটা দেখা
                 হচ্ছে তার জানার অধিকার আছে যে পুরো URL কোথাও জমা হয় না।
            */}
            <UsagePanel
              title="Top sites"
              hint="Domains only — full URLs are never stored"
              report={data.sites}
              emptyText="No browser time found"
              unitLabel="domain"
            />
          </div>
          <Caveat>{data.caveat}</Caveat>
        </>
      )}
    </section>
  );
}

function UsagePanel({
  title,
  hint,
  report,
  emptyText,
  unitLabel,
}: {
  title: string;
  hint: string;
  report: UsageReport;
  emptyText: string;
  /**
   * **একবচনে** — `'app'` / `'domain'`। বহুবচনের `s` নিচে নিজে বসে, তাই
   * ⚠️ একটামাত্র ডোমেইন হলেও "1 apps" ধরনের ভাঙা ইংরেজি বেরোয় না।
   */
  unitLabel: string;
}) {
  return (
    <Card title={title} hint={hint}>
      {report.rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-3">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {report.rows.map((row) => (
            <UsageRow key={row.key} row={row} />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[11.5px] text-ink-3">
        <span>
          <span className="num">{formatCount(report.distinctKeys)}</span>{' '}
          {report.distinctKeys === 1 ? unitLabel : `${unitLabel}s`} in total ·{' '}
          <Duration seconds={report.totalSec} tone="muted" />
        </span>
        {/*
          ⭐ তালিকার বাইরে পড়ে যাওয়া সময় না দেখালে "টপ ১০"-ই যেন গোটা দিন
             মনে হতো, অথচ সেটা দিনের অর্ধেকও হতে পারে।
        */}
        {report.otherSec > 0 && (
          <span>
            Outside this list{' '}
            <Duration seconds={report.otherSec} tone="muted" />
          </span>
        )}
      </div>
    </Card>
  );
}

function UsageRow({ row }: { row: UsageTally }) {
  const cat = row.category ?? 'unknown';

  return (
    <div
      className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2.5"
      title={`${row.label} · ${CAT_LABEL[cat]} · ${formatPct(row.sharePct, 1)} of time · ${formatCount(row.records)} rows`}
    >
      <span
        aria-hidden
        className={`size-2.5 rounded-[2px] border border-line ${CAT_CLASS[cat]}`}
      />

      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-ink">
            {row.label}
          </span>
          {/*
            ⚠️ `mixed` মানে এই কী-র ভেতরে একাধিক **জানা** ক্যাটাগরি মিশে আছে
               (chrome.exe-এর ভেতরে github ও youtube দুটোই)। একটামাত্র রঙের
               বিন্দু দেখিয়ে চুপ করে থাকলে সেটা মিথ্যে হতো।
          */}
          {row.mixed && (
            <span className="flex-none rounded border border-line px-1 text-[10px] text-ink-3">
              Mixed
            </span>
          )}
        </div>

        <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-ink/45"
            style={{ width: `${Math.min(100, Math.max(0, row.sharePct))}%` }}
          />
        </div>
      </div>

      <Duration seconds={row.seconds} className="text-[12px] text-ink-2" />
    </div>
  );
}
