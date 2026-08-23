import { useState } from 'react';

import {
  listDeposits,
  setDepositStart,
  settleDeposit,
  updateDepositPolicy,
  type DepositBalance,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { Card } from '../../components/Card';
import { Caveat, Empty, ErrorBox, Loading } from '../../components/States';
import {
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

/**
 * ⭐⭐ **R21 — সিকিউরিটি মানি (জামানত)।**
 *
 * মালিকের কথা *(১৫ আগস্ট)*: প্রতি মাসে বেতন থেকে ৫০০ টাকা কেটে রাখা হয়,
 * আর কেউ ৩০ দিন আগে জানিয়ে চাকরি ছাড়লে পুরো জমাটা ফেরত পান।
 *
 * ⚠️⚠️ এই পর্দাটা **owner-only**, ম্যানেজারও নয় — জামানত সরাসরি বেতনের
 * অংশ (ADR-023 · ADR-027)।
 *
 * ⭐ কর্মী নিজের জমাটা নিজের পাতায় দেখেন (`/me`), তাই "কত জমল" প্রশ্নের
 * উত্তর জানতে তাঁকে মালিকের কাছে আসতে হয় না — ফিচারটার আসল উদ্দেশ্যই
 * সেটা।
 */
export function DepositsTab() {
  const { data, error, loading, reload } = useApi(
    (signal) => listDeposits(signal),
    [],
  );
  const mutation = useMutation();

  const [editingRule, setEditingRule] = useState(false);
  const [settling, setSettling] = useState<DepositBalance | null>(null);
  const [startFor, setStartFor] = useState<DepositBalance | null>(null);

  const rows = data?.rows ?? [];
  const open = rows.filter((r) => !r.settlement);

  /**
   * ⚠️ মোট জমা **পয়সা থেকে** যোগ হয়, `balance` স্ট্রিং পার্স করে নয় —
   *    `Number("500.00")` কাজ করে বটে, কিন্তু বারোটা সারিতে ভাসমান দশমিক
   *    যোগ করলে শেষে এক পয়সা এদিক-ওদিক হতো, আর সেটা মালিকের চোখে পড়ত।
   */
  const heldPaisa = open.reduce((sum, r) => sum + r.balancePaisa, 0);

  return (
    <>
      <ServerError error={mutation.error} />

      <Card
        title="Security Deposit"
        hint={
          data
            ? `${data.policy.amount} a month · refundable with ${data.policy.noticeDays} days' notice`
            : 'Held from salary each month, refunded when someone leaves'
        }
        padded={false}
        actions={
          <RowActions>
            <MiniButton disabled={!data} onClick={() => setEditingRule(true)}>
              Edit rule
            </MiniButton>
          </RowActions>
        }
      >
        {loading && !data ? (
          <Loading label="Loading deposits…" />
        ) : !data ? (
          <ErrorBox error={error} retry={reload} />
        ) : rows.length === 0 ? (
          <Empty title="No staff yet" />
        ) : (
          <>
            {/*
              ⭐ মোটটা উপরে, একবার। মালিকের প্রথম প্রশ্নটা "সব মিলিয়ে কত
                 টাকা আমার হাতে জমা আছে" — সারি গুনে যোগ করতে হলে ওই
                 উত্তরটা কেউ কোনোদিন বের করত না।
              ⚠️ নিষ্পত্তি হয়ে যাওয়া কর্মীদের বাদ দিয়ে — ওই টাকা আর
                 হাতে নেই, ফেরত (বা বাজেয়াপ্ত) হয়ে গেছে।
            */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-3">
              <span className="num text-[19px] font-semibold">
                {takaOf(heldPaisa)}
              </span>
              <span className="text-[12px] text-ink-2">
                held from {open.length}{' '}
                {open.length === 1 ? 'person' : 'people'}
              </span>
            </div>

            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li
                  key={row.employeeId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                >
                  <span className="min-w-0 flex-1 text-[13px]">
                    <span className="font-medium">{row.fullName}</span>
                    <span className="num ml-2 text-[12px] text-ink-3">
                      {row.empCode}
                    </span>

                    {row.settlement ? (
                      <span className="block text-[12px] text-ink-2">
                        {row.settlement.outcome === 'refunded'
                          ? 'Refunded'
                          : 'Forfeited'}{' '}
                        {row.settlement.amount} ·{' '}
                        {row.settlement.noticeDaysGiven === null
                          ? 'notice dates were not recorded'
                          : `${row.settlement.noticeDaysGiven} days' notice, rule is ${row.settlement.noticeDaysRule}`}
                        {row.settlement.note && ` · ${row.settlement.note}`}
                      </span>
                    ) : (
                      <span className="block text-[12px] text-ink-3">
                        {row.months} {row.months === 1 ? 'month' : 'months'}{' '}
                        held
                        {/*
                          ⭐ **কোন মাস থেকে কাটা হচ্ছে** — এটা না দেখালে
                             মালিককে অঙ্ক কষে বের করতে হতো, আর ভুলটা
                             ধরাই পড়ত না।
                          ⚠️ মালিক নিজে বেছে দিলে সেটা আলাদা করে বলা হয়,
                             নইলে "নিয়ম অনুযায়ী" — দুটো এক দেখালে কে
                             কোনটা বসিয়েছে তা আর জানা যেত না।
                        */}
                        {row.effectiveStart && (
                          <>
                            {' · from '}
                            <span className="num">{row.effectiveStart}</span>
                            {row.startYearMonth === null && ' (by rule)'}
                          </>
                        )}
                      </span>
                    )}
                  </span>

                  <span
                    className={`num text-[13px] font-semibold ${
                      row.settlement ? 'text-ink-3 line-through' : ''
                    }`}
                  >
                    {row.balance}
                  </span>

                  <RowActions>
                    {/*
                      ⚠️ নিষ্পত্তি হয়ে গেলে বোতামটা **থাকেই না** — সার্ভার
                         দ্বিতীয়বার ৪০৯ দেয়, তাই বোতাম রাখলে সেটা শুধু
                         একটা এরর বাক্সে নিয়ে যেত।
                    */}
                    {/*
                      ⚠️ নিষ্পত্তি হয়ে গেলে খাতা বন্ধ — সার্ভার ৪০৯ দেয়,
                         তাই বোতামটাও থাকে না।
                    */}
                    {!row.settlement && (
                      <MiniButton onClick={() => setStartFor(row)}>
                        Start month
                      </MiniButton>
                    )}
                    {!row.settlement && row.balancePaisa > 0 && (
                      <MiniButton onClick={() => setSettling(row)}>
                        Settle
                      </MiniButton>
                    )}
                  </RowActions>
                </li>
              ))}
            </ul>
          </>
        )}

        <Caveat>
          The instalment is written into the ledger month by month, so changing
          the amount later never rewrites what was already held. The payroll
          sheet shows it as its own line: the salary earned stays the same, and
          only the amount handed over that month goes down.
        </Caveat>
      </Card>

      {startFor && (
        <StartMonthDialog
          row={startFor}
          busy={mutation.busy}
          onClose={() => setStartFor(null)}
          onSubmit={(yearMonth) =>
            mutation.run(async () => {
              const result = await setDepositStart(startFor.employeeId, yearMonth);
              setStartFor(null);
              reload();

              /**
               * ⚠️⚠️ কতগুলো কিস্তি মুছল সেটা **বলে দেওয়া হয়** — নীরবে
               * সারি মুছে ফেলা যাবে না। মালিক যদি ভুল মাস বসিয়ে থাকেন,
               * এই এক লাইনই তাঁকে সাথে সাথে জানায় কী ঘটেছে।
               */
              if (result.removed > 0 || result.added > 0) {
                window.alert(
                  `Ledger updated — ${result.removed} instalment(s) removed, ` +
                    `${result.added} added.`,
                );
              }
            })
          }
        />
      )}

      {editingRule && data && (
        <EditRule
          policy={data.policy}
          busy={mutation.busy}
          onClose={() => setEditingRule(false)}
          onSubmit={(body) =>
            mutation.run(async () => {
              await updateDepositPolicy(body);
              setEditingRule(false);
              reload();
            })
          }
        />
      )}

      {settling && (
        <SettleDialog
          row={settling}
          noticeDays={data?.policy.noticeDays ?? 30}
          busy={mutation.busy}
          onClose={() => setSettling(null)}
          onSubmit={(body) =>
            mutation.run(async () => {
              await settleDeposit(settling.employeeId, body);
              setSettling(null);
              reload();
            })
          }
        />
      )}
    </>
  );
}

/** পয়সা → '৳' ছাড়া দুই-দশমিকের সংখ্যা, সার্ভারের `paisaToTaka`-র মতোই */
function takaOf(paisa: number): string {
  return (paisa / 100).toFixed(2);
}

function EditRule({
  policy,
  busy,
  onClose,
  onSubmit,
}: {
  policy: {
    amount: string;
    startYearMonth: string;
    noticeDays: number;
    active: boolean;
  };
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: {
    amountPaisa?: number;
    startYearMonth?: string;
    noticeDays?: number;
    active?: boolean;
  }) => void;
}) {
  const [amount, setAmount] = useState(policy.amount);
  const [startYearMonth, setStart] = useState(policy.startYearMonth);
  const [noticeDays, setNotice] = useState(String(policy.noticeDays));
  const [active, setActive] = useState(policy.active ? 'yes' : 'no');

  /**
   * ⚠️ ফাঁকা বা অসংখ্যা ঘরে বোতামটা নিষ্ক্রিয় — সার্ভার ৪০০ দিত ঠিকই,
   *    কিন্তু দেয়ালে পাঠানোর চেয়ে দেখিয়ে দেওয়াই ভালো। ⚠️ `Number('')`
   *    শূন্য হয়, তাই খালি ঘরটা আলাদা করে দেখা দরকার।
   */
  const badAmount = amount.trim() === '' || !(Number(amount) > 0);
  const badNotice =
    noticeDays.trim() === '' || !Number.isInteger(Number(noticeDays));

  return (
    <Modal
      title="Security deposit rule"
      onClose={onClose}
      footer={
        <RowActions>
          <MiniButton onClick={onClose}>Cancel</MiniButton>
          <MiniButton
            disabled={busy || badAmount || badNotice}
            onClick={() =>
              onSubmit({
                // ⭐ পর্দা টাকায় নেয়, API পয়সায় — রূপান্তরটা এই এক জায়গায়
                amountPaisa: Math.round(Number(amount) * 100),
                startYearMonth: orUndefined(startYearMonth),
                noticeDays: Number(noticeDays),
                active: active === 'yes',
              })
            }
          >
            Save
          </MiniButton>
        </RowActions>
      }
    >
      <FormGrid>
        <TextField label="Amount a month" value={amount} onChange={setAmount} />
        <TextField
          label="Notice required (days)"
          value={noticeDays}
          onChange={setNotice}
        />
        <TextField
          label="Collect from"
          value={startYearMonth}
          onChange={setStart}
          placeholder="2026-08"
        />
        <SelectField
          label="Collecting"
          value={active}
          onChange={setActive}
          options={[
            { value: 'yes', label: 'Yes — add an instalment each month' },
            { value: 'no', label: 'No — stop adding new instalments' },
          ]}
        />

        <FullWidth>
          <Notice>
            Changing the amount only affects months that have not been recorded
            yet. Everything already held keeps the amount it was held at, so
            nobody&apos;s balance moves because a rule changed today. Turning
            collection off leaves every balance untouched.
          </Notice>
        </FullWidth>
      </FormGrid>
    </Modal>
  );
}

