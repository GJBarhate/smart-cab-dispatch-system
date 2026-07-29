import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import { useEffect } from 'react';
// See LiveOpsMap: leaflet's CSS and icon fix ship with the map chunk.
import 'leaflet/dist/leaflet.css';
import './leafletSetup';
import { toLeafletTuple, decodePolyline, isZeroPoint } from '../../lib/geo';
import { carDivIcon, pinDivIcon } from './driverIcons';
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors';
function AutoFit({
  points
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(points, {
      padding: [30, 30],
      maxZoom: 15
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.map(p => p.join(',')).join('|')]);
  return null;
}
export function TripMap({
  driverPosition,
  heading = 0,
  stops,
  polyline
}) {
  const decoded = useMemo(() => polyline ? decodePolyline(polyline) : [], [polyline]);
  const pendingStops = stops.filter(s => s.status !== 'done');
  const points = useMemo(() => {
    const pts = [];
    if (driverPosition) pts.push(driverPosition);
    pendingStops.forEach(s => {
      if (!isZeroPoint(s.coordinates)) pts.push(toLeafletTuple(s.coordinates));
    });
    return pts;
  }, [driverPosition, pendingStops]);
  return <MapContainer center={points[0] ?? [18.559, 73.8]} zoom={13} style={{
    height: '100%',
    width: '100%'
  }} scrollWheelZoom={false}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <AutoFit points={points} />
      {driverPosition && <Marker position={driverPosition} icon={carDivIcon('en_route_pickup', heading)} />}
      {pendingStops.map((s, i) => isZeroPoint(s.coordinates) ? null : <Marker key={`${s.seq}-${i}`} position={toLeafletTuple(s.coordinates)} icon={pinDivIcon(s.kind === 'pickup' ? '#d97706' : '#059669')} />)}
      {decoded.length > 1 && <Polyline positions={decoded} pathOptions={{
      color: '#6d28d9',
      weight: 4,
      opacity: 0.8
    }} />}
    </MapContainer>;
}
