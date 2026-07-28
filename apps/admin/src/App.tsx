import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
// Login stays eager: it is the one route an unauthenticated visitor always
// lands on, so deferring it would only add a spinner before the first paint.
import Login from './pages/Login';

// Every authenticated route is split out. Statically importing them put all of
// recharts (370 kB) and leaflet into the initial module graph, so signing in
// downloaded the Analytics charts and the map even if you never opened either
// — and a driver downloaded the entire admin console to reach one screen.
const OpsDashboard = lazy(() => import('./pages/OpsDashboard'));
const LiveOpsMapPage = lazy(() => import('./pages/LiveOpsMapPage'));
const DriverManagement = lazy(() => import('./pages/DriverManagement'));
const GuestManagement = lazy(() => import('./pages/GuestManagement'));
const ApprovalInbox = lazy(() => import('./pages/ApprovalInbox'));
const TripBoard = lazy(() => import('./pages/TripBoard'));
const QueueMonitor = lazy(() => import('./pages/QueueMonitor'));
const DispatchConsole = lazy(() => import('./pages/DispatchConsole'));
const Analytics = lazy(() => import('./pages/Analytics'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DriverHome = lazy(() => import('./pages/driver/DriverHome'));
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
        <p className="text-sm font-medium text-muted">Waking up the server…</p>
        <p className="max-w-xs text-xs text-muted">Free-tier hosting sleeps after idling — this can take up to a minute the first time.</p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Shown while a route chunk is in flight. Deliberately quiet — on a warm cache
 * the chunk resolves in a frame or two, and a full-page spinner flashing on
 * every navigation would read as the app being slower, not faster.
 */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading page">
      <Loader2 className="animate-spin text-ops-500" size={22} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionWatcher />
      <WarmupSplash>
        <ErrorBoundary>
          {/* One boundary around the whole route table: each lazy route
              suspends independently, and the shell (sidebar/header) is not
              lazy, so only the page area shows the fallback. */}
          <Suspense fallback={<RouteFallback />}>
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
          </Suspense>
        </ErrorBoundary>
      </WarmupSplash>
      <p className="sr-only">{APP_NAME}</p>
    </BrowserRouter>
  );
}
