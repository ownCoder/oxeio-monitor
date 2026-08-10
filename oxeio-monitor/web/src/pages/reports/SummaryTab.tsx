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

  if (loading && !data) return <Loading label="সারাংশ আনা হচ্ছে…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || data.rows.length === 0) {
    return (
      <Empty
        title="এই রেঞ্জে কোনো সারাংশ নেই"
        hint="সারাংশ তৈরি হয় দৈনিক হিসাব থেকে। এজেন্ট এখনো ডেটা না পাঠালে এই পাতা খালিই থাকবে — অন্য তারিখ বেছে দেখুন।"
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
      header: 'স্টাফ',
      render: (row) => (
        <PersonCell fullName={row.fullName} empCode={row.empCode} />
      ),
    },
    {
      key: 'bucket',
      header: groupBy === 'month' ? 'মাস' : 'সপ্তাহ',
      render: (row) => (
        <span className="num whitespace-nowrap">{bucketLabel(row)}</span>
      ),
    },
    {
      key: 'workdays',
      header: 'কর্মদিবস',
      align: 'right',
      render: (row) => (
        <span className="num text-ink-3">{formatCount(row.workdays)}</span>
      ),
    },
    {
      key: 'daysWithWork',
      header: 'কাজ হয়েছে',
      align: 'right',
      render: (row) => (
        <span className="num">{formatCount(row.daysWithWork)}</span>
      ),
    },
    {
      key: 'worked',
      header: 'কাজ',
      align: 'right',
      render: (row) => <Hours hours={row.workedHours} />,
    },
    {
      key: 'adjustment',
      header: 'সমন্বয়',
      align: 'right',
      render: (row) => <SignedHours hours={row.adjustmentHours} />,
    },
    {
      key: 'credited',
      header: 'গোনা হয়েছে',
      align: 'right',
      render: (row) => (
        <Hours hours={row.creditedHours} className="font-semibold" />
      ),
    },
    {
      key: 'target',
      header: 'টার্গেট',
      align: 'right',
      render: (row) => <Hours hours={row.targetHours} tone="muted" />,
    },
    {
      // ⭐ বার পূর্ণ হলে কালো হয়ে যায় (`ProgressBar`-এর নিয়ম) — টার্গেট
      //    ছোঁয়া কোনো সমস্যা নয়, তাই ওটা লাল থাকে না।
      key: 'pace',
      header: 'অগ্রগতি',
      className: 'w-24',
      render: (row) => (
        <ProgressBar
          value={hoursToSeconds(row.creditedHours)}
          max={hoursToSeconds(row.targetHours)}
        />
      ),
    },
    {
      // ⚠️ ঘাটতিই একমাত্র লাল সংখ্যা এই টেবিলে — লাল মানে "মনোযোগ দরকার",
      //    আর সব কলাম লাল করলে লালের মানেই হারিয়ে যেত।
      key: 'shortfall',
      header: 'ঘাটতি',
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
      header: 'অতিরিক্ত',
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
        title={groupBy === 'month' ? 'মাসভিত্তিক সারাংশ' : 'সপ্তাহভিত্তিক সারাংশ'}
        hint="গোনা হয়েছে = কাজ + সমন্বয় — টার্গেটের সাথে এটাই মেলানো হয়"
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
