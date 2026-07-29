import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore';

/**
 * Light/dark switch. Rendered as a two-position segmented control rather than
 * a single icon button so the current theme is readable at a glance — on a
 * dark screen a lone sun icon is ambiguous about whether it shows the current
 * state or the action.
 */
export function ThemeToggle({
  compact = false
}) {
  const theme = useThemeStore(s => s.theme);
  const setTheme = useThemeStore(s => s.setTheme);
  const option = (value, Icon, label) => {
    const active = theme === value;
    return <button key={value} type="button" onClick={() => setTheme(value)} aria-label={`${label} theme`} aria-pressed={active} title={`${label} theme`} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-600 ${active ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-muted'}`}>
        <Icon size={14} />
        {!compact && label}
      </button>;
  };
  return <div role="group" aria-label="Colour theme" className="flex items-center gap-0.5 rounded-lg bg-elevated p-0.5">
      {option('light', Sun, 'Light')}
      {option('dark', Moon, 'Dark')}
    </div>;
}
