import React from 'react';
import { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
        <Icon className="h-7 w-7 text-brand-500" />
      </div>
      <p className="font-semibold text-gray-800">{title}</p>
      {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
