import { forwardRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { Eye, EyeOff, AlertTriangle } from 'lucide-react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Password field with a reveal toggle and a Caps Lock warning.
 *
 * Revealing matters most exactly where this is used: an ops console signed into
 * on a venue laptop, often with a generated driver password being typed from a
 * phone screen. Without it the only feedback on a typo is a failed sign-in.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className = '', onKeyUp, onKeyDown, onBlur, ...rest },
  ref
) {
  const [visible, setVisible] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  // getModifierState is the only reliable read: there is no Caps Lock event, and
  // inferring it from character case breaks the moment Shift is held.
  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') setCapsOn(e.getModifierState('CapsLock'));
  };

  return (
    <div>
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          // pr-10 keeps the value clear of the button; without it a long
          // password runs underneath the icon.
          className={`input pr-10 ${className}`}
          onKeyUp={(e) => {
            readCaps(e);
            onKeyUp?.(e);
          }}
          onKeyDown={(e) => {
            readCaps(e);
            onKeyDown?.(e);
          }}
          onBlur={(e) => {
            // The warning is meaningless once focus has left the field.
            setCapsOn(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        <button
          type="button" // never "submit": inside a <form> the default would send it
          onClick={() => setVisible((v) => !v)}
          // The label carries the state, so a screen reader hears "Show
          // password" / "Hide password" rather than an unlabelled icon.
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          // Deliberately focusable: revealing a password you cannot see is a
          // keyboard user's problem more than anyone's.
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-faint transition-colors hover:bg-elevated hover:text-muted"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {capsOn && (
        // aria-live so it is announced when it appears rather than only on a
        // later focus pass.
        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-amber-700" role="status" aria-live="polite">
          <AlertTriangle size={11} className="shrink-0" />
          Caps Lock is on
        </p>
      )}
    </div>
  );
});
