import React from 'react';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  brand: 'bg-brand-100 text-brand-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700'
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }): JSX.Element {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses[tone]}`}>{children}</span>;
}
