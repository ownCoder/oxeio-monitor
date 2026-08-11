import { getPayroll, type PayrollRow } from '../../api/reports';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Hours } from '../../components/Duration';
import { ProgressBar } from '../../components/ProgressRing';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import { PersonCell, Table, type Column } from '../../components/Table';
import { formatMonth, formatTaka, hoursToSeconds } from '../../lib/format';

/**
 * F03 — মাসিক পে-রোল ঘণ্টা শিট। **owner-only**।
 *
 * ⭐⚠️ এই কম্পোনেন্টটা ম্যানেজারের পর্দায় কখনো render হয় না — `ReportsPage`
 *    ট্যাবটাই বানায় না (`user.role === 'owner'` না হলে)। ৪০৩ দেখিয়ে আটকানো
 *    যথেষ্ট নয়: তাহলে "পে-রোল" নামের একটা ট্যাব দেখা যেত, আর **বেতনের
 *    ব্যবস্থাটা যে আছে সেটাই** জানা হয়ে যেত (§ ৪.৩, ADR-023)।
 *
 * ⚠️ প্রতিটা কল সার্ভারে audit-এ লেখা হয় (`payroll_view`) — তাই অকারণে
 *    বারবার fetch করা হয় না, আর `useApi` মাস বদলালেই কেবল আবার আনে।
 *
 * ⚠️ সব ঘণ্টা ও টাকা **স্ট্রিং** (Decimal)। `Number()` করে যোগ-বিয়োগ করা
 *    হয় না — `formatTaka()` শুধু কমা বসায়, নইলে ১৩০০০.১০ পর্দায়
 *    ১৩০০০.০৯৯৯… হয়ে যেত।
 */
export function PayrollTab({ month }: { month: string }) {
  const { data, error, loading, reload } = useApi(
    (signal) => getPayroll(month, signal),
    [month],
  );

  if (loading && !data) return <Loading label="Loading payroll…" />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  if (!data || data.rows.length === 0) {
    return (
      <Empty
        title={`No rows for ${formatMonth(month)}`}
        hint={
          data && data.missingSummary.length > 0
            ? `The monthly figures for these ${data.missingSummary.length} are not built yet: ${data.missingSummary.join(', ')}. The rows appear once the month ends or the nightly rollup runs.`
            : 'The monthly figures for that month are not built yet. Try an earlier month.'
        }
      />
    );
  }

  const columns: Column<PayrollRow>[] = [
    {
      key: 'person',
      header: 'Staff',
      render: (row) => (
        <PersonCell
          fullName={row.fullName}
          empCode={row.empCode}
          note={row.designation ?? undefined}
        />
      ),
    },
    {
      key: 'target',
      header: 'Target',
      align: 'right',
      render: (row) => <Hours hours={row.targetHours} tone="muted" />,
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
      key: 'shortfall',
      header: 'Shortfall',
      align: 'right',
      render: (row) =>
        Number(row.shortfallHours) > 0 ? (
          <span className="font-semibold text-brand-ink">
            <Hours hours={row.shortfallHours} />
          </span>
        ) : (
          <span className="num text-ink-3">—</span>
        ),
    },
    {
      /**
       * ⚠️⚠️ এই কলামে **কেবল ঘণ্টা** — কোনো টাকা নয়। OT-র হার নির্ধারিত
       *    হয়নি (O4), তাই সার্ভারও কোনো অঙ্ক পাঠায় না। এখানে নিজে থেকে
       *    "× ১.৫" বসিয়ে দিলে সেটাই নীরবে কোম্পানির নীতি হয়ে যেত।
       */
      key: 'overtime',
      header: 'Overtime',
      align: 'right',
      render: (row) =>
        Number(row.overtimeHours) > 0 ? (
          <Hours hours={row.overtimeHours} />
        ) : (
          <span className="num text-ink-3">—</span>
        ),
    },
    {
      key: 'salary',
      header: 'Monthly salary',
      align: 'right',
      // ⚠️ `null` = বেতন **বসানো নেই**, শূন্য নয়। `—` লিখলে দুটো এক দেখাত,
      //    আর তখন কারো বেতন বসাতে ভুলে যাওয়া ধরাই পড়ত না।
      render: (row) =>
        row.monthlySalary === null ? (
          <span className="text-[11.5px] text-ink-3">Not set</span>
        ) : (
          <span className="num">{formatTaka(row.monthlySalary)}</span>
        ),
    },
    {
      key: 'rate',
      header: 'Hourly rate',
      align: 'right',
      render: (row) => (
        <span className="num text-ink-3">{formatTaka(row.hourlyRate)}</span>
      ),
    },
    {
      key: 'deduction',
      header: 'Deduction',
      align: 'right',
      render: (row) =>
        row.deduction !== null && Number(row.deduction) > 0 ? (
          <span className="num text-brand-ink">{formatTaka(row.deduction)}</span>
        ) : (
          <span className="num text-ink-3">{formatTaka(row.deduction)}</span>
        ),
    },
    {
      key: 'payable',
      header: 'Payable',
      align: 'right',
      render: (row) => (
        <span className="num font-semibold">{formatTaka(row.payable)}</span>
      ),
    },
  ];

  return (
    <>
      <Card
        title={`Payroll hours · ${formatMonth(month)}`}
        hint="Deduction = salary × shortfall ÷ target. Every view of this sheet is written to the audit log."
        padded={false}
      >
        <Table
          columns={columns}
          rows={data.rows}
          rowKey={(row) => String(row.employeeId)}
          rowMuted={(row) => row.monthlySalary === null}
        />
      </Card>

      {/* ⭐ O4 — সার্ভারের `payroll.math.ts`-ও ঠিক এই কথাটাই বলে */}
      <Caveat>
        No money is calculated for overtime — the rate is still undecided (open
        question O4). “Payable” above is only the salary minus the shortfall
        deduction.
      </Caveat>

      {data.missingSalary.length > 0 && (
        <Caveat>
          These <span className="num">{data.missingSalary.length}</span> have no
          salary on file, so no deduction or payable could be worked out for
          them (they are not treated as zero): {data.missingSalary.join(', ')}
        </Caveat>
      )}

      {data.missingSummary.length > 0 && (
        <Caveat>
          These <span className="num">{data.missingSummary.length}</span> have
          no figures for that month yet, so they are <b>not</b> in the table
          above: {data.missingSummary.join(', ')}
        </Caveat>
      )}
    </>
  );
}
