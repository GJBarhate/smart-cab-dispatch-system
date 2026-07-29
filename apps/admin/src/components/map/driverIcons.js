import L from 'leaflet';
export const DRIVER_STATUS_COLOR = {
  idle: '#059669',
  // emerald — available
  assigned: '#2563eb',
  // blue — offered/accepted, not moving
  en_route_pickup: '#2563eb',
  at_pickup: '#d97706',
  // amber
  on_trip: '#7c3aed',
  // ops purple — guest aboard
  on_break: '#6b7280',
  // gray
  offline: '#9ca3af',
  suspended: '#dc2626' // red
};
export const DRIVER_STATUS_LABEL = {
  idle: 'Idle',
  assigned: 'Assigned',
  en_route_pickup: 'En route to pickup',
  at_pickup: 'At pickup',
  on_trip: 'On trip',
  on_break: 'On break',
  offline: 'Offline',
  suspended: 'Suspended'
};
const cache = new Map();
export function carDivIcon(status, heading = 0) {
  const key = `${status}:${Math.round(heading / 10) * 10}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const color = DRIVER_STATUS_COLOR[status] ?? '#6b7280';
  const html = `
    <div style="transform: rotate(${heading}deg); width:26px; height:26px; display:flex; align-items:center; justify-content:center;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1">
        <path d="M12 2 L20 20 L12 16 L4 20 Z" />
      </svg>
    </div>`;
  const icon = L.divIcon({
    html,
    className: 'eventride-driver-marker',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
  cache.set(key, icon);
  return icon;
}
export function pinDivIcon(color, pulse = false) {
  const key = `pin:${color}:${pulse}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const icon = L.divIcon({
    html: `<div class="${pulse ? 'eventride-pulse' : ''}" style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px ${color};"></div>`,
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
  cache.set(key, icon);
  return icon;
}
