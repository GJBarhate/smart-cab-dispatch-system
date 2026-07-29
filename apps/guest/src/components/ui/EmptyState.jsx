export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action
}) {
  return <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface p-8 text-center shadow-sm ring-1 ring-line/70">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
        <Icon className="h-7 w-7 text-brand-500" />
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>;
}
