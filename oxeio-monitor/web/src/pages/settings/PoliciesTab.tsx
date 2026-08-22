import { useState } from 'react';

import {
  createWorkPolicy,
  deactivateWorkPolicy,
  listWorkPolicies,
  updateWorkPolicy,
  type WorkPolicyBody,
  type WorkPolicyView,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { useAuth } from '../../auth/AuthContext';
import { Card } from '../../components/Card';
import { Button } from '../../components/Page';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { Table, type Column } from '../../components/Table';
import { formatDuration } from '../../lib/format';
import { HolidaysSection } from './HolidaysSection';
import {
  Chip,
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
  useMutation,
} from './ui';

/**
 * work policy ও ছুটি — দুটো একসাথে, কারণ এরা একই প্রশ্নের উত্তর দেয়:
 * **এই মাসে কতটা কাজ প্রত্যাশিত?**
 *
 * ⚠️ এখানে একটা সংখ্যা বদলালে পরের config sync-এ **প্রতিটা PC-র আচরণ**
 * বদলে যায় (idle থ্রেশহোল্ড, ছবির উইন্ডো, স্লট)। আর টার্গেট বা ছুটি
 * বদলালে কেউ এক মিনিট কাজ না করেও পিছিয়ে বা এগিয়ে যায়।
 */

/** ISO দিন — সোম = ১ … রবি = ৭ (`weeklyOffDay`) */
const OFF_DAY_OPTIONS = [
  { value: '', label: 'None — every day is a workday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
];

const OFF_DAY_LABEL: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

/**
 * ⚠️ ম্যানেজার পান **শুধু ছুটির অংশটা** *(১৫ আগস্ট)*। `work_policies`
 * সার্ভারে owner-only থেকেই গেছে — মাসিক টার্গেট বা ছবির উইন্ডো বদলালে
 * প্রতিটা PC-র আচরণ বদলায়। উপরের সেকশনটা না লুকালে ম্যানেজার ট্যাব খুলেই
 * একটা ৪০৩ বাক্স দেখতেন, আর ভাবতেন কিছু ভেঙে আছে।
 */
export function PoliciesTab() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      {user?.role === 'owner' && <WorkPoliciesSection />}
      <HolidaysSection />
    </div>
  );
}

