import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Map, Users, UserRound, Inbox, Kanban, ListOrdered, Gauge, BarChart3, Settings, LogOut, WifiOff
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { AuthApi } from '../../api/endpoints';
import { useSocket } from '../../hooks/useSocket';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ThemeToggle } from '../ui/ThemeToggle';

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
  const online = useOnlineStatus();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await AuthApi.logout();
    } catch {
      // best-effort — client-side discard always happens regardless
    }
    clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-full min-h-screen bg-canvas">
      {/* Ten nav links stand between the tab key and the page content; this
          gives keyboard users one keystroke past them. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[1000] focus:rounded-md focus:bg-ops-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line-soft px-4 py-4">
          <div className="er-elev-1 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-ops-500 to-ops-700 text-sm font-bold text-white">
            ER
          </div>
          <div>
            <p className="er-gradient-text text-sm font-semibold tracking-tight">EventRide Ops</p>
            <p className="flex items-center gap-1.5 text-[11px] text-faint">
              {/* Reuses the dashboard's live dot so "is the feed up?" looks the
                  same everywhere. It stops pinging when the socket drops. */}
              <span className="er-live-dot !h-1.5 !w-1.5" data-stale={!connected} />
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
                // The ::before rail in index.css keys off aria-current, which
                // NavLink sets on the active link itself — no extra prop to
                // thread through, and it stays in sync with routing for free.
                `er-nav-item flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-ops-50 text-ops-700' : 'text-muted hover:bg-elevated hover:text-ink'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line-soft p-3">
          <ThemeToggle />
          <div className="truncate text-xs text-muted">Signed in as <span className="font-medium text-ink">{name}</span></div>
          <button
            onClick={() => setLogoutOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-elevated"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </aside>
      <main id="main-content" className="min-w-0 flex-1 overflow-y-auto">
        {/* Distinct from the socket chip in the sidebar: that one means "the
            live feed dropped", this means "this machine has no network at all",
            and every number on screen is frozen. */}
        {!online && (
          <div
            role="status"
            className="flex items-center justify-center gap-1.5 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800"
          >
            <WifiOff size={13} />
            No network connection — figures on screen are the last received values
          </div>
        )}
        <Outlet />
      </main>

      <ConfirmDialog
        open={logoutOpen}
        title="Log out?"
        message="You'll need to sign in again to access the ops dashboard."
        confirmLabel="Log out"
        danger
        loading={loggingOut}
        onConfirm={handleLogout}
        onCancel={() => setLogoutOpen(false)}
      />
    </div>
  );
}
