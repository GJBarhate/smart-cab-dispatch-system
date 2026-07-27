interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}

export function Slider({ label, value, min, max, step = 0.1, onChange, format, disabled }: Props) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-gray-600">
        <span>{label}</span>
        <span className="tabular-nums text-ops-700">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-ops-600 disabled:cursor-not-allowed"
      />
    </label>
  );
}
