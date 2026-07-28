/** @type {import('tailwindcss').Config} */
// Neutrals are semantic tokens backed by CSS variables (see src/index.css), not
// literal greys. `bg-surface` means "a card" in either theme, so switching
// themes is one class on <html> rather than a `dark:` variant on every element.
// The channel triplet form keeps Tailwind's /opacity modifiers working.
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('--c-canvas'),
        surface: token('--c-surface'),
        elevated: token('--c-elevated'),
        line: token('--c-line'),
        'line-soft': token('--c-line-soft'),
        ink: token('--c-ink'),
        muted: token('--c-muted'),
        faint: token('--c-faint'),
        ops: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#4c1d95',
          900: '#3b1878'
        }
      }
    }
  },
  plugins: []
};
