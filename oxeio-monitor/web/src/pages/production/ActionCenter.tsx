import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProduction, stamp, type ActionCenter, type ActionType } from '../../api/production';
import { useApi } from '../../api/useApi';

const LABEL: Record<ActionType, string> = {
  skip_review: 'Skip reviews',
  replacement_owed: 'Replacement owed',
  rework: 'Rework',
  overdue: 'Overdue',
  unstarted: 'Unstarted',
  agent_data_missing: 'Agent setup',
};

export function ActionCenterView({ open }: { open: (id: number) => void }) {
  const [revision, setRevision] = useState(0);
  const [type, setType] = useState<ActionType | 'all'>('all');
  const [search, setSearch] = useState('');
  const result = useApi((signal) => getProduction<ActionCenter>('action-center', signal), [revision]);
  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return (result.data?.rows ?? []).filter((row) =>
      (type === 'all' || row.type === type) &&
      (!q || `${row.title} ${row.detail} ${row.person?.fullName ?? ''} ${row.person?.empCode ?? ''}`.toLocaleLowerCase().includes(q)),
    );
  }, [result.data, search, type]);
  if (result.loading && !result.data) return <p>Loading current actions…</p>;
  if (result.error) return <div className="production-error">{result.error.message}</div>;
  const data = result.data!;
  return <>
    <section className="production-panel action-center-head">
      <div><h2>One queue for management action</h2><p>Current facts from skip review, replacement, deadlines, rework and agent setup. Categories can overlap; each row opens the exact record.</p></div>
      <button onClick={() => setRevision((value) => value + 1)}>Refresh</button>
    </section>
    <div className="action-center-metrics">
      {(Object.keys(LABEL) as ActionType[]).map((key) => <button key={key} className={type === key ? 'active' : ''} onClick={() => setType(type === key ? 'all' : key)}>
        <span>{LABEL[key]}</span><strong>{data.counts[key]}</strong>
      </button>)}
    </div>
    <div className="production-toolbar">
      <label>Find action<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Staff, job or ASIN" /></label>
      {(type !== 'all' || search) && <button onClick={() => { setType('all'); setSearch(''); }}>Clear filters</button>}
      <span className="production-pill">{rows.length} shown · {data.total} actions</span>
    </div>
    {data.limited && <p>Each category shows its first 25 actions. Use the linked record for the full queue.</p>}
    <section className="action-center-list" aria-live="polite">
      {rows.map((row) => <article key={row.id} className={`action-center-row priority-${row.priority}`}>
        <div><span className="production-pill">{LABEL[row.type]}</span><h3>{row.title}</h3><p>{row.detail}</p><small>{row.person ? `${row.person.empCode} · ${row.person.fullName}` : 'No assignee'}{row.at ? ` · ${stamp(row.at)}` : ''}</small></div>
        {row.targetId !== null && row.type !== 'skip_review' && row.type !== 'replacement_owed'
          ? <button onClick={() => open(row.targetId!)}>{row.action}</button>
          : <Link className="action-center-link" to={row.href}>{row.action}</Link>}
      </article>)}
      {rows.length === 0 && <div className="production-panel"><h2>No matching action</h2><p>There is nothing in this filter right now.</p></div>}
    </section>
  </>;
}
