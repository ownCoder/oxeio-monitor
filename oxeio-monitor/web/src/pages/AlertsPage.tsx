import { useState } from 'react';

import {
  acknowledgeAlert,
  acknowledgeAllAlerts,
  ALERT_SEVERITY_LABEL,
  ALERT_TYPE_LABEL,
  listAlerts,
  type AlertRow,
  type AlertType,
} from '../api/alerts';
import { getOpsHealth, runBackupNow, runRetentionNow } from '../api/ops';
import { usePolling, useApi } from '../api/useApi';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Card, Stat, StatRow } from '../components/Card';
import { Page } from '../components/Page';
import { Empty, ErrorBox, Loading } from '../components/States';
import { Table } from '../components/Table';
import { formatAgo, formatDateTime } from '../lib/format';
import { Chip, MiniButton, Notice, ServerError, useMutation } from './settings/ui';

/**
 * **G01–G07 · K04** — অ্যালার্ট ও সার্ভারের হেলথ।
 *
 * ⚠️⚠️ `api/alerts.ts` ফাইলটা অনেক আগেই লেখা হয়েছিল — টাইপ, লেবেল,
 * ফিল্টার, `openCount` সব — কিন্তু **কোনো পাতা সেটা ব্যবহার করত না**।
 * অর্থাৎ সার্ভার নিয়ম মেনে অ্যালার্ট তুলত, ইমেইলও পাঠাত, কিন্তু
 * ড্যাশবোর্ডে ঢুকে মালিক একটাও দেখতে পেতেন না। ইমেইল মিস হলে ঘটনাটা
 * চিরতরে হারাত।
 *
 * ⭐ হেলথটা **একই পাতায়**, আলাদা কোথাও নয়: "কিছু কি ভাঙা?" প্রশ্নের
 * উত্তর দু-জায়গায় ভাগ থাকলে মানুষ একটাও খুলত না।
 */
export function AlertsPage() {
  const { user } = useAuth();
  const [showAll, setShowAll] = useState(false);

  /**
   * ⚠️ পোলিং, একবারের `useApi` নয় — এই পাতাটা খুলে রেখে দেওয়া হয়
   * (ইনসিডেন্টের সময় দ্বিতীয় মনিটরে)। ⭐ `usePolling` লুকোনো ট্যাবে
   * নিজেই থেমে যায়, তাই সারারাত খোলা থাকলেও সার্ভারে ঝড় ওঠে না।
   */
  const alerts = usePolling(
    (signal) => listAlerts({ status: showAll ? 'all' : 'open' }, signal),
    30_000,
    [showAll],
  );

  const health = useApi((signal) => getOpsHealth(signal), []);
  const ackAll = useMutation();

  if (user?.role !== 'owner') {
    return (
      <Page title="Alerts">
        <ErrorBox error={new ApiError(403, "You don't have access")} />
      </Page>
    );
  }

  const rows = alerts.data?.rows ?? [];

  return (
    <Page
      title="Alerts"
      subtitle={
        alerts.data
          ? `${alerts.data.openCount} still open`
          : 'What the server noticed on its own'
      }
      actions={
        <MiniButton onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show only open' : 'Show all'}
        </MiniButton>
      }
    >
      <div className="space-y-4">
        <HealthCard
          data={health.data}
          loading={health.loading}
          error={health.error}
          reload={health.reload}
        />

        <Card
          title={showAll ? 'All Alerts' : 'Open Alerts'}
          hint="Nothing is ever deleted — acknowledging just marks it seen"
          padded={false}
          actions={
            /*
              ⭐ **"Seen all"** — এক ক্লিকে সব খোলা অ্যালার্ট দেখা *(১৮ আগস্ট)*।
                 G01 ("এজেন্ট চুপ") ১২টা PC-তে বারবার এলে ১১৮টা ওয়ার্নিং জমে,
                 আর এক-এক করে চাপা যন্ত্রণা।

              ⚠️ শুধু **খোলা** থাকলে দেখানো হয় (`openCount > 0`) — সব দেখা
                 থাকলে বোতামটাই বসে না, নইলে "কিছু নেই" অবস্থায় একটা নিষ্ক্রিয়
                 বোতাম বিভ্রান্তি করত।

              ⚠️ নিশ্চিত-প্রম্পট — এটা একসাথে অনেকগুলো ছোঁয়, তাই ভুল ক্লিকে
                 যেন গোটা তালিকা নীরবে seen না হয়ে যায়।
            */
            (alerts.data?.openCount ?? 0) > 0 ? (
              <MiniButton
                disabled={ackAll.busy}
                onClick={() =>
                  ackAll.run(async () => {
                    const n = alerts.data?.openCount ?? 0;
                    if (!window.confirm(`Mark all ${n} open alerts as seen?`)) {
                      return;
                    }
                    await acknowledgeAllAlerts();
                    alerts.reload();
                  })
                }
              >
                {ackAll.busy ? 'Marking…' : 'Seen all'}
              </MiniButton>
            ) : undefined
          }
        >
          {alerts.loading && !alerts.data && <Loading />}
          {alerts.error && (
            <ErrorBox error={alerts.error} retry={alerts.reload} />
          )}
          {alerts.data && rows.length === 0 && (
            <Empty
              title={showAll ? 'No alerts at all' : 'Nothing open'}
              hint={
                showAll
                  ? 'The server has not raised a single alert yet.'
                  : 'Everything raised so far has been acknowledged.'
              }
            />
          )}
          {rows.length > 0 && (
            <AlertTable rows={rows} onChanged={alerts.reload} />
          )}
        </Card>
      </div>
    </Page>
  );
}

