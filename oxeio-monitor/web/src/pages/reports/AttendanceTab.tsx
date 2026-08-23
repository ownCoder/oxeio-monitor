import { getAttendanceReport, type AttendanceRow } from '../../api/reports';
import { useApi } from '../../api/useApi';
import { Card, Stat, StatRow } from '../../components/Card';
import { Hours } from '../../components/Duration';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { PersonCell, Table, type Column } from '../../components/Table';
import { formatCount, formatDateShort, weekdayOf } from '../../lib/format';
import {
  DAY_TYPE_LABEL,
  MAX_SHOWN_ROWS,
  MetaNote,
  Pill,
  SignedHours,
  TrimmedNote,
} from './shared';

/**
 * F01 — দৈনিক অ্যাটেনডেন্স রিপোর্ট: প্রতি কর্মী, প্রতি দিন এক সারি।
 *
 * ⭐⚠️ এখানে **"কে কখন বসল" নেই এবং কখনো থাকবে না** (ADR-011)। সার্ভার
 *    `first_activity_at` পাঠায়ই না, আর পাঠালেও বসানো যেত না — একটা "শুরুর
 *    সময়" কলাম বসিয়ে দিলে এই শিটটাই কার্যত লেট-রিপোর্ট হয়ে যেত, অথচ লেট
 *    ট্র্যাকিং এই পণ্যে নেই। রিপোর্ট শুধু বলে কত ঘণ্টা হয়েছে।
 */
