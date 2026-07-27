import { formatDistanceToNowStrict, format } from 'date-fns';

export function minutesAgo(iso?: string | null): number {
  if (!iso) return 0;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
}

export function fmtWaitMinutes(iso?: string | null): string {
  if (!iso) return '—';
  const min = minutesAgo(iso);
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'HH:mm');
  } catch {
    return '—';
  }
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'd MMM, HH:mm');
  } catch {
    return '—';
  }
}

export function fmtNum(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

export function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
