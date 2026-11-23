import { useState } from 'react';
import { NavLink, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../api/useApi';
import {
  age,
  changeProduction,
  dhakaDate,
  getProduction,
  LABELS,
  QUEUES,
  stamp,
  type Digest,
  type Monitor,
  type Quality,
  type Queue,
  type QueuePage,
  type Workload,
} from '../../api/production';
import { TargetDrawer } from './TargetDrawer';
import { ProductResults } from './ProductResults';
import { ActionCenterView } from './ActionCenter';
import './production.css';

export function ProductionPage() {
  const { section = 'board' } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const target = Number(params.get('target'));
  const manager = user?.role === 'owner' || user?.role === 'manager';
  const tabs = [
    ['board', 'Production Board'],
    ...(manager
      ? [
          ['action-center', 'Action Center'],
          ['workload', 'Workload'],
          ['quality', 'Quality & flow'],
        ]
      : []),
    ...(user?.role === 'owner'
      ? [
          ['digest', 'Action digest'],
          ['monitor', 'System checks'],
          ['sales', 'Product results'],
        ]
      : []),
  ];
  function open(id: number) {
    setParams((previous) => {
      previous.set('target', String(id));
      return previous;
    });
  }
  return (
    <div className="production">
      <div className="production-header">
        <div>
          <p>STUDIO / PRODUCTION</p>
          <h1>
            {tabs.find((t) => t[0] === section)?.[1] ?? 'Target workspace'}
          </h1>
          <p>
            From assignment to live product, with a clear record of every step.
          </p>
        </div>
        <span className="production-pill">Dhaka time</span>
      </div>
      {user?.role !== 'employee' && (
        <nav className="production-tabs" aria-label="Production sections">
          {tabs.map(([path, label]) => (
            <NavLink key={path} to={`/production/${path}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      )}
      {section === 'board' && user?.role !== 'employee' && (
        <Board open={open} />
      )}
      {section === 'action-center' && manager && <ActionCenterView open={open} />}
      {section === 'workload' && manager && <WorkloadView />}
      {section === 'quality' && manager && <QualityView />}
      {section === 'digest' && user?.role === 'owner' && <DigestView />}
      {section === 'monitor' && user?.role === 'owner' && <MonitorView />}
      {section === 'sales' && user?.role === 'owner' && (
        <ProductResults open={open} />
      )}
      {user?.role === 'employee' && (
        <p>Open a job from My data to view its history and design previews.</p>
      )}
      {target > 0 && Number.isSafeInteger(target) && (
        <TargetDrawer
          key={target}
          id={target}
          close={() =>
            setParams((previous) => {
              previous.delete('target');
              return previous;
            })
          }
        />
      )}
    </div>
  );
}
function Board({ open }: { open: (id: number) => void }) {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get('q') ?? '');
  const q = params.get('q') ?? '',
    staffId = params.get('staffId') ?? '';
  const [revision, setRevision] = useState(0);
  return (
    <>
      <form
        className="production-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setParams((previous) => {
            if (draft.trim()) previous.set('q', draft.trim());
            else previous.delete('q');
            return previous;
          });
        }}
      >
        <label>
          Find work
          <input
            value={draft}
            maxLength={100}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Job number or source ASIN"
          />
        </label>
        <button>Search</button>
        <button type="button" onClick={() => setRevision((n) => n + 1)}>
          Refresh board
        </button>
        {staffId && (
          <button
            type="button"
            onClick={() =>
              setParams((previous) => {
                previous.delete('staffId');
                return previous;
              })
            }
          >
            Clear staff filter
          </button>
        )}
      </form>
      <p>
        Elapsed waiting time includes nights and holidays. Review and upload
        queues can overlap; counts are not additive.
      </p>
      <div className="production-board">
        {QUEUES.map((queue) => (
          <QueueColumn
            key={`${queue}:${q}:${staffId}:${revision}`}
            queue={queue}
            q={q}
            staffId={staffId}
            open={open}
          />
        ))}
      </div>
    </>
  );
}
function QueueColumn({
  queue,
  q,
  staffId,
  open,
}: {
  queue: Queue;
  q: string;
  staffId: string;
  open: (id: number) => void;
}) {
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({
    queue,
    page: String(page),
    ...(q ? { q } : {}),
    ...(staffId ? { staffId } : {}),
  });
  const result = useApi(
    (signal) => getProduction<QueuePage>(`queue?${query}`, signal),
    [queue, q, staffId, page],
  );
  return (
    <section className="production-column">
      <h2>
        {LABELS[queue]} <span>{result.data?.total ?? '—'}</span>
      </h2>
      {result.error && (
        <p className="production-error" role="alert">
          {result.error.message}
          <button onClick={result.reload}>Retry</button>
        </p>
      )}
      {result.loading && <p>Loading…</p>}
      {result.data?.rows.map((row) => (
        <button
          className="production-card"
          key={row.id}
          onClick={() => open(row.id)}
        >
          <div className="production-card-footer">
            <strong>Job {row.jobNumber ?? '—'}</strong>
            {row.priority > 0 && (
              <span className="production-pill">
                {row.priority === 2 ? 'High' : 'Medium'}
              </span>
            )}
          </div>
          <small>{row.asin}</small>
          <span>{row.assignedTo?.fullName ?? 'Unassigned'}</span>
          <div className="production-card-footer">
            <small
              className={(row.waitingHours ?? 0) >= 48 ? 'production-warn' : ''}
            >
              {age(row.waitingHours)}
            </small>
            {row.dueAt && <small>Due {dhakaDate(row.dueAt)}</small>}
          </div>
        </button>
      ))}
      {result.data?.total === 0 && <p>No work in this queue.</p>}
      {result.data && result.data.pages > 1 && (
        <div className="production-actions">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            ←
          </button>
          <span>
            {page} / {result.data.pages}
          </span>
          <button
            disabled={page >= result.data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </button>
        </div>
      )}
    </section>
  );
}
function WorkloadView() {
  const result = useApi(
    (signal) => getProduction<Workload[]>('workload', signal),
    [],
  );
  return (
    <section className="production-panel">
      <h2>Assigned work by designer</h2>
      <p>
        Counts show current assignments. Daily target is a planning reference,
        not a new completion cap. Open a queue and select a job to change
        priority or assignment.
      </p>
      {result.error && <p role="alert">{result.error.message}</p>}
      {result.loading && <p>Loading…</p>}
      <div className="production-scroll">
        <table>
          <thead>
            <tr>
              {[
                'Staff',
                'Unstarted',
                'Started',
                'Daily target',
                'High priority',
                'Overdue',
                '',
              ].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.data?.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.fullName}</strong>
                  <p>{row.empCode}</p>
                </td>
                <td>{row.unstarted}</td>
                <td>{row.started}</td>
                <td>{row.dailyDesignTarget}</td>
                <td>{row.highPriority}</td>
                <td>{row.overdue}</td>
                <td>
                  <NavLink to={`/production/board?staffId=${row.id}`}>
                    View work →
                  </NavLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.data?.length === 0 && <p>No active design staff.</p>}
    </section>
  );
}
function QualityView() {
  const [from, setFrom] = useState(
    dhakaDate(new Date(Date.now() - 29 * 86400000).toISOString()),
  );
  const [to, setTo] = useState(dhakaDate(new Date().toISOString()));
  const result = useApi(
    (signal) =>
      getProduction<Quality>(
        `quality?${new URLSearchParams({ from, to })}`,
        signal,
      ),
    [from, to],
  );
  const data = result.data;
  return (
    <>
      <div className="production-toolbar">
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {result.error && (
        <p className="production-error" role="alert">
          {result.error.message}
        </p>
      )}
      {result.loading && <p>Loading report…</p>}
      {data && (
        <>
          <div className="production-metrics">
            {[
              [
                'First recorded review pass',
                data.firstPassRate === null
                  ? '—'
                  : `${(100 * data.firstPassRate).toFixed(1)}%`,
                `${data.accepted} accepted / ${data.reviewed} reviewed`,
              ],
              [
                'Rework at first recorded review',
                data.rework,
                'Observed checks in this period',
              ],
              [
                'Complete → upload',
                data.completeToUploadHours === null
                  ? '—'
                  : `${data.completeToUploadHours.toFixed(1)}h`,
                `Median · ${data.uploadSamples} samples`,
              ],
              [
                'Upload → live',
                data.uploadToLiveHours === null
                  ? '—'
                  : `${data.uploadToLiveHours.toFixed(1)}h`,
                `Median · ${data.liveSamples} samples`,
              ],
            ].map(([label, value, hint]) => (
              <article
                className="production-panel production-metric"
                key={label}
              >
                <p>{label}</p>
                <strong>{value}</strong>
                <p>{hint}</p>
              </article>
            ))}
          </div>
          <p>
            Review history begins {stamp(data.historySince)}. Earlier reviews
            are unknown; the first recorded check may not be a job’s first-ever
            check. Durations are elapsed time, not labor hours. Missing
            timestamps are excluded and shown through sample counts.
          </p>
          <section className="production-panel">
            <h2>Estimate accuracy by work type</h2>
            <p>{data.estimates.matched} of {data.estimates.planned} planned completed designs have matched file activity.{data.estimates.missingObserved > 0 && ` ${data.estimates.missingObserved} without matched activity are excluded.`}{data.estimates.tracesLimited && ' Latest 50,000 observations only.'}</p>
            {data.estimates.byType.length ? <div className="production-scroll"><table><thead><tr><th>Work type</th><th>Samples</th><th>Median plan</th><th>Median observed</th><th>Median variance</th><th>Over plan</th></tr></thead><tbody>
              {data.estimates.byType.map(row => <tr key={row.workType}><td>{({ typography: 'Typography', graphic: 'Graphic', illustration: 'Illustration', seasonal: 'Seasonal', other: 'Other' } as Record<string, string>)[row.workType] ?? row.workType}</td><td>{row.samples}</td><td>{row.medianEstimateMinutes}m</td><td>{row.medianObservedMinutes}m</td><td>{row.medianVariancePct > 0 ? '+' : ''}{row.medianVariancePct}%</td><td>{row.overEstimate} / {row.samples}</td></tr>)}
            </tbody></table></div> : <p>No completed designs have both an estimate and matched file activity in this period.</p>}
            <p>Observed means matched design-file foreground time, not payroll credit or quality. Medians reduce the effect of unusually long files; sample counts stay visible.</p>
          </section>
        </>
      )}
    </>
  );
}
function DigestView() {
  const result = useApi(
    (signal) => getProduction<Digest>('digest', signal),
    [],
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      await changeProduction(
        'digest',
        {
          enabled: form.get('enabled') === 'on',
          staleHours: Number(form.get('hours')),
        },
        'PATCH',
      );
      result.reload();
      setMessage('Digest settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="production-panel">
      <h2>One actionable daily summary</h2>
      <p>
        Runs at 18:45 Dhaka. Sends only when overdue or stalled work needs
        attention. Uses the private owner Telegram chat configured in Settings.
      </p>
      {result.error && <p role="alert">{result.error.message}</p>}
      {result.data && (
        <>
          <form
            key={`${result.data.config.enabled}:${result.data.config.staleHours}`}
            onSubmit={(e) => void save(e)}
          >
            <div className="production-toolbar">
              <label>
                <span>
                  <input
                    name="enabled"
                    type="checkbox"
                    defaultChecked={result.data.config.enabled}
                  />{' '}
                  Enable daily delivery
                </span>
              </label>
              <label>
                Waiting threshold (hours)
                <input
                  type="number"
                  name="hours"
                  min={1}
                  max={720}
                  defaultValue={result.data.config.staleHours}
                  required
                />
              </label>
              <button disabled={busy}>Save settings</button>
            </div>
          </form>
          <p>
            Backup/copy failure:{' '}
            {result.data.backupFailed
              ? 'Needs attention — see System checks'
              : 'None recorded'}
          </p>
          <p>
            Last run:{' '}
            {result.data.last
              ? `${stamp(result.data.last.at)} · ${result.data.last.outcome}`
              : 'Not run yet'}
          </p>
          <div className="production-metrics">
            <article className="production-panel production-metric">
              <p>Overdue assigned work</p>
              <strong>{result.data.overdue}</strong>
            </article>
            {result.data.queues.map((q) => (
              <article
                className="production-panel production-metric"
                key={q.queue}
              >
                <p>{LABELS[q.queue]} · above threshold</p>
                <strong>{q.count}</strong>
              </article>
            ))}
          </div>
          <p>
            Queue counts can overlap. Quiet days record a successful run without
            sending a message.
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
function MonitorView() {
  const result = useApi(
    (signal) => getProduction<Monitor>('monitor', signal),
    [],
  );
  return (
    <>
      <section className="production-panel">
        <h2>Independent monitoring</h2>
        <p>
          External monitors detect silence when this server is unavailable.
          Configure Healthchecks ping URLs on the VPS and set a 10-minute uptime
          timeout and 26-hour daily job timeout. Add an external HTTP check for
          /api/v1/health.
        </p>
        {result.error && <p role="alert">{result.error.message}</p>}
        {result.data && (
          <>
            <div className="production-metrics">
              {[
                [
                  'Uptime',
                  result.data.uptimeConfigured,
                  result.data.heartbeats?.uptime,
                ],
                [
                  'Backup job',
                  result.data.backupConfigured,
                  result.data.heartbeats?.backup,
                ],
                [
                  'Action digest',
                  result.data.digestConfigured,
                  result.data.heartbeats?.digest,
                ],
              ].map(([label, configured, at]) => (
                <article className="production-panel" key={String(label)}>
                  <h2>{label}</h2>
                  <p>{configured ? 'Ping URL configured' : 'Setup required'}</p>
                  <p>
                    Last delivered observation:{' '}
                    {stamp(typeof at === 'string' ? at : null)}
                  </p>
                </article>
              ))}
            </div>
            <p>
              Local backup: {result.data.backup?.lastOutcome ?? 'Unknown'} ·
              last success {stamp(result.data.backup?.lastSuccessAt)} · offsite
              copy {result.data.backup?.lastCopyOutcome ?? 'Unknown'}
            </p>
            <h2>Restore verification</h2>
            <p>{result.data.restoreVerification}</p>
            <p>
              Ask the operator to run the restore drill from the operations
              guide. The drill decrypts a backup and restores it into an
              isolated temporary database, then records table counts and
              integrity checks.
            </p>
          </>
        )}
        <button onClick={result.reload}>Refresh checks</button>
      </section>
    </>
  );
}
