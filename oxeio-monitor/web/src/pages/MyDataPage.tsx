import { Link } from 'react-router-dom';

import { getMyDays, getMySummary, type MyDay } from '../api/me';
import { useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, Stat, StatRow } from '../components/Card';
import { Duration } from '../components/Duration';
import { Page } from '../components/Page';
import { ProgressBar, ProgressRing } from '../components/ProgressRing';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Table } from '../components/Table';
import {
  formatDate,
  formatDateShort,
  formatSignedDuration,
  monthStartOf,
  shiftWorkDate,
  todayInDhaka,
  weekdayOf,
} from '../lib/format';
import { Adjustments } from './employee/Adjustments';

/**
 * **J05 · J08 · ADR-011e** — স্টাফের নিজের পাতা।
 *
 * ⚠️⚠️ tray-র মেনুতে **"My data"** আইটেমটা প্রথম দিন থেকেই ছিল, আর সেটা
 * চাপলে ব্রাউজার খুলে ৪০৪ দেখাত — পাতাটা কোনোদিন বানানোই হয়নি। অর্থাৎ
 * স্বচ্ছতার প্রতিশ্রুতিটা প্রতিদিন স্টাফের চোখের সামনে ছিল, আর
 * প্রতিদিনই ভাঙত।
 *
 * ⭐ <b>পাতাটার একটাই কাজ: "আমার সম্পর্কে সিস্টেম কী জানে" — এক জায়গায়।</b>
 * তাই এখানে চারটে জিনিস, আর তার বেশি কিছু নয়:
 *   ১· আজ ও মাসের ঘণ্টা (tray-র হুবহু একই সংখ্যা)
 *   ২· দিনে দিনে তালিকা — ছুটিসহ, ফাঁকা দিনসহ
 *   ৩· ঘণ্টা-সংশোধন, কারণসহ (J08)
 *   ৪· নিজের ছবি ও নীতিমালার শর্ত
 *
 * ⚠️ **কোনো বোতাম নেই** — না "সময় দাবি করুন", না "ব্যাখ্যা দিন"। একটা
 * বসালেই সেটা approval workflow-র প্রথম ধাপ হতো, যেটা এই সিস্টেমে
 * ইচ্ছাকৃতভাবে নেই (ADR-011d)। tray জানালাতেও ঠিক এই কারণেই কোনো বোতাম
 * নেই।
 */
