export function Card({
  className = '',
  interactive = false,
  children,
  ...rest
}) {
  const effects = interactive ? 'er-spotlight er-lift hover:border-ops-200' : '';
  return <div className={`er-elev-1 rounded-xl border border-line bg-surface ${effects} ${className}`} {...rest}>
      {children}
    </div>;
}
export function CardHeader({
  title,
  subtitle,
  action
}) {
  return <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>;
}
export function CardBody({
  className = '',
  children
}) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
