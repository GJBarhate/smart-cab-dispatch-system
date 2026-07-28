/** @type {import('tailwindcss').Config} */
// Same semantic-token approach as the admin app — see apps/admin/tailwind.config.js.
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
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a'
        }
      }
    }
  },
  plugins: []
};
