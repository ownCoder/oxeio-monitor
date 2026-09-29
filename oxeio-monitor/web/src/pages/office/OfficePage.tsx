import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useApi } from '../../api/useApi';
import { useAuth } from '../../auth/AuthContext';
import {
  defaults,
  editable,
  LABELS,
  taskProgress,
  type Content,
  type Entry,
  type Kind,
} from './office-view';
import './office.css';
type Person = { id: number; fullName: string; empCode: string };
const sections: Record<string, Kind[]> = {
  today: [],
  briefs: ['brief', 'brief_template'],
  help: ['blocker'],
  checks: ['submission', 'checklist_template'],
  library: ['sop'],
  equipment: ['asset'],
  people: ['lifecycle', 'lifecycle_template'],
  coaching: ['coaching'],
};
const names: Record<string, string> = {
  today: 'Today',
  briefs: 'Design briefs',
  help: 'Help requests',
  checks: 'Submission checks',
  library: 'SOP & examples',
  equipment: 'Equipment',
  people: 'Joining / leaving',
  coaching: 'Skills & coaching',
};
export function OfficePage() {
  const { section = 'today' } = useParams();
  const [params] = useSearchParams();
  const active = section in sections ? section : 'today';
  const { user } = useAuth();
  const management = user?.role === 'owner' || user?.role === 'manager';
  const [kind, setKind] = useState<Kind>('brief'),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState<Entry | null | undefined>(
      params.get('target') ? null : undefined,
    ),
    [error, setError] = useState(''),
    [archived, setArchived] = useState(false);
  const choices = sections[active];
  const selected = choices.includes(kind) ? kind : choices[0];
  const list = useApi(
    (signal) =>
      api<{ rows: Entry[]; total: number }>(
        `/office?${new URLSearchParams({ ...(selected ? { kind: selected } : {}), q, page: String(page), ...(archived ? { archived: 'yes' } : {}) })}`,
        { signal },
      ),
    [selected, q, page, revision, archived],
  );
  const people = useApi(
    (signal) => api<Person[]>('/office/people', { signal }),
    [],
  );
  async function open(row: Entry) {
    setError('');
    try {
      setEditing(await api<Entry>(`/office/${row.id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="office">
      <header>
        <p className="office-eyebrow">OXEIO / DAILY OPERATIONS</p>
        <h1>Office workspace</h1>
        <p>Clear instructions, help and follow-up in one place.</p>
      </header>
      <nav aria-label="Office sections">
        {Object.keys(sections).map((s) => (
          <Link
            aria-current={s === active ? 'page' : undefined}
            key={s}
            to={`/office/${s}`}
            onClick={() => {
              setPage(1);
              setQ('');
              setEditing(undefined);
            }}
          >
            {names[s]}
          </Link>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {active === 'today' ? (
        <Today management={management} />
      ) : (
        <>
          <div className="office-toolbar">
            {choices.map((k) => (
              <button
                key={k}
                aria-pressed={k === selected}
                onClick={() => {
                  setKind(k);
                  setPage(1);
                  setEditing(undefined);
                }}
              >
                {LABELS[k]}
              </button>
            ))}
            <input
              aria-label="Search records"
              placeholder="Search titles…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            <label className="office-check">
              <input
                type="checkbox"
                checked={archived}
                disabled={!management}
                onChange={(e) => {
                  setArchived(e.target.checked);
                  setPage(1);
                }}
              />
              Archived
            </label>
            <button onClick={() => setRevision((x) => x + 1)}>Refresh</button>
            {(management ||
              selected === 'blocker' ||
              selected === 'submission') && (
              <button
                className="office-primary"
                onClick={() => setEditing(null)}
              >
                + New {selected === 'blocker' ? 'request' : 'record'}
              </button>
            )}
          </div>
          {list.error && <p role="alert">{list.error.message}</p>}
          {list.loading && <p role="status">Loading records…</p>}
          <div className="office-grid">
            {list.data?.rows.map((row) => (
              <button
                key={row.id}
                className="office-card"
                onClick={() => void open(row)}
              >
                <small>
                  {LABELS[row.kind]} · v{row.version}
                </small>
                <h2>{row.title}</h2>
                <p>
                  {row.target
                    ? `Design ${row.target.jobNumber ?? row.target.asin} · `
                    : ''}
                  {row.employee?.fullName}
                </p>
                {row.kind === 'blocker' && (
                  <span className="office-badge">
                    {String(row.content.state)}
                  </span>
                )}
                {row.kind === 'lifecycle' && (
                  <span className="office-badge">
                    {taskProgress(row.content)}
                  </span>
                )}
                {row.kind === 'sop' && (
                  <span className="office-badge">
                    {row.acknowledgements?.some(
                      (a) => a.version === row.version,
                    )
                      ? 'Read ✓'
                      : 'Read acknowledgement needed'}
                  </span>
                )}
                {row.kind === 'asset' && (
                  <span className="office-badge">
                    {String(row.content.tag)} · {String(row.content.state)}
                  </span>
                )}
                {row.kind === 'submission' && (
                  <span className="office-badge">
                    {(row.content.warnings as string[]).length
                      ? 'Needs attention'
                      : 'Checklist passed'}
                  </span>
                )}
              </button>
            ))}
          </div>
          {list.data?.rows.length === 0 && (
            <div className="office-empty">
              No records yet.{' '}
              {management
                ? 'Create a template or record to get started.'
                : 'Your records will appear here.'}
            </div>
          )}
          <footer>
            <button disabled={page === 1} onClick={() => setPage((x) => x - 1)}>
              Previous
            </button>
            <span>
              Page {page} · {list.data?.total ?? 0} records
            </span>
            <button
              disabled={page * 40 >= (list.data?.total ?? 0)}
              onClick={() => setPage((x) => x + 1)}
            >
              Next
            </button>
          </footer>
          {editing !== undefined && selected && (
            <Editor
              key={editing?.id ?? selected}
              entry={editing}
              kind={selected}
              people={people.data ?? []}
              management={management}
              self={user?.employeeId ?? null}
              initialTarget={params.get('target') ?? ''}
              close={() => setEditing(undefined)}
              saved={() => {
                setEditing(undefined);
                setRevision((x) => x + 1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
function Today({ management }: { management: boolean }) {
  const records = useApi(
    (signal) => api<{ rows: Entry[]; total: number }>('/office', { signal }),
    [],
  );
  const stats = useApi(
    (signal) => api<{openHelp:number;assigned:number}>('/office/today',{signal}),
    [],
  );
  return (
    <>
      <div className="office-grid">
        <Link
          className="office-card"
          to={management ? '/production/workload' : '/me'}
        >
          <small>WORK</small>
          <h2>
            {management
              ? 'Team workload'
              : `${stats.data?.assigned ?? '…'} assigned designs`}
          </h2>
          <p>Open your current work and design links →</p>
        </Link>
        <Link className="office-card" to="/office/help">
          <small>FOLLOW-UP</small>
          <h2>Help requests</h2>
          <p>{stats.data?.openHelp ?? '…'} open requests · View all →</p>
        </Link>
        <Link className="office-card" to="/office/library">
          <small>LEARNING</small>
          <h2>SOP & examples</h2>
          <p>Read the latest instructions and acknowledge updates →</p>
        </Link>
      </div>
      <h2>Recent follow-up</h2>
      {records.error && <p role="alert">{records.error.message}</p>}
{stats.error && <p role="alert">{stats.error.message}</p>}
      {records.loading && <p role="status">Loading…</p>}
      {records.data?.rows.slice(0, 8).map((r) => (
        <Link
          className="office-recent"
          key={r.id}
          to={`/office/${Object.keys(sections).find((s) => sections[s].includes(r.kind)) ?? 'today'}`}
        >
          <span>{r.title}</span>
          <small>
            {LABELS[r.kind]} · {new Date(r.updatedAt).toLocaleDateString()}
          </small>
        </Link>
      ))}
      <p className="office-note">
        Help requests and checklists do not change tracked hours, completion or
        skip allowance.
      </p>
    </>
  );
}
function Editor({
  entry,
  kind,
  people,
  management,
  self,
  initialTarget,
  close,
  saved,
}: {
  entry: Entry | null;
  kind: Kind;
  people: Person[];
  management: boolean;
  self: number | null;
  initialTarget: string;
  close: () => void;
  saved: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState(entry?.title ?? ''),
    [content, setContent] = useState<Content>(
      entry ? editable(entry) : defaults(kind),
    ),
    [employee, setEmployee] = useState(
      String(entry?.employeeId ?? (!management ? self : '') ?? ''),
    ),
    [target, setTarget] = useState(String(entry?.targetId ?? initialTarget)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const templateKind: Kind | undefined =
    kind === 'brief'
      ? 'brief_template'
      : kind === 'submission'
        ? 'checklist_template'
        : kind === 'lifecycle'
          ? 'lifecycle_template'
          : undefined;
  const templates = useApi(
    (signal) =>
      templateKind
        ? api<{ rows: Entry[]; total: number }>(
            `/office?kind=${templateKind}`,
            { signal },
          )
        : Promise.resolve({ rows: [], total: 0 }),
    [templateKind],
  );
  const [designSearch, setDesignSearch] = useState('');
  const designs = useApi(
    (signal) =>
      api<
        {
          id: number;
          jobNumber: number | null;
          asin: string;
          assignedToId: number | null;
        }[]
      >(`/office/designs?q=${encodeURIComponent(designSearch)}`, { signal }),
    [designSearch],
  );
  const devices = useApi(
    (signal) =>
      management && kind === 'asset'
        ? api<{ id: number; hostname: string }[]>('/office/devices', { signal })
        : Promise.resolve([]),
    [management, kind],
  );
  const canEdit =
    !entry?.archivedAt &&
    (management ||
      (!entry && ['blocker', 'submission'].includes(kind)) ||
      (entry && kind === 'submission'));
  const set = (key: string, value: unknown) =>
    setContent((c) => ({ ...c, [key]: value }));
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: string,
    label: string,
    type = 'text',
    required = false,
  ) => (
    <label key={key}>
      {label}
      {type === 'textarea' ? (
        <textarea
          required={required}
          disabled={busy}
          readOnly={!canEdit}
          value={String(content[key] ?? '')}
          onChange={(e) => set(key, e.target.value)}
        />
      ) : (
        <input
          required={required}
          disabled={busy}
          readOnly={!canEdit}
          type={type}
          min={type === 'number' ? 0 : undefined}
          value={String(content[key] ?? '')}
          onChange={(e) =>
            set(
              key,
              type === 'number' ? Number(e.target.value) : e.target.value,
            )
          }
        />
      )}
    </label>
  );
  const select = (key: string, label: string, values: string[]) => (
    <label>
      {label}
      <select
        disabled={!canEdit || busy}
        value={String(content[key] ?? '')}
        onChange={(e) => set(key, e.target.value)}
      >
        {values.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  const shared = [
    'brief_template',
    'checklist_template',
    'sop',
    'lifecycle_template',
  ].includes(kind);
  return (
    <section
      className="office-editor"
      aria-label={entry ? 'Record details' : 'New office record'}
    >
      <div className="office-toolbar">
        <h2>{entry ? 'Record details' : `New ${LABELS[kind]}`}</h2>
        <button disabled={busy} onClick={close}>
          Close ×
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            api(`/office${entry ? '/' + entry.id : ''}`, {
              method: entry ? 'PATCH' : 'POST',
              body: {
                kind,
                title,
                content,
                ...(employee ? { employeeId: Number(employee) } : {}),
                ...(target ? { targetId: Number(target) } : {}),
                ...(entry ? { version: entry.version } : {}),
              },
            }),
          );
        }}
      >
        <label>
          Title
          <input
            required
            maxLength={120}
            disabled={!canEdit || busy}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {!shared && (
          <div className="office-fields">
            <label>
              Employee
              <select
                disabled={!management || (!!entry && kind !== 'asset') || busy}
                value={employee}
                onChange={(e) => setEmployee(e.target.value)}
              >
                <option value="">Not assigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.empCode} · {p.fullName}
                  </option>
                ))}
              </select>
            </label>
            {['brief', 'blocker', 'submission'].includes(kind) && (
              <label>
                Design
                {!entry && (
                  <input
                    aria-label="Search design number or ASIN"
                    placeholder="Search number or ASIN…"
                    value={designSearch}
                    onChange={(e) => setDesignSearch(e.target.value)}
                  />
                )}
                <select
                  aria-label="Design"
                  required
                  disabled={!!entry || busy}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose a design…</option>
                  {target &&
                    !designs.data?.some((d) => String(d.id) === target) && (
                      <option value={target}>Selected design</option>
                    )}
                  {designs.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.jobNumber ?? 'Unnumbered'} · {d.asin}
                    </option>
                  ))}
                </select>
                {designs.error && (
                  <small role="alert">{designs.error.message}</small>
                )}
              </label>
            )}
          </div>
        )}
        {templateKind && kind !== 'submission' && canEdit && !entry && (
          <label>
            Apply template
            <select
              defaultValue=""
              onChange={(e) => {
                const t = templates.data?.rows.find(
                  (r) => r.id === Number(e.target.value),
                );
                if (t) {
                  setContent(structuredClone(t.content));
                  if (!title) setTitle(t.title);
                }
              }}
            >
              <option value="">Select a template…</option>
              {templates.data?.rows.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · v{t.version}
                </option>
              ))}
            </select>
            {templates.data && templates.data.total > 40 && (
              <small>
                First 40 templates shown. Search templates in their tab.
              </small>
            )}
          </label>
        )}
        {['brief', 'brief_template'].includes(kind) && (
          <div className="office-fields">
            {field('niche', 'Niche')}
            {field('audience', 'Audience')}
            {field('style', 'Style')}
            {field('requiredText', 'Required text', 'textarea')}
            {field('reference', 'Reference / instructions', 'textarea')}
            {field('output', 'Expected output', 'textarea', true)}
          </div>
        )}
        {kind === 'blocker' && (
          <>
            {select('category', 'Problem type', [
              'brief',
              'link',
              'tool',
              'pc',
              'other',
            ])}
            {field('detail', 'What is blocking the work?', 'textarea', true)}
            {management && (
              <>
                {select('state', 'Resolution', ['open', 'resolved'])}
                {field('response', 'Response / next action', 'textarea')}
              </>
            )}
          </>
        )}
        {kind === 'checklist_template' && (
          <>
            <label>
              Checklist items (one per line)
              <textarea
                disabled={!canEdit || busy}
                value={(content.items as string[]).join('\n')}
                onChange={(e) => set('items', e.target.value.split('\n'))}
              />
            </label>
            {select('format', 'Required format', [
              'any',
              'png',
              'jpeg',
              'ai',
              'psd',
              'svg',
            ])}
            <div className="office-fields">
              {field('width', 'Width px (0 = unrestricted)', 'number')}
              {field('height', 'Height px (0 = unrestricted)', 'number')}
            </div>
          </>
        )}
        {kind === 'submission' && (
          <>
            <p className="office-note">
              This is a technical checklist, not Complete or a quality approval.
            </p>
            <label>
              Choose current checklist
              <select
                disabled={!canEdit || busy}
                value={String(content.checklistId)}
                onChange={(e) => {
                  const t = templates.data?.rows.find(
                    (r) => r.id === Number(e.target.value),
                  );
                  if (t)
                    setContent((c) => ({
                      ...c,
                      checklistId: t.id,
                      checklistVersion: t.version,
                      checked: (t.content.items as string[]).map(() => false),
                    }));
                }}
              >
                <option value="0">Select…</option>
                {templates.data?.rows.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} · v{t.version}
                  </option>
                ))}
              </select>
            </label>
            {(
              (templates.data?.rows.find(
                (t) =>
                  t.id === content.checklistId &&
                  t.version === content.checklistVersion,
              )?.content.items ??
                entry?.content.items ??
                []) as string[]
            ).map((item, i) => (
              <label className="office-check" key={i}>
                <input
                  type="checkbox"
                  disabled={!canEdit || busy}
                  checked={(content.checked as boolean[])[i] ?? false}
                  onChange={(e) => {
                    const checked = [...(content.checked as boolean[])];
                    checked[i] = e.target.checked;
                    set('checked', checked);
                  }}
                />
                {item}
              </label>
            ))}
            <label>
              Read file details
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.ai,.psd,.svg"
                disabled={!canEdit || busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const extension = file.name.split('.').pop()?.toLowerCase();
                  const format = extension === 'jpg' ? 'jpeg' : extension;
                  if (
                    !['png', 'jpeg', 'ai', 'psd', 'svg'].includes(format ?? '')
                  ) {
                    setError('Choose a supported design file.');
                    return;
                  }
                  setContent((c) => ({ ...c, fileName: file.name, format }));
                  if (format === 'png' || format === 'jpeg')
                    void createImageBitmap(file)
                      .then((bitmap) => {
                        setContent((c) => ({
                          ...c,
                          width: bitmap.width,
                          height: bitmap.height,
                        }));
                        bitmap.close();
                      })
                      .catch(() =>
                        setError('Could not read the image. Check its format.'),
                      );
                }}
              />
              <small>
                The file stays on this PC. PNG/JPEG dimensions are read
                automatically.
              </small>
            </label>
            {field('fileName', 'File name', 'text', true)}
            {select('format', 'Actual format', [
              'png',
              'jpeg',
              'ai',
              'psd',
              'svg',
            ])}
            <div className="office-fields">
              {field('width', 'Actual width px', 'number')}
              {field('height', 'Actual height px', 'number')}
            </div>
            {field('note', 'Notes', 'textarea')}
            {entry &&
              (entry.content.warnings as string[]).map((w) => (
                <p className="office-warning" key={w}>
                  {w}
                </p>
              ))}
            <p className="office-note">
              Values are declared metadata. Originality and visual quality still
              need review.
            </p>
          </>
        )}
        {kind === 'sop' && (
          <>
            {field('body', 'Instructions / examples', 'textarea', true)}
            {entry && (
              <button
                type="button"
                disabled={
                  busy ||
                  entry.acknowledgements?.some(
                    (a) =>
                      a.version === entry.version && a.userId === user?.userId,
                  )
                }
                onClick={() =>
                  void run(() =>
                    api(`/office/${entry.id}/ack`, {
                      method: 'POST',
                      body: { version: entry.version },
                    }),
                  )
                }
              >
                {entry.acknowledgements?.some(
                  (a) => a.version === entry.version,
                )
                  ? 'Read ✓'
                  : 'I have read this version'}
              </button>
            )}
          </>
        )}
        {kind === 'asset' && (
          <>
            <div className="office-fields">
              {field('tag', 'Company asset tag', 'text', true)}
              {field('serial', 'Serial number')}
              <label>
                Linked agent PC
                <select
                  disabled={!canEdit || busy}
                  value={String(content.deviceId ?? 0)}
                  onChange={(e) => set('deviceId', Number(e.target.value))}
                >
                  <option value={0}>No linked PC / accessory</option>
                  {devices.data?.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.hostname}
                    </option>
                  ))}
                </select>
              </label>
              {field('warranty', 'Warranty expiry', 'date')}
              {select('state', 'Equipment state', [
                'spare',
                'in_use',
                'repair',
                'returned',
              ])}
            </div>
            {field('note', 'Issue / repair / handover notes', 'textarea')}
          </>
        )}
        {['lifecycle', 'lifecycle_template'].includes(kind) && (
          <>
            {select('type', 'Checklist type', ['joining', 'leaving'])}
            {field('due', 'Due date', 'date')}
            {(
              content.tasks as {
                label: string;
                done: boolean;
                responsible: string;
              }[]
            ).map((task, i) => (
              <div className="office-task" key={i}>
                <input
                  aria-label={`Task ${i + 1}`}
                  disabled={!canEdit || busy}
                  value={task.label}
                  onChange={(e) =>
                    set(
                      'tasks',
                      (content.tasks as (typeof task)[]).map((t, j) =>
                        j === i ? { ...t, label: e.target.value } : t,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Responsible for task ${i + 1}`}
                  placeholder="Responsible person"
                  disabled={!canEdit || busy}
                  value={task.responsible}
                  onChange={(e) =>
                    set(
                      'tasks',
                      (content.tasks as (typeof task)[]).map((t, j) =>
                        j === i ? { ...t, responsible: e.target.value } : t,
                      ),
                    )
                  }
                />
                <label className="office-check">
                  <input
                    type="checkbox"
                    disabled={!canEdit || busy}
                    checked={task.done}
                    onChange={(e) =>
                      set(
                        'tasks',
                        (content.tasks as (typeof task)[]).map((t, j) =>
                          j === i ? { ...t, done: e.target.checked } : t,
                        ),
                      )
                    }
                  />
                  Done
                </label>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        'tasks',
                        (content.tasks as (typeof task)[]).filter(
                          (_, j) => j !== i,
                        ),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={() =>
                  set('tasks', [
                    ...(content.tasks as object[]),
                    { label: '', done: false, responsible: '' },
                  ])
                }
              >
                + Task
              </button>
            )}
            <p className="office-note">
              Checklist completion does not deactivate accounts or revoke
              devices. Use existing Staff controls for those actions.
            </p>
          </>
        )}
        {kind === 'coaching' && (
          <>
            {(content.skills as { name: string; level: number }[]).map(
              (skill, i) => (
                <div className="office-fields" key={i}>
                  <label>
                    Skill
                    <input
                      disabled={!canEdit || busy}
                      value={skill.name}
                      onChange={(e) =>
                        set(
                          'skills',
                          (content.skills as (typeof skill)[]).map((s, j) =>
                            j === i ? { ...s, name: e.target.value } : s,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Manager assessment (1–5)
                    <input
                      type="number"
                      min={1}
                      max={5}
                      disabled={!canEdit || busy}
                      value={skill.level}
                      onChange={(e) =>
                        set(
                          'skills',
                          (content.skills as (typeof skill)[]).map((s, j) =>
                            j === i
                              ? { ...s, level: Number(e.target.value) }
                              : s,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ),
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() =>
                  set('skills', [
                    ...(content.skills as object[]),
                    { name: '', level: 1 },
                  ])
                }
              >
                + Skill
              </button>
            )}
            {field('goal', 'Training goal', 'textarea', true)}
            {field('followUp', 'Follow-up date', 'date')}
            {field('note', 'Examples / coaching notes', 'textarea')}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="office-toolbar">
          {canEdit && (
            <button className="office-primary" disabled={busy}>
              Save {entry ? 'changes' : 'record'}
            </button>
          )}
          {management && entry && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api(`/office/${entry.id}/archive`, {
                    method: 'POST',
                    body: {
                      version: entry.version,
                      archived: !entry.archivedAt,
                    },
                  }),
                )
              }
            >
              {entry.archivedAt ? 'Restore' : 'Archive'}
            </button>
          )}
        </div>
      </form>
      {entry?.events && (
        <details>
          <summary>Change history</summary>
          {entry.events.map((e) => (
            <p key={e.id}>
              v{e.version} · {e.action} · {e.actorName} ·{' '}
              {new Date(e.createdAt).toLocaleString()}
              <span className="office-history">
                {humanSnapshot(e.snapshot)}
              </span>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}

function humanSnapshot(snapshot: Content): string {
  const content = (snapshot.content ?? snapshot) as Content;
  return Object.entries(content)
    .filter(
      ([key]) => !['deviceId', 'checklistId', 'checklistVersion'].includes(key),
    )
    .map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1');
      const text = Array.isArray(value)
        ? value
            .map((v) =>
              typeof v === 'object' && v !== null
                ? Object.values(v).join(' · ')
                : String(v),
            )
            .join('; ')
        : String(value);
      return label + ': ' + text;
    })
    .join('\n');
}
