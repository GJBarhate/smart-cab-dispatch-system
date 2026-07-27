import type { ReactNode } from 'react';

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

const TONES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-ops-100 text-ops-700'
};

export function Badge({ tone = 'gray', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