function AlertTable({
  rows,
  onChanged,
}: {
  rows: AlertRow[];
  onChanged: () => void;
}) {
  const { busy, error, run } = useMutation();

  return (
    <>
      <ServerError error={error} />
      <Table
        rows={rows}
        rowKey={(r) => r.id}
        // ⚠️ acknowledge **বা** সার্ভার নিজে-বন্ধ করা সারি ম্লান — কিন্তু
        //    **থেকে যায়**, কারণ ইতিহাসটাই পরে ঘণ্টা সংশোধনের প্রমাণ (ADR-011e)
        rowMuted={(r) => r.acknowledgedAt !== null || r.resolvedAt !== null}
        columns={[
          {
            key: 'severity',
            header: '',
            render: (r) => (
              <Chip
                tone={
                  r.severity === 'critical'
                    ? 'attention'
                    : r.severity === 'warning'
                      ? 'pending'
                      : 'muted'
                }
              >
                {ALERT_SEVERITY_LABEL[r.severity] ?? r.severity}
              </Chip>
            ),
          },
          {
            key: 'what',
            header: 'What',
            render: (r) => (
              <div className="min-w-0">
                <div className="font-medium">
                  {ALERT_TYPE_LABEL[r.type as AlertType] ?? r.type}
                </div>
                {/* ⭐ শিরোনামে নাম/হোস্টনেম থাকে — ওটাই কাজের তথ্য */}
                <div className="text-[12.5px] text-ink-2">{r.title}</div>
                {r.detail && (
                  <div className="mt-0.5 max-w-prose text-[12px] text-ink-3">
                    {r.detail}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'when',
            header: 'When',
            render: (r) => (
              <span
                className="num text-[12.5px] text-ink-3"
                title={formatDateTime(r.createdAt)}
              >
                {formatAgo(r.createdAt)}
              </span>
            ),
          },
          {
            key: 'sent',
            header: 'Sent',
            render: (r) =>
              r.channelsSent.length > 0 ? (
                <span className="text-[12px] text-ink-3">
                  {r.channelsSent.join(', ')}
                </span>
              ) : (
                // ⚠️ "কোথাও যায়নি" আর "ইমেইল গেছে" — পার্থক্যটা জরুরি:
                //    SMTP বন্ধ থাকলে এই কলামটাই একমাত্র সূত্র
                <span className="text-[12px] text-ink-3">—</span>
              ),
          },
          {
            key: 'ack',
            header: '',
            align: 'right',
            render: (r) =>
              r.acknowledgedAt ? (
                <span className="text-[12px] text-ink-3">
                  Seen{r.acknowledgedBy ? ` by ${r.acknowledgedBy}` : ''}
                </span>
              ) : r.resolvedAt ? (
                /*
                  ⭐ সার্ভার **নিজে** বন্ধ করেছে (এজেন্ট ফিরে এসেছে) — কোনো
                     বোতাম নয়, কারণ "দেখার" কিছু নেই। সারিটা ইতিহাসে থেকে যায়
                     (Show all-এ), কিন্তু খোলা গোনায় ঢোকে না।
                */
                <span
                  className="text-[12px] text-ink-3"
                  title={`Resolved on its own — ${formatDateTime(r.resolvedAt)}`}
                >
                  Resolved
                </span>
              ) : (
                <MiniButton
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await acknowledgeAlert(r.id);
                      onChanged();
                    })
                  }
                >
                  Seen
                </MiniButton>
              ),
          },
        ]}
      />
    </>
  );
}

