import { useState } from 'react';

import {
  createAdjustment,
  listAdjustments,
  revokeAdjustment,
  CAUSE_LABELS,
  type AdjustmentCause,
  type AdjustmentView,
} from '../../api/adjustments';
import { useApi } from '../../api/useApi';
import { useAuth } from '../../auth/AuthContext';
import { Card } from '../../components/Card';
import { Button } from '../../components/Page';
import { Empty, ErrorBox, Loading } from '../../components/States';
import {
  formatDate,
  formatSignedDuration,
  todayInDhaka,
} from '../../lib/format';
import {
  Chip,
  ConfirmDialog,
  Modal,
  MiniButton,
  Notice,
  SelectField,
  ServerError,
  TextField,
  useMutation,
} from '../settings/ui';

/**
 * **B14 · J08 · ADR-011e** — ঘণ্টা সংশোধন।
 *
 * ⭐ **কেন এটা কর্মীর পাতায়, Settings-এ নয়:** প্রশ্নটা ওঠে একটা নির্দিষ্ট
 * দিন দেখতে দেখতে — "ওইদিন এজেন্ট বন্ধ ছিল, ওর ঘণ্টা কম কেন"। উত্তরটাও
 * তাই ওই পাতাতেই থাকা দরকার, অন্য পর্দায় গিয়ে খুঁজতে হলে কেউ করতই না।
 *
 * ⚠️ **স্টাফ নিজেও এটা পড়ে** (J08)। তাই কারণের লেখাগুলো কারিগরি নয়, আর
 * এখানে কোনো "দাবি করুন" বোতাম নেই — সংশোধন owner-এর সিদ্ধান্ত, স্টাফের
 * আবেদন নয় (ADR-011d: কোনো অনুমোদন ব্যবস্থা নেই)।
 *
 * ⚠️ তালিকাটা **তারিখ-নিরপেক্ষ** — পাতার বাকি অংশ একটা দিনের, কিন্তু
 * সংশোধন কম হয় আর সবগুলো একসাথে দেখাই কাজের। দিন ধরে ফিল্টার করলে
 * "গত মাসে কি কিছু দেওয়া হয়েছিল" প্রশ্নের উত্তর খুঁজতে ৩০ দিন ঘুরতে হতো।
 */
