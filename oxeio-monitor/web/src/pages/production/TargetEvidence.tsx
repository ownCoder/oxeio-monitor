import { useApi } from '../../api/useApi';
import { getProduction, stamp, type TargetEvidence as Evidence } from '../../api/production';
import { formatDuration } from '../../lib/format';

const kinds: Record<string, string> = { brief: 'Design brief', blocker: 'Help request', submission: 'Submission checklist' };
const workTypes: Record<string, string> = { typography: 'Typography', graphic: 'Graphic', illustration: 'Illustration', seasonal: 'Seasonal', other: 'Other' };
function variance(estimateMinutes: number, observedSec: number): string {
  const delta = Math.round(observedSec / 60) - estimateMinutes;
  if (Math.abs(delta) < 5) return 'Observed time is close to plan';
  return `${formatDuration(Math.abs(delta) * 60)} ${delta > 0 ? 'over' : 'under'} plan`;
}
function detail(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(item => typeof item === 'boolean' ? item ? '✓' : '○' : String(item)).join(' · ');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function TargetEvidence({ id, review, history }: { id: number; review: () => void; history: () => void }) {
  const result = useApi(signal => getProduction<Evidence>(`targets/${id}/evidence`, signal), [id]);
  const data = result.data;
  return <div className="design-evidence">
    <div className="production-actions"><h2>Design evidence</h2><button type="button" onClick={history}>Target history</button><button type="button" onClick={result.reload} disabled={result.loading}>{result.loading ? 'Refreshing…' : 'Refresh evidence'}</button></div>
    {result.error && <p role="alert" className="production-error">{result.error.message}</p>}
    {!data && result.loading && <p role="status">Loading design activity…</p>}
    {data && <>
      <div className="design-evidence-stats">
        <article><small>Planned time</small><strong>{data.estimatedMinutes ? formatDuration(data.estimatedMinutes * 60) : '—'}</strong><span>{data.estimatedMinutes ? `${data.workType ? workTypes[data.workType] ?? data.workType : 'Unclassified'} · ${variance(data.estimatedMinutes, data.foregroundSec)}` : 'Not estimated yet'}</span></article>
        <article><small>File foreground time</small><strong>{formatDuration(data.foregroundSec)}</strong><span>{data.observations} active observations{data.tracesLimited ? ' · latest 5,000 only' : ''}</span></article>
        <article><small>Matched screenshots</small><strong>{data.screenshotTotal}</strong><span>From retained captures</span></article>
        <article><small>Preview versions</small><strong>{data.previewVersions}</strong><button type="button" onClick={review}>Open design review ↗</button></article>
        <article><small>Open review comments</small><strong>{data.unresolvedComments}</strong><button type="button" onClick={review}>Review comments ↗</button></article>
      </div>
      <p className="design-evidence-note">Planned time is a manager estimate. Observed time is matched from the job number at the start of an Illustrator/Photoshop window title; overlaps on the same person's devices count once. It is file activity, not payroll credit or a quality verdict. {data.scope === 'self' && 'Only your activity is shown.'}</p>
      <div className="design-evidence-columns">
        <section><h2>Who worked on this file</h2>
          {data.byPerson.length ? <ul className="design-evidence-people">{data.byPerson.map(person => <li key={person.employeeId}><span><strong>{person.fullName}</strong><small>{person.empCode} · {person.observations} observations</small></span><b>{formatDuration(person.foregroundSec)}</b></li>)}</ul> : <p>No matching file activity. Unsaved files, different names or other design apps may leave no match.</p>}
          <p>First seen: {data.firstSeenAt ? stamp(data.firstSeenAt) : '—'}<br />Last seen: {data.lastSeenAt ? stamp(data.lastSeenAt) : '—'}</p>
        </section>
        <section><h2>Briefs, help &amp; checklists</h2>
          {data.officeEntries.length ? data.officeEntries.map(entry => <details key={entry.id} className="design-evidence-record"><summary><strong>{entry.title}</strong><small>{kinds[entry.kind] ?? entry.kind} · {stamp(entry.updatedAt)}</small></summary><dl>{Object.entries(entry.content).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, ' $1')}</dt><dd>{detail(value)}</dd></div>)}</dl></details>) : <p>No linked brief, help request or submission checklist yet.</p>}
          {data.officeEntries.length === 20 && <p>Showing the latest 20 linked records.</p>}
        </section>
      </div>
      <section className="design-evidence-captures"><div className="production-actions"><h2>Matching screenshots</h2><span>{data.screenshots.length} of {data.screenshotTotal}</span></div>
        <p>Matched by the captured design-app window number. Open a capture for the full image; refresh evidence if its private link expires.</p>
        {data.screenshots.length ? <div className="design-evidence-gallery">{data.screenshots.map(shot => <a key={shot.id} href={shot.fullUrl} target="_blank" rel="noreferrer"><img loading="lazy" src={shot.thumbUrl} alt={`Job ${data.jobNumber} · ${shot.fullName} · ${stamp(shot.capturedAt)}`} /><span>{shot.fullName} · {shot.empCode}<br />{stamp(shot.capturedAt)} · Screen {shot.monitorIndex + 1}</span></a>)}</div> : <p>No retained screenshots match this job number.</p>}
      </section>
      <details className="design-evidence-record"><summary>Recent file activity · {data.timeline.length} observations</summary><div className="design-evidence-timeline"><table><thead><tr><th>Staff</th><th>App</th><th>Started</th><th>Ended</th></tr></thead><tbody>{data.timeline.map((row, index) => <tr key={`${row.deviceId}-${row.startedAt}-${index}`}><td>{row.fullName} · {row.empCode}</td><td>{row.processName}</td><td>{stamp(row.startedAt)}</td><td>{stamp(row.endedAt)}</td></tr>)}</tbody></table></div></details>
      <p className="design-evidence-note">Snapshot {stamp(data.generatedAt)}. Retention and missing capture data can limit the record.</p>
    </>}
  </div>;
}