/**
 * ⭐ হেলথটা উপরে, ছোট করে — অ্যালার্ট **ঘটনা**, হেলথ **অবস্থা**। দুটো
 * এক তালিকায় মেশালে "এখন কী ভাঙা" প্রশ্নের উত্তর খুঁজে পাওয়া যেত না।
 */
function HealthCard({
  data,
  loading,
  error,
  reload,
}: {
  data: import('../api/ops').OpsHealth | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}) {
  const jobs = useMutation();
  const [ran, setRan] = useState<string | null>(null);

  return (
    <Card
      title="Server Health"
      hint={data ? `Checked ${formatAgo(data.checkedAt)}` : undefined}
      actions={
        <div className="flex gap-2">
          {/*
            ⭐ দুটো বোতামই "চোখে দেখার" জন্য: যে ব্যাকআপ কখনো পরীক্ষা
            করা হয়নি সেটা ব্যাকআপ নয়, অনুমান। একই যুক্তি retention-এও —
            নীতিমালায় স্টাফকে "৯০ দিন পর ছবি মুছে যাবে" বলা আছে।
          */}
          <MiniButton
            disabled={jobs.busy}
            onClick={() =>
              jobs.run(async () => {
                const r = await runBackupNow();
                setRan(
                  r.ok
                    ? `Backup done${r.fileName ? ` — ${r.fileName}` : ''}`
                    : `Backup failed — ${r.error ?? r.skipped ?? 'unknown'}`,
                );
                reload();
              })
            }
          >
            Back up now
          </MiniButton>
          <MiniButton
            disabled={jobs.busy}
            onClick={() =>
              jobs.run(async () => {
                const r = await runRetentionNow();
                setRan(
                  r.skipped
                    ? 'A cleanup was already running'
                    : `Cleanup done — ${r.rowsDeleted} old screenshots removed`,
                );
                reload();
              })
            }
          >
            Delete old screenshots
          </MiniButton>
        </div>
      }
    >
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} retry={reload} />}
      <ServerError error={jobs.error} />
      {ran && <Notice>{ran}</Notice>}

      {data && (
        <div className="space-y-3">
          {data.problems.length > 0 && (
            <Notice tone="attention">
              {data.problems.join(' · ')}
            </Notice>
          )}

          <StatRow>
            <Stat
              label="Status"
              value={data.status === 'ok' ? 'Healthy' : data.status === 'degraded' ? 'Degraded' : 'Down'}
              tone={data.status === 'ok' ? 'counted' : 'attention'}
            />
            <Stat
              label="Disk used"
              value={data.disk.usedPct === null ? '—' : `${Math.round(data.disk.usedPct)}%`}
              unit={data.disk.free ? `${data.disk.free} free` : undefined}
              tone={
                data.disk.usedPct !== null && data.disk.usedPct >= 85
                  ? 'attention'
                  : 'counted'
              }
            />
            <Stat
              label="Last backup"
              value={
                data.backup.lastSuccessAt
                  ? formatAgo(data.backup.lastSuccessAt)
                  : 'Never'
              }
              tone={data.backup.problem ? 'attention' : 'counted'}
            />
            <Stat
              label="Agents quiet"
              value={data.devices.silent}
              unit={`of ${data.devices.active}`}
              // ⚠️ লাল নয়: রাতে সবাই চুপ থাকাই স্বাভাবিক, আর তাতে
              //    status-ও খারাপ হয় না (সার্ভারের নিয়ম)
              tone={data.devices.silent > 0 ? 'muted' : 'counted'}
            />
          </StatRow>
        </div>
      )}
    </Card>
  );
}
