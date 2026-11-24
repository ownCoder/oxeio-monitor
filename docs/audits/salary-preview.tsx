import { createRoot } from 'react-dom/client';
import { AuthProvider } from './src/auth/AuthContext';
import { SalaryPage } from './src/pages/SalaryPage';
import { todayInDhaka } from './src/lib/format';
import './src/index.css';

const month = todayInDhaka().slice(0, 7);
const staffMode = new URLSearchParams(location.search).get('role') === 'staff';
const rows = [
  { employeeId: 1, empCode: 'OX-01', fullName: 'Sample designer', staffType: 'designer', monthlySalary: '20000.00', netPayable: '19000.00', payment: { status: 'not_recorded', paidAmount: null, paidOn: null, note: null, netPayableAtRecord: null, updatedAt: null } },
  { employeeId: 2, empCode: 'OX-02', fullName: 'Second sample', staffType: 'researcher', monthlySalary: '15000.00', netPayable: '14500.00', payment: { status: 'paid', paidAmount: '14500.00', paidOn: todayInDhaka(), note: 'Sample bank reference', netPayableAtRecord: '14500.00', updatedAt: new Date().toISOString() } },
  { employeeId: 3, empCode: 'OX-03', fullName: 'Third sample', staffType: 'designer', monthlySalary: '12000.00', netPayable: null, payment: { status: 'not_recorded', paidAmount: null, paidOn: null, note: null, netPayableAtRecord: null, updatedAt: null } },
];
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  let data: unknown = {};
  if (url.pathname.endsWith('/auth/me')) {
    data = { userId: 900001, email: 'preview@example.test', fullName: staffMode ? 'Sample designer' : 'Preview owner', role: staffMode ? 'employee' : 'owner', employeeId: staffMode ? 1 : null, mustChangePassword: false, lastLoginAt: null, canAddTargets: false, canProofread: false };
  } else if (url.pathname.endsWith('/payroll/salary') && init?.method !== 'PUT') {
    data = { yearMonth: url.searchParams.get('month') ?? month, closed: true, rows, missingSummary: ['Third sample'], approximateHolidayDates: [] };
  } else if (url.pathname.includes('/payroll/salary/') && init?.method === 'PUT') {
    const id = Number(url.pathname.split('/').at(-2));
    const body = JSON.parse(String(init.body)) as { status: string; paidAmount: string; paidOn?: string; note?: string };
    const row = rows.find(item => item.employeeId === id);
    if (row) row.payment = { status: body.status, paidAmount: body.paidAmount, paidOn: body.paidOn ?? null, note: body.note ?? null, netPayableAtRecord: row.netPayable, updatedAt: new Date().toISOString() };
    data = { ok: true };
  }
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
createRoot(document.getElementById('root')!).render(<AuthProvider><div className="min-h-screen bg-paper p-4"><p className="mb-5 rounded bg-amber-100 p-2 text-center text-sm text-black">Synthetic preview — sample salaries only; no employee data</p><SalaryPage /></div></AuthProvider>);
