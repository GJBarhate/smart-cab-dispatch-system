import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center">
      <Icon size={28} className="text-gray-300" />
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description && <p className="max-w-xs text-xs text-gray-500">{description}</p>}
      {action}
    </div>
  );
}
