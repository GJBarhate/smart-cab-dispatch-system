import React from 'react';

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }): JSX.Element {
  return <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 ${className}`}>{children}</div>;
}
