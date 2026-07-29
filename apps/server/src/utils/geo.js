"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.bearing = bearing;
exports.decodePolyline = decodePolyline;
exports.encodePolyline = encodePolyline;
exports.haversineKm = haversineKm;
exports.pointAlongPath = pointAlongPath;
exports.toOsrmCoords = exports.toLeafletTuple = exports.toLatLng = exports.toGeoPoint = void 0;
// The coordinate-order firewall. GeoJSON/Mongo is [lng, lat]; Leaflet is [lat, lng];
// OSRM URLs want "lng,lat". No file outside this one may construct a raw coordinate array.

// [lng, lat]

const toGeoPoint = p => ({
  type: 'Point',
  coordinates: [p.lng, p.lat]
});
exports.toGeoPoint = toGeoPoint;
const toLatLng = g => ({
  lat: g.coordinates[1],
  lng: g.coordinates[0]
});

/** Leaflet wants [lat, lng] */
exports.toLatLng = toLatLng;
const toLeafletTuple = p => [p.lat, p.lng];

/** OSRM wants "lng,lat;lng,lat" */
exports.toLeafletTuple = toLeafletTuple;
const toOsrmCoords = pts => pts.map(p => `${p.lng},${p.lat}`).join(';');
exports.toOsrmCoords = toOsrmCoords;
const EARTH_RADIUS_KM = 6371;
const toRad = deg => deg * Math.PI / 180;
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/** Bearing in degrees (0-360) for driver marker rotation */
function bearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const theta = Math.atan2(y, x);
  return (theta * 180 / Math.PI + 360) % 360;
}

/** Interpolate along a path of points (equal-weighted segments) — used by the simulator */
function pointAlongPath(path, fraction) {
  if (path.length === 0) throw new Error('pointAlongPath: empty path');
  if (path.length === 1) return path[0];
  const clamped = Math.min(1, Math.max(0, fraction));
  const segLengths = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const len = haversineKm(path[i], path[i + 1]);
    segLengths.push(len);
    total += len;
  }
  if (total === 0) return path[0];
  const targetDist = clamped * total;
  let covered = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (covered + segLen >= targetDist || i === segLengths.length - 1) {
      const segFraction = segLen === 0 ? 0 : (targetDist - covered) / segLen;
      const a = path[i];
      const b = path[i + 1];
      return {
        lat: a.lat + (b.lat - a.lat) * segFraction,
        lng: a.lng + (b.lng - a.lng) * segFraction
      };
    }
    covered += segLen;
  }
  return path[path.length - 1];
}

/** Decodes an OSRM/Google-style encoded polyline (precision 5 by default) */
function decodePolyline(str, precision = 5) {
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  while (index < str.length) {
    let result = 1;
    let shift = 0;
    let b;
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
    coordinates.push({
      lat: lat / factor,
      lng: lng / factor
    });
  }
  return coordinates;
}

/** Encodes a path back into a polyline string — used when we synthesise a route (haversine fallback) */
function encodePolyline(points, precision = 5) {
  const factor = Math.pow(10, precision);
  let output = '';
  let prevLat = 0;
  let prevLng = 0;
  const encodeNumber = num => {
    let sgn_num = num << 1;
    if (num < 0) sgn_num = ~sgn_num;
    let value = sgn_num;
    let out = '';
    while (value >= 0x20) {
      out += String.fromCharCode((0x20 | value & 0x1f) + 63);
      value >>= 5;
    }
    out += String.fromCharCode(value + 63);
    return out;
  };
  for (const point of points) {
    const lat = Math.round(point.lat * factor);
    const lng = Math.round(point.lng * factor);
    output += encodeNumber(lat - prevLat);
    output += encodeNumber(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return output;
}