export function MyDataPage() {
  const { user } = useAuth();
  const today = todayInDhaka();

  /**
   * ⚠️ owner ও manager-এর `users.employee_id` সাধারণত null — তাঁরা কর্মীর
   * সারিতে বাঁধা নন। সার্ভার তাঁদের ৪০৩ বলে, কিন্তু সেটা পর্দায় আসত
   * *"You don't have access"* হয়ে — অথচ owner-এর কাছে ওই বাক্যটা
   * বিভ্রান্তিকর (তাঁর তো সবেতেই access)। আসল কথাটা অন্য: **তাঁর নিজের
   * বলে কোনো ঘণ্টা নেই**। তাই রিকোয়েস্টটা পাঠানোই হয় না।
   */
  const linked = user?.employeeId != null;

  const summary = useApi(
    (signal) => (linked ? getMySummary(signal) : Promise.resolve(null)),
    [linked],
  );

  /**
   * ⚠️ **রোলিং ৩০ দিন, "চলতি মাস" নয়।** মাসের ১ তারিখে চলতি-মাস দেখালে
   * তালিকায় একটাই সারি থাকত, আর ঠিক তখনই মানুষ গত মাসের শেষ দিনগুলো
   * মেলাতে চায়। উপরের সংখ্যাগুলো অবশ্য মাসেরই — ওটাই চুক্তির একক (O8)।
   */
  const from = shiftWorkDate(today, -29);
  const days = useApi(
    (signal) => (linked ? getMyDays(from, today, signal) : Promise.resolve([])),
    [linked, from, today],
  );

  const p = summary.data?.progress;

  return (
    <Page
      title="My data"
      subtitle={
        summary.data
          ? `${summary.data.employee.fullName} · ${summary.data.employee.empCode}`
          : (user?.fullName ?? '')
      }
    >
      {!linked && (
        <Empty
          title="This account has no hours of its own"
          hint="Owner and manager accounts are not linked to a staff record, so there is nothing personal to show here. Staff see their own hours on this page."
        />
      )}

      {linked && summary.loading && <Loading />}
      {linked && summary.error && (
        <ErrorBox error={summary.error} retry={summary.reload} />
      )}

      {p && summary.data && (
        <div className="space-y-4">
          <StatRow>
            <Stat label="Today" value={<Duration seconds={p.todayActiveSec} />} />
            <Stat
              label="This month"
              value={<Duration seconds={p.monthActiveSec} />}
              unit={`/ ${p.monthlyTargetHours}h`}
            />
            <Stat label="Last 7 days" value={<Duration seconds={p.week7ActiveSec} />} />
            {/*
              ⭐ পুরো পাতায় **একটাই** সম্ভাব্য লাল টাইল — পিছিয়ে থাকা।
              ⚠️ এগিয়ে থাকলে লাল নয়; সব টাইল লাল করলে লালের মানেই হারায়।
            */}
            <Stat
              label={p.paceSec < 0 ? 'Behind' : 'Ahead'}
              value={formatSignedDuration(p.paceSec)}
              tone={p.paceSec < 0 ? 'attention' : 'counted'}
            />
          </StatRow>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Where you are"
              hint="The same numbers your tray icon shows"
            >
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-3">
                  <ProgressRing
                    value={p.monthActiveSec}
                    max={p.monthlyTargetHours * 3600}
                    size={64}
                    ariaLabel="This month"
                  />
                  <div className="text-[13px]">
                    <div className="font-medium">This month</div>
                    <div className="text-ink-3">
                      <Duration seconds={p.monthActiveSec} /> of{' '}
                      {p.monthlyTargetHours}h
                    </div>
                  </div>
                </div>

                <div className="min-w-[180px] flex-1 space-y-3">
                  {/*
                    ⚠️ ছুটির দিনে দৈনিক টার্গেট ০ — তখন খালি বার নয়, একটা
                       বাক্য। খালি বার "আজও ৮ ঘণ্টা বাকি" বলে তাড়া দিত,
                       অথচ আজ কিছু করার কথাই নেই। tray জানালাতেও একই নিয়ম।
                  */}
                  {p.dailyTargetSec > 0 ? (
                    <Line
                      label="Today"
                      value={p.todayActiveSec}
                      max={p.dailyTargetSec}
                    />
                  ) : (
                    <p className="text-[13px] text-ink-2">
                      Today is a day off — nothing is expected. Anything you do
                      work still counts.
                    </p>
                  )}

                  <Line
                    label="Last 7 days"
                    value={p.week7ActiveSec}
                    max={p.week7TargetSec}
                  />
                </div>
              </div>
            </Card>

            {/*
              ⭐ **স্বচ্ছতার ঘর।** নীতিমালায় স্টাফকে যা লিখিতভাবে বলা
              হয়েছে, তার সংখ্যাগুলো এখানেই — খুঁজতে যেতে হয় না।
              ⚠️ ছবির মেয়াদ সার্ভার থেকে আসে, হাতে লেখা নয়; নীতি বদলালে
                 পাতাটা পুরোনো প্রতিশ্রুতি দেখাত।
            */}
            <Card title="What is recorded" hint="And for how long">
              <dl className="space-y-2.5 text-[13px]">
                <Row term="Screenshots">
                  Kept {summary.data.screenshotRetentionDays} days, then deleted
                  automatically —{' '}
                  <Link to="/screenshots" className="underline">
                    see yours
                  </Link>
                </Row>
                <Row term="Working hours">
                  Active time only. Idle and locked time is recorded but never
                  counted as work.
                </Row>
                <Row term="Policy signed">
                  {summary.data.policySignedAt
                    ? formatDate(summary.data.policySignedAt)
                    : 'Not recorded yet'}
                </Row>
                {summary.data.employee.joinedOn && (
                  <Row term="Joined">
                    {formatDate(summary.data.employee.joinedOn)}
                  </Row>
                )}
              </dl>
            </Card>
          </div>
        </div>
      )}

      {linked && (
      <div className="mt-4 space-y-4">
        <Card
          title="Day by day"
          hint="Last 30 days · days off and empty days are shown too"
          padded={false}
        >
          {days.loading && <Loading />}
          {days.error && <ErrorBox error={days.error} retry={days.reload} />}
          {days.data?.length === 0 && <Empty title="Nothing recorded yet" />}
          {days.data && days.data.length > 0 && <DayTable rows={days.data} />}
        </Card>

        {/*
          ⭐ J08 — নিজের সংশোধন, কারণসহ। কম্পোনেন্টটা owner-এর পাতার
          সাথে **ভাগ করা**: owner ওখানে যোগ করার বোতামও পান, স্টাফ শুধু
          তালিকাটা দেখেন (`isOwner` ভেতরেই যাচাই হয়)। দুটো আলাদা
          কম্পোনেন্ট লিখলে একদিন দুই পাতায় দুই রকম কারণ দেখাত।
        */}
        {user?.employeeId != null && (
          <Adjustments employeeId={user.employeeId} nonce={0} />
        )}
      </div>
      )}
    </Page>
  );
}

