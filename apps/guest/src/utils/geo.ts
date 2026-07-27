// Coordinate-order firewall for the guest app (mirrors apps/server/src/utils/geo.ts).
// GeoJSON/Mongo is [lng, lat]. Leaflet wants [lat, lng]. No file outside this one
// should construct a raw coordinate tuple.
import type { GeoPoint } from '../shared';

export type LatLng = { lat: number; lng: number };

export const toLatLng = (g: GeoPoint | undefined | null): LatLng | null => {
  if (!g || !Array.isArray(g.coordinates)) return null;
  const [lng, lat] = g.coordinates;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
};

/** Leaflet wants [lat, lng] */
export const toLeafletTuple = (p: LatLng): [number, number] => [p.lat, p.lng];

export const geoPointToLeaflet = (g: GeoPoint | undefined | null): [number, number] | null => {
  const ll = toLatLng(g);
  return ll ? toLeafletTuple(ll) : null;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Bearing in degrees (0-360) for driver marker rotation */
export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/** Decodes an OSRM/Google-style encoded polyline (precision 5) into Leaflet [lat,lng] tuples */
export function decodePolylineToLeaflet(str: string, precision = 5): [number, number][] {
  if (!str) return [];
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: [number, number][] = [];

  while (index < str.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lat / factor, lng / factor]);
  }

  return coordinates;
}
