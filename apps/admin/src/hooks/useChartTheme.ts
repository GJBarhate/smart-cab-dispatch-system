import { useThemeStore } from '../store/themeStore';

/**
 * Recharts styles axes, grids and tooltips through inline SVG props, so it
 * cannot see the CSS theme tokens. This resolves the same palette in JS and
 * re-renders the charts whenever the theme changes.
 */
export interface ChartTheme {
  grid: string;
  axis: string;
  tick: string;
  tooltip: React.CSSProperties;
  series: { primary: string; secondary: string; positive: string; warning: string; danger: string };
}

const LIGHT: ChartTheme = {
  grid: '#e5e7eb',
  axis: '#e5e7eb',
  tick: '#6b7280',
  tooltip: {
    fontSize: 12,
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#111827'
  },
  series: { primary: '#6d28d9', secondary: '#a78bfa', positive: '#059669', warning: '#d97706', danger: '#dc2626' }
};

const DARK: ChartTheme = {
  grid: '#2a3240',
  axis: '#2a3240',
  tick: '#a3adbe',
  tooltip: {
    fontSize: 12,
    borderRadius: 8,
    border: '1px solid #2a3240',
    background: '#141922',
    color: '#e8ecf3'
  },
  // Lifted a step or two: the -600 hues that read as solid on white turn muddy
  // against a dark canvas.
  series: { primary: '#a78bfa', secondary: '#7c3aed', positive: '#34d399', warning: '#fbbf24', danger: '#f87171' }
};

export function useChartTheme(): ChartTheme {
  return useThemeStore((s) => s.theme) === 'dark' ? DARK : LIGHT;
}
