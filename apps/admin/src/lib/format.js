import { formatDistanceToNowStrict, format } from 'date-fns';
export function minutesAgo(iso) {
  if (!iso) return 0;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
}
export function fmtWaitMinutes(iso) {
  if (!iso) return '—';
  const min = minutesAgo(iso);
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
}
export function fmtRelative(iso) {
  if (!iso) return '—';
  try {
    return formatDistanceToNowStrict(new Date(iso), {
      addSuffix: true
    });
  } catch {
    return '—';
  }
}
export function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'HH:mm');
  } catch {
    return '—';
  }
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'd MMM, HH:mm');
  } catch {
    return '—';
  }
}
export function fmtNum(n, digits = 1) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}
export function titleCase(s) {
  return s.split(/[_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
