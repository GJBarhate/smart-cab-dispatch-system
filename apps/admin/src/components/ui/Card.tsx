import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Adds the pointer-tracked highlight and hover lift. Off by default: a card
   * that responds to the cursor implies it does something when clicked, so it
   * stays opt-in for the panels that genuinely are interactive.
   */
  interactive?: boolean;
}

export function Card({ className = '', interactive = false, children, ...rest }: CardProps) {
  const effects = interactive ? 'er-spotlight er-lift hover:border-ops-200' : '';
  return (
    <div className={`er-elev-1 rounded-xl border border-line bg-surface ${effects} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
