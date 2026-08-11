import type { ReactNode } from 'react';

/**
 * সাধারণ টেবিল।
 *
 * ⚠️ E12 — চওড়া টেবিল ফোনে **নিজের ফ্রেমে স্ক্রল করে**, পুরো পাতা নয়।
 *    এটা না থাকলে অ্যাটেনডেন্স রিপোর্টের ৯টা কলাম গোটা পেজটাকেই আড়াআড়ি
 *    টেনে বড় করত, আর হেডার-নেভিগেশনও সরে যেত।
 *
 * ⭐ সংখ্যার কলামে `align: 'right'` দিন — ডানে সারিবদ্ধ সংখ্যা চোখে
 *    তুলনা করা যায়। `<Duration>`/`.num` এমনিতেই tabular-nums।
 *
 * ```tsx
 * <Table
 *   rows={report.rows}
 *   rowKey={(r) => String(r.employeeId)}
 *   columns={[
 *     { key: 'name', header: 'Name', render: (r) => r.fullName },
 *     { key: 'h', header: 'Hours', align: 'right',
 *       render: (r) => <Duration seconds={r.workedSec} /> },
 *   ]}
 * />
 * ```
 */
export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** কলামের নিজস্ব ক্লাস — যেমন `w-32` বা `hidden sm:table-cell` */
  className?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  /** সারি হালকা করে দেখানো — যেমন নিষ্ক্রিয় কর্মী */
  rowMuted,
  footer,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowMuted?: (row: T) => boolean;
  /** যোগফলের সারি — `<tfoot>`-এ বসে, স্ক্রল করলেও কলামের সাথেই থাকে */
  footer?: ReactNode;
}) {
  const align = (a?: Column<T>['align']): string =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-3 py-2 font-medium text-ink-3 whitespace-nowrap ${align(col.align)} ${col.className ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line/70 last:border-0 ${
                onRowClick ? 'cursor-pointer hover:bg-paper' : ''
              } ${rowMuted?.(row) ? 'text-ink-3' : ''}`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 ${align(col.align)} ${col.className ?? ''}`}
                >
                  {col.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>

        {footer && (
          <tfoot className="border-t border-line bg-paper font-medium">
            {footer}
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * নাম + কোড — টেবিলের প্রথম কলামে যেভাবে বারবার লাগে।
 * ⚠️ কোডটা `.num`-এ, কারণ `OX-001` আর `OX-010` একই প্রস্থে থাকলে
 *    চোখে খুঁজে পাওয়া সহজ।
 */
export function PersonCell({
  fullName,
  empCode,
  note,
}: {
  fullName: string;
  empCode?: string;
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-ink">{fullName}</div>
      {(empCode || note) && (
        <div className="num truncate text-[11px] text-ink-3">
          {empCode}
          {empCode && note ? ' · ' : ''}
          {note}
        </div>
      )}
    </div>
  );
}
