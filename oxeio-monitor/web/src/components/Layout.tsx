import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { BrandMark, Wordmark } from './Brand';

/** Phase 3-এ এগুলো আসল পেজ হবে; এখন শুধু কাঠামোটা দাঁড় করানো */
const NAV = [
  { to: '/', label: 'লাইভ বোর্ড', end: true },
  { to: '/staff', label: 'স্টাফ' },
  { to: '/screenshots', label: 'স্ক্রিনশট' },
  { to: '/monthly', label: 'মাসিক অগ্রগতি' },
  { to: '/reports', label: 'রিপোর্ট' },
];

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'স্টাফ',
};

export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-full flex-col">
      {/* লোগোর কালো ফিল্ড — দুই থিমেই এক */}
      <header className="flex items-center gap-4 bg-black px-4 py-2.5 text-white">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="leading-tight">
            <Wordmark className="text-[15px]" />
            <div className="text-[11px] text-white/55">Workforce Monitor</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-[12.5px] font-medium">{user?.fullName}</div>
            <div className="text-[11px] text-white/55">
              {user ? (ROLE_LABEL[user.role] ?? user.role) : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-white/20 px-2.5 py-1.5 text-xs text-white/85 transition hover:border-brand hover:text-white"
          >
            লগআউট
          </button>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition ${
                isActive
                  ? 'border-brand font-semibold text-brand-ink'
                  : 'border-transparent text-ink-2 hover:text-ink'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
