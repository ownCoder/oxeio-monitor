import { useState } from 'react';

import {
  createEmployee,
  createPortalAccount,
  deactivateEmployee,
  listEmployees,
  listWorkPolicies,
  reactivateEmployee,
  updateEmployee,
  type CreateEmployeeBody,
  type EmployeeStatus,
  type EmployeeView,
  type Role,
  type UpdateEmployeeBody,
} from '../../api/admin';
import { useApi } from '../../api/useApi';
import { useAuth } from '../../auth/AuthContext';
import { Card } from '../../components/Card';
import { Button } from '../../components/Page';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { PersonCell, Table, type Column } from '../../components/Table';
import { formatDate, formatTaka, todayInDhaka } from '../../lib/format';
import {
  Chip,
  ConfirmDialog,
  FormGrid,
  FullWidth,
  Modal,
  MiniButton,
  Notice,
  RowActions,
  SecretModal,
  SelectField,
  ServerError,
  TextField,
  orNull,
  orUndefined,
  useDebounced,
  useMutation,
} from './ui';

/**
 * E10 · স্টাফ — `CRUD /employees`।
 *
 * ⚠️ **ডিলিট নেই, deactivate আছে।** সার্ভারে `@Delete` রুটটাই নেই
 * (`employees.controller.ts`) — কারণ সারিটা মুছলে ওই কর্মীর মাসের হিসাব,
 * স্ক্রিনশট আর audit trail সব অনাথ হতো। তাই UI-তেও "মুছে ফেলুন" কথাটা
 * কোথাও লেখা নেই; "নিষ্ক্রিয় করুন" লেখা আছে, আর ব্যাপারটা ফেরানো যায়।
 *
 * ⭐ বেতনের ঘরটা `user.role === 'owner'` ছাড়া **render-ই হয় না**।
 * ম্যানেজারের রেসপন্সে `monthlySalary` key-টাই থাকে না (redact.ts), তাই
 * `?? '—'` লিখলে ম্যানেজারের পর্দায় একটা ফাঁকা বেতনের কলাম বসে যেত —
 * আর সেটা দেখে মনে হতো বেতন বসানোই নেই।
 */

const STATUS_OPTIONS = [
  { value: 'active', label: 'সক্রিয়' },
  { value: 'inactive', label: 'নিষ্ক্রিয়' },
  { value: 'all', label: 'সবাই' },
] as const;

type StatusFilter = EmployeeStatus | 'all';

