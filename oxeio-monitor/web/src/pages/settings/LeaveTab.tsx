import { useState } from 'react';

import {
  createLeave,
  deleteLeave,
  listEmployees,
  listLeaves,
  type LeaveView,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import { formatDate } from '../../lib/format';
import {
  ConfirmDialog,
  FormGrid,
  FullWidth,
  MiniButton,
  Modal,
  Notice,
  RowActions,
  SelectField,
  ServerError,
  TextField,
  orUndefined,
  useMutation,
} from './ui';

/** ⚠️ তিনটেই সবেতন — `unpaid` কেন নেই, `schema.prisma`-র নোট দেখুন */
const TYPES = [
  { value: 'casual', label: 'Casual' },
  { value: 'sick', label: 'Sick' },
  { value: 'annual', label: 'Annual' },
] as const;

/**
 * ⭐⭐ **R2 — ছুটির খাতা।**
 *
 * ⚠️⚠️ যে সমস্যাটা এটা সারায়: ছুটির খাতা ছাড়া অনুপস্থিতি আর ছুটির মধ্যে
 * সিস্টেমের কোনো পার্থক্য ছিল না। যিনি অনুমতি নিয়ে ছুটি কাটালেন, তাঁর
 * ওই দিনগুলো পুরো আট ঘণ্টার ঘাটতি হয়ে মাসের pace-এ বসত — অর্থাৎ সংখ্যাটা
 * তাঁর নামে এমন একটা ব্যর্থতার দাবি করত যা ঘটেইনি।
 *
 * ⭐⭐ **ছুটি সবেতন।** ওই দিনের আট ঘণ্টা টার্গেট থেকে বাদ যায়, কিন্তু
 * পে-রোলের ভগ্নাংশ `d ÷ D` **অটুট**। এই বিচ্ছেদটা কোডে তিন জায়গায়
 * পাহারা দেওয়া, আর নিচের ব্যাখ্যাটা পর্দাতেও থাকে — নইলে ছুটি লিখতে
 * গিয়ে কেউ ভাবতেন বেতন কাটছেন।
 */
export function LeaveTab() {
  const [month, setMonth] = useState(currentMonth);

  const { data, error, loading, reload } = useApi(
    (signal) => listLeaves(month, signal),
    [month],
  );
  const staff = useApi(
    (signal) => listEmployees({ status: 'active' }, signal),
    [],
  );
  const mutation = useMutation();

  const [adding, setAdding] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [removing, setRemoving] = useState<LeaveView | null>(null);

  return (
    <>
      <ServerError error={mutation.error} />

      <Card
        title="Leave"
        hint="Days off that were agreed — not absences"
        padded={false}
        actions={
          <RowActions>
            <input
              type="month"
              value={month}
              max={currentMonth()}
              onChange={(e) => setMonth(e.target.value || currentMonth())}
              className="tap rounded border border-line bg-surface px-2 py-1 text-[12px]"
              aria-label="Month"
            />
            <MiniButton
              disabled={!staff.data || staff.data.rows.length === 0}
              onClick={() => setAdding(true)}
            >
              Add leave
            </MiniButton>
          </RowActions>
        }
      >
        {loading && !data ? (
          <Loading label="Loading leave…" />
        ) : !data ? (
          <ErrorBox error={error} retry={reload} />
        ) : data.rows.length === 0 ? (
          <Empty
            title="No leave recorded for this month"
            hint="Anyone who was away on these dates counts as a full shortfall until it is written here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="num min-w-24 text-[13px] font-medium">
                  {formatDate(row.leaveDate)}
                </span>

                <span className="min-w-0 flex-1 text-[13px]">
                  {row.employeeName}
                  <span className="ml-2 text-[12px] text-ink-3">
                    {labelOf(row.type)}
                  </span>
                  {row.note && (
                    <span className="block text-[12px] text-ink-2">
                      {row.note}
                    </span>
                  )}
                  {/*
                    ⚠️⚠️ এই লাইনটাই এই পর্দার সবচেয়ে জরুরি অংশ। শুক্রবারে
                       বা সরকারি ছুটির দিনে লেখা একটা ছুটি টার্গেটের কিছুই
                       কমায় না, কিন্তু সারিটা খাতায় বসে থাকে। না লিখলে
                       মালিক ধরে নিতেন ওই দিনটা ছাড় পেয়েছে — আর সংখ্যা
                       দেখে সেটা যাচাই করার কোনো উপায় থাকত না।
                  */}
                  {!row.countsTowardTarget && (
                    <span className="block text-[12px] text-idle-ink">
                      Already a day off — this changes no target
                    </span>
                  )}
                </span>

                <RowActions>
                  <MiniButton tone="danger" onClick={() => setRemoving(row)}>
                    Remove
                  </MiniButton>
                </RowActions>
              </li>
            ))}
          </ul>
        )}

        <Caveat>
          Leave is paid. The hours target for those days is removed, so nobody
          shows a shortfall for being away — but the payroll fraction (days
          employed ÷ days in the month) does not change, so the salary is the
          same. A month that has been closed refuses new leave; reopen it first.
        </Caveat>
      </Card>

      {adding && staff.data && (
        <AddLeave
          skipped={skipped}
          staff={staff.data.rows.map((e) => ({
            value: String(e.id),
            label: `${e.fullName} (${e.empCode})`,
          }))}
          month={month}
          busy={mutation.busy}
          onClose={() => {
            setAdding(false);
            setSkipped([]);
          }}
          /**
           * ⚠️ `mutation.run` কিছু ফেরায় না, তাই `skipped` ওর ভেতর দিয়ে
           *    বের করা যায় না — বাদ পড়া দিনগুলো এখানেই ধরে রাখা হয়, আর
           *    সেগুলো থাকলে মোডালটা **খোলাই থাকে**। বন্ধ করে দিলে "কোন
           *    দিনগুলো বসেনি" প্রশ্নের উত্তর আর কোথাও থাকত না।
           */
          onSubmit={(body) =>
            mutation.run(async () => {
              const result = await createLeave(body);
              setSkipped(result.skipped);
              if (result.skipped.length === 0) setAdding(false);
              reload();
            })
          }
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove this leave day?"
          intro={
            <>
              {formatDate(removing.leaveDate)} · {removing.employeeName}
            </>
          }
          warning={
            removing.countsTowardTarget
              ? "That day's target comes back, so the month will show it as a shortfall again unless it was worked."
              : 'That day was already a day off, so no target changes.'
          }
          confirmLabel="Remove"
          busy={mutation.busy}
          error={mutation.error}
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            mutation.run(async () => {
              await deleteLeave(removing.id);
              setRemoving(null);
              reload();
            })
          }
        />
      )}
    </>
  );
}

