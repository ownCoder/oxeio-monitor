import { useState } from 'react';
import {
  changeProduction,
  getProduction,
  stamp,
  type CsvPreview,
  type Sale,
  type Sales,
} from '../../api/production';
import { useApi } from '../../api/useApi';

export function ProductResults({ open }: { open: (id: number) => void }) {
  const [period, setPeriod] = useState(''),
    [page, setPage] = useState(1);
  const result = useApi(
    (signal) =>
      getProduction<Sales>(
        `sales?${new URLSearchParams({ page: String(page), ...(period ? { period } : {}) })}`,
        signal,
      ),
    [period, page],
  );
  const [csv, setCsv] = useState(''),
    [name, setName] = useState('Monthly product totals');
  const [preview, setPreview] = useState<CsvPreview | null>(null),
    [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [editing, setEditing] = useState<Sale | null>(null);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  const unmatched =
    preview?.rows.filter((row) => row.match !== 'matched').length ?? 0;
  const duplicate =
    preview?.alreadyImported || preview?.rows.some((row) => row.duplicate);
  return (
    <>
      <section className="production-panel">
        <h2>Import monthly product totals</h2>
        <p>
          Use your own live product ASIN, not the source ASIN. One row per
          month, product and currency. Refunds may be negative. Existing totals
          cannot be imported again.
        </p>
        <a
          download="product-sales-template.csv"
          href={
            'data:text/csv;charset=utf-8,' +
            encodeURIComponent(
              'period,live_asin,units,royalty,currency\n2026-09,B012345678,10,23.50,USD\n',
            )
          }
        >
          Download CSV template ↓
        </a>
        <div className="production-toolbar">
          <label>
            CSV file · up to 1 MB
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPreview(null);
                setCsv('');
                setAccept(false);
                void act(async () => {
                  if (file.size > 1000000)
                    throw new Error('CSV is too large (maximum 1 MB).');
                  setCsv(await file.text());
                  setName(file.name.slice(0, 120));
                });
              }}
            />
          </label>
          <label>
            Import name
            <input
              value={name}
              maxLength={120}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <label>
          CSV contents
          <textarea
            value={csv}
            disabled={busy}
            maxLength={1000000}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
              setAccept(false);
            }}
            placeholder="period,live_asin,units,royalty,currency"
          />
        </label>
        <div className="production-actions">
          <button
            disabled={busy || !csv.trim()}
            onClick={() =>
              void act(async () => {
                setPreview(null);
                setPreview(
                  await changeProduction<CsvPreview>('sales/preview', { csv }),
                );
              })
            }
          >
            Preview import
          </button>
        </div>
        {preview && (
          <>
            <p>
              {preview.rows.length} rows · {unmatched} unmatched/ambiguous ·{' '}
              {duplicate
                ? 'Duplicates found — import blocked'
                : 'No duplicate monthly totals'}
            </p>
            <div className="production-scroll" style={{ maxHeight: 360 }}>
              <table>
                <thead>
                  <tr>
                    {['Month', 'Live ASIN', 'Units', 'Royalty', 'Match'].map(
                      (h) => (
                        <th key={h}>{h}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={`${row.period}:${row.liveAsin}:${row.currency}`}>
                      <td>{row.period}</td>
                      <td>{row.liveAsin}</td>
                      <td>{row.units}</td>
                      <td>
                        {row.currency} {Number(row.royalty).toFixed(2)}
                      </td>
                      <td>
                        {row.duplicate
                          ? 'Already imported'
                          : row.match === 'matched'
                            ? `Job ${row.jobNumber ?? '—'}`
                            : row.match}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unmatched > 0 && (
              <label>
                <span>
                  <input
                    type="checkbox"
                    checked={accept}
                    disabled={busy}
                    onChange={(e) => setAccept(e.target.checked)}
                  />{' '}
                  Import unmatched products for later linking
                </span>
              </label>
            )}
            <div className="production-actions">
              <button
                disabled={
                  busy ||
                  !!duplicate ||
                  (unmatched > 0 && !accept) ||
                  !name.trim()
                }
                onClick={() =>
                  void act(async () => {
                    const response = await changeProduction<{
                      imported: number;
                    }>('sales/import', { csv, name, acceptUnmatched: accept });
                    setMessage(`${response.imported} rows imported.`);
                    setPreview(null);
                    setCsv('');
                    setPage(1);
                    result.reload();
                  })
                }
              >
                Import {preview.rows.length} rows
              </button>
            </div>
          </>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      <div className="production-toolbar">
        <label>
          Month filter
          <input
            type="month"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          onClick={() => {
            setPeriod('');
            setPage(1);
          }}
        >
          All months
        </button>
        <button onClick={result.reload}>Refresh</button>
      </div>
      {result.error && (
        <p className="production-error" role="alert">
          {result.error.message}
        </p>
      )}
      {result.loading && <p>Loading product results…</p>}
      {result.data && (
        <>
          <div className="production-metrics">
            {result.data.currencies.map((row) => (
              <article
                key={row.currency}
                className="production-panel production-metric"
              >
                <p>{row.currency} royalty</p>
                <strong>{Number(row.royalty).toFixed(2)}</strong>
                <p>{row.units} net units</p>
              </article>
            ))}
          </div>
          <section className="production-panel">
            <h2>Product results · {result.data.total}</h2>
            <p>
              Currencies remain separate. Cost is a one-time estimate per
              target/currency, shown for reference and not subtracted repeatedly
              from monthly royalty or salary.
            </p>
            <div className="production-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      'Month',
                      'Product',
                      'Units',
                      'Royalty',
                      'Cost estimate',
                      '',
                    ].map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.period}</td>
                      <td>
                        {row.liveAsin}
                        <p>
                          {row.targetId ? (
                            <button onClick={() => open(row.targetId!)}>
                              Job {row.target?.jobNumber ?? '—'} · Target #
                              {row.targetId}
                            </button>
                          ) : (
                            'Unmatched'
                          )}
                        </p>
                      </td>
                      <td>{row.units}</td>
                      <td>
                        {row.currency} {Number(row.royalty).toFixed(2)}
                      </td>
                      <td>
                        {row.target?.costs.length
                          ? row.target.costs.map((c) => (
                              <p key={c.currency} title={c.note}>
                                {c.currency} {Number(c.amount).toFixed(2)}
                              </p>
                            ))
                          : 'Not estimated'}
                      </td>
                      <td>
                        <button onClick={() => setEditing(row)}>
                          {row.targetId ? 'Edit cost' : 'Link target'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.data.total === 0 && <p>No imported results yet.</p>}
            <div className="production-actions">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>
                {page} / {Math.max(1, result.data.pages)}
              </span>
              <button
                disabled={page >= result.data.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </section>
          <section className="production-panel">
            <h2>Recent imports</h2>
            {result.data.imports.map((row) => (
              <p key={row.id}>
                {row.name} · {row._count.rows} rows · {stamp(row.createdAt)}
              </p>
            ))}
          </section>
        </>
      )}
      {editing && (
        <EditSale
          key={editing.id}
          row={editing}
          close={() => setEditing(null)}
          done={() => {
            setEditing(null);
            result.reload();
          }}
        />
      )}
    </>
  );
}
function EditSale({
  row,
  close,
  done,
}: {
  row: Sale;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (row.targetId)
        await changeProduction(
          `targets/${row.targetId}/cost`,
          {
            amount: String(form.get('amount')),
            currency: String(form.get('currency')),
            note: String(form.get('note')),
          },
          'PATCH',
        );
      else
        await changeProduction(`sales/${row.id}/link`, {
          targetId: Number(form.get('targetId')),
        });
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="production-panel" aria-label="Edit product result">
      <h2>
        {row.targetId ? 'Estimated one-time cost' : 'Link exact live ASIN'} ·{' '}
        {row.liveAsin}
      </h2>
      <form onSubmit={(e) => void save(e)}>
        {row.targetId ? (
          <div className="production-toolbar">
            <label>
              Amount
              <input
                name="amount" autoFocus
                type="number"
                step="0.01"
                min={0}
                max={9999999999.99}
                required
              />
            </label>
            <label>
              Currency
              <input
                name="currency"
                defaultValue={row.currency}
                pattern="[A-Z]{3}"
                maxLength={3}
                required
              />
            </label>
            <label>
              Estimate basis
              <input name="note" minLength={3} maxLength={500} required />
            </label>
          </div>
        ) : (
          <label>
            Target ID (not job number)
            <input name="targetId" autoFocus type="number" min={1} required />
            <span>Find this ID in the job’s history panel. The selected target must have this exact live ASIN.</span>
          </label>
        )}
        <div className="production-actions">
          <button disabled={busy}>Save</button>
          <button disabled={busy} type="button" onClick={close}>
            Cancel
          </button>
        </div>
        {error && (
          <p role="alert" className="production-error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
