import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Map, Users, UserRound, Inbox, Kanban, ListOrdered, Gauge, BarChart3, Settings, LogOut
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { AuthApi } from '../../api/endpoints';
import { useSocket } from '../../hooks/useSocket';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/map', label: 'Live Map', icon: Map },
  { to: '/requests', label: 'Approvals', icon: Inbox },
  { to: '/queue', label: 'Queue', icon: ListOrdered },
  { to: '/dispatch', label: 'Dispatch Console', icon: Gauge },
  { to: '/trips', label: 'Trip Board', icon: Kanban },
  { to: '/drivers', label: 'Drivers', icon: UserRound },
  { to: '/guests', label: 'Guests', icon: Users },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings }
];

export function AdminShell() {
  const name = useAuthStore((s) => s.name);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
  const { connected } = useSocket();

  async function handleLogout() {
    try {
      await AuthApi.logout();
    } catch {
      // best-effort — client-side discard always happens regardless
    }
    clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-full min-h-screen bg-gray-50">
      <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ops-600 text-sm font-bold text-white">ER</div>
          <div>
            <p className="text-sm font-semibold text-gray-900">EventRide Ops</p>
            <p className="flex items-center gap-1 text-[11px] text-gray-400">
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-400'}`} />
              {connected ? 'Live' : 'Reconnecting…'}
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-ops-50 text-ops-700' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-100 p-3">
          <div className="mb-2 truncate text-xs text-gray-500">Signed in as <span className="font-medium text-gray-700">{name}</span></div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
