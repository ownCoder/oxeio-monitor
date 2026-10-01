import { useMemo, useState, type FormEvent } from 'react';

import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { getSalaryOverview, recordSalaryPayment, type PaymentStatus, type SalaryRow } from '../api/salary';
import { useApi } from '../api/useApi';
import { Card } from '../components/Card';
import { MonthPicker } from '../components/DatePicker';
import { Button, Page } from '../components/Page';
import { Caveat, ErrorBox, Loading } from '../components/States';
import { formatDate, formatMonth, formatTaka, todayInDhaka } from '../lib/format';

const statusLabel: Record<PaymentStatus, string> = {
  not_recorded: 'Not recorded',
  unpaid: 'Unpaid',
  partial: 'Partial',
  paid: 'Paid',
};

function PaymentEditor({
  row, month, onSaved, onCancel,
}: {
  row: SalaryRow;
  month: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<'unpaid' | 'partial' | 'paid'>(
    row.payment.status === 'not_recorded' ? (row.netPayable !== null ? 'paid' : 'unpaid') : row.payment.status,
  );
  const [amount, setAmount] = useState(row.payment.paidAmount ?? row.netPayable ?? '0.00');
  const [paidOn, setPaidOn] = useState(row.payment.paidOn ?? todayInDhaka());
  const [note, setNote] = useState(row.payment.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const changeStatus = (next: 'unpaid' | 'partial' | 'paid') => {
    setStatus(next);
    if (next === 'paid') setAmount(row.netPayable ?? '0.00');
    if (next === 'unpaid') setAmount('0.00');
    if (next === 'partial') setAmount(row.payment.status === 'partial' ? row.payment.paidAmount ?? '' : '');
    setError(null);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await recordSalaryPayment(month, row.employeeId, {
        status,
        paidAmount: status === 'paid' ? row.netPayable ?? '0.00' : status === 'unpaid' ? '0.00' : amount,
        paidOn: status === 'unpaid' ? undefined : paidOn,
        note: note.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Could not save payment status'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Record payment · ${row.fullName}`} hint={`For ${formatMonth(month)}. This records a status; it does not send money.`}>
      <form onSubmit={save} className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-ink-3">Status
            <select className="mt-1 block rounded-md border border-line bg-surface px-2.5 py-2 text-ink" value={status}
              onChange={event => changeStatus(event.target.value as 'unpaid' | 'partial' | 'paid')}>
              <option value="unpaid">Unpaid</option>
              <option value="partial" disabled={row.netPayable === null}>Partial</option>
              <option value="paid" disabled={row.netPayable === null}>Paid</option>
            </select>
          </label>
          {status !== 'unpaid' && (
            <>
              <label className="text-xs text-ink-3">Paid amount (৳)
                <input className="mt-1 block w-36 rounded-md border border-line bg-surface px-2.5 py-2 text-ink" type="number"
                  min="0" step="0.01" value={status === 'paid' ? row.netPayable ?? '0.00' : amount}
                  readOnly={status === 'paid'} onChange={event => setAmount(event.target.value)} required />
              </label>
              <label className="text-xs text-ink-3">Payment date
                <input className="mt-1 block rounded-md border border-line bg-surface px-2.5 py-2 text-ink" type="date"
                  max={todayInDhaka()} value={paidOn} onChange={event => setPaidOn(event.target.value)} required />
              </label>
            </>
          )}
        </div>
        <label className="block text-xs text-ink-3">Note or reference (optional)
          <input className="mt-1 block w-full rounded-md border border-line bg-surface px-2.5 py-2 text-ink" maxLength={500}
            value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. bank transfer reference" />
        </label>
        {error && <ErrorBox error={error} />}
        <div className="flex gap-2">
          <Button type="submit" tone="primary" disabled={busy || (status !== 'unpaid' && row.netPayable === null)}>
            {busy ? 'Saving…' : 'Save status'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export function SalaryPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(todayInDhaka().slice(0, 7));
  const [filter, setFilter] = useState<PaymentStatus | 'all'>('all');
  const [editing, setEditing] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const { data, error, loading, reload } = useApi(signal => getSalaryOverview(month, signal), [month]);
  const rows = useMemo(() => data?.rows.filter(row => filter === 'all' || row.payment.status === filter) ?? [], [data, filter]);

  if (user?.role !== 'owner') {
    return <Page title="Salary"><ErrorBox error={new ApiError(403, "You don't have access")} /></Page>;
  }

  return (
    <Page title="Salary" subtitle="Monthly salaries and payment status · owner only"
      actions={<MonthPicker value={month} onChange={next => { setMonth(next); setEditing(null); setSaved(false); }} />}>
      {loading && !data ? <Loading label="Loading salaries…" /> : error ? <ErrorBox error={error} retry={reload} /> : data && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs text-ink-2">
            <span className="rounded-md border border-line bg-surface px-3 py-2">{data.rows.length} staff</span>
            <span className="rounded-md border border-line bg-surface px-3 py-2">Scheduled payday · {formatDate(data.dueOn)}</span>
            {(['not_recorded', 'unpaid', 'partial', 'paid'] as const).map(status => (
              <span key={status} className="rounded-md border border-line bg-surface px-3 py-2">
                {statusLabel[status]}: {data.rows.filter(row => row.payment.status === status).length}
              </span>
            ))}
          </div>
          {!data.closed && <Caveat>Month is open. Net payable may still change. Confirm the amount before recording a payment; the row will flag any later difference.</Caveat>}
          {data.dueOn < todayInDhaka() && data.rows.some(row => row.payment.status !== 'paid') &&
            <Caveat>Scheduled payday has passed. Check actual payments and record their status; an unrecorded payment is not automatically marked unpaid.</Caveat>}
          {data.missingSummary.length > 0 && <Caveat>Net payable is not calculated for: {data.missingSummary.join(', ')}. Their salary remains visible, but payment cannot be marked Paid yet.</Caveat>}
          {data.approximateHolidayDates.length > 0 && <Caveat>Some holiday dates are approximate. Confirm the payroll figures before recording payments.</Caveat>}
          {saved && <p className="text-sm text-ink-2" role="status">Payment status saved and audit logged.</p>}
          <Card title={`${formatMonth(month)} · all staff salaries`} actions={
            <label className="text-xs text-ink-3">Show
              <select className="ml-2 rounded-md border border-line bg-surface px-2 py-1.5 text-ink" value={filter}
                onChange={event => setFilter(event.target.value as PaymentStatus | 'all')}>
                <option value="all">All statuses</option>
                {(['not_recorded', 'unpaid', 'partial', 'paid'] as const).map(status => <option key={status} value={status}>{statusLabel[status]}</option>)}
              </select>
            </label>
          } padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line bg-paper text-xs text-ink-3"><tr>
                  <th className="px-4 py-3">Staff</th><th className="px-4 py-3">Monthly salary</th>
                  <th className="px-4 py-3">Net payable</th><th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Paid amount / date</th><th className="px-4 py-3">Action</th>
                </tr></thead>
                <tbody>{rows.map(row => {
                  const changed = row.payment.netPayableAtRecord !== null && row.netPayable !== row.payment.netPayableAtRecord;
                  return <tr key={row.employeeId} className="border-b border-line align-top">
                    <td className="px-4 py-3"><b>{row.fullName}</b><div className="text-xs text-ink-3">{row.empCode}</div></td>
                    <td className="num px-4 py-3">{formatTaka(row.monthlySalary)}</td>
                    <td className="num px-4 py-3">{formatTaka(row.netPayable)}</td>
                    <td className="px-4 py-3"><span className="rounded-full border border-line px-2 py-1 text-xs">{statusLabel[row.payment.status]}</span>
                      {changed && <div className="mt-2 text-xs text-attention">Payable changed since status was recorded. Review this row.</div>}
                    </td>
                    <td className="px-4 py-3">{row.payment.paidAmount === null ? '—' : formatTaka(row.payment.paidAmount)}
                      {row.payment.paidOn && <div className="text-xs text-ink-3">{formatDate(row.payment.paidOn)}</div>}
                      {row.payment.note && <div className="max-w-52 break-words text-xs text-ink-3">{row.payment.note}</div>}
                    </td>
                    <td className="px-4 py-3"><Button onClick={() => { setEditing(row.employeeId); setSaved(false); }}>Record / edit</Button></td>
                  </tr>;
                })}</tbody>
              </table>
              {rows.length === 0 && <p className="p-4 text-sm text-ink-3">No staff match this status.</p>}
            </div>
          </Card>
          {editing !== null && data.rows.find(row => row.employeeId === editing) && (
            <PaymentEditor key={`${month}-${editing}`} row={data.rows.find(row => row.employeeId === editing)!} month={month}
              onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved(true); reload(); }} />
          )}
          <p className="text-xs text-ink-3">Salary for this month is scheduled on the 5th of the following month. Payment status is a manual record, not a bank transfer. No record means the historical status is unknown. Every view and change is audit logged.</p>
        </div>
      )}
    </Page>
  );
}
