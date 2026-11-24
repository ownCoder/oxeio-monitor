import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../api/useApi';
import {
  changeProduction,
  dhakaDate,
  getProduction,
  stamp,
  type History,
  type Preview,
  type TaskItem,
  type Target,
  type Workload,
} from '../../api/production';
import './production.css';
import { TargetEvidence } from './TargetEvidence';

function historyValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (key.endsWith('_at') && typeof value === 'string' && Number.isFinite(new Date(value).getTime())) return stamp(value);
  if (key === 'priority' && typeof value === 'number') return ['Normal', 'Medium', 'High'][value] ?? String(value);
  return String(value);
}

export function TargetDrawer({ id, close }: { id: number; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState('evidence');
  const [before, setBefore] = useState<number | undefined>();
  const history = useApi(
    (signal) =>
      getProduction<History>(
        `targets/${id}/history${before ? `?before=${before}` : ''}`,
        signal,
      ),
    [id, before],
  );
  const { user } = useAuth();
  const canPlan = user?.role === 'owner' || user?.role === 'manager';
  const canEvidence = canPlan || (user?.employeeId != null && history.data?.target.assignedToId === user.employeeId);
  const activeTab = tab === 'evidence' && !canEvidence ? 'history' : tab;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="production production-dialog"
      onCancel={close}
      aria-label="Target details"
    >
      <div className="production-header">
        <div>
          <p>PRODUCTION / TARGET</p>
          <h1>
            {history.data
              ? `Job ${history.data.target.jobNumber ?? '—'}`
              : 'Target details'}
          </h1>
          <p>
            {history.data?.target.asin} · Target #{id} ·{' '}
            {history.data?.target.assignedTo?.fullName ?? 'Unassigned'}
          </p>
        </div>
        <button onClick={close} autoFocus aria-label="Close target details">
          Close ×
        </button>
      </div>
      <div className="production-actions">
        {[...(canEvidence ? ['evidence'] : []), 'tasks', 'history', 'proofs', ...(canPlan ? ['planning'] : [])].map(
          (value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              aria-pressed={value === activeTab}
            >
              {value === 'evidence' ? 'Design evidence' : value === 'tasks'
                ? 'Checklist'
                : value === 'history'
                ? 'Target history'
                : value === 'proofs'
                  ? 'Design review'
                  : 'Plan work'}
            </button>
          ),
        )}
      </div>
      {history.error && (
        <p role="alert" className="production-error">
          {history.error.message}
        </p>
      )}
      {history.loading && <p role="status">Loading target…</p>}
      {history.data && activeTab === 'evidence' && canEvidence && <TargetEvidence id={id} review={() => setTab('proofs')} history={() => setTab('history')} />}
      {history.data && activeTab === 'history' && (
        <>
          <p>
            Recorded history since {stamp(history.data.since)}. Earlier changes
            are unavailable. Times are Dhaka.
          </p>
          <div className="production-history">
            {history.data.rows.map((event) => (
              <article key={event.id} className="production-event">
                <h2>{event.action.replaceAll('_', ' ')}</h2>
                <p>
                  {event.actorName ??
                    (event.source === 'agent'
                      ? 'Desktop agent'
                      : 'System / unknown actor')}{' '}
                  · {stamp(event.recordedAt)}
                </p>
                <details>
                  <summary>Changed fields · {event.source}</summary>
                  <dl>
                    {Object.entries(event.afterState)
                      .filter(
                        ([key, value]) =>
                          JSON.stringify(value) !==
                          JSON.stringify(event.beforeState?.[key]),
                      )
                      .map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt>{key.replaceAll('_', ' ')}</dt>
                          <dd>
                            {event.beforeState && (
                              <>{historyValue(key, event.beforeState[key])} → </>
                            )}
                            {historyValue(key, value)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </details>
              </article>
            ))}
            {history.data.rows.length === 0 && (
              <p>No recorded changes for this target yet.</p>
            )}
          </div>
          <div className="production-actions">
            <button disabled={!before} onClick={() => setBefore(undefined)}>
              Latest
            </button>
            <button
              disabled={!history.data.nextBefore}
              onClick={() => setBefore(history.data?.nextBefore ?? undefined)}
            >
              Older changes
            </button>
          </div>
        </>
      )}
      {history.data && activeTab === 'tasks' && (
        <TaskChecklist key={id} id={id} canManage={canPlan} />
      )}
      {history.data && activeTab === 'planning' && canPlan && (
        <Planning key={id} target={history.data.target} done={() => { history.reload(); setTab('history'); }} />
      )}
      {history.data && activeTab === 'proofs' && <Proofs key={id} id={id} />}
    </dialog>
  );
}

function TaskChecklist({ id, canManage }: { id: number; canManage: boolean }) {
  const tasks = useApi(
    (signal) => getProduction<TaskItem[]>(`targets/${id}/tasks`, signal),
    [id],
  );
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      tasks.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  const done = tasks.data?.filter((item) => item.completedAt).length ?? 0;
  return (
    <section className="production-panel">
      <div className="production-task-head">
        <div>
          <h2>Task checklist</h2>
          <p>Small, visible steps for this design. Completion is task progress, not payroll credit or design approval.</p>
        </div>
        <strong>{done}/{tasks.data?.length ?? 0}</strong>
      </div>
      {(error || tasks.error) && <p role="alert" className="production-error">{error || tasks.error?.message}</p>}
      {tasks.loading && <p role="status">Loading checklist…</p>}
      <div className="production-task-list">
        {tasks.data?.map((item) => (
          <div key={item.id} className={item.completedAt ? 'production-task done' : 'production-task'}>
            <label>
              <input
                type="checkbox"
                checked={Boolean(item.completedAt)}
                disabled={busy}
                onChange={(event) => void act(() => changeProduction(`tasks/${item.id}`, { completed: event.target.checked }, 'PATCH'))}
              />
              <span>{item.text}</span>
            </label>
            {canManage && <button disabled={busy} onClick={() => void act(() => changeProduction(`tasks/${item.id}`, {}, 'DELETE'))}>Remove</button>}
          </div>
        ))}
        {!tasks.loading && tasks.data?.length === 0 && <p>No checklist items yet.</p>}
      </div>
      {canManage && (
        <form onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            await changeProduction(`targets/${id}/tasks`, { text });
            setText('');
          });
        }}>
          <label>
            Add a step
            <input value={text} maxLength={200} onChange={(event) => setText(event.target.value)} placeholder="Example: Export print-ready PNG" />
          </label>
          <button disabled={busy || !text.trim()}>Add checklist item</button>
        </form>
      )}
    </section>
  );
}

