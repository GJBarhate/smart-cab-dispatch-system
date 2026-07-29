// Disabled state is one shared `opacity-50` on the base class rather than a
// washed-out colour per variant: a literal `-300` tint is a pale block on a
// dark canvas, while dimming the real colour reads correctly in both themes.
// The filled variants carry a gradient rather than a flat fill — the slight
// vertical shift is what separates a button that looks printed on from one that
// looks lit. `er-btn` adds the sheen pass on press; the flat variants skip it
// because they have no surface for the light to catch.
const variantClasses = {
  primary: 'er-btn bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-sm active:from-brand-600 active:to-brand-700',
  secondary: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 active:bg-brand-100',
  danger: 'er-btn bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm active:from-red-600 active:to-red-700',
  ghost: 'bg-transparent text-muted active:bg-elevated'
};
export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}) {
  return <button disabled={disabled || loading} className={`er-press min-h-[48px] rounded-xl px-5 font-semibold text-base
        transition-[background,transform,box-shadow,color] duration-150
        disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100
        ${fullWidth ? 'w-full' : ''} ${variantClasses[variant]} ${className}`} {...rest}>
      {loading ? <span className="inline-flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {children}
        </span> : children}
    </button>;
}
