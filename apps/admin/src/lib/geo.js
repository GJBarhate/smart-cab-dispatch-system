// The coordinate-order firewall (plan.md §5.1 / §16.1), frontend side.
// GeoJSON from the API is always [longitude, latitude]. Leaflet always wants
// [latitude, longitude]. NO file outside this one may construct a raw
// coordinate tuple from a GeoPoint.

export function toLeafletTuple(point) {
  if (!point || !Array.isArray(point.coordinates)) return [0, 0];
  const [lng, lat] = point.coordinates;
  return [lat, lng];
}
export function isZeroPoint(point) {
  if (!point) return true;
  const [lng, lat] = point.coordinates ?? [0, 0];
  return lng === 0 && lat === 0;
}

/** Decodes an OSRM/Google-style encoded polyline (precision 5) into [lat, lng] pairs. */
export function decodePolyline(str, precision = 5) {
  if (!str) return [];
  const factor = 10 ** precision;
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}
export function haversineKm(a, b) {
  const toRad = d => d * Math.PI / 180;
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