export function AttendanceTab({
  from,
  to,
  employeeId,
}: {
  from: string;
  to: string;
  employeeId: number | null;
}) {
  const { data, error, loading, reload } = useApi(
    (signal) =>
      // ⚠️ `employeeId: null` পাঠানো যাবে না — `qs()` null বাদ দেয়, তাই
      //    "সবাই" মানে প্যারামিটারটা একেবারেই না পাঠানো।
      getAttendanceReport(
        { from, to, employeeId: employeeId ?? undefined },
        signal,
      ),
    [from, to, employeeId],
  );

  if (loading && !data) return <Loading label="Loading attendance…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || data.rows.length === 0) {
    return (
      <Empty
        title="No rows in this range"
        hint="Staff may have joined or left outside these dates, or the agent has not sent anything yet. Try other dates."
      />
    );
  }

  const { totals } = data;
  const shown = data.rows.slice(0, MAX_SHOWN_ROWS);

  const columns: Column<AttendanceRow>[] = [
    {
      key: 'person',
      header: 'Staff',
      render: (row) => (
        <PersonCell
          fullName={row.fullName}
          empCode={row.empCode}
          note={row.department ?? undefined}
        />
      ),
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => (
        <span className="whitespace-nowrap">
          <span className="num">{formatDateShort(row.date)}</span>
          <span className="ml-1.5 text-[11px] text-ink-3">
            {weekdayOf(row.date)}
          </span>
        </span>
      ),
    },
    {
      key: 'dayType',
      header: 'Day',
      render: (row) => (
        <Pill muted={row.dayType !== 'workday'}>
          {DAY_TYPE_LABEL[row.dayType]}
        </Pill>
      ),
    },
    {
      key: 'worked',
      header: 'Worked',
      align: 'right',
      render: (row) => <Hours hours={row.workedHours} />,
    },
    {
      // ⚠️ ধূসর — idle সময় **গোনা হয়নি**। কালোয় দেখালে মনে হতো এটাও
      //    কাজের ঘণ্টার সাথে যোগ হয়েছে।
      key: 'idle',
      header: 'Idle',
      align: 'right',
      render: (row) => <Hours hours={row.idleHours} tone="muted" />,
    },
    {
      key: 'adjustment',
      header: 'Adjustment',
      align: 'right',
      render: (row) => <SignedHours hours={row.adjustmentHours} />,
    },
    {
      // ⭐ এই কলামটাই আসল — worked + adjustment, টার্গেটের সাথে এটাই মেলে
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
    /**
     * ⭐⭐ **আজ কতগুলো ডিজাইন শেষ হয়েছে** *(২৩ আগস্ট ২০২৬)* —
     * "kon designer daily koyta design korche seta kothay dekhote pab?"
     *
     * ⚠️⚠️ সংখ্যাটা Excel-এ আগে থেকেই ছিল, কিন্তু **পর্দায় ছিল না** —
     * অর্থাৎ দেখতে হলে ফাইল নামাতে হতো।
     *
     * ⚠️ এক সময় এখানে দুটো কলাম ছিল (Opened ও Finished)। **"খোলা"টা তুলে
     * দেওয়া হয়েছে** *(মালিকের সিদ্ধান্ত, ২৩ আগস্ট)* — ওই গণনা "যে বানায়"
     * আর "যে দেখে" দুজনকে আলাদা করতে পারত না।
     *
     * ⚠️ ০ হলে ঘর **খালি**, "০" নয় — ডিজাইন-বহির্ভূত কর্মীর সারিতে ০
     * লেখা মানে "মেপে শূন্য পাওয়া গেছে", আর সেটা মিথ্যা হতো।
     */
    {
      key: 'designs',
      header: 'Designs',
      align: 'right',
      render: (row) =>
        row.designsDone === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          // ⭐ সবুজ — এটাই একমাত্র সংখ্যা যেটা "কাজ শেষ" বোঝায়
          <span className="num font-medium text-ok">{row.designsDone}</span>
        ),
    },
  ];

  return (
    <>
      <StatRow>
        <Stat label="Staff" value={formatCount(totals.employees)} />
        <Stat label="Rows" value={formatCount(totals.rows)} />
        <Stat label="Days with work" value={formatCount(totals.daysWithWork)} />
        <Stat
          label="Total worked"
          value={<Hours hours={totals.workedHours} />}
        />
        <Stat
          label="Total counted"
          value={<Hours hours={totals.creditedHours} />}
        />
        {/*
          ⚠️⚠️ লেবেলে "days listed" — সংখ্যাটা নিচের Target কলামের যোগফল,
          "এ পর্যন্ত কত হওয়ার কথা ছিল" নয়। এখানে ট্র্যাকিং শুরুর আগের দিন
          আর আজকের অসমাপ্ত দিনও আছে, তাই এটাকে Total counted-এর পাশে রেখে
          বিয়োগ করলে যে ঘাটতি বেরোয় সেটা মিথ্যে। প্রত্যাশা আসে
          `meta.expectedHours` থেকে, আর সেটা Monthly পাতা দেখায়।
        */}
        <Stat
          label="Total target · days listed"
          value={<Hours hours={totals.targetHours} />}
          tone="muted"
        />
      </StatRow>

      <div className="mt-4">
        <Card title="Day by Day" padded={false}>
          <Table
            columns={columns}
            rows={shown}
            // ⚠️ একজন কর্মীর একাধিক দিন আসে, তাই কী-তে দুটোই লাগে —
            //    শুধু employeeId দিলে React সারিগুলো গুলিয়ে ফেলত।
            rowKey={(row) => `${row.employeeId}-${row.date}`}
            rowMuted={(row) => row.status === 'no_activity'}
            footer={
              <tr>
                <td className="px-3 py-2" colSpan={3}>
                  Total
                </td>
                <td className="num px-3 py-2 text-right">
                  <Hours hours={totals.workedHours} />
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="num px-3 py-2 text-right">
                  <Hours hours={totals.creditedHours} />
                </td>
                <td className="num px-3 py-2 text-right">
                  <Hours hours={totals.targetHours} tone="muted" />
                </td>
              </tr>
            }
          />
          {data.rows.length > shown.length && (
            <TrimmedNote total={data.rows.length} />
          )}
        </Card>
      </div>

      <MetaNote meta={data.meta} />
    </>
  );
}
