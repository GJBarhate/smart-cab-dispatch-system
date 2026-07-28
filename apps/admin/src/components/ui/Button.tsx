import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

// The filled variants carry a gradient rather than a flat fill — a very slight
// vertical shift is what separates a button that looks printed on from one that
// looks lit. `er-btn` adds the sheen sweep and press response; the outline
// variants skip it because they have no surface for light to catch.
const VARIANTS: Record<Variant, string> = {
  primary: 'er-btn bg-gradient-to-b from-ops-500 to-ops-600 text-white shadow-sm hover:from-ops-600 hover:to-ops-700',
  secondary: 'bg-surface text-muted border border-line hover:bg-elevated hover:border-faint',
  danger: 'er-btn bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm hover:from-red-600 hover:to-red-700',
  success: 'er-btn bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm hover:from-emerald-600 hover:to-emerald-700',
  ghost: 'bg-transparent text-muted hover:bg-elevated'
};

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-3 text-base'
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', loading, disabled, className = '', children, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[background,transform,box-shadow,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:transform-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
);
Button.displayName = 'Button';