function Planning({ target, done }: { target: Target; done: () => void }) {
  const employees = useApi(
    (signal) => getProduction<Workload[]>('workload', signal),
    [],
  );
  const [priority, setPriority] = useState(target.priority),
    [dueDay, setDueDay] = useState(target.dueAt ? dhakaDate(target.dueAt) : '');
  const [workType, setWorkType] = useState(target.workType ?? ''),
    [estimatedMinutes, setEstimatedMinutes] = useState(target.estimatedMinutes ? String(target.estimatedMinutes) : '');
  const [staff, setStaff] = useState(target.assignedToId ?? 0),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function save(reassign: boolean) {
    setBusy(true);
    setMessage('');
    try {
      await changeProduction(
        `targets/${target.id}/${reassign ? 'reassign' : 'plan'}`,
        reassign
          ? { employeeId: staff, reason }
          : {
              priority,
              dueDay: dueDay || null,
              workType: workType || null,
              estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
              reason,
            },
        reassign ? 'POST' : 'PATCH',
      );
      setMessage('Saved.');
      done();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="production-panel">
      <h2>Plan work</h2>
      <p>
        A deadline ends at 23:59 Dhaka time. Reassignment is allowed before work
        starts.
      </p>
      <div className="production-toolbar">
        <label>
          Priority
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          >
            <option value={0}>Normal</option>
            <option value={1}>Medium</option>
            <option value={2}>High</option>
          </select>
        </label>
        <label>
          Due date
          <input
            type="date"
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          />
        </label>
        <label>
          Work type
          <select value={workType} onChange={(e) => setWorkType(e.target.value)}>
            <option value="">Not classified</option>
            <option value="typography">Typography</option>
            <option value="graphic">Graphic</option>
            <option value="illustration">Illustration</option>
            <option value="seasonal">Seasonal</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Estimated minutes
          <input
            type="number"
            min={5}
            max={1440}
            step={5}
            value={estimatedMinutes}
            placeholder="Not estimated"
            onChange={(e) => setEstimatedMinutes(e.target.value)}
          />
        </label>
      </div>
      <label>
        Reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Explain this change (at least 3 characters)"
        />
      </label>
      <div className="production-actions">
        <button
          disabled={busy || reason.trim().length < 3 || (!!estimatedMinutes && (Number(estimatedMinutes) < 5 || Number(estimatedMinutes) > 1440))}
          onClick={() => void save(false)}
        >
          Save plan
        </button>
      </div>
      <label>
        Assign to
        <select
          value={staff}
          onChange={(e) => setStaff(Number(e.target.value))}
        >
          <option value={0}>Choose staff</option>
          {employees.data?.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.fullName} · {emp.unstarted + emp.started} assigned
            </option>
          ))}
        </select>
      </label>
      {employees.error && <p role="alert">{employees.error.message}</p>}
      <div className="production-actions">
        <button
          disabled={
            busy ||
            !staff ||
            reason.trim().length < 3 ||
            target.status !== 'assigned' ||
            target.startedAt !== null ||
            target.assignedToId === staff
          }
          onClick={() => void save(true)}
        >
          Reassign unstarted work
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function Proofs({ id }: { id: number }) {
  const { user } = useAuth();
  const previews = useApi(
    (signal) => getProduction<Preview[]>(`targets/${id}/previews`, signal),
    [id],
  );
  const [selected, setSelected] = useState<number | null>(null),
    [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState(''),
    [note, setNote] = useState(''),
    [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const preview =
    previews.data?.find((row) => row.id === selected) ?? previews.data?.[0];
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      previews.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!file) return;
    if (
      file.size > 2 * 1024 * 1024 ||
      !['image/png', 'image/jpeg'].includes(file.type)
    )
      throw new Error('Choose a PNG or JPEG up to 2 MB.');
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read image.'));
      reader.readAsDataURL(file);
    });
    const result = await changeProduction<{ id: number }>(
      `targets/${id}/previews`,
      { filename: file.name, base64, note },
    );
    setSelected(result.id);
    setFile(null);
    setNote('');
    setPin(null);
  }
  return (
    <section>
      <div className="production-panel">
        <h2>Add a design version</h2>
        <p>
          PNG or JPEG · up to 2 MB · 50 versions per target. Identical uploads
          reuse their existing version.
        </p>
        <label>
          Preview image
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Version note
          <textarea
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button disabled={busy || !file} onClick={() => void act(upload)}>
          Upload preview
        </button>
      </div>
      {(error || previews.error) && (
        <p className="production-error" role="alert">
          {error || previews.error?.message}
        </p>
      )}
      {previews.loading && <p>Loading versions…</p>}
      {preview ? (
        <>
          <label>
            Version
            <select
              value={preview.id}
              disabled={busy}
              onChange={(e) => {
                setSelected(Number(e.target.value));
                setPin(null);
                setText('');
              }}
            >
              {previews.data?.map((row) => (
                <option key={row.id} value={row.id}>
                  Version {row.version} · {row.filename}
                </option>
              ))}
            </select>
          </label>
          <p>
            {preview.authorName} · {stamp(preview.createdAt)}
            <br />
            {preview.note}
          </p>
          <p>
            Click the image to place a comment pin, or write a general comment
            below.
          </p>
          <div className="production-proof">
            <img
              src={`/api/v1/production/previews/${preview.id}/image`}
              alt={`Design version ${preview.version}`}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setPin({
                  x: (e.clientX - rect.left) / rect.width,
                  y: (e.clientY - rect.top) / rect.height,
                });
              }}
            />
            {preview.comments
              .filter((c) => c.x !== null && c.y !== null)
              .map((c) => (
                <a
                  className="production-pin"
                  key={c.id}
                  href={`#comment-${c.id}`}
                  style={{
                    left: `${c.x! * 100}%`,
                    top: `${c.y! * 100}%`,
                    opacity: c.resolvedAt ? 0.5 : 1,
                  }}
                  aria-label={`Comment ${c.id}: ${c.text}`}
                >
                  {c.id}
                </a>
              ))}
            {pin && (
              <span
                className="production-pin"
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
              >
                +
              </span>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await changeProduction(`previews/${preview.id}/comments`, {
                  text,
                  ...(pin ?? {}),
                });
                setText('');
                setPin(null);
              });
            }}
          >
            <label>
              {pin ? 'Pinned comment' : 'General comment'}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                required
              />
            </label>
            <div className="production-actions">
              <button disabled={busy || !text.trim()}>Add comment</button>
              {pin && (
                <button type="button" onClick={() => setPin(null)}>
                  Remove pin
                </button>
              )}
            </div>
          </form>
          {preview.comments.map((c) => (
            <article
              id={`comment-${c.id}`}
              key={c.id}
              className="production-comment"
            >
              <strong>
                {c.authorName} · #{c.id}
              </strong>
              <p>{c.text}</p>
              <div className="production-actions">
                <span className="production-pill">
                  {c.resolvedAt ? 'Resolved' : 'Open'}
                </span>
                {(user?.role !== 'employee' || user.userId === c.authorId) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        changeProduction(
                          `comments/${c.id}`,
                          { resolved: !c.resolvedAt },
                          'PATCH',
                        ),
                      )
                    }
                  >
                    {c.resolvedAt ? 'Reopen' : 'Resolve'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </>
      ) : (
        !previews.loading && (
          <p>No previews yet. Upload the first version to begin review.</p>
        )
      )}
    </section>
  );
}