function WorkPoliciesSection() {
  const policies = useApi((signal) => listWorkPolicies(signal), []);

  const [editing, setEditing] = useState<WorkPolicyView | null>(null);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<WorkPolicyView | null>(null);

  const rows = policies.data?.rows ?? [];

  const columns: Column<WorkPolicyView>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (policy) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{policy.name}</div>
          <div className="num truncate text-[11px] text-ink-3">
            {policy.timezone}
          </div>
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Monthly target',
      align: 'right',
      render: (policy) => (
        <span className="num">
          {policy.monthlyTargetHours}
          <small className="ml-1 text-[11px] text-ink-3">h</small>
        </span>
      ),
    },
    {
      key: 'workdays',
      header: 'Workdays',
      align: 'right',
      render: (policy) => <span className="num">{policy.expectedWorkdays}</span>,
    },
    {
      key: 'off',
      header: 'Weekly off',
      render: (policy) =>
        policy.weeklyOffDay === null ? (
          <span className="text-ink-3">None</span>
        ) : (
          (OFF_DAY_LABEL[policy.weeklyOffDay] ?? String(policy.weeklyOffDay))
        ),
    },
    {
      key: 'office',
      header: 'Office hours',
      render: (policy) =>
        policy.officeFrom && policy.officeTo ? (
          <span className="num">
            {policy.officeFrom}–{policy.officeTo}
          </span>
        ) : (
          // ⚠️ "সারাদিন" মানে অ্যালার্ট কখনো চুপ থাকবে না — সেটা লুকোনো নয়
          <span className="text-ink-3">all day</span>
        ),
    },
    {
      key: 'window',
      header: 'Screenshot window',
      render: (policy) => (
        <span className="num">
          {policy.screenshotFrom ?? '07:00'}–{policy.screenshotTo ?? '23:00'}
        </span>
      ),
    },
    {
      key: 'idle',
      header: 'Idle threshold',
      align: 'right',
      render: (policy) => (
        <span className="num">{formatDuration(policy.idleThresholdSec)}</span>
      ),
    },
    {
      key: 'slot',
      header: 'Slot',
      align: 'right',
      render: (policy) => (
        <span className="num">
          {policy.slotMinutes}
          <small className="ml-1 text-[11px] text-ink-3">min</small>
        </span>
      ),
    },
    {
      key: 'people',
      header: 'Staff',
      align: 'right',
      render: (policy) => <span className="num">{policy.employeeCount}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (policy) =>
        policy.isActive ? (
          <Chip tone="counted">Open</Chip>
        ) : (
          <Chip>Closed</Chip>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (policy) => (
        <RowActions>
          <MiniButton onClick={() => setEditing(policy)}>Edit</MiniButton>
          {policy.isActive && (
            <MiniButton
              tone="danger"
              onClick={() => setClosing(policy)}
              title={
                policy.employeeCount > 0
                  ? 'Move the people on this policy to another one first'
                  : undefined
              }
            >
              Close
            </MiniButton>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Work policies
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Monthly target, screenshot window and idle threshold — everything
            about a person's day comes from here
          </p>
        </div>
        <Button tone="primary" onClick={() => setCreating(true)}>
          New policy
        </Button>
      </div>

      {/*
        ⭐ সরু ধূসর, লাল নয় — এটা কোনো ভুল নয়, একটা শর্ত। সলিড লাল রাখা
           থাকে সত্যিকারের বিপদের জন্য (নিশ্চিতকরণের বাক্সগুলো দেখুন)।
      */}
      <Notice>
        Change a number here and the next config sync changes{' '}
        <strong>how every PC behaves</strong> — when idle starts counting, when
        screenshots are taken. Change the monthly target and everyone's progress
        percentage moves with it.
      </Notice>

      {policies.loading && !policies.data && <Loading />}
      {policies.error && (
        <ErrorBox error={policies.error} retry={policies.reload} />
      )}

      {!policies.loading && !policies.error && rows.length === 0 && (
        <Empty
          title="No work policy yet"
          hint="At least one policy is needed — without it nobody has a monthly target and the progress ring never fills. Create one with the default 208 hours."
          action={
            <Button tone="primary" onClick={() => setCreating(true)}>
              New policy
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <Card padded={false}>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(policy) => String(policy.id)}
            rowMuted={(policy) => !policy.isActive}
          />
        </Card>
      )}

      {(creating || editing) && (
        <PolicyForm
          key={editing?.id ?? 'new'}
          policy={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            policies.reload();
          }}
        />
      )}

      {closing && (
        <ClosePolicyDialog
          policy={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            policies.reload();
          }}
        />
      )}
    </section>
  );
}

// ── policy ফর্ম ─────────────────────────────────────────────────────────────

interface PolicyFormState {
  name: string;
  monthlyTargetHours: string;
  expectedWorkdays: string;
  weeklyOffDay: string;
  screenshotFrom: string;
  screenshotTo: string;
  officeFrom: string;
  officeTo: string;
  idleThresholdSec: string;
  slotMinutes: string;
}

function PolicyForm({
  policy,
  onClose,
  onSaved,
}: {
  policy: WorkPolicyView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PolicyFormState>({
    name: policy?.name ?? '',
    monthlyTargetHours: String(policy?.monthlyTargetHours ?? 208),
    expectedWorkdays: String(policy?.expectedWorkdays ?? 26),
    weeklyOffDay:
      policy?.weeklyOffDay === null || policy?.weeklyOffDay === undefined
        ? ''
        : String(policy.weeklyOffDay),
    screenshotFrom: policy?.screenshotFrom ?? '07:00',
    screenshotTo: policy?.screenshotTo ?? '23:00',
    // ⚠️ খালি থাকলে ৯টা–৬টা দেখানো হয়, আর সংরক্ষণে সেটাই বসে যায়।
    //    ইচ্ছাকৃত: ঘরটা ফাঁকা রেখে সংরক্ষণ করলে সার্ভার '' বাতিল করত, আর
    //    মালিক বুঝতেন না কেন কিছু হলো না।
    officeFrom: policy?.officeFrom ?? '09:00',
    officeTo: policy?.officeTo ?? '18:00',
    idleThresholdSec: String(policy?.idleThresholdSec ?? 300),
    slotMinutes: String(policy?.slotMinutes ?? 10),
  });

  const { busy, error, run } = useMutation();
  const set = (key: keyof PolicyFormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (): void => {
    run(async () => {
      const body: WorkPolicyBody = {
        monthlyTargetHours: Number(form.monthlyTargetHours),
        expectedWorkdays: Number(form.expectedWorkdays),
        // ⚠️ `null` = "সাপ্তাহিক ছুটি নেই" — `undefined` হলে সার্ভার মানটায়
        //    হাতই দিত না, আর ছুটির দিন কখনো তোলা যেত না
        weeklyOffDay: form.weeklyOffDay === '' ? null : Number(form.weeklyOffDay),
        screenshotFrom: form.screenshotFrom,
        screenshotTo: form.screenshotTo,
        officeFrom: form.officeFrom,
        officeTo: form.officeTo,
        idleThresholdSec: Number(form.idleThresholdSec),
        slotMinutes: Number(form.slotMinutes),
      };

      if (policy) {
        await updateWorkPolicy(policy.id, { ...body, name: form.name.trim() });
      } else {
        await createWorkPolicy({ ...body, name: form.name.trim() });
      }
      onSaved();
    });
  };

  return (
    <Modal
      title={policy ? `${policy.name} — edit` : 'New work policy'}
      hint={
        policy && policy.employeeCount > 0
          ? `${policy.employeeCount} people are on this policy`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={submit}
            disabled={busy || form.name.trim() === ''}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <FullWidth>
            <TextField
              label="Name"
              value={form.name}
              onChange={set('name')}
              required
              autoFocus
              maxLength={120}
              placeholder="General staff"
            />
          </FullWidth>

          <TextField
            label="Monthly target (hours)"
            type="number"
            value={form.monthlyTargetHours}
            onChange={set('monthlyTargetHours')}
            mono
            min={1}
            max={744}
            step="0.01"
            hint="The only target that is stored. The daily target is derived from this — monthly target ÷ workdays. Default 208."
          />
          <TextField
            label="Expected workdays"
            type="number"
            value={form.expectedWorkdays}
            onChange={set('expectedWorkdays')}
            mono
            min={1}
            max={31}
            hint="How many days of work the month is assumed to hold — used for pace, and it divides the daily target"
          />

          <SelectField
            label="Weekly off"
            value={form.weeklyOffDay}
            onChange={set('weeklyOffDay')}
            options={OFF_DAY_OPTIONS}
            hint="This is not a block — hours worked on a day off still count in full"
          />
          <TextField
            label="Office opens"
            type="time"
            value={form.officeFrom}
            onChange={set('officeFrom')}
            mono
          />
          <TextField
            label="Office closes"
            type="time"
            value={form.officeTo}
            onChange={set('officeTo')}
            mono
            hint="Outside these hours — and on the weekly off day and holidays — a quiet PC raises no alert. Hours worked outside them still count in full."
          />

          <TextField
            label="Idle threshold"
            type="number"
            value={form.idleThresholdSec}
            onChange={set('idleThresholdSec')}
            mono
            min={10}
            max={3600}
            hint="Seconds. Once the keyboard and mouse have been quiet this long, the time stops counting."
          />

          <TextField
            label="Screenshots from"
            type="time"
            value={form.screenshotFrom}
            onChange={set('screenshotFrom')}
            mono
          />
          <TextField
            label="Screenshots until"
            type="time"
            value={form.screenshotTo}
            onChange={set('screenshotTo')}
            mono
            hint="No screenshot is ever taken outside this window"
          />

          <TextField
            label="Slot (minutes)"
            type="number"
            value={form.slotMinutes}
            onChange={set('slotMinutes')}
            mono
            min={1}
            max={60}
            hint="How long each cell of the timeline is"
          />
        </FormGrid>

        <ServerError error={error} />
      </div>
    </Modal>
  );
}

function ClosePolicyDialog({
  policy,
  onClose,
  onDone,
}: {
  policy: WorkPolicyView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();
  const occupied = policy.employeeCount > 0;

  return (
    <ConfirmDialog
      title={`Close "${policy.name}"?`}
      intro="The policy is not deleted, only closed — past months rest on it, so the record stays."
      warning={
        occupied
          ? `${policy.employeeCount} people are still on this policy. The server will refuse to close it — move them to another policy first.`
          : 'No new staff member can be put on this policy again.'
      }
      confirmLabel="Close"
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        run(async () => {
          await deactivateWorkPolicy(policy.id);
          onDone();
        })
      }
    />
  );
}
