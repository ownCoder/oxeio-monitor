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

/**
 * ⚠️ কর্মীর `inactive` মানে **চাকরি ছেড়েছেন বা বন্ধ করা হয়েছে** — লাইভ
 *    বোর্ডের "নিষ্ক্রিয়" (Idle, কি-বোর্ড চুপ) নয়। তাই এখানে "Idle" নয়,
 *    "Inactive"; দুটোকে এক শব্দে মেলালে ছুটিতে থাকা কর্মী আর চাকরি ছাড়া
 *    কর্মী একই রকম দেখাত।
 */
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'Everyone' },
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
      header: 'Name',
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
      header: 'Department',
      render: (emp) => emp.department ?? '—',
    },
    {
      key: 'policy',
      header: 'Work policy',
      render: (emp) => policyName(emp.policyId),
    },
    {
      key: 'joined',
      header: 'Joined',
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
            header: 'Monthly salary',
            align: 'right' as const,
            render: (emp: EmployeeView) => (
              <span className="num">{formatTaka(emp.monthlySalary)}</span>
            ),
          },
        ]
      : []),
    {
      key: 'status',
      header: 'Status',
      render: (emp) =>
        emp.status === 'active' ? (
          <Chip tone="counted">Active</Chip>
        ) : (
          <Chip>Inactive{emp.leftOn ? ` · ${formatDate(emp.leftOn)}` : ''}</Chip>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (emp) => (
        <RowActions>
          <MiniButton onClick={() => setEditing(emp)}>Edit</MiniButton>
          {emp.status === 'active' ? (
            <>
              <MiniButton
                onClick={() => setPortalFor(emp)}
                title="Gives them a login to see their own hours"
              >
                Portal account
              </MiniButton>
              <MiniButton tone="danger" onClick={() => setDeactivating(emp)}>
                Deactivate
              </MiniButton>
            </>
          ) : (
            <MiniButton onClick={() => setReactivating(emp)}>
              Reactivate
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
            <span className="mb-1 block text-[11.5px] text-ink-3">Search</span>
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Name, code or email"
              className="w-56 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11.5px] text-ink-3">Status</span>
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
          Add staff
        </Button>
      </div>

      {staff.loading && !staff.data && <Loading />}
      {staff.error && <ErrorBox error={staff.error} retry={staff.reload} />}

      {!staff.loading && !staff.error && rows.length === 0 && (
        <Empty
          title={search ? 'No one matches that search' : 'No staff yet'}
          hint={
            search
              ? 'Try part of a name, code or email — or change "Status" to include inactive people.'
              : 'Add someone first, then create an enrolment code for their PC on the "Devices" tab — without it the agent sends nothing.'
          }
          action={
            <Button tone="primary" onClick={() => setCreating(true)}>
              Add staff
            </Button>
          }
        />
      )}

      {rows.length > 0 && (
        <Card
          padded={false}
          title={`Staff · ${staff.data?.total ?? rows.length}`}
          hint={
            canSeeSalary
              ? 'Viewing or changing salary is recorded in the audit log.'
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
            label: p.isActive ? p.name : `${p.name} (closed)`,
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
          title="Temporary password"
          label="password"
          secret={tempPassword.password}
          note={tempPassword.email}
          meta="They must change this password at their first sign-in."
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
      title={employee ? `${employee.fullName} — edit` : 'New staff member'}
      hint={
        employee ? `Code ${employee.empCode}` : 'Code and name are required'
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={submit}
            disabled={busy || incomplete}
            title={incomplete ? 'Both code and name are required' : undefined}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FormGrid>
          <TextField
            label="Employee code"
            value={form.empCode}
            onChange={set('empCode')}
            required
            mono
            maxLength={32}
            autoFocus={!employee}
            hint="Letters, digits, hyphen and underscore only — for example OX-001"
          />
          <TextField
            label="Full name"
            value={form.fullName}
            onChange={set('fullName')}
            required
            maxLength={120}
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={set('email')}
            hint="Needed to create a portal account"
          />
          <TextField
            label="Designation"
            value={form.designation}
            onChange={set('designation')}
            maxLength={120}
          />
          <TextField
            label="Department"
            value={form.department}
            onChange={set('department')}
            maxLength={120}
          />
          <TextField
            label="Joined on"
            type="date"
            value={form.joinedOn}
            onChange={set('joinedOn')}
            max={todayInDhaka()}
          />
          <SelectField
            label="Work policy"
            value={form.policyId}
            onChange={set('policyId')}
            options={[
              { value: '', label: '— Default —' },
              ...(policies ?? []),
            ]}
            hint="The monthly target, screenshot window and idle threshold all come from here"
          />

          {/*
            ⭐ বেতনের ঘরটা owner ছাড়া কারো জন্য **বসানোই হয় না**।
               ⚠️ পাশের লেখাটা ইচ্ছাকৃত: যে দেখছে সে-ও যেন জানে তার দেখাটা
                  লেখা থাকছে (সার্ভার `payroll_view` সারি বসায়)।
          */}
          {canSeeSalary && (
            <FullWidth>
              <TextField
                label="Monthly salary (৳)"
                value={form.monthlySalary}
                onChange={set('monthlySalary')}
                mono
                placeholder="13000"
                hint='Viewing or changing salary is recorded in the audit log. Write it as "13000" or "13000.50"; leave it empty to clear the salary that is set.'
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
      title={`Deactivate ${employee.fullName}?`}
      intro="Their past hours, screenshots and reports all stay — nothing is deleted. You can reactivate them later."
      warning="All their devices will be revoked at the same time, any unused enrolment code is cancelled, and their portal account is closed. No new data will arrive from those PCs."
      confirmLabel="Deactivate"
      withReason
      extra={
        <div className="max-w-xs">
          <TextField
            label="Last workday"
            type="date"
            value={leftOn}
            onChange={setLeftOn}
            max={todayInDhaka()}
            hint="Defaults to today — the month is counted only up to this date"
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
      title={`Reactivate ${employee.fullName}?`}
      intro="They come back to the active list and count towards the monthly target again."
      warning="Devices do not come back on their own — create a new enrolment code for their PC on the Devices tab, otherwise the agent stays silent."
      confirmLabel="Reactivate"
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
  { value: 'employee', label: 'Staff — their own hours only' },
  { value: 'manager', label: "Manager — everyone's Live Board and reports" },
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
      title={`${employee.fullName} — portal account`}
      hint="They will be able to see their own hours and progress"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
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
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Notice>
          The temporary password is shown <strong>only once</strong> after it
          is created. They must change it at their first sign-in.
        </Notice>

        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          required
          autoFocus
          hint="This is the email they will sign in with"
        />

        <SelectField
          label="Role"
          value={role}
          onChange={(value) => setRole(value as Role)}
          options={PORTAL_ROLES}
          hint="A staff screen has no buttons — they can only look at their own hours"
        />

        <ServerError error={error} />
      </div>
    </Modal>
  );
}
