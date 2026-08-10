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
  { value: '', label: 'নেই — প্রতিদিনই কর্মদিবস' },
  { value: '1', label: 'সোমবার' },
  { value: '2', label: 'মঙ্গলবার' },
  { value: '3', label: 'বুধবার' },
  { value: '4', label: 'বৃহস্পতিবার' },
  { value: '5', label: 'শুক্রবার' },
  { value: '6', label: 'শনিবার' },
  { value: '7', label: 'রবিবার' },
];

const OFF_DAY_LABEL: Record<number, string> = {
  1: 'সোম',
  2: 'মঙ্গল',
  3: 'বুধ',
  4: 'বৃহস্পতি',
  5: 'শুক্র',
  6: 'শনি',
  7: 'রবি',
};

export function PoliciesTab() {
  return (
    <div className="space-y-6">
      <WorkPoliciesSection />
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
      header: 'নাম',
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
      header: 'মাসিক টার্গেট',
      align: 'right',
      render: (policy) => (
        <span className="num">
          {policy.monthlyTargetHours}
          <small className="ml-1 text-[11px] text-ink-3">ঘণ্টা</small>
        </span>
      ),
    },
    {
      key: 'workdays',
      header: 'কর্মদিবস',
      align: 'right',
      render: (policy) => <span className="num">{policy.expectedWorkdays}</span>,
    },
    {
      key: 'off',
      header: 'সাপ্তাহিক ছুটি',
      render: (policy) =>
        policy.weeklyOffDay === null ? (
          <span className="text-ink-3">নেই</span>
        ) : (
          (OFF_DAY_LABEL[policy.weeklyOffDay] ?? String(policy.weeklyOffDay))
        ),
    },
    {
      key: 'window',
      header: 'ছবির উইন্ডো',
      render: (policy) => (
        <span className="num">
          {policy.screenshotFrom ?? '07:00'}–{policy.screenshotTo ?? '23:00'}
        </span>
      ),
    },
    {
      key: 'idle',
      header: 'idle থ্রেশহোল্ড',
      align: 'right',
      render: (policy) => (
        <span className="num">{formatDuration(policy.idleThresholdSec)}</span>
      ),
    },
    {
      key: 'slot',
      header: 'স্লট',
      align: 'right',
      render: (policy) => (
        <span className="num">
          {policy.slotMinutes}
          <small className="ml-1 text-[11px] text-ink-3">মি</small>
        </span>
      ),
    },
    {
      key: 'people',
      header: 'কর্মী',
      align: 'right',
      render: (policy) => <span className="num">{policy.employeeCount}</span>,
    },
    {
      key: 'status',
      header: 'অবস্থা',
      render: (policy) =>
        policy.isActive ? (
          <Chip tone="counted">চালু</Chip>
        ) : (
          <Chip>বন্ধ</Chip>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (policy) => (
        <RowActions>
          <MiniButton onClick={() => setEditing(policy)}>সম্পাদনা</MiniButton>
          {policy.isActive && (
            <MiniButton
              tone="danger"
              onClick={() => setClosing(policy)}
              title={
                policy.employeeCount > 0
                  ? 'আগে এই পলিসির কর্মীদের অন্য পলিসিতে সরাতে হবে'
                  : undefined
              }
            >
              বন্ধ করুন
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
            work policy
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">
            মাসের টার্গেট, ছবির উইন্ডো আর idle থ্রেশহোল্ড — একজন কর্মীর সবকিছু
            এখান থেকেই আসে
          </p>
        </div>
        <Button tone="primary" onClick={() => setCreating(true)}>
          নতুন policy
        </Button>
      </div>

      {/*
        ⭐ সরু ধূসর, লাল নয় — এটা কোনো ভুল নয়, একটা শর্ত। সলিড লাল রাখা
           থাকে সত্যিকারের বিপদের জন্য (নিশ্চিতকরণের বাক্সগুলো দেখুন)।
      */}
      <Notice>
        এখানকার সংখ্যা বদলালে পরের config sync-এ{' '}
        <strong>প্রতিটা PC-র আচরণ</strong> বদলে যায় — idle কখন ধরা হবে, ছবি
        কখন উঠবে। আর মাসিক টার্গেট বদলালে সবার অগ্রগতির শতাংশও বদলে যায়।
      </Notice>

      {policies.loading && !policies.data && <Loading />}
      {policies.error && (
        <ErrorBox error={policies.error} retry={policies.reload} />
      )}

      {!policies.loading && !policies.error && rows.length === 0 && (
        <Empty
          title="কোনো work policy নেই"
          hint="অন্তত একটা policy দরকার — নইলে কারো মাসিক টার্গেট নেই, আর অগ্রগতির রিং কখনো ভরবে না। ডিফল্ট ২০৮ ঘণ্টা দিয়ে একটা বানিয়ে নিন।"
          action={
            <Button tone="primary" onClick={() => setCreating(true)}>
              নতুন policy
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
      title={policy ? `${policy.name} — সম্পাদনা` : 'নতুন work policy'}
      hint={
        policy && policy.employeeCount > 0
          ? `${policy.employeeCount} জন কর্মী এই policy-তে আছেন`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            বাতিল
          </Button>
          <Button
            tone="primary"
            onClick={submit}
            disabled={busy || form.name.trim() === ''}
          >
            {busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <FullWidth>
            <TextField
              label="নাম"
              value={form.name}
              onChange={set('name')}
              required
              autoFocus
              maxLength={120}
              placeholder="সাধারণ কর্মী"
            />
          </FullWidth>

          <TextField
            label="মাসিক টার্গেট (ঘণ্টা)"
            type="number"
            value={form.monthlyTargetHours}
            onChange={set('monthlyTargetHours')}
            mono
            min={1}
            max={744}
            step="0.01"
            hint="⭐ একমাত্র টার্গেট — দৈনিক কোনো টার্গেট নেই। ডিফল্ট 208।"
          />
          <TextField
            label="প্রত্যাশিত কর্মদিবস"
            type="number"
            value={form.expectedWorkdays}
            onChange={set('expectedWorkdays')}
            mono
            min={1}
            max={31}
            hint="মাসে কত দিন কাজ হবে ধরে নেওয়া হচ্ছে — pace হিসাবের জন্য"
          />

          <SelectField
            label="সাপ্তাহিক ছুটি"
            value={form.weeklyOffDay}
            onChange={set('weeklyOffDay')}
            options={OFF_DAY_OPTIONS}
            hint="⚠️ এটা কোনো বাধা নয় — ছুটির দিনে কাজ করলেও ঘণ্টা পুরোপুরি গোনা হয়"
          />
          <TextField
            label="idle থ্রেশহোল্ড"
            type="number"
            value={form.idleThresholdSec}
            onChange={set('idleThresholdSec')}
            mono
            min={10}
            max={3600}
            hint="সেকেন্ড। এত সময় কি-বোর্ড/মাউস চুপ থাকলে সময়টা আর গোনা হবে না।"
          />

          <TextField
            label="ছবি শুরু"
            type="time"
            value={form.screenshotFrom}
            onChange={set('screenshotFrom')}
            mono
          />
          <TextField
            label="ছবি শেষ"
            type="time"
            value={form.screenshotTo}
            onChange={set('screenshotTo')}
            mono
            hint="এই উইন্ডোর বাইরে কোনো স্ক্রিনশট তোলা হয় না"
          />

          <TextField
            label="স্লট (মিনিট)"
            type="number"
            value={form.slotMinutes}
            onChange={set('slotMinutes')}
            mono
            min={1}
            max={60}
            hint="সময়রেখার প্রতিটা ঘরের দৈর্ঘ্য"
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
      title={`"${policy.name}" বন্ধ করবেন?`}
      intro="policy-টা মোছা হয় না, শুধু বন্ধ হয় — পুরোনো মাসের হিসাব এর উপরেই দাঁড়িয়ে আছে, তাই সারিটা থেকে যায়।"
      warning={
        occupied
          ? `${policy.employeeCount} জন কর্মী এখনো এই policy-তে আছেন। সার্ভার এটা বন্ধ করতে দেবে না — আগে তাঁদের অন্য policy-তে সরান।`
          : 'নতুন কর্মীকে আর এই policy দেওয়া যাবে না।'
      }
      confirmLabel="বন্ধ করুন"
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
