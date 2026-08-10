import { useState } from 'react';

import {
  createEnrollmentCode,
  listDevices,
  restoreDevice,
  revokeDevice,
  type DeviceStatus,
  type DeviceView,
  type EnrollmentCodeResult,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { EmployeePicker } from '../../components/EmployeePicker';
import { Button } from '../../components/Page';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { PersonCell, Table, type Column } from '../../components/Table';
import { formatAgo, formatDateTime, formatDuration } from '../../lib/format';
import {
  Chip,
  ConfirmDialog,
  MiniButton,
  Modal,
  Notice,
  RowActions,
  SecretModal,
  ServerError,
  useMutation,
} from './ui';

/**
 * E10 · H05 · H06 — ডিভাইস।
 *
 * ⚠️ এখানে কিছুই মোছা যায় না, শুধু **revoke** — আর সেটা ফেরানো যায়।
 * revoke করলে ওই PC-র টোকেন সঙ্গে সঙ্গে অচল হয়, অর্থাৎ ট্র্যাকিং থেমে
 * যায়। তাই নিশ্চিতকরণ ছাড়া কোনো পথ রাখা হয়নি, আর কারণ লেখা বাধ্যতামূলক।
 */

/** ঘড়ির হেরফের এত সেকেন্ড ছাড়ালে সার্ভার অ্যালার্ট বানায় (clock-drift.service.ts) */
const DRIFT_ALERT_SEC = 300;

const STATUS_OPTIONS = [
  { value: '', label: 'সব' },
  { value: 'active', label: 'সক্রিয়' },
  { value: 'revoked', label: 'বাতিল' },
] as const;

export function DevicesTab() {
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [status, setStatus] = useState<DeviceStatus | ''>('');

  const devices = useApi(
    (signal) =>
      listDevices(
        {
          ...(employeeId === null ? {} : { employeeId }),
          ...(status === '' ? {} : { status }),
        },
        signal,
      ),
    [employeeId, status],
  );

  const [enrolling, setEnrolling] = useState(false);
  const [issued, setIssued] = useState<EnrollmentCodeResult | null>(null);
  const [revoking, setRevoking] = useState<DeviceView | null>(null);
  const [restoring, setRestoring] = useState<DeviceView | null>(null);

  const rows = devices.data?.rows ?? [];

  const columns: Column<DeviceView>[] = [
    {
      key: 'device',
      header: 'ডিভাইস',
      render: (device) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{device.hostname}</div>
          <div
            className="num truncate text-[11px] text-ink-3"
            title={device.machineGuid}
          >
            {device.windowsUsername}
          </div>
        </div>
      ),
    },
    {
      key: 'employee',
      header: 'স্টাফ',
      render: (device) =>
        device.employee ? (
          <PersonCell
            fullName={device.employee.fullName}
            empCode={device.employee.empCode}
          />
        ) : (
          <span className="text-ink-3">যুক্ত নয়</span>
        ),
    },
    {
      key: 'agent',
      header: 'এজেন্ট',
      render: (device) => (
        <div className="min-w-0">
          <div className="num">{device.agentVersion ?? '—'}</div>
          <div className="truncate text-[11px] text-ink-3">
            {device.osVersion ?? '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'monitors',
      header: 'মনিটর',
      align: 'right',
      render: (device) => <span className="num">{device.monitors}</span>,
    },
    {
      key: 'drift',
      header: 'ঘড়ির হেরফের',
      align: 'right',
      render: (device) => <Drift device={device} />,
    },
    {
      key: 'seen',
      header: 'শেষ সাড়া',
      render: (device) => (
        <span
          className={device.lastSeenAt ? '' : 'text-ink-3'}
          title={formatDateTime(device.lastSeenAt)}
        >
          {formatAgo(device.lastSeenAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'অবস্থা',
      render: (device) =>
        device.status === 'active' ? (
          <Chip tone="counted">সক্রিয়</Chip>
        ) : (
          // ⭐ সলিড লাল নয়, তবু ব্র্যান্ড-লাল চিপ — বাতিল ডিভাইস মানে
          //    ওই PC থেকে আর কিছুই আসছে না, আর সেটা চোখে পড়া দরকার
          <Chip tone="attention">বাতিল</Chip>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (device) => (
        <RowActions>
          {device.status === 'active' ? (
            <MiniButton tone="danger" onClick={() => setRevoking(device)}>
              revoke
            </MiniButton>
          ) : (
            <MiniButton onClick={() => setRestoring(device)}>
              আবার চালু
            </MiniButton>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <EmployeePicker
            value={employeeId}
            onChange={setEmployeeId}
            allowAll
            allLabel="সব স্টাফ"
            includeInactive
          />
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-ink-3">অবস্থা</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as DeviceStatus | '')}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Button tone="primary" onClick={() => setEnrolling(true)}>
          নতুন এনরোলমেন্ট কোড
        </Button>
      </div>

      {devices.loading && !devices.data && <Loading />}
      {devices.error && (
        <ErrorBox error={devices.error} retry={devices.reload} />
      )}

      {!devices.loading && !devices.error && rows.length === 0 && (
        <Empty
          title="কোনো ডিভাইস নেই"
          hint="একটা PC তখনই এখানে আসে যখন সেখানে এজেন্ট বসিয়ে এনরোলমেন্ট কোড দেওয়া হয়। কোড বানিয়ে কর্মীকে দিন — এজেন্ট সেটা দিয়ে একবারই নিবন্ধন করবে।"
          action={
            <Button tone="primary" onClick={() => setEnrolling(true)}>
              নতুন এনরোলমেন্ট কোড
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <Card
          padded={false}
          title={`ডিভাইস · ${devices.data?.total ?? rows.length}টি`}
          hint="ঘড়ির হেরফের ৫ মিনিট ছাড়ালে ওই মেশিনের সময়ের হিসাব সন্দেহজনক"
        >
          <Table
            columns={columns}
            rows={rows}
            rowKey={(device) => String(device.id)}
            rowMuted={(device) => device.status === 'revoked'}
          />
        </Card>
      )}

      {enrolling && (
        <EnrollmentForm
          onClose={() => setEnrolling(false)}
          onIssued={(result) => {
            setEnrolling(false);
            setIssued(result);
          }}
        />
      )}

      {issued && (
        <SecretModal
          title="এনরোলমেন্ট কোড"
          label="কোড"
          secret={issued.code}
          note={`${issued.employee.fullName} · ${issued.employee.empCode}`}
          meta={`মেয়াদ শেষ: ${formatDateTime(issued.expiresAt)}। এজেন্ট ইনস্টল করার সময় এই কোডটা চাইবে — একবার ব্যবহার হলেই সেটা ফুরিয়ে যায়।`}
          onClose={() => {
            setIssued(null);
            devices.reload();
          }}
        />
      )}

      {revoking && (
        <RevokeDialog
          device={revoking}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setRevoking(null);
            devices.reload();
          }}
        />
      )}

      {restoring && (
        <RestoreDialog
          device={restoring}
          onClose={() => setRestoring(null)}
          onDone={() => {
            setRestoring(null);
            devices.reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * ঘড়ির হেরফের।
 *
 * ⚠️ এটাই একমাত্র সংখ্যা যা ঠিক থাকলে কেউ কোনোদিন তাকায় না, আর ভুল হলে
 *    পুরো দিনের সময়রেখা বেঠিক হয়ে যায় — তাই ৫ মিনিট ছাড়ালে লাল।
 */
function Drift({ device }: { device: DeviceView }) {
  const abs = Math.abs(device.lastDriftSec);
  const alarming = abs > DRIFT_ALERT_SEC;

  return (
    <span
      className={`num ${alarming ? 'text-brand-ink' : abs === 0 ? 'text-ink-3' : ''}`}
      title={`সর্বোচ্চ হেরফের ${driftText(Math.abs(device.maxDriftSec))}`}
    >
      {abs === 0
        ? '—'
        : `${device.lastDriftSec > 0 ? '+' : '−'}${driftText(abs)}`}
    </span>
  );
}

/**
 * ⚠️ `formatDuration()` এখানে চলে না: ওটা মিনিটে round করে, তাই ৪৫ সেকেন্ডের
 *    হেরফের "1মি" আর ১০ সেকেন্ডেরটা "0মি" দেখাত — অর্থাৎ ছোট কিন্তু আসল
 *    হেরফেরগুলো হয় বড় নয় শূন্য মনে হতো। এক মিনিটের নিচে তাই কাঁচা সেকেন্ড।
 */
function driftText(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : formatDuration(seconds);
}

// ── H05 · এনরোলমেন্ট কোড ────────────────────────────────────────────────────

/**
 * ⚠️ নতুন কোড বানালে ওই কর্মীর **আগের কোডগুলো তখনই বাতিল** হয়ে যায়।
 *    কেউ যদি সকালে কোড পাঠিয়ে বিকেলে আরেকটা বানায়, সকালেরটা দিয়ে আর
 *    ইনস্টল হবে না — আর কর্মী বুঝতেই পারবে না কেন।
 */
function EnrollmentForm({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: (result: EnrollmentCodeResult) => void;
}) {
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const { busy, error, run } = useMutation();

  return (
    <Modal
      title="নতুন এনরোলমেন্ট কোড"
      hint="নতুন PC-তে এজেন্ট বসানোর জন্য"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            বাতিল
          </Button>
          <Button
            tone="primary"
            disabled={busy || employeeId === null}
            onClick={() =>
              run(async () => {
                if (employeeId === null) return;
                onIssued(await createEnrollmentCode(employeeId));
              })
            }
          >
            {busy ? 'তৈরি হচ্ছে…' : 'কোড বানান'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Notice tone="attention">
          কোডটা তৈরির পর <strong>একবারই</strong> দেখানো হবে — সার্ভারে শুধু
          এর hash জমা থাকে। আর এই কর্মীর আগের কোনো কোড থাকলে সেটা এখনই বাতিল
          হয়ে যাবে।
        </Notice>

        <EmployeePicker
          value={employeeId}
          onChange={setEmployeeId}
          label="কার জন্য"
        />

        <ServerError error={error} />
      </div>
    </Modal>
  );
}

// ── H06 · revoke ও restore ──────────────────────────────────────────────────

function RevokeDialog({
  device,
  onClose,
  onDone,
}: {
  device: DeviceView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();

  return (
    <ConfirmDialog
      title={`${device.hostname} — revoke করবেন?`}
      intro={
        device.employee
          ? `${device.employee.fullName}-এর এই PC-টি এখন সক্রিয়।`
          : 'এই ডিভাইসটি কোনো কর্মীর সাথে যুক্ত নয়।'
      }
      warning="এই PC-র ট্র্যাকিং সঙ্গে সঙ্গে থেমে যাবে — নতুন কোনো ঘণ্টা, স্ক্রিনশট বা অ্যাপের হিসাব আর আসবে না। পুরোনো ডেটা যেমন আছে তেমনই থাকবে।"
      confirmLabel="revoke করুন"
      withReason
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={(reason) =>
        run(async () => {
          await revokeDevice(device.id, reason);
          onDone();
        })
      }
    />
  );
}

function RestoreDialog({
  device,
  onClose,
  onDone,
}: {
  device: DeviceView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();

  return (
    <ConfirmDialog
      title={`${device.hostname} — আবার চালু করবেন?`}
      intro="ডিভাইসটি আবার ডেটা পাঠাতে শুরু করবে।"
      warning="⚠️ restore করলে পুরোনো টোকেনটাই আবার জেগে ওঠে। ল্যাপটপ হারিয়ে গিয়ে থাকলে restore করবেন না — তাহলে যার হাতে আছে সে-ও আবার ঢুকতে পারবে। ওই ক্ষেত্রে নতুন এনরোলমেন্ট কোড বানান।"
      confirmLabel="আবার চালু করুন"
      tone="primary"
      withReason
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={(reason) =>
        run(async () => {
          await restoreDevice(device.id, reason);
          onDone();
        })
      }
    />
  );
}
