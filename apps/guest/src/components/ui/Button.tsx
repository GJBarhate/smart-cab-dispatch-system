import React from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white active:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-brand-50 text-brand-700 active:bg-brand-100 disabled:text-brand-300',
  danger: 'bg-red-600 text-white active:bg-red-700 disabled:bg-red-300',
  ghost: 'bg-transparent text-gray-600 active:bg-gray-100 disabled:text-gray-300'
};

export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      disabled={disabled || loading}
      className={`min-h-[48px] rounded-xl px-5 font-semibold text-base transition-colors
        active:scale-[0.98] disabled:cursor-not-allowed
        ${fullWidth ? 'w-full' : ''} ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
