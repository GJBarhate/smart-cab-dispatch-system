import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SocketProvider } from './hooks/useSocket';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { registerUnauthorizedHandler } from './api/client';
import Login from './pages/Login';
import Home from './pages/Home';
import Track from './pages/Track';
import Request from './pages/Request';
import Trips from './pages/Trips';
import Profile from './pages/Profile';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true
    }
  }
});

function UnauthorizedRedirect(): null {
  const navigate = useNavigate();
  useEffect(() => {
    registerUnauthorizedHandler(() => navigate('/login', { replace: true }));
  }, [navigate]);
  return null;
}

function AppRoutes(): JSX.Element {
  return (
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
  );
}

export default function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SocketProvider>
            <UnauthorizedRedirect />
            <AppRoutes />
          </SocketProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
