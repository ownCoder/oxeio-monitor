import type { TargetRow } from '../../api/targets';

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  // Names can come from user input; prevent spreadsheet formula execution.
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function targetsCsv(rows: TargetRow[], filterLabel?: string): string {
  const header = ['ASIN', 'Job number', 'Status', 'Designer', 'Added by', 'Added at', 'Completed at', 'Skip requested at', 'Deleted at', 'Drop reason'];
  const data = rows.map(r => [r.asin, r.jobNumber, r.skipReviewPending ? 'pending_skip_review' : r.status,
    r.assignedTo?.fullName ?? '', r.addedBy.fullName, r.addedAt, r.completedAt, r.skipRequestedAt, r.deletedAt, r.dropReason]);
  return '\uFEFF' + [...(filterLabel ? [['Filters', filterLabel]] : []), header, ...data].map(row => row.map(cell).join(',')).join('\r\n');
}

export function downloadTargetsCsv(rows: TargetRow[], page: number, filterLabel?: string): void {
  const url = URL.createObjectURL(new Blob([targetsCsv(rows, filterLabel)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `design-pool-page-${page}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