/**
 * ⭐⭐ নিষ্পত্তির মোডাল — **সিদ্ধান্তটা মালিকের, হিসাবটা পর্দার।**
 *
 * ⚠️ তারিখ দুটো বসালে পর্দা সাথে সাথে বলে দেয় কত দিনের নোটিশ হলো আর নিয়ম
 * কী বলে, কিন্তু বোতাম দুটোর কোনোটাই লুকায় না। ব্যতিক্রম সবসময়ই থাকে
 * (হাসপাতাল, পারিবারিক কারণ), আর স্বয়ংক্রিয় করলে মালিককে নিয়মটা
 * **ভাঙতে** হতো — অথচ ভাঙার কোনো পথ থাকত না।
 */
function SettleDialog({
  row,
  noticeDays,
  busy,
  onClose,
  onSubmit,
}: {
  row: DepositBalance;
  noticeDays: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: {
    outcome: 'refunded' | 'forfeited';
    noticeGivenOn?: string;
    lastWorkingDay?: string;
    note?: string;
  }) => void;
}) {
  const [noticeGivenOn, setNoticeGiven] = useState('');
  const [lastWorkingDay, setLastDay] = useState('');
  const [outcome, setOutcome] = useState<'refunded' | 'forfeited'>('refunded');
  const [note, setNote] = useState('');

  /** দুটো তারিখই থাকলে কত দিন — সার্ভারের `daysBetween`-এর মতোই, শেষ দিনসহ */
  const daysGiven =
    noticeGivenOn && lastWorkingDay
      ? Math.round(
          (new Date(lastWorkingDay).getTime() -
            new Date(noticeGivenOn).getTime()) /
            86_400_000,
        )
      : null;

  return (
    <Modal
      title={`Settle ${row.fullName}'s deposit`}
      onClose={onClose}
      footer={
        <RowActions>
          <MiniButton onClick={onClose}>Cancel</MiniButton>
          <MiniButton
            tone={outcome === 'forfeited' ? 'danger' : undefined}
            disabled={busy}
            onClick={() =>
              onSubmit({
                outcome,
                noticeGivenOn: orUndefined(noticeGivenOn),
                lastWorkingDay: orUndefined(lastWorkingDay),
                note: orUndefined(note),
              })
            }
          >
            {outcome === 'refunded' ? 'Refund' : 'Forfeit'}
          </MiniButton>
        </RowActions>
      }
    >
      <FormGrid>
        <FullWidth>
          <Notice>
            {row.balance} held over {row.months}{' '}
            {row.months === 1 ? 'month' : 'months'}. This closes the ledger — no
            further instalments are added, and it cannot be settled twice.
          </Notice>
        </FullWidth>

        <TextField
          label="Notice given on"
          value={noticeGivenOn}
          onChange={setNoticeGiven}
          type="date"
        />
        <TextField
          label="Last working day"
          value={lastWorkingDay}
          onChange={setLastDay}
          type="date"
        />

        <SelectField
          label="Outcome"
          value={outcome}
          onChange={(v) => setOutcome(v as 'refunded' | 'forfeited')}
          options={[
            { value: 'refunded', label: 'Refund the full amount' },
            { value: 'forfeited', label: 'Forfeit — notice was too short' },
          ]}
        />
        <TextField label="Note" value={note} onChange={setNote} />

        {/*
          ⭐ হিসাবটা দেখানো হয়, কিন্তু বোতাম বদলানো হয় না — মালিক নিয়ম
             জেনে সিদ্ধান্ত নেন, নিয়ম তাঁর হয়ে সিদ্ধান্ত নেয় না।
          ⚠️ তারিখ না দিলে কিছুই দাবি করা হয় না: "জানা নেই" আর "শর্ত
             মেলেনি" এক কথা নয়।
        */}
        <FullWidth>
          {daysGiven === null ? (
            <Notice>
              Without both dates the notice period is not recorded — the
              settlement still goes through, and the ledger simply says the
              dates were not known.
            </Notice>
          ) : (
            <Notice>
              {daysGiven} days&apos; notice · the rule asks for {noticeDays}.{' '}
              {daysGiven >= noticeDays
                ? 'This meets the rule.'
                : 'This is short of the rule — refunding anyway is your call, and the note is a good place to say why.'}
            </Notice>
          )}
        </FullWidth>
      </FormGrid>
    </Modal>
  );
}