function Line({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
        <span className="text-ink-2">{label}</span>
        <span className="text-ink-3">
          <Duration seconds={value} /> / <Duration seconds={max} />
        </span>
      </div>
      <ProgressBar value={value} max={max} ariaLabel={label} />
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="min-w-[120px] text-ink-3">{term}</dt>
      <dd className="min-w-0 flex-1 text-ink-2">{children}</dd>
    </div>
  );
}

function DayTable({ rows }: { rows: MyDay[] }) {
  const monthStart = monthStartOf(todayInDhaka());

  return (
    <Table
      rows={rows}
      rowKey={(r) => r.workDate}
      // ⚠️ ছুটির দিন ম্লান — "কাজ করোনি" নয়, "করার কথা ছিল না"
      rowMuted={(r) => r.isOffDay && r.workedSec === 0}
      columns={[
        {
          key: 'date',
          header: 'Date',
          render: (r) => (
            <span className="num">
              {formatDateShort(r.workDate)}{' '}
              <span className="text-ink-3">{weekdayOf(r.workDate)}</span>
            </span>
          ),
        },
        {
          key: 'worked',
          header: 'Worked',
          align: 'right',
          render: (r) => (
            <Duration
              seconds={r.workedSec}
              tone={r.workedSec === 0 ? 'muted' : 'counted'}
            />
          ),
        },
        {
          key: 'adjust',
          header: 'Correction',
          align: 'right',
          render: (r) =>
            // ⚠️ শূন্য হলে ড্যাশ — `+0:00` লিখলে প্রতিটা সারিতে মনে হতো
            //    কিছু একটা বদলানো হয়েছে
            r.adjustmentSec === 0 ? (
              <span className="text-ink-3">—</span>
            ) : (
              <span className="num">{formatSignedDuration(r.adjustmentSec)}</span>
            ),
        },
        {
          key: 'credited',
          header: 'Counted',
          align: 'right',
          render: (r) => <Duration seconds={r.creditedSec} />,
        },
        {
          key: 'note',
          header: '',
          render: (r) =>
            r.isOffDay ? (
              <span className="text-[11.5px] text-ink-3">Day off</span>
            ) : null,
        },
      ]}
      footer={
        <tr>
          <td className="px-3 py-2 text-[12.5px] text-ink-3">
            This month so far
          </td>
          <td colSpan={3} className="px-3 py-2 text-right">
            <Duration
              seconds={rows
                .filter((r) => r.workDate >= monthStart)
                .reduce((sum, r) => sum + r.creditedSec, 0)}
            />
          </td>
          <td />
        </tr>
      }
    />
  );
}
