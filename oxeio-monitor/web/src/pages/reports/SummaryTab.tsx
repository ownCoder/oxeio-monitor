import {
  getSummaryReport,
  type GroupBy,
  type SummaryRow,
} from '../../api/reports';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Hours } from '../../components/Duration';
import { ProgressBar } from '../../components/ProgressRing';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import { PersonCell, Table, type Column } from '../../components/Table';
import {
  formatCount,
  formatDateShort,
  formatMonth,
  hoursToSeconds,
} from '../../lib/format';
import { MAX_SHOWN_ROWS, MetaNote, SignedHours, TrimmedNote } from './shared';

/**
 * F02 — সাপ্তাহিক/মাসিক সারাংশ: worked · target · shortfall · overtime।
 *
 * ⭐⚠️ **অতিরিক্ত ঘণ্টার টাকা এখানে কখনো দেখানো হবে না** — শুধু ঘণ্টা।
 *    OT-র হার (১×, ১.৫×, নাকি কিছুই না) এখনো ঠিক হয়নি (open question O4)।
 *    পর্দায় একটা টাকার অঙ্ক বসিয়ে দিলে সেই হারটাই নীরবে কোম্পানির নীতি
 *    হয়ে যেত, অথচ সিদ্ধান্তটা কেউ নেয়নি। সার্ভারও তাই `overtimeNote`
 *    পাঠায় — সেটা নিচে হুবহু দেখানো হয়।
 */
export function SummaryTab({
  from,
  to,
  employeeId,
  groupBy,
}: {
  from: string;
  to: string;
  employeeId: number | null;
  groupBy: GroupBy;
}) {
  const { data, error, loading, reload } = useApi(
    (signal) =>
      getSummaryReport(
        { from, to, employeeId: employeeId ?? undefined, groupBy },
        signal,
      ),
    [from, to, employeeId, groupBy],
  );

  if (loading && !data) return <Loading label="Loading summary…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || data.rows.length === 0) {
    return (
      <Empty
        title="No summary for this range"
        hint="Summaries are built from the daily figures. Until the agent sends data this page stays empty — try other dates."
      />
    );
  }

  const shown = data.rows.slice(0, MAX_SHOWN_ROWS);

  /**
   * ⚠️ মাসে `bucket` = `'2026-08'`, সপ্তাহে সপ্তাহ-শুরুর তারিখ। কিন্তু
   *    `bucketStart`/`bucketEnd` **পুরো** মাস/সপ্তাহ নয় — রেঞ্জ ও কর্মকালের
   *    যতটুকু ভেতরে পড়েছে ততটুকু। তাই সপ্তাহে দুই প্রান্তই দেখানো হয়,
   *    নইলে "১০ আগস্ট থেকে সপ্তাহ" পড়ে কেউ ধরে নিত পুরো সাত দিনই আছে।
   */
  const bucketLabel = (row: SummaryRow): string =>
    groupBy === 'month'
      ? formatMonth(row.bucket)
      : `${formatDateShort(row.bucketStart)} – ${formatDateShort(row.bucketEnd)}`;

  const columns: Column<SummaryRow>[] = [
    {
      key: 'person',
      header: 'Staff',
      render: (row) => (
        <PersonCell fullName={row.fullName} empCode={row.empCode} />
      ),
    },
    {
      key: 'bucket',
      header: groupBy === 'month' ? 'Month' : 'Week',
      render: (row) => (
        <span className="num whitespace-nowrap">{bucketLabel(row)}</span>
      ),
    },
    {
      key: 'workdays',
      header: 'Workdays',
      align: 'right',
      render: (row) => (
        <span className="num text-ink-3">{formatCount(row.workdays)}</span>
      ),
    },
    {
      key: 'daysWithWork',
      header: 'Days worked',
      align: 'right',
      render: (row) => (
        <span className="num">{formatCount(row.daysWithWork)}</span>
      ),
    },
    {
      key: 'worked',
      header: 'Worked',
      align: 'right',
      render: (row) => <Hours hours={row.workedHours} />,
    },
    {
      key: 'adjustment',
      header: 'Adjustment',
      align: 'right',
      render: (row) => <SignedHours hours={row.adjustmentHours} />,
    },
    {
      key: 'credited',
      header: 'Counted',
      align: 'right',
      render: (row) => (
        <Hours hours={row.creditedHours} className="font-semibold" />
      ),
    },
    {
      key: 'target',
      header: 'Target',
      align: 'right',
      render: (row) => <Hours hours={row.targetHours} tone="muted" />,
    },
    {
      // ⭐ বার পূর্ণ হলে **সবুজ** হয়ে যায় (`ProgressBar`-এর নিয়ম) — টার্গেট
      //    ছোঁয়া কোনো সমস্যা নয়, তাই ওটা লাল থাকে না। চলতি অবস্থায়
      //    নিরপেক্ষ `ink`; লাল এই টেবিলে শুধু ঘাটতির কলামে।
      key: 'pace',
      header: 'Progress',
      className: 'w-24',
      render: (row) => (
        <ProgressBar
          value={hoursToSeconds(row.creditedHours)}
          max={hoursToSeconds(row.targetHours)}
          ariaLabel="Target"
        />
      ),
    },
    {
      // ⚠️ ঘাটতিই একমাত্র লাল সংখ্যা এই টেবিলে — লাল মানে "মনোযোগ দরকার",
      //    আর সব কলাম লাল করলে লালের মানেই হারিয়ে যেত।
      key: 'shortfall',
      header: 'Shortfall',
      align: 'right',
      render: (row) =>
        row.shortfallHours > 0 ? (
          <span className="num font-semibold text-brand-ink">
            <Hours hours={row.shortfallHours} />
          </span>
        ) : (
          <span className="num text-ink-3">—</span>
        ),
    },
    {
      key: 'overtime',
      header: 'Overtime',
      align: 'right',
      render: (row) =>
        row.overtimeHours > 0 ? (
          <Hours hours={row.overtimeHours} />
        ) : (
          <span className="num text-ink-3">—</span>
        ),
    },
  ];

  return (
    <>
      <Card
        title={groupBy === 'month' ? 'Month by month' : 'Week by week'}
        hint="Counted = worked + adjustment — this is what the target is matched against"
        padded={false}
      >
        <Table
          columns={columns}
          rows={shown}
          // ⚠️ একই কর্মীর একাধিক বালতি আসে, তাই দুটোই কী-তে দরকার
          rowKey={(row) => `${row.employeeId}-${row.bucket}`}
        />
        {data.rows.length > shown.length && (
          <TrimmedNote total={data.rows.length} />
        )}
      </Card>

      {/* ⭐ সার্ভারের নিজের বাক্য — এটাই O4-কে খোলা রাখে */}
      <Caveat>{data.overtimeNote}</Caveat>

      <MetaNote meta={data.meta} />
    </>
  );
}
