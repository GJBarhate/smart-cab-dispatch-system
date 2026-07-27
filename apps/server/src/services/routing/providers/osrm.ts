// Public OSRM demo server: no key, no cost, no SLA, /table capped at ~10,000 cells.
// /table returns durations in SECONDS and distances in METRES, only when
// annotations=duration,distance is passed (plan.md §16.27).
import { toOsrmCoords, decodePolyline } from '../../../utils/geo';
import type { LatLng } from '../../../utils/geo';
import { env } from '../../../config/env';
import { UpstreamError } from '../../../utils/errors';
import type { MatrixResult, RouteResult, RoutingProvider } from './types';

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ROUTING_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new UpstreamError(`OSRM responded ${res.status}`);
    const json = (await res.json()) as any;
    if (json.code !== 'Ok') throw new UpstreamError(`OSRM error: ${json.code} ${json.message ?? ''}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function tableChunk(origins: LatLng[], dests: LatLng[]): Promise<MatrixResult> {
  const combined = [...origins, ...dests];
  const sources = origins.map((_, i) => i).join(';');
  const destinations = dests.map((_, i) => origins.length + i).join(';');
  const coords = toOsrmCoords(combined);
  const url = `${env.OSRM_BASE_URL}/table/v1/driving/${coords}?sources=${sources}&destinations=${destinations}&annotations=duration,distance`;

  const json = await fetchJson(url);
  const durations: number[][] = json.durations;
  const distances: number[][] = json.distances ?? durations.map((row: number[]) => row.map(() => 0));
  return { durations, distances };
}

export const osrmProvider: RoutingProvider = {
  name: 'osrm',

  async matrix(origins: LatLng[], dests: LatLng[]): Promise<MatrixResult> {
    const totalCells = origins.length * dests.length;
    if (totalCells === 0) return { durations: [], distances: [] };

    if (totalCells <= env.OSRM_MAX_MATRIX_CELLS) {
      return tableChunk(origins, dests);
    }

    // Chunk along the destination axis to stay under the cell cap.
    const maxDestsPerChunk = Math.max(1, Math.floor(env.OSRM_MAX_MATRIX_CELLS / origins.length));
    const durations: number[][] = origins.map(() => []);
    const distances: number[][] = origins.map(() => []);

    for (let i = 0; i < dests.length; i += maxDestsPerChunk) {
      const chunkDests = dests.slice(i, i + maxDestsPerChunk);
      const chunkResult = await tableChunk(origins, chunkDests);
      chunkResult.durations.forEach((row, r) => durations[r].push(...row));
      chunkResult.distances.forEach((row, r) => distances[r].push(...row));
    }

    return { durations, distances };
  },

  async route(waypoints: LatLng[]): Promise<RouteResult> {
    const coords = toOsrmCoords(waypoints);
    const url = `${env.OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=polyline&annotations=duration,distance`;
    const json = await fetchJson(url);
    const route = json.routes?.[0];
    if (!route) throw new UpstreamError('OSRM returned no route');

    const legs = (route.legs ?? []).map((leg: any) => ({
      distanceMeters: leg.distance,
      durationSeconds: leg.duration
    }));

    return {
      polyline: route.geometry,
      durationSeconds: route.duration,
      distanceMeters: route.distance,
      legs
    };
  }
};

// Exported for tests that want to sanity-check the decoded shape without a network call.
export const _decode = decodePolyline;
