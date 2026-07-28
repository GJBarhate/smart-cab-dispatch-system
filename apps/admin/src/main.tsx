import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Leaflet's stylesheet and its default-icon fix used to be imported here. They
// now live in the map components themselves (LiveOpsMap / TripMap), because an
// import at this level put all of leaflet — 155 kB, 45 kB gzipped — into the
// initial bundle for every route, including the sign-in screen. Module bodies
// still evaluate before the component that imports them renders, so the
// "set up before any MapContainer mounts" guarantee is unchanged; it is now
// enforced by colocation rather than by a distant import in another file.
import './index.css';
import App from './App';
import { ApiError } from './api/client';
import { ToastProvider } from './components/ui/Toast';
import { SocketProvider } from './hooks/useSocket';
import { initTheme } from './store/themeStore';
import { initSpotlight } from './lib/spotlight';

// Reconciles the store with the class the inline bootstrap already applied and
// starts following the OS preference (until the user picks a theme by hand).
initTheme();

// One delegated pointer listener drives the highlight on every `.er-spotlight`
// card in the app. Started here rather than in a component so it is not tied to
// any subtree's mount/unmount — and so StrictMode's double-mount can't attach
// it twice.
initSpotlight();

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
      refetchOnWindowFocus: false
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SocketProvider>
          <App />
        </SocketProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
