import { listEmployees, type EmployeeView } from '../api/admin';
import { useApi } from '../api/useApi';

/**
 * স্টাফ বাছাই — টাইমলাইন, স্ক্রিনশট, রিপোর্ট সব পেজেই লাগে।
 *
 * ⭐ তালিকাটা নিজেই আনে (`GET /employees`), তাই পেজগুলোকে আলাদা করে
 * একটা কল লিখতে হয় না। `GET /employees` **owner + manager** দুজনেরই
 * খোলা — নামের তালিকা ছাড়া লাইভ ভিউ বা রিপোর্ট অর্থহীন।
 *
 * ⚠️ `role = employee` এখানে ৪০৩ পাবে। স্টাফের নিজের পর্দায় এই বাছাইটা
 *    **রাখবেন না** — সে তো একজনই, বাছার কিছু নেই, আর তালিকাটা দেখালে
 *    সহকর্মীদের নামও দেখা যেত।
 *
 * ⚠️ ডিফল্টে শুধু active কর্মী। চলে যাওয়া কারো পুরোনো দিন দেখতে হলে
 *    `includeInactive` — তখন নামের পাশে "(Inactive)" বসে, নইলে কেউ
 *    বুঝত না কেন তার আজকের ঘণ্টা শূন্য।
 *
 * ⚠️ **"Inactive" ≠ "Idle"** — বাংলায় দুটোই "নিষ্ক্রিয়" ছিল, ইংরেজিতে নয়।
 *    এখানকারটা **চাকরির অবস্থা** (চলে গেছেন), আর `StatusDot`-এর "Idle"
 *    হলো এই মুহূর্তে কি-বোর্ড-মাউস চুপচাপ। দুটো গুলিয়ে ফেললে কর্মরত
 *    কাউকে "চলে গেছেন" পড়া যেত।
 */
export function EmployeePicker({
  value,
  onChange,
  label = 'Staff',
  allowAll = false,
  allLabel = 'Everyone',
  includeInactive = false,
  className = '',
}: {
  /** `null` = কেউ বাছা হয়নি / সবাই */
  value: number | null;
  onChange: (employeeId: number | null) => void;
  label?: string;
  /** "সবাই" বিকল্পটা থাকবে কি না */
  allowAll?: boolean;
  allLabel?: string;
  includeInactive?: boolean;
  className?: string;
}) {
  const { data, error, loading } = useApi(
    (signal) =>
      listEmployees({ status: includeInactive ? 'all' : 'active' }, signal),
    [includeInactive],
  );

  const rows: EmployeeView[] = data?.rows ?? [];

  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11.5px] text-ink-3">{label}</span>
      <select
        value={value === null ? '' : String(value)}
        disabled={loading || error !== null}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="min-w-44 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60"
      >
        {/*
          ⚠️ তিনটে অবস্থাই এখানে দেখাতে হয় — নইলে তালিকা খালি থাকলে
             ফাঁকা ড্রপডাউন দেখে মনে হতো কন্ট্রোলটাই ভাঙা।
        */}
        {loading && <option value="">Loading…</option>}
        {error && <option value="">Couldn't load the list</option>}

        {!loading && !error && (
          <>
            {allowAll && <option value="">{allLabel}</option>}
            {!allowAll && value === null && (
              <option value="">— Choose —</option>
            )}
            {rows.length === 0 && <option value="">No staff yet</option>}
            {rows.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} · {emp.empCode}
                {emp.status === 'inactive' ? ' (Inactive)' : ''}
              </option>
            ))}
          </>
        )}
      </select>
    </label>
  );
}
