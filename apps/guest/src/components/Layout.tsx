import React from 'react';
import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';

export function Layout(): JSX.Element {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-gray-50">
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
