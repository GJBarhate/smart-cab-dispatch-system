// The inset ring is what makes a pill read as a discrete object rather than a
// coloured patch of the surface behind it, and it survives both themes where a
// drop shadow at this size would not.
const toneClasses = {
  neutral: 'bg-elevated text-muted ring-1 ring-inset ring-line',
  brand: 'bg-brand-100 text-brand-700 ring-1 ring-inset ring-brand-200',
  success: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  warning: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200',
  danger: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-200'
};
export function Badge({
  tone = 'neutral',
  children
}) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses[tone]}`}>{children}</span>;
}
