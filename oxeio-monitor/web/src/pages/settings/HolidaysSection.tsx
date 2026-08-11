import { useState } from 'react';

import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  updateHoliday,
  type HolidayView,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Button } from '../../components/Page';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { Table, type Column } from '../../components/Table';
import { formatDate, todayInDhaka, weekdayOf } from '../../lib/format';
import {
  Chip,
  ConfirmDialog,
  FormGrid,
  MiniButton,
  Modal,
  Notice,
  RowActions,
  SelectField,
  ServerError,
  TextField,
  useMutation,
} from './ui';

/**
 * ছুটি — `CRUD /holidays`।
 *
 * ⚠️ পুরো E10-এ এটাই একমাত্র সত্যিকারের DELETE, আর সেটা নিরীহ নয়: ছুটি
 * মুছলে ওই মাসের কর্মদিবস বেড়ে যায়, ফলে **সবার pace পিছিয়ে যায়** — কেউ
 * কোনো কাজ না করেও। তাই নিশ্চিত করার বাক্সে কথাটা স্পষ্ট লেখা।
 */

const TYPE_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'optional', label: 'Optional' },
  { value: 'company', label: 'Company' },
];

const TYPE_LABEL: Record<string, string> = {
  public: 'Public',
  optional: 'Optional',
  company: 'Company',
};

export function HolidaysSection() {
  const thisYear = Number(todayInDhaka().slice(0, 4));
  const [year, setYear] = useState(thisYear);

  const holidays = useApi((signal) => listHolidays(year, signal), [year]);

  const [editing, setEditing] = useState<HolidayView | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<HolidayView | null>(null);

  const rows = holidays.data?.rows ?? [];

  const columns: Column<HolidayView>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (holiday) => (
        <span className="num">
          {formatDate(holiday.holidayDate)}
          <small className="ml-1.5 text-[11px] text-ink-3">
            {weekdayOf(holiday.holidayDate)}
          </small>
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      render: (holiday) => holiday.name,
    },
    {
      key: 'type',
      header: 'Type',
      render: (holiday) => (
        <Chip>{TYPE_LABEL[holiday.type] ?? holiday.type}</Chip>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (holiday) => (
        <RowActions>
          <MiniButton onClick={() => setEditing(holiday)}>Edit</MiniButton>
          <MiniButton tone="danger" onClick={() => setRemoving(holiday)}>
            Delete
          </MiniButton>
        </RowActions>
      ),
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Holidays
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Workdays for the month are counted with these days taken out
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {/*
            ⚠️ সংখ্যার ইনপুট বাক্স নয়, ◀ ▶ — কারণ বাক্সটা controlled রাখলে
               "2026" মুছে "2027" টাইপ করার মাঝপথে ("2", "20") মানটা সীমার
               বাইরে পড়ত, state বদলাত না, আর কার্সারের নিচে বছরটা লাফিয়ে
               আগেরটায় ফিরে যেত। বছর বদলানো এমনিতেই এক-দুই ধাপের কাজ।
          */}
          <div>
            <span className="mb-1 block text-[11.5px] text-ink-3">Year</span>
            <div className="flex items-center gap-1">
              <YearArrow
                label="Previous year"
                disabled={year <= 2000}
                onClick={() => setYear((y) => y - 1)}
              >
                ◀
              </YearArrow>
              <span className="num min-w-16 rounded-md border border-line bg-surface px-2.5 py-1.5 text-center text-[13px]">
                {year}
              </span>
              <YearArrow
                label="Next year"
                disabled={year >= 2100}
                onClick={() => setYear((y) => y + 1)}
              >
                ▶
              </YearArrow>
            </div>
          </div>

          <Button tone="primary" onClick={() => setCreating(true)}>
            Add holiday
          </Button>
        </div>
      </div>

      {holidays.loading && !holidays.data && <Loading />}
      {holidays.error && (
        <ErrorBox error={holidays.error} retry={holidays.reload} />
      )}

      {!holidays.loading && !holidays.error && rows.length === 0 && (
        <Empty
          title={`No holidays are set for ${year}`}
          hint="With no holidays every day counts as a workday, which makes the month's pace look harsh for everyone. It is best to enter the public holidays at the start of the year."
          action={
            <Button tone="primary" onClick={() => setCreating(true)}>
              Add holiday
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <Card padded={false} title={`${year} · ${rows.length} days`}>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(holiday) => String(holiday.id)}
          />
        </Card>
      )}

      {(creating || editing) && (
        <HolidayForm
          key={editing?.id ?? 'new'}
          holiday={editing}
          defaultYear={year}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            holidays.reload();
          }}
        />
      )}

      {removing && (
        <RemoveHolidayDialog
          holiday={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            holidays.reload();
          }}
        />
      )}
    </section>
  );
}

