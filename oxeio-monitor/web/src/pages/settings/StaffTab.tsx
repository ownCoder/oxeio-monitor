import { useEffect, useState } from 'react';

import {
  createEmployee,
  changeLoginEmail,
  changeUserRole,
  createPortalAccount,
  nextEmployeeCode,
  resetUserPassword,
  deactivateEmployee,
  listEmployees,
  listWorkPolicies,
  reactivateEmployee,
  turnAgentOn,
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

  /**
   * ⭐ বন্ধ হয়ে যাওয়া এজেন্ট আবার চালু — **নিশ্চিতকরণসহ**।
   *
   * ⚠️⚠️ revoke `token_hash` মোছে না, শুধু দরজা বন্ধ করে। ফেরালে **পুরোনো
   * টোকেনটাই আবার জেগে ওঠে** — তাই হারিয়ে যাওয়া ল্যাপটপে এটা করা যাবে না,
   * যে ধরে আছে সে-ও ফিরে আসবে। এক ক্লিকে হয়ে যাওয়ার মতো কাজ নয়।
   */
  const onTurnAgentOn = (emp: EmployeeView) => {
    const ok = window.confirm(
      `Turn ${emp.fullName}'s agent back on?

`
        + 'Their PC starts sending hours and screenshots again, using the login it already has.

'
        + '⚠️ Do NOT do this if that PC was lost or stolen — whoever holds it gets back in too. '
        + 'In that case leave it off and sign in fresh on the new machine.',
    );
    if (!ok) return;

    void turnAgentOn(emp.id)
      .then(() => staff.reload())
      .catch((e: unknown) => window.alert((e as Error).message));
  };

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
    /**
     * ⭐ **রোলআউটের একমাত্র শর্ত** — সই ছাড়া কারো PC-তে এজেন্ট বসবে না
     * ([01 § রোলআউট](../../../../docs/01-Planning.md))।
     *
     * ⚠️ কলামটা তালিকার ভেতরে রাখা হয়েছে, কোনো আলাদা পাতায় নয়: রোলআউটের
     * দিনে প্রশ্নটা হয় "এর সই আছে তো?", আর উত্তরটা ওই সারিতেই থাকা দরকার।
     * ⚠️ "নেই" অবস্থাটা **আম্বার**, লাল নয় — এটা সিস্টেমের ব্যর্থতা নয়,
     * একটা বাকি থাকা কাজ।
     */
    /**
     * ⭐⭐ **"এই লোকটার এজেন্ট বসানো যাবে?" — এক নজরে।**
     *
     * ⚠️ আগে এই প্রশ্নের উত্তর পর্দায় **কোথাও ছিল না**। কার portal
     * account খোলা হয়েছে সেটা জানার একমাত্র উপায় ছিল ১৫টা সারিতে একে একে
     * "Portal account" চেপে দেখা। ফলে রোলআউটের দিন কেউ বাদ পড়লে সেটা ধরা
     * পড়ত **ওই PC-র সামনে দাঁড়িয়ে**, যখন স্টাফ সাইন ইন করতে পারত না।
     */
    {
      key: 'setup',
      header: 'Setup',
      render: (emp) => {
        if (emp.status !== 'active') return <span className="text-ink3">—</span>;

        // ⚠️ ক্রমটা কাজের ক্রম: আগে লগইন, তারপর MSI, তারপর সে সাইন ইন করে
        if (!emp.hasPortalAccount) {
          return (
            <span className="text-brand" title="Create a portal account first — the agent asks for this login">
              Needs login
            </span>
          );
        }
        /**
         * ⚠️⚠️ **এটা "Ready to install"-এর আগে দেখতে হবে।** দুটো অবস্থাতেই
         * `hasDevice` মিথ্যা, কিন্তু করণীয় সম্পূর্ণ আলাদা: একটায় PC-তে
         * গিয়ে MSI বসাতে হয়, অন্যটায় সারিতেই এক ক্লিক। উল্টো ক্রমে লিখলে
         * মালিক বন্ধ হয়ে যাওয়া এজেন্টের জন্য আবার ইনস্টল করতে যেতেন।
         *
         * ⭐ এটা ঘটে কারণ কর্মী নিষ্ক্রিয় করলে তাঁর ডিভাইস revoke হয়, আর
         * আবার সক্রিয় করলে সেটা ফেরে না — ইচ্ছাকৃত, কিন্তু নীরব।
         */
        if (emp.agentSwitchedOff) {
          return (
            <button
              type="button"
              className="text-brand underline underline-offset-2"
              title="Their agent was switched off (this happens when someone is made inactive). Turn it back on — no need to reinstall."
              onClick={() => onTurnAgentOn(emp)}
            >
              Turn agent on
            </button>
          );
        }
        if (!emp.hasDevice) {
          return (
            <span className="text-idle" title="Login ready — now install the agent on their PC">
              Ready to install
            </span>
          );
        }
        return (
          <span className="text-ok" title="Signed in from their PC — tracking">
            Running
          </span>
        );
      },
    },
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
                title={
                  emp.hasPortalAccount
                    ? `Login: ${emp.portalEmail ?? ''} — change it or reset the password`
                    : 'Gives them a login to see their own hours'
                }
              >
                {/* ⭐ অ্যাকাউন্ট থাকলে লেখাটা বদলায় — নইলে "Portal account"
                    চেপে কী হবে তার কোনো ইঙ্গিতই থাকত না, আর মালিক ভাবতেন
                    আবার নতুন অ্যাকাউন্ট তৈরি হয়ে যাবে। */}
                {emp.hasPortalAccount ? 'Login' : 'Portal account'}
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

  /**
   * ⭐ রোলআউটের একমাত্র সংখ্যা — কতজনের কাজ বাকি।
   *
   * ⚠️ শুধু `active` কর্মী গোনা হয়; যিনি চলে গেছেন তাঁর portal account
   * না থাকাটা বাকি কাজ নয়।
   */
  const activeStaff = rows.filter((e) => e.status === 'active');
  const needLogin = activeStaff.filter((e) => !e.hasPortalAccount).length;
  const needAgent = activeStaff.filter(
    (e) => e.hasPortalAccount && !e.hasDevice && !e.agentSwitchedOff,
  ).length;

  // ⚠️ আলাদা করে গোনা — "বসাতে হবে" আর "চালু করতে হবে" এক নয়, আর
  //    দ্বিতীয়টা এক ক্লিকের কাজ। একসাথে গুনলে মালিক ভাবতেন সবগুলোতেই
  //    PC-তে যেতে হবে।
  const switchedOff = activeStaff.filter((e) => e.agentSwitchedOff).length;

  const setupHint =
    needLogin === 0 && needAgent === 0 && switchedOff === 0
      ? undefined
      : [
          needLogin > 0 ? `${needLogin} still need a portal account` : null,
          needAgent > 0 ? `${needAgent} ready for the agent` : null,
          switchedOff > 0 ? `${switchedOff} agent switched off` : null,
        ]
          .filter(Boolean)
          .join(' · ');

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
          /**
           * ⭐ **রোলআউটের একমাত্র সংখ্যা।** ১৫টা সারি পড়ার বদলে এক লাইনে
           * "কতজন বাকি" — আর কী বাকি, সেটাও।
           *
           * ⚠️ শুধু কাজ **বাকি থাকলেই** দেখানো হয়। সব শেষ হয়ে গেলে লাইনটা
           * উধাও — নইলে ওটা স্থায়ী সাজসজ্জা হয়ে যেত আর কেউ পড়ত না।
           */
          hint={setupHint ?? (
            canSeeSalary
              ? 'Viewing or changing salary is recorded in the audit log.'
              : undefined
          )}
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
            // ⚠️ রিসেটেও তালিকা রিফ্রেশ — নতুন অ্যাকাউন্ট খোলা হলে
            //    "Setup" কলামটা সাথে সাথে বদলাতে হবে
            staff.reload();
          }}
          onSaved={() => {
            setPortalFor(null);
            staff.reload();
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

  /**
   * ⭐ নতুন কর্মীর ফর্ম খুললে কোডটা আগে থেকেই বসে যায় (`OX-13`)।
   *
   * ⚠️ **সম্পাদনার সময় নয়** — ওখানে কোডটা কর্মীর নিজের, আর ওটা বদলে
   * দেওয়ার কোনো কারণ নেই।
   *
   * ⚠️ ব্যর্থ হলে চুপ করে থাকা হয় ইচ্ছাকৃতভাবে: এটা নিছক সুবিধা, আর
   * এর জন্য পুরো ফর্মে একটা লাল বার্তা দেখানো অর্থহীন — মালিক তখন
   * নিজেই কোডটা টাইপ করে নিতে পারেন।
   *
   * ⚠️ যা টাইপ করা হয়ে গেছে তার উপরে বসে না (`prev.empCode === ''`) —
   * ধীর সংযোগে উত্তর আসতে দেরি হলে হাতে লেখা কোড মুছে যেত।
   */
  useEffect(() => {
    if (employee) return;

    const ac = new AbortController();
    nextEmployeeCode(ac.signal)
      .then(({ code }) =>
        setForm((prev) => (prev.empCode === '' ? { ...prev, empCode: code } : prev)),
      )
      .catch(() => {
        /* পরামর্শ না এলে ঘরটা খালিই থাকুক */
      });

    return () => ac.abort();
  }, [employee]);

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
            hint={
              employee
                ? 'Letters, digits, hyphen and underscore only'
                : 'Suggested from the highest code so far — change it if you like'
            }
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
  onSaved,
}: {
  employee: EmployeeView;
  onClose: () => void;
  /** নতুন অস্থায়ী পাসওয়ার্ড — খোলা ও রিসেট, দুটোতেই */
  onCreated: (email: string, password: string) => void;
  /** ইমেইল বদলানোর পর — পাসওয়ার্ড দেখানোর কিছু নেই, শুধু তালিকা রিফ্রেশ */
  onSaved: () => void;
}) {
  /**
   * ⭐ একই মোডাল দুটো কাজ করে — অ্যাকাউন্ট **খোলা** আর **ঠিক করা**।
   *
   * ⚠️ আলাদা দুটো মোডাল বানালে সারিতে দুটো বোতাম লাগত, আর মালিককে মনে
   * রাখতে হতো কারটা খোলা হয়েছে কারটা হয়নি — অথচ সেটা সিস্টেম নিজেই জানে।
   */
  const existing = employee.hasPortalAccount && employee.portalUserId !== null;

  const [email, setEmail] = useState(
    existing ? (employee.portalEmail ?? '') : (employee.email ?? ''),
  );
  /**
   * ⚠️⚠️ ড্রপডাউনটা **বর্তমান** ভূমিকা দেখিয়ে খোলে। `'employee'` ধরে
   * শুরু করলে কেউ শুধু ইমেইলের বানান ঠিক করতে গিয়ে সেভ চাপলেই একজন
   * ম্যানেজার নীরবে স্টাফ হয়ে যেতেন — আর সেটা কোথাও দেখা যেত না।
   */
  const [role, setRole] = useState<Role>(
    employee.portalRole === 'manager' ? 'manager' : 'employee',
  );

  /**
   * ⚠️ owner-এর অ্যাকাউন্ট এখান থেকে ছোঁয়া যায় না। ভূমিকার ঘরটাই দেখানো
   * হয় না, কারণ একটা নিষ্ক্রিয় ড্রপডাউন দেখলে মনে হতো কিছু একটা ভেঙে
   * আছে — অথচ এটা ইচ্ছাকৃত (ADR-011d)। সার্ভারও আলাদা করে আটকায়।
   */
  const ownerAccount = employee.portalRole === 'owner';

  const emailChanged = email.trim() !== (employee.portalEmail ?? '');
  const roleChanged = !ownerAccount && role !== employee.portalRole;
  const hasChanges = emailChanged || roleChanged;
  const { busy, error, run } = useMutation();

  return (
    <Modal
      title={`${employee.fullName} — ${existing ? 'login' : 'portal account'}`}
      hint={
        existing
          ? 'Change the sign-in email or role, or give them a new password'
          : 'They will be able to see their own hours and progress'
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {existing ? (
            <>
              {/* ⚠️⚠️ পাসওয়ার্ড রিসেট আর ইমেইল বদলানো **দুটো আলাদা বোতাম**।
                  এক বোতামে মিলিয়ে দিলে ইমেইলের বানান ঠিক করতে গিয়ে কারো
                  পাসওয়ার্ড অকারণে বদলে যেত, আর সে পরদিন ঢুকতেই পারত না। */}
              <Button
                onClick={() =>
                  run(async () => {
                    const result = await resetUserPassword(employee.portalUserId!);
                    onCreated(result.email, result.tempPassword);
                  })
                }
                disabled={busy}
              >
                {busy ? 'Working…' : 'Reset password'}
              </Button>
              <Button
                tone="primary"
                onClick={() =>
                  run(async () => {
                    /**
                     * ⚠️ ইমেইল ও ভূমিকা — যেটা সত্যিই বদলেছে **শুধু সেটাই**
                     * পাঠানো হয়। দুটোই সবসময় পাঠালে audit log-এ এমন
                     * "বদল" জমত যেখানে আসলে কিছুই বদলায়নি, আর পরে
                     * "কে কখন ম্যানেজার হলো" খুঁজে বের করা কঠিন হতো।
                     */
                    if (emailChanged) {
                      await changeLoginEmail(employee.portalUserId!, email.trim());
                    }
                    if (roleChanged) {
                      await changeUserRole(employee.portalUserId!, role);
                    }
                    onSaved();
                  })
                }
                disabled={busy || email.trim() === '' || !hasChanges}
              >
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          ) : (
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
          )}
        </>
      }
    >
      <div className="space-y-3.5">
        <Notice>
          {existing
            ? 'Change the email or the role, then Save. Resetting gives them a new temporary password — shown only once, and it does not change anything else.'
            : 'The temporary password is shown only once after it is created. They must change it at their first sign-in.'}
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

        {!ownerAccount && (
          <SelectField
            label="Role"
            value={role}
            onChange={(value) => setRole(value as Role)}
            options={PORTAL_ROLES}
            hint="A staff screen has no buttons — they can only look at their own hours"
          />
        )}

        <ServerError error={error} />
      </div>
    </Modal>
  );
}
