// The provider of last resort. Never fails, never throws, never touches the network.
// distanceKm = haversine * HAVERSINE_ROAD_FACTOR ; seconds = distanceKm / avgSpeed * 3600
import { haversineKm, encodePolyline } from '../../../utils/geo';
import type { LatLng } from '../../../utils/geo';
import { env } from '../../../config/env';
import type { MatrixResult, RouteResult, RoutingProvider } from './types';

function estimate(a: LatLng, b: LatLng): { distanceMeters: number; durationSeconds: number } {
  const km = haversineKm(a, b) * env.HAVERSINE_ROAD_FACTOR;
  const hours = km / env.HAVERSINE_AVG_SPEED_KMPH;
  return { distanceMeters: Math.round(km * 1000), durationSeconds: Math.round(hours * 3600) };
}

export const haversineProvider: RoutingProvider = {
  name: 'haversine',

  async matrix(origins: LatLng[], dests: LatLng[]): Promise<MatrixResult> {
    const durations: number[][] = [];
    const distances: number[][] = [];
    for (const o of origins) {
      const durRow: number[] = [];
      const distRow: number[] = [];
      for (const d of dests) {
        const e = estimate(o, d);
        durRow.push(e.durationSeconds);
        distRow.push(e.distanceMeters);
      }
      durations.push(durRow);
      distances.push(distRow);
    }
    return { durations, distances };
  },

  async route(waypoints: LatLng[]): Promise<RouteResult> {
    if (waypoints.length < 2) {
      return { polyline: encodePolyline(waypoints), durationSeconds: 0, distanceMeters: 0, legs: [] };
    }
    let totalDistance = 0;
    let totalDuration = 0;
    const legs = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const e = estimate(waypoints[i], waypoints[i + 1]);
      totalDistance += e.distanceMeters;
      totalDuration += e.durationSeconds;
      legs.push({ distanceMeters: e.distanceMeters, durationSeconds: e.durationSeconds });
    }
    return { polyline: encodePolyline(waypoints), durationSeconds: totalDuration, distanceMeters: totalDistance, legs };
  }
};
