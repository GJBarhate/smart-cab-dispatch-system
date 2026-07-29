import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SocketProvider } from './hooks/useSocket';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { ApiError, registerUnauthorizedHandler } from './api/client';
// Login stays eager — it is where every signed-out guest lands, so deferring it
// would only add a spinner before first paint.
import Login from './pages/Login';

// The rest are split per route. /track pulls in leaflet (155 kB); a guest who
// only checks their booking should never download it, and on a phone at an
// airport that difference is the whole first-load experience.
const Home = React.lazy(() => import('./pages/Home'));
const Track = React.lazy(() => import('./pages/Track'));
const Request = React.lazy(() => import('./pages/Request'));
const Trips = React.lazy(() => import('./pages/Trips'));
const Profile = React.lazy(() => import('./pages/Profile'));
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // A 4xx is deterministic — retrying re-asks a question already answered,
      // and on an expired session it just multiplies the failures racing the
      // redirect to /login. Only network blips (status 0) and 5xx get a second
      // attempt.
      retry: (failureCount, error) => {
        const status = error instanceof ApiError ? error.status : null;
        if (status !== null && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: true
    }
  }
});
function UnauthorizedRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    registerUnauthorizedHandler(() => navigate('/login', {
      replace: true
    }));
  }, [navigate]);
  return null;
}

/**
 * Shown while a route chunk is in flight. A centred spinner rather than a
 * full-screen takeover: the bottom nav stays put, so tapping between tabs never
 * makes the app look like it reloaded.
 */
function RouteFallback() {
  return <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>;
}
function AppRoutes() {
  return <React.Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/track" element={<Track />} />
            <Route path="/request" element={<Request />} />
            <Route path="/trips" element={<Trips />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </React.Suspense>;
}
export default function App() {
  return <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SocketProvider>
            <UnauthorizedRedirect />
            <AppRoutes />
          </SocketProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>;
}
