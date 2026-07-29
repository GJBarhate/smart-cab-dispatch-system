export function Card({
  className = '',
  children
}) {
  return <div className={`er-elev-1 rounded-2xl bg-surface p-4 ring-1 ring-line/70 ${className}`}>{children}</div>;
}
