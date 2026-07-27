export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  accent = 'ops'
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  accent?: 'ops' | 'emerald';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 disabled:opacity-50 ${disabled ? 'cursor-not-allowed' : ''}`}
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? (accent === 'emerald' ? 'bg-emerald-600' : 'bg-ops-600') : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
      {label && <span className="text-sm text-gray-700">{label}</span>}
    </button>
  );
}
