import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import './components/map/leafletSetup'; // §16.7 — fix Leaflet's default marker icon once, globally, before any map mounts
import './index.css';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { SocketProvider } from './hooks/useSocket';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
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
