import React from 'react';
import { Outlet } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { BottomNav } from './BottomNav';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function Layout(): JSX.Element {
  const online = useOnlineStatus();

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-canvas">
      {/* Event venues have patchy signal. Saying so explicitly beats letting
          every screen quietly show stale data with no explanation. */}
      {!online && (
        <div
          role="status"
          className="flex items-center justify-center gap-1.5 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800"
        >
          <WifiOff className="h-3.5 w-3.5" />
          You&apos;re offline — showing your last update
        </div>
      )}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
