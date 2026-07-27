// OpenRouteService — optional fallback (2,000 directions/day free), only used when
// ORS_API_KEY is set and OSRM has failed. See plan.md §7.4 fallback chain.
import type { LatLng } from '../../../utils/geo';
import { env } from '../../../config/env';
import { UpstreamError } from '../../../utils/errors';
import type { MatrixResult, RouteResult, RoutingProvider } from './types';

const BASE_URL = 'https://api.openrouteservice.org/v2';

async function postJson(path: string, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ROUTING_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: env.ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) throw new UpstreamError(`ORS responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const orsProvider: RoutingProvider = {
  name: 'ors',

  async matrix(origins: LatLng[], dests: LatLng[]): Promise<MatrixResult> {
    const locations = [...origins, ...dests].map((p) => [p.lng, p.lat]);
    const sources = origins.map((_, i) => i);
    const destinations = dests.map((_, i) => origins.length + i);

    const json = await postJson('/matrix/driving-car', {
      locations,
      sources,
      destinations,
      metrics: ['distance', 'duration']
    });

    return { durations: json.durations, distances: json.distances };
  },

  async route(waypoints: LatLng[]): Promise<RouteResult> {
    const json = await postJson('/directions/driving-car', {
      coordinates: waypoints.map((p) => [p.lng, p.lat])
    });

    const route = json.routes?.[0];
    if (!route) throw new UpstreamError('ORS returned no route');

    const legs = (route.segments ?? []).map((seg: any) => ({
      distanceMeters: seg.distance,
      durationSeconds: seg.duration
    }));

    return {
      polyline: route.geometry,
      durationSeconds: route.summary.duration,
      distanceMeters: route.summary.distance,
      legs
    };
  }
};
