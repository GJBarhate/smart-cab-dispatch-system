// A sweep rather than a pulse: a pulsing block reads as "something is here",
// a travelling highlight reads as "something is on its way".
export function Skeleton({
  className = ''
}) {
  return <div className={`er-shimmer rounded bg-line-soft ${className}`} />;
}
export function SkeletonRows({
  rows = 4,
  className = ''
}) {
  return <div className={`space-y-2 ${className}`}>
      {Array.from({
      length: rows
    }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>;
}
export function SkeletonCard() {
  return <div className="er-elev-1 rounded-xl border border-line bg-surface p-4">
      <Skeleton className="mb-3 h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
    </div>;
}