/**
 * ⭐⭐ **এই কর্মীর জামানত কোন মাস থেকে কাটা শুরু।**
 *
 * ⚠️⚠️ মাস **এগিয়ে** দিলে তার আগের কিস্তিগুলো খাতা থেকে মুছে যায় — এটাই
 * এই জানালার আসল কাজ (ভুল সংশোধন), তাই কথাটা এখানে **আগেই** বলা হয়,
 * সেভ করার পরে নয়।
 *
 * ⭐ `month` ইনপুট ব্যবহার করা হয়েছে, তারিখ নয় — প্রশ্নটা "কোন মাস", আর
 * দিন চাইলে মালিককে এমন একটা সিদ্ধান্ত নিতে হতো যেটার কোনো মানেই নেই।
 */
function StartMonthDialog({
  row,
  busy,
  onClose,
  onSubmit,
}: {
  row: DepositBalance;
  busy: boolean;
  onClose: () => void;
  onSubmit: (yearMonth: string | null) => void;
}) {
  const [month, setMonth] = useState(row.startYearMonth ?? row.effectiveStart ?? '');

  return (
    <Modal
      title={`${row.fullName} — deposit start`}
      hint="From which month this person's deposit started being held"
      onClose={onClose}
      footer={
        <>
          <MiniButton onClick={onClose}>Cancel</MiniButton>
          {/*
            ⚠️ "নিয়মে ফেরত" আলাদা বোতাম — ঘরটা খালি করে সেভ করলে সেটা
               "কিছু বলিনি" নাকি "নিয়মে ফেরাও" তা বোঝা যেত না।
          */}
          {row.startYearMonth !== null && (
            <MiniButton disabled={busy} onClick={() => onSubmit(null)}>
              Use the rule
            </MiniButton>
          )}
          <MiniButton
            disabled={busy || month === '' || month === row.startYearMonth}
            onClick={() => onSubmit(month)}
          >
            {busy ? 'Saving…' : 'Save'}
          </MiniButton>
        </>
      }
    >
      <div className="space-y-3.5">
        <Notice>
          Moving this <b>later</b> deletes the instalments before it, and moving
          it <b>earlier</b> adds the missing ones. The ledger is rebuilt to match
          the month you choose.
        </Notice>

        <TextField
          label="Deposit starts from"
          type="month"
          value={month}
          onChange={setMonth}
          required
          autoFocus
          hint={
            row.startYearMonth === null
              ? `Currently following the rule (${row.effectiveStart ?? '—'})`
              : 'Set by you — "Use the rule" puts it back'
          }
        />
      </div>
    </Modal>
  );
}