export function StaffTab() {
  const { user } = useAuth();
  // ⭐ পুরো পেজটাই owner-only, তবু এখানে আবার দেখা হয়: বেতনের সিদ্ধান্তটা
  //    যে জায়গায় বেতন দেখানো হয়, ঠিক সেখানেই থাকা দরকার।
  const canSeeSalary = user?.role === 'owner';

  const [status, setStatus] = useState<StatusFilter>('active');
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);

  const staff = useApi(
    (signal) => listEmployees({ status, search }, signal),
    [status, search],
  );

  // পলিসির নাম দেখানোর জন্য — id দেখিয়ে লাভ নেই, কেউ মনে রাখে না
  const policies = useApi((signal) => listWorkPolicies(signal), []);
  const policyName = (id: number | null): string => {
    if (id === null) return '—';
    const found = policies.data?.rows.find((p) => p.id === id);
    return found ? found.name : `#${id}`;
  };

  const [editing, setEditing] = useState<EmployeeView | null>(null);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState<EmployeeView | null>(null);
  const [reactivating, setReactivating] = useState<EmployeeView | null>(null);
  const [portalFor, setPortalFor] = useState<EmployeeView | null>(null);
  const [tempPassword, setTempPassword] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const rows = staff.data?.rows ?? [];

  const columns: Column<EmployeeView>[] = [
    {
      key: 'name',
      header: 'নাম',
      render: (emp) => (
        <PersonCell
          fullName={emp.fullName}
          empCode={emp.empCode}
          note={emp.designation ?? undefined}
        />
      ),
    },
    {
      key: 'department',
      header: 'বিভাগ',
      render: (emp) => emp.department ?? '—',
    },
    {
      key: 'policy',
      header: 'work policy',
      render: (emp) => policyName(emp.policyId),
    },
    {
      key: 'joined',
      header: 'যোগদান',
      render: (emp) => (
        <span className="num">
          {emp.joinedOn ? formatDate(emp.joinedOn) : '—'}
        </span>
      ),
    },
    // ⭐ কলামটা তালিকা থেকেই বাদ — লুকিয়ে রাখা নয়, বসানোই হয় না
    ...(canSeeSalary
      ? [
          {
            key: 'salary',
            header: 'মাসিক বেতন',
            align: 'right' as const,
            render: (emp: EmployeeView) => (
              <span className="num">{formatTaka(emp.monthlySalary)}</span>
            ),
          },
        ]
      : []),
    {
      key: 'status',
      header: 'অবস্থা',
      render: (emp) =>
        emp.status === 'active' ? (
          <Chip tone="counted">সক্রিয়</Chip>
        ) : (
          <Chip>নিষ্ক্রিয়{emp.leftOn ? ` · ${formatDate(emp.leftOn)}` : ''}</Chip>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (emp) => (
        <RowActions>
          <MiniButton onClick={() => setEditing(emp)}>সম্পাদনা</MiniButton>
          {emp.status === 'active' ? (
            <>
              <MiniButton
                onClick={() => setPortalFor(emp)}
                title="স্টাফ নিজের হিসাব দেখার জন্য লগইন পাবে"
              >
                পোর্টাল অ্যাকাউন্ট
              </MiniButton>
              <MiniButton tone="danger" onClick={() => setDeactivating(emp)}>
                নিষ্ক্রিয় করুন
              </MiniButton>
            </>
          ) : (
            <MiniButton onClick={() => setReactivating(emp)}>
              আবার চালু করুন
            </MiniButton>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/*
        ⚠️ ফিল্টারের বার তিনটে অবস্থার **বাইরে** — নইলে সার্চ বাক্সটা প্রতি
           রিকোয়েস্টে unmount হয়ে যেত আর টাইপ করতে করতে কার্সার হারাত।
      */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-ink-3">খুঁজুন</span>
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="নাম, কোড বা ইমেইল"
              className="w-56 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11.5px] text-ink-3">অবস্থা</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Button tone="primary" onClick={() => setCreating(true)}>
          স্টাফ যোগ করুন
        </Button>
      </div>

      {staff.loading && !staff.data && <Loading />}
      {staff.error && <ErrorBox error={staff.error} retry={staff.reload} />}

      {!staff.loading && !staff.error && rows.length === 0 && (
        <Empty
          title={search ? 'এই খোঁজে কাউকে পাওয়া গেল না' : 'এখনো কোনো স্টাফ নেই'}
          hint={
            search
              ? 'নাম, কোড বা ইমেইলের অংশ দিয়ে খুঁজুন — অথবা "অবস্থা" বদলে নিষ্ক্রিয়দেরও দেখুন।'
              : 'প্রথমে স্টাফ যোগ করুন, তারপর "ডিভাইস" ট্যাব থেকে তার PC-র জন্য এনরোলমেন্ট কোড বানান — ওটা ছাড়া এজেন্ট কোনো ডেটা পাঠাবে না।'
          }
          action={
            <Button tone="primary" onClick={() => setCreating(true)}>
              স্টাফ যোগ করুন
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <Card
          padded={false}
          title={`স্টাফ · ${staff.data?.total ?? rows.length} জন`}
          hint={
            canSeeSalary
              ? 'বেতন দেখা ও বদলানো — দুটোই audit log-এ লেখা থাকে'
              : undefined
          }
        >
          <Table
            columns={columns}
            rows={rows}
            rowKey={(emp) => String(emp.id)}
            rowMuted={(emp) => emp.status === 'inactive'}
          />
        </Card>
      )}

      {(creating || editing) && (
        <EmployeeForm
          // ⚠️ `key` — নইলে একজনের ফর্ম বন্ধ না করে অন্যজনেরটা খুললে React
          //    একই কম্পোনেন্ট ধরে নিত আর আগের জনের টাইপ করা মান বসে থাকত
          key={editing?.id ?? 'new'}
          employee={editing}
          canSeeSalary={canSeeSalary}
          policies={policies.data?.rows.map((p) => ({
            value: String(p.id),
            label: p.isActive ? p.name : `${p.name} (নিষ্ক্রিয়)`,
          }))}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            staff.reload();
          }}
        />
      )}

      {deactivating && (
        <DeactivateDialog
          employee={deactivating}
          onClose={() => setDeactivating(null)}
          onDone={() => {
            setDeactivating(null);
            staff.reload();
          }}
        />
      )}

      {reactivating && (
        <ReactivateDialog
          employee={reactivating}
          onClose={() => setReactivating(null)}
          onDone={() => {
            setReactivating(null);
            staff.reload();
          }}
        />
      )}

      {portalFor && (
        <PortalAccountForm
          employee={portalFor}
          onClose={() => setPortalFor(null)}
          onCreated={(email, password) => {
            setPortalFor(null);
            setTempPassword({ email, password });
          }}
        />
      )}

      {tempPassword && (
        <SecretModal
          title="অস্থায়ী পাসওয়ার্ড"
          label="পাসওয়ার্ড"
          secret={tempPassword.password}
          note={tempPassword.email}
          meta="প্রথম লগইনেই তাকে পাসওয়ার্ড বদলাতে হবে।"
          onClose={() => setTempPassword(null)}
        />
      )}
    </div>
  );
}

// ── যোগ করা ও সম্পাদনা ──────────────────────────────────────────────────────

interface StaffForm {
  empCode: string;
  fullName: string;
  email: string;
  designation: string;
  department: string;
  policyId: string;
  joinedOn: string;
  monthlySalary: string;
}

function formOf(employee: EmployeeView | null): StaffForm {
  return {
    empCode: employee?.empCode ?? '',
    fullName: employee?.fullName ?? '',
    email: employee?.email ?? '',
    designation: employee?.designation ?? '',
    department: employee?.department ?? '',
    policyId:
      employee?.policyId === null || employee?.policyId === undefined
        ? ''
        : String(employee.policyId),
    joinedOn: employee?.joinedOn ?? '',
    monthlySalary: employee?.monthlySalary ?? '',
  };
}

/**
 * ⚠️ PATCH-এ **শুধু যা বদলেছে** সেটুকুই যায়।
 *
 * পুরো ফর্মটা পাঠালে দুটো ক্ষতি হতো: (১) বেতনে হাত না দিলেও প্রতিবার
 * `employee_salary` audit সারি বসত, আর আসল বেতন-পরিবর্তনগুলো ওগুলোর নিচে
 * চাপা পড়ত; (২) দুজন একসাথে সম্পাদনা করলে একজন অন্যজনের বদল মুছে দিত।
 */
function patchOf(
  before: StaffForm,
  after: StaffForm,
  canSeeSalary: boolean,
): UpdateEmployeeBody {
  const patch: UpdateEmployeeBody = {};

  if (after.empCode.trim() !== before.empCode) {
    patch.empCode = after.empCode.trim();
  }
  if (after.fullName.trim() !== before.fullName) {
    patch.fullName = after.fullName.trim();
  }
  // ⚠️ ফাঁকা ঘর মানে `null` ("মুছে দাও"), `''` নয় — `''` পাঠালে
  //    `@IsEmail`/`@Matches` ভেঙে ৪০০ হতো
  if (after.email.trim() !== before.email) patch.email = orNull(after.email);
  if (after.designation.trim() !== before.designation) {
    patch.designation = orNull(after.designation);
  }
  if (after.department.trim() !== before.department) {
    patch.department = orNull(after.department);
  }
  if (after.joinedOn !== before.joinedOn) {
    patch.joinedOn = orNull(after.joinedOn);
  }
  if (after.policyId !== before.policyId) {
    patch.policyId = after.policyId === '' ? null : Number(after.policyId);
  }
  if (canSeeSalary && after.monthlySalary.trim() !== before.monthlySalary) {
    patch.monthlySalary = orNull(after.monthlySalary);
  }

  return patch;
}

function EmployeeForm({
  employee,
  canSeeSalary,
  policies,
  onClose,
  onSaved,
}: {
  employee: EmployeeView | null;
  canSeeSalary: boolean;
  policies?: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = formOf(employee);
  const [form, setForm] = useState<StaffForm>(initial);
  const { busy, error, run } = useMutation();

  const set = (key: keyof StaffForm) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (): void => {
    run(async () => {
      if (employee) {
        const patch = patchOf(initial, form, canSeeSalary);
        // কিছুই বদলায়নি — সার্ভারে গিয়ে "কোনো ফিল্ড দেওয়া হয়নি" ৪০০ আনার
        // চেয়ে চুপচাপ বন্ধ করে দেওয়াই সৎ
        if (Object.keys(patch).length > 0) {
          await updateEmployee(employee.id, patch);
        }
      } else {
        const body: CreateEmployeeBody = {
          empCode: form.empCode.trim(),
          fullName: form.fullName.trim(),
          ...(orUndefined(form.email) ? { email: form.email.trim() } : {}),
          ...(orUndefined(form.designation)
            ? { designation: form.designation.trim() }
            : {}),
          ...(orUndefined(form.department)
            ? { department: form.department.trim() }
            : {}),
          ...(form.policyId ? { policyId: Number(form.policyId) } : {}),
          ...(form.joinedOn ? { joinedOn: form.joinedOn } : {}),
          ...(canSeeSalary && orUndefined(form.monthlySalary)
            ? { monthlySalary: form.monthlySalary.trim() }
            : {}),
        };
        await createEmployee(body);
      }
      onSaved();
    });
  };

  const incomplete =
    form.empCode.trim() === '' || form.fullName.trim() === '';

  return (
    <Modal
      title={employee ? `${employee.fullName} — সম্পাদনা` : 'নতুন স্টাফ'}
      hint={employee ? `কোড ${employee.empCode}` : 'কোড আর নাম বাধ্যতামূলক'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            বাতিল
          </Button>
          <Button
            tone="primary"
            onClick={submit}
            disabled={busy || incomplete}
            title={incomplete ? 'কোড আর নাম দুটোই লাগবে' : undefined}
          >
            {busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <TextField
            label="কর্মী কোড"
            value={form.empCode}
            onChange={set('empCode')}
            required
            mono
            maxLength={32}
            autoFocus={!employee}
            hint="শুধু অক্ষর, সংখ্যা, হাইফেন ও আন্ডারস্কোর — যেমন OX-001"
          />
          <TextField
            label="পুরো নাম"
            value={form.fullName}
            onChange={set('fullName')}
            required
            maxLength={120}
          />
          <TextField
            label="ইমেইল"
            type="email"
            value={form.email}
            onChange={set('email')}
            hint="পোর্টাল অ্যাকাউন্ট বানাতে লাগবে"
          />
          <TextField
            label="পদবি"
            value={form.designation}
            onChange={set('designation')}
            maxLength={120}
          />
          <TextField
            label="বিভাগ"
            value={form.department}
            onChange={set('department')}
            maxLength={120}
          />
          <TextField
            label="যোগদানের তারিখ"
            type="date"
            value={form.joinedOn}
            onChange={set('joinedOn')}
            max={todayInDhaka()}
          />
          <SelectField
            label="work policy"
            value={form.policyId}
            onChange={set('policyId')}
            options={[
              { value: '', label: '— ডিফল্ট —' },
              ...(policies ?? []),
            ]}
            hint="মাসের টার্গেট, ছবির উইন্ডো ও idle থ্রেশহোল্ড এখান থেকেই আসে"
          />

          {/*
            ⭐ বেতনের ঘরটা owner ছাড়া কারো জন্য **বসানোই হয় না**।
               ⚠️ পাশের লেখাটা ইচ্ছাকৃত: যে দেখছে সে-ও যেন জানে তার দেখাটা
                  লেখা থাকছে (সার্ভার `payroll_view` সারি বসায়)।
          */}
          {canSeeSalary && (
            <FullWidth>
              <TextField
                label="মাসিক বেতন (৳)"
                value={form.monthlySalary}
                onChange={set('monthlySalary')}
                mono
                placeholder="13000"
                hint='⭐ বেতন দেখা ও বদলানো — দুটোই audit log-এ থাকে। "13000" বা "13000.50" ধাঁচে লিখুন; ফাঁকা রাখলে বসানো বেতনটা মুছে যাবে।'
              />
            </FullWidth>
          )}
        </FormGrid>

        <ServerError error={error} />
      </div>
    </Modal>
  );
}

// ── নিষ্ক্রিয় ও পুনরায় চালু ─────────────────────────────────────────────────

function DeactivateDialog({
  employee,
  onClose,
  onDone,
}: {
  employee: EmployeeView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();
  const [leftOn, setLeftOn] = useState(todayInDhaka());

  return (
    <ConfirmDialog
      title={`${employee.fullName}-কে নিষ্ক্রিয় করবেন?`}
      intro="তার পুরোনো হিসাব, স্ক্রিনশট আর রিপোর্ট সব থেকে যাবে — কিছুই মোছা হয় না। পরে আবার চালু করা যাবে।"
      warning="একই সাথে তার সব ডিভাইস revoke হবে, না-ব্যবহার করা এনরোলমেন্ট কোড বাতিল হবে আর পোর্টাল অ্যাকাউন্ট বন্ধ হবে। ওই PC-গুলো থেকে নতুন কোনো ডেটা আর আসবে না।"
      confirmLabel="নিষ্ক্রিয় করুন"
      withReason
      extra={
        <div className="max-w-xs">
          <TextField
            label="শেষ কর্মদিবস"
            type="date"
            value={leftOn}
            onChange={setLeftOn}
            max={todayInDhaka()}
            hint="ডিফল্ট আজ — মাসের হিসাব এই তারিখ পর্যন্তই গোনা হবে"
          />
        </div>
      }
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={(reason) =>
        run(async () => {
          await deactivateEmployee(employee.id, reason, leftOn);
          onDone();
        })
      }
    />
  );
}

function ReactivateDialog({
  employee,
  onClose,
  onDone,
}: {
  employee: EmployeeView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, error, run } = useMutation();

  return (
    <ConfirmDialog
      title={`${employee.fullName}-কে আবার চালু করবেন?`}
      intro="সে আবার সক্রিয় তালিকায় আসবে আর মাসের টার্গেটে গোনা হবে।"
      warning="⚠️ ডিভাইসগুলো নিজে থেকে ফিরে আসে না — তার PC-র জন্য নতুন এনরোলমেন্ট কোড বানাতে হবে (ডিভাইস ট্যাব), নইলে এজেন্ট চুপ করে থাকবে।"
      confirmLabel="আবার চালু করুন"
      tone="primary"
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() =>
        run(async () => {
          await reactivateEmployee(employee.id);
          onDone();
        })
      }
    />
  );
}

// ── পোর্টাল অ্যাকাউন্ট ──────────────────────────────────────────────────────

const PORTAL_ROLES: { value: Role; label: string }[] = [
  { value: 'employee', label: 'স্টাফ — শুধু নিজের হিসাব' },
  { value: 'manager', label: 'ম্যানেজার — সবার লাইভ ভিউ ও রিপোর্ট' },
];

/**
 * স্টাফের নিজের পর্দায় ঢোকার অ্যাকাউন্ট (J04)।
 *
 * ⚠️ `owner` ভূমিকা এখান থেকে দেওয়া যায় না — ইচ্ছাকৃত। owner মানে বেতন,
 *    audit log আর সেটিংসের চাবি; সেটা একটা ড্রপডাউনের এক ক্লিকে দেওয়ার
 *    মতো জিনিস নয়।
 */
function PortalAccountForm({
  employee,
  onClose,
  onCreated,
}: {
  employee: EmployeeView;
  onClose: () => void;
  onCreated: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState(employee.email ?? '');
  const [role, setRole] = useState<Role>('employee');
  const { busy, error, run } = useMutation();

  return (
    <Modal
      title={`${employee.fullName} — পোর্টাল অ্যাকাউন্ট`}
      hint="সে নিজের ঘণ্টা ও অগ্রগতি দেখতে পারবে"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            বাতিল
          </Button>
          <Button
            tone="primary"
            onClick={() =>
              run(async () => {
                const result = await createPortalAccount(
                  employee.id,
                  email.trim(),
                  role,
                );
                onCreated(result.email, result.tempPassword);
              })
            }
            disabled={busy || email.trim() === ''}
          >
            {busy ? 'তৈরি হচ্ছে…' : 'অ্যাকাউন্ট বানান'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Notice>
          অস্থায়ী পাসওয়ার্ডটা তৈরির পর <strong>একবারই</strong> দেখানো হবে।
          প্রথম লগইনেই তাকে সেটা বদলাতে হবে।
        </Notice>

        <TextField
          label="ইমেইল"
          type="email"
          value={email}
          onChange={setEmail}
          required
          autoFocus
          hint="এই ইমেইল দিয়েই সে লগইন করবে"
        />

        <SelectField
          label="ভূমিকা"
          value={role}
          onChange={(value) => setRole(value as Role)}
          options={PORTAL_ROLES}
          hint="স্টাফের পর্দায় কোনো বোতাম থাকে না — শুধু নিজের হিসাব দেখা যায়"
        />

        <ServerError error={error} />
      </div>
    </Modal>
  );
}
