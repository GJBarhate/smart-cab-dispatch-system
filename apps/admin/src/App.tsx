import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Login from './pages/Login';
import OpsDashboard from './pages/OpsDashboard';
import LiveOpsMapPage from './pages/LiveOpsMapPage';
import DriverManagement from './pages/DriverManagement';
import GuestManagement from './pages/GuestManagement';
import ApprovalInbox from './pages/ApprovalInbox';
import TripBoard from './pages/TripBoard';
import QueueMonitor from './pages/QueueMonitor';
import DispatchConsole from './pages/DispatchConsole';
import Analytics from './pages/Analytics';
import SettingsPage from './pages/SettingsPage';
import DriverHome from './pages/driver/DriverHome';
import { RequireAuth } from './components/RequireAuth';
import { RequireRole } from './components/RequireRole';
import { AdminShell } from './components/layout/AdminShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuthStore } from './store/authStore';
import { apiClient, registerUnauthorizedHandler } from './api/client';
import { useToast } from './components/ui/Toast';

const APP_NAME = (import.meta.env.VITE_APP_NAME as string) || 'EventRide Ops';

function NotFoundRedirect() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  if (!token) return <Navigate to="/login" replace />;
  return <Navigate to={role === 'driver' ? '/driver' : '/'} replace />;
}

function SessionWatcher() {
  const { push } = useToast();
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      push({ kind: 'warning', title: 'Session expired', description: 'Please sign in again.' });
    });
  }, [push]);
  return null;
}

function WarmupSplash({ children }: { children: React.ReactNode }) {
  const [waking, setWaking] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setWaking(true);
    }, 3000);

    apiClient
      .get('/health')
      .catch(() => null)
      .finally(() => {
        if (cancelled) return;
        window.clearTimeout(slowTimer);
        setWaking(false);
        setReady(true);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, []);

  if (!ready && waking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ops-50 text-center">
        <Loader2 className="animate-spin text-ops-600" size={28} />
        <p className="text-sm font-medium text-gray-700">Waking up the server…</p>
        <p className="max-w-xs text-xs text-gray-500">Free-tier hosting sleeps after idling — this can take up to a minute the first time.</p>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionWatcher />
      <WarmupSplash>
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<RequireAuth />}>
              <Route element={<RequireRole role="admin" />}>
                <Route element={<AdminShell />}>
                  <Route index element={<OpsDashboard />} />
                  <Route path="map" element={<LiveOpsMapPage />} />
                  <Route path="drivers" element={<DriverManagement />} />
                  <Route path="guests" element={<GuestManagement />} />
                  <Route path="requests" element={<ApprovalInbox />} />
                  <Route path="trips" element={<TripBoard />} />
                  <Route path="queue" element={<QueueMonitor />} />
                  <Route path="dispatch" element={<DispatchConsole />} />
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>

              <Route element={<RequireRole role="driver" />}>
                <Route path="driver" element={<DriverHome />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFoundRedirect />} />
          </Routes>
        </ErrorBoundary>
      </WarmupSplash>
      <p className="sr-only">{APP_NAME}</p>
    </BrowserRouter>
  );
}