function AddLeave({
  staff,
  month,
  busy,
  skipped,
  onClose,
  onSubmit,
}: {
  staff: { value: string; label: string }[];
  month: string;
  busy: boolean;
  /** আগে থেকেই খাতায় ছিল বলে যে দিনগুলো বসেনি */
  skipped: string[];
  onClose: () => void;
  onSubmit: (body: {
    employeeId: number;
    from: string;
    to: string;
    type: string;
    note?: string;
  }) => void;
}) {
  const [employeeId, setEmployeeId] = useState(staff[0]?.value ?? '');
  const [from, setFrom] = useState(`${month}-01`);
  const [to, setTo] = useState(`${month}-01`);
  const [type, setType] = useState<string>('casual');
  const [note, setNote] = useState('');

  /**
   * ⚠️ শেষ তারিখ শুরুর আগে হলে সার্ভার ৪০০ ফেরাবে, কিন্তু বোতামটা তার
   *    আগেই নিষ্ক্রিয় — একটা দেয়ালে পাঠানোর চেয়ে দেখিয়ে দেওয়াই ভালো।
   */
  const backwards = from !== '' && to !== '' && to < from;

  return (
    <Modal title="Add leave" onClose={onClose}>
      {/*
        ⚠️ `skipped` চুপচাপ গিলে ফেলা যাবে না। আগে থেকেই খাতায় থাকা দিন
           যোগ হয় না, আর "যোগ হয়েছে" বলে মোডাল বন্ধ করে দিলে মালিক ভাবতেন
           পুরো রেঞ্জটাই বসেছে।
      */}
      {skipped.length > 0 && (
        <Notice tone="attention">
          {skipped.length} day{skipped.length === 1 ? '' : 's'} already had
          leave and {skipped.length === 1 ? 'was' : 'were'} left alone:{' '}
          {skipped.map((d) => formatDate(d)).join(', ')}
        </Notice>
      )}

      <FormGrid>
        <FullWidth>
          <SelectField
            label="Staff"
            value={employeeId}
            onChange={setEmployeeId}
            options={staff}
            required
          />
        </FullWidth>

        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(v) => {
            setFrom(v);
            // ⭐ একদিনের ছুটিই সবচেয়ে সাধারণ, তাই শেষ তারিখ সাথে চলে
            if (to === '' || to < v) setTo(v);
          }}
          required
        />

        <TextField label="To" type="date" value={to} onChange={setTo} required />

        <SelectField
          label="Type"
          value={type}
          onChange={setType}
          options={TYPES}
          hint="All three are paid"
        />

        <FullWidth>
          <TextField
            label="Note (optional)"
            value={note}
            onChange={setNote}
            placeholder="Family wedding"
            maxLength={280}
          />
        </FullWidth>
      </FormGrid>

      {backwards && (
        <Notice tone="attention">The end date is before the start date.</Notice>
      )}

      <RowActions>
        <MiniButton onClick={onClose}>Cancel</MiniButton>
        <MiniButton
          disabled={busy || employeeId === '' || from === '' || backwards}
          onClick={() => {
            onSubmit({
              employeeId: Number(employeeId),
              from,
              to,
              type,
              note: orUndefined(note),
            });
          }}
        >
          Add
        </MiniButton>
      </RowActions>
    </Modal>
  );
}

function labelOf(type: string): string {
  return TYPES.find((t) => t.value === type)?.label ?? type;
}

/** ⚠️ ঢাকার আজ, ব্রাউজারের নয় — `MonthsTab`-এর একই নোট দেখুন */
function currentMonth(): string {
  return new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 7);
}
