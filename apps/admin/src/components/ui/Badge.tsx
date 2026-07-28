import type { ReactNode } from 'react';

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

// The inset ring is what makes a pill read as a discrete object rather than a
// coloured patch of the surface behind it — it survives both themes, where a
// drop shadow at this size would not.
const TONES: Record<Tone, string> = {
  gray: 'bg-elevated text-muted ring-1 ring-inset ring-line',
  green: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  amber: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200',
  red: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-200',
  blue: 'bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200',
  purple: 'bg-ops-100 text-ops-700 ring-1 ring-inset ring-ops-100'
};

export function Badge({ tone = 'gray', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