export function Adjustments({
  employeeId,
  nonce,
}: {
  employeeId: number;
  nonce: number;
}) {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const { data, loading, error, reload } = useApi(
    (signal) => listAdjustments(employeeId, signal),
    [employeeId, nonce],
  );

  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<AdjustmentView | null>(null);

  const rows = data ?? [];
  const counted = rows.filter((r) => r.active);

  return (
    <Card
      title="Hour Corrections"
      hint="Time given back when the system — not the person — lost the hours"
      actions={
        isOwner ? (
          <Button onClick={() => setAdding(true)}>Add correction</Button>
        ) : undefined
      }
    >
      {loading && <Loading />}
      {error && <ErrorBox error={error} retry={reload} />}

      {!loading && !error && rows.length === 0 && (
        <Empty
          title="No corrections"
          hint="The recorded hours stand exactly as they were measured."
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="space-y-2">
          {/*
            ⚠️ যোগফলটা উপরে, কারণ "মোট কত ফেরত দেওয়া হয়েছে" প্রশ্নটাই
               প্রথমে আসে — সারি গুনে বের করতে হলে কেউ করত না।
            ⚠️ শুধু **সক্রিয়** সারিগুলো গোনা হয়; বাতিল করাগুলো বাদ,
               ঠিক যেমন সার্ভারের হিসাবেও বাদ।
          */}
          {counted.length > 0 && (
            <p className="text-[13px] text-ink-2">
              <span className="num font-semibold">{formatSignedDuration(totalSec(counted))}</span>{' '}
              counted in total, from {counted.length}{' '}
              {counted.length === 1 ? 'correction' : 'corrections'}
            </p>
          )}

          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                canRevoke={isOwner}
                onRevoke={() => setRevoking(row)}
              />
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <AddDialog
          employeeId={employeeId}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {revoking && (
        <RevokeDialog
          row={revoking}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setRevoking(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function Row({
  row,
  canRevoke,
  onRevoke,
}: {
  row: AdjustmentView;
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2.5">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            ⚠️ চিহ্নসহ সংখ্যা (+২:০০ / −০:৩০) — "২:০০" দেখে কেউ বুঝত না
               ঘণ্টা যোগ হলো না কাটা গেল, অথচ পার্থক্যটা তার বেতনের।
            ⚠️ বাতিল হলে কাটা দাগ, আর রংও নিরপেক্ষ — সংখ্যাটা এখনো
               গোনা হচ্ছে বলে ভুল হওয়ার সুযোগ থাকা চলবে না।
          */}
          <span
            className={`num text-[15px] font-semibold ${
              row.active ? 'text-ink' : 'text-ink-3 line-through'
            }`}
          >
            {formatSignedDuration(row.deltaSec)}
          </span>

          <span className="num text-[13px] text-ink-2">
            {formatDate(row.workDate)}
          </span>

          <Chip>{CAUSE_LABELS[row.cause] ?? row.cause}</Chip>

          {row.beyondEvidence && (
            <Chip tone="pending">More than measured</Chip>
          )}

          {!row.active && <Chip tone="muted">Revoked</Chip>}
        </div>

        {/* ⭐ কারণটা সবসময় দেখানো হয় — স্টাফ নিজেও এটা পড়ে (J08) */}
        <p className="max-w-prose text-[13px] text-ink-2">{row.reason}</p>

        <p className="text-[11.5px] text-ink-3">
          Recorded by {row.createdBy}
          {!row.active && row.revokedBy ? (
            <> · revoked by {row.revokedBy}{row.revokeReason ? ` — ${row.revokeReason}` : ''}</>
          ) : null}
        </p>
      </div>

      {canRevoke && row.active && (
        <MiniButton tone="danger" onClick={onRevoke}>
          Revoke
        </MiniButton>
      )}
    </li>
  );
}

/**
 * ⚠️ ইনপুট **ঘণ্টা ও মিনিটে**, সেকেন্ডে নয় — কেউ "2h 30m" ভেবে 230
 * লিখলে সেটা ৪ মিনিট হয়ে যেত। API-তে সেকেন্ডেই যায়, রূপান্তরটা এখানে।
 */
function AddDialog({
  employeeId,
  onClose,
  onDone,
}: {
  employeeId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();

  const [workDate, setWorkDate] = useState(todayInDhaka());
  const [sign, setSign] = useState<'plus' | 'minus'>('plus');
  const [hours, setHours] = useState('2');
  const [minutes, setMinutes] = useState('0');
  const [cause, setCause] = useState<AdjustmentCause>('agent_down');
  const [reason, setReason] = useState('');

  const seconds =
    (Math.max(0, Number(hours) || 0) * 3600 +
      Math.max(0, Number(minutes) || 0) * 60) *
    (sign === 'minus' ? -1 : 1);

  const tooLong = Math.abs(seconds) > 24 * 3600;
  const ready = seconds !== 0 && reason.trim().length >= 3 && !tooLong;

  return (
    <Modal
      title="Add hour correction"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || !ready}
            onClick={() =>
              run(async () => {
                await createAdjustment(employeeId, {
                  workDate,
                  deltaSec: seconds,
                  cause,
                  reason: reason.trim(),
                });
                onDone();
              })
            }
          >
            Add correction
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Notice tone="info">
          This does not change what was measured — the raw activity stays
          exactly as recorded. The correction is stored beside it, with your
          name and reason, and the staff member can see both.
        </Notice>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Day"
            type="date"
            value={workDate}
            onChange={setWorkDate}
            max={todayInDhaka()}
          />

          <SelectField
            label="Direction"
            value={sign}
            onChange={(v) => setSign(v as 'plus' | 'minus')}
            options={[
              { value: 'plus', label: 'Give hours back' },
              { value: 'minus', label: 'Take hours off' },
            ]}
          />

          <TextField
            label="Hours"
            type="number"
            value={hours}
            onChange={setHours}
            min="0"
            max="24"
          />

          <TextField
            label="Minutes"
            type="number"
            value={minutes}
            onChange={setMinutes}
            min="0"
            max="59"
          />
        </div>

        <SelectField
          label="What happened"
          value={cause}
          onChange={(v) => setCause(v as AdjustmentCause)}
          options={Object.entries(CAUSE_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />

        <TextField
          label="Reason"
          value={reason}
          onChange={setReason}
          hint="The staff member reads this — write it for them, not for the log"
        />

        {tooLong && (
          <Notice tone="attention">
            A single day cannot be corrected by more than 24 hours.
          </Notice>
        )}

        <ServerError error={error} />
      </div>
    </Modal>
  );
}

function RevokeDialog({
  row,
  onClose,
  onDone,
}: {
  row: AdjustmentView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();

  return (
    <ConfirmDialog
      title={`Revoke ${formatSignedDuration(row.deltaSec)} on ${formatDate(row.workDate)}?`}
      intro="The correction stops counting from now on. It is not deleted — the record, your reason and the original one all stay."
      confirmLabel="Revoke"
      withReason
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={(reason) =>
        run(async () => {
          await revokeAdjustment(row.id, reason);
          onDone();
        })
      }
    />
  );
}

function totalSec(rows: AdjustmentView[]): number {
  return rows.reduce((sum, r) => sum + r.deltaSec, 0);
}

/**
 * ⚠️ `signed()` এখানেই লেখা ছিল, এখন `lib/format.ts`-এ
 * (`formatSignedDuration`) — ওই ফাইলের নিজের ডকই বলে *"নিজের পেজে আলাদা
 * করে ফরম্যাট লিখবেন না"*, আর এটাই ছিল একমাত্র জায়গা যেখানে নিয়মটা ভাঙা
 * হয়েছিল।
 *
 * ⭐ সরানোর সাথে সাথেই একটা সত্যিকারের বাগ বেরোল: এখানকার হিসাবে ৩৫৯৮
 * সেকেন্ডের সংশোধন পর্দায় `+0:60` দেখাত (মিনিট round করে ৬০ হয়ে যায়,
 * আর ঘণ্টায় তোলা হতো না)। `formatDuration()` ওই ফাঁদটা আগেই সামলাত —
 * নকল করে লেখা কোডটাই সামলাত না।
 */
