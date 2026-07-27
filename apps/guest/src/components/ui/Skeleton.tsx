import React from 'react';

export function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} />;
}

export function CardSkeleton(): JSX.Element {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-8 w-2/3" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-4/5" />
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
