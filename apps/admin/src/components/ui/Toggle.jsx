export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  accent = 'ops'
}) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`inline-flex items-center gap-2 disabled:opacity-50 ${disabled ? 'cursor-not-allowed' : ''}`}>
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? accent === 'emerald' ? 'bg-emerald-600' : 'bg-ops-600' : 'bg-line'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
      </span>
      {label && <span className="text-sm text-muted">{label}</span>}
    </button>;
}
