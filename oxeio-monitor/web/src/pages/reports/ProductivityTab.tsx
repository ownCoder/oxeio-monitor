import {
  getProductivityReport,
  type ProductivityEmployeeRow,
  type ProductivityItem,
} from '../../api/reports';
import { useApi } from '../../api/useApi';
import { Card, Stat, StatRow } from '../../components/Card';
import { Hours } from '../../components/Duration';
import { ProgressBar } from '../../components/ProgressRing';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import { PersonCell, Table, type Column } from '../../components/Table';
import { formatPct } from '../../lib/format';
import { CATEGORY_LABEL, MetaNote, Pill } from './shared';

/**
 * F04 — অ্যাপ/সাইট ভিত্তিক productivity রিপোর্ট।
 *
 * ⚠️ **নাম-সংঘাত**: `activity.ts`-এর `DailyProductivityReport` (D07) আলাদা
 *    জিনিস — ওটা দিনে-দিনে স্কোর, এটা কোন অ্যাপ/সাইটে কত সময়।
 *
 * ⭐ যা দেখানো হয় তা হলো ব্রাউজারের **ডোমেইন** (`github.com`), ফুল URL নয়
 *    — সার্ভার ফুল URL রাখেই না (ADR-013), আর উইন্ডো-টাইটেলও কখনো আসে না।
 *    এই পর্দায় নতুন কোনো "বিস্তারিত" কলাম যোগ করার আগে ওই নিয়মটা মনে রাখুন।
 */
export function ProductivityTab({
  from,
  to,
  employeeId,
  limit,
}: {
  from: string;
  to: string;
  employeeId: number | null;
  /** টপ কতটা অ্যাপ/সাইট — সার্ভারে সর্বোচ্চ ২০০ */
  limit: number;
}) {
  const { data, error, loading, reload } = useApi(
    (signal) =>
      getProductivityReport(
        { from, to, employeeId: employeeId ?? undefined, limit },
        signal,
      ),
    [from, to, employeeId, limit],
  );

  if (loading && !data) return <Loading label="Loading app and site usage…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || (data.top.length === 0 && data.byEmployee.length === 0)) {
    return (
      <Empty
        title="No app or site usage in this range"
        hint="While the agent runs, working time is collected on its own. In a new office it is normal for this page to stay empty for the first few days."
      />
    );
  }

  const topColumns: Column<ProductivityItem>[] = [
    {
      key: 'name',
      header: 'App / site',
      render: (item) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">
            {item.displayName ?? item.key}
          </div>
          {/* নিয়মে দেওয়া নাম থাকলে আসল কী-টাও দেখানো হয়, নইলে মেলানো যেত না */}
          {item.displayName && item.displayName !== item.key && (
            <div className="num truncate text-[11px] text-ink-3">{item.key}</div>
          )}
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      render: (item) => (
        <Pill muted>{item.kind === 'site' ? 'Site' : 'App'}</Pill>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (item) => (
        <Pill muted={item.category === 'uncategorized'}>
          {CATEGORY_LABEL[item.category]}
        </Pill>
      ),
    },
    {
      key: 'hours',
      header: 'Time',
      align: 'right',
      render: (item) => <Hours hours={item.hours} />,
    },
    {
      key: 'share',
      header: 'Share',
      align: 'right',
      className: 'w-32',
      render: (item) => (
        <div className="flex items-center justify-end gap-2">
          <ProgressBar
            value={item.sharePct}
            max={100}
            className="w-16"
            ariaLabel="Share"
          />
          <span className="num w-11 text-right text-ink-2">
            {formatPct(item.sharePct)}
          </span>
        </div>
      ),
    },
  ];

  const employeeColumns: Column<ProductivityEmployeeRow>[] = [
    {
      key: 'person',
      header: 'Staff',
      render: (row) => (
        <PersonCell fullName={row.fullName} empCode={row.empCode} />
      ),
    },
    {
      key: 'productive',
      header: 'Productive',
      align: 'right',
      render: (row) => (
        <Hours hours={row.productiveHours} className="font-semibold" />
      ),
    },
    {
      key: 'neutral',
      header: 'Neutral',
      align: 'right',
      render: (row) => <Hours hours={row.neutralHours} />,
    },
    {
      key: 'unproductive',
      header: 'Unproductive',
      align: 'right',
      render: (row) => <Hours hours={row.unproductiveHours} />,
    },
    {
      // ⚠️ ধূসর — এগুলো এখনো কোনো নিয়মে পড়েনি, খারাপ কিছু নয়
      key: 'uncategorized',
      header: 'Uncategorized',
      align: 'right',
      render: (row) => <Hours hours={row.uncategorizedHours} tone="muted" />,
    },
    {
      key: 'tracked',
      header: 'Total tracked',
      align: 'right',
      render: (row) => <Hours hours={row.trackedHours} tone="muted" />,
    },
    {
      key: 'share',
      header: 'Productive share',
      align: 'right',
      className: 'w-32',
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <ProgressBar
            value={row.productiveSharePct}
            max={100}
            className="w-16"
            ariaLabel="Productive share"
          />
          <span className="num w-11 text-right">
            {formatPct(row.productiveSharePct)}
          </span>
        </div>
      ),
    },
  ];

  return (
    <>
      <StatRow>
        <Stat label="Total tracked" value={<Hours hours={data.totalTrackedHours} />} />
        <Stat
          label="Uncategorized"
          value={<Hours hours={data.uncategorizedHours} />}
          tone="muted"
        />
        <Stat
          label="Uncategorized share"
          value={formatPct(
            data.totalTrackedHours > 0
              ? (data.uncategorizedHours / data.totalTrackedHours) * 100
              : null,
          )}
          tone="muted"
        />
      </StatRow>

      <div className="mt-4 space-y-4">
        <Card
          title="Top apps and sites"
          hint="Sites show the domain only — the full address is never stored"
          padded={false}
        >
          {data.top.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-3">
              No apps or sites were recorded in this range.
            </p>
          ) : (
            <Table
              columns={topColumns}
              rows={data.top}
              // ⚠️ একই নামের অ্যাপ ও সাইট থাকতে পারে, তাই kind-ও কী-তে
              rowKey={(item) => `${item.kind}-${item.key}`}
            />
          )}
        </Card>

        <Card title="By staff" padded={false}>
          {data.byEmployee.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-3">
              No usage was recorded for anyone in this range.
            </p>
          ) : (
            <Table
              columns={employeeColumns}
              rows={data.byEmployee}
              rowKey={(row) => String(row.employeeId)}
            />
          )}
        </Card>
      </div>

      {/*
        ⚠️ এই বাক্যটা বাদ দেওয়া যাবে না। "উৎপাদনশীল অংশ"-এর হরে অচিহ্নিত
           সময়ও আছে, তাই নতুন ক্যাটাগরি-নিয়ম যোগ হতে হতে সংখ্যাটা নিজে
           থেকেই বাড়ে। না বললে কেউ ভাবত মানুষটার কাজ বদলেছে — আসলে শুধু
           নিয়মের তালিকা বেড়েছে। আর `daily_summary`-র শতাংশের সাথেও এটা
           হুবহু মিলবে না, সেটা ভুল নয়।
      */}
      <Caveat>
        Productive share = productive ÷ total tracked time, and the denominator
        includes uncategorized time too. The more category rules there are, the
        higher this number climbs — so do not be surprised if it does not match
        the dashboard's daily score exactly.
      </Caveat>

      <MetaNote meta={data.meta} />
    </>
  );
}