function YearArrow({
  children,
  label,
  onClick,
  disabled,
}: {
  children: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-ink-2 transition hover:border-brand hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function HolidayForm({
  holiday,
  defaultYear,
  onClose,
  onSaved,
}: {
  holiday: HolidayView | null;
  defaultYear: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [holidayDate, setHolidayDate] = useState(
    holiday?.holidayDate ?? `${defaultYear}-01-01`,
  );
  const [name, setName] = useState(holiday?.name ?? '');
  const [type, setType] = useState(holiday?.type ?? 'public');

  const { busy, error, run } = useMutation();

  // ⚠️ `weekdayOf()` অচেনা তারিখে `''` দেয় — তাই ফাঁকা হলে hint বসানোই
  //    হয় না, নইলে শিরোনামের নিচে একটা শূন্য লাইন ঝুলে থাকত।
  // ⚠️ আগে এর সাথে "বার" প্রত্যয় জোড়া হতো; ইংরেজি UI-তে বারের নামটাই
  //    যথেষ্ট, আর `format.ts` ইংরেজিতে গেলে "Monবার" হয়ে যেত।
  const weekday = weekdayOf(holidayDate);

  return (
    <Modal
      title={holiday ? 'Edit holiday' : 'New holiday'}
      hint={weekday === '' ? undefined : weekday}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || name.trim() === '' || holidayDate === ''}
            onClick={() =>
              run(async () => {
                if (holiday) {
                  await updateHoliday(holiday.id, {
                    holidayDate,
                    name: name.trim(),
                    type,
                  });
                } else {
                  await createHoliday({
                    holidayDate,
                    name: name.trim(),
                    type,
                  });
                }
                onSaved();
              })
            }
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <TextField
            label="Date"
            type="date"
            value={holidayDate}
            onChange={setHolidayDate}
            required
            mono
            hint="Future holidays can be entered too — entering the whole year up front is the norm"
          />
          <SelectField
            label="Type"
            value={type}
            onChange={setType}
            options={TYPE_OPTIONS}
          />
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            required
            autoFocus
            maxLength={120}
            placeholder="Victory Day"
          />
        </FormGrid>

        <Notice>
          Adding a holiday lowers the workday count for that month, so everyone's
          pace gets a little easier. The numbers move the moment you save it —
          without anyone working an extra minute.
        </Notice>

        <ServerError error={error} />
      </div>
    </Modal>
  );
}

function RemoveHolidayDialog({
  holiday,
  onClose,
  onDone,
}: {
  holiday: HolidayView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();

  return (
    <ConfirmDialog
      title={`Delete "${holiday.name}"?`}
      intro={`${formatDate(holiday.holidayDate)} · ${weekdayOf(holiday.holidayDate)}`}
      warning="Deleting a holiday raises the workday count for that month — everyone falls behind on pace without working a minute less. If anyone has already read the monthly report, the numbers will no longer match."
      confirmLabel="Delete"
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        run(async () => {
          await deleteHoliday(holiday.id);
          onDone();
        })
      }
    />
  );
}
