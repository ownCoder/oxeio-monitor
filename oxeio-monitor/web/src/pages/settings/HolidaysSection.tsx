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
  { value: 'public', label: 'সরকারি' },
  { value: 'optional', label: 'ঐচ্ছিক' },
  { value: 'company', label: 'কোম্পানির' },
];

const TYPE_LABEL: Record<string, string> = {
  public: 'সরকারি',
  optional: 'ঐচ্ছিক',
  company: 'কোম্পানির',
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
      header: 'তারিখ',
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
      header: 'নাম',
      render: (holiday) => holiday.name,
    },
    {
      key: 'type',
      header: 'ধরন',
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
          <MiniButton onClick={() => setEditing(holiday)}>সম্পাদনা</MiniButton>
          <MiniButton tone="danger" onClick={() => setRemoving(holiday)}>
            মুছুন
          </MiniButton>
        </RowActions>
      ),
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">ছুটি</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            ছুটির দিন বাদ দিয়েই মাসের কর্মদিবস গোনা হয়
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
            <span className="mb-1 block text-[11.5px] text-ink-3">বছর</span>
            <div className="flex items-center gap-1">
              <YearArrow
                label="আগের বছর"
                disabled={year <= 2000}
                onClick={() => setYear((y) => y - 1)}
              >
                ◀
              </YearArrow>
              <span className="num min-w-16 rounded-md border border-line bg-surface px-2.5 py-1.5 text-center text-[13px]">
                {year}
              </span>
              <YearArrow
                label="পরের বছর"
                disabled={year >= 2100}
                onClick={() => setYear((y) => y + 1)}
              >
                ▶
              </YearArrow>
            </div>
          </div>

          <Button tone="primary" onClick={() => setCreating(true)}>
            ছুটি যোগ করুন
          </Button>
        </div>
      </div>

      {holidays.loading && !holidays.data && <Loading />}
      {holidays.error && (
        <ErrorBox error={holidays.error} retry={holidays.reload} />
      )}

      {!holidays.loading && !holidays.error && rows.length === 0 && (
        <Empty
          title={`${year} সালে কোনো ছুটি বসানো নেই`}
          hint="ছুটি না বসালে সব দিনই কর্মদিবস ধরা হবে, ফলে মাসের pace সবার জন্যই কঠিন দেখাবে। বছরের শুরুতেই সরকারি ছুটিগুলো বসিয়ে নেওয়া ভালো।"
          action={
            <Button tone="primary" onClick={() => setCreating(true)}>
              ছুটি যোগ করুন
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <Card padded={false} title={`${year} · ${rows.length} দিন`}>
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

  // ⚠️ `weekdayOf()` অচেনা তারিখে `''` দেয় — সরাসরি জুড়ে দিলে শিরোনামের
  //    নিচে নিছক "বার" লেখা বসত
  const weekday = weekdayOf(holidayDate);

  return (
    <Modal
      title={holiday ? 'ছুটি সম্পাদনা' : 'নতুন ছুটি'}
      hint={weekday ? `${weekday}বার` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            বাতিল
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
            {busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <TextField
            label="তারিখ"
            type="date"
            value={holidayDate}
            onChange={setHolidayDate}
            required
            mono
            hint="⚠️ ভবিষ্যতের ছুটিও বসানো যায় — বছরের শুরুতেই সব বসিয়ে নেওয়াই নিয়ম"
          />
          <SelectField
            label="ধরন"
            value={type}
            onChange={setType}
            options={TYPE_OPTIONS}
          />
          <TextField
            label="নাম"
            value={name}
            onChange={setName}
            required
            autoFocus
            maxLength={120}
            placeholder="বিজয় দিবস"
          />
        </FormGrid>

        <Notice>
          ছুটি যোগ করলে ওই মাসের কর্মদিবস কমে যায়, ফলে সবার pace একটু সহজ হয়।
          সংখ্যাটা তখনই বদলে যাবে — কেউ বাড়তি কাজ না করেও।
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
      title={`"${holiday.name}" মুছবেন?`}
      intro={`${formatDate(holiday.holidayDate)} · ${weekdayOf(holiday.holidayDate)}বার`}
      warning="ছুটি মুছলে ওই মাসের কর্মদিবস বেড়ে যায় — ফলে সবার pace পিছিয়ে যাবে, কেউ এক মিনিট কম কাজ না করেও। মাসের রিপোর্ট ইতিমধ্যে কেউ দেখে থাকলে সংখ্যাগুলো আর মিলবে না।"
      confirmLabel="মুছে ফেলুন"
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
