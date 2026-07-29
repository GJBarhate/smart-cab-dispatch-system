import { Inbox } from 'lucide-react';
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action
}) {
  return <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <Icon size={28} className="text-faint" />
      <p className="text-sm font-medium text-muted">{title}</p>
      {description && <p className="max-w-xs text-xs text-muted">{description}</p>}
      {action}
    </div>;
}
