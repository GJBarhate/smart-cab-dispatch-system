import React from 'react';

// A travelling sweep rather than a pulse: it reads as "on its way" instead of
// "something is here".
export function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`er-shimmer rounded-lg bg-line-soft ${className}`} />;
}

export function CardSkeleton(): JSX.Element {
  return (
    <div className="er-elev-1 rounded-2xl bg-surface p-4 ring-1 ring-line/70">
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
