// Public routing facade — composes the provider fallback chain, the cache, and the
// circuit breakers into the single interface the rest of the app depends on (plan.md §7.1).
// Never throws: the haversine provider is the floor of the fallback chain.
import { haversineKm } from '../../utils/geo';
import type { LatLng } from '../../utils/geo';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { CircuitBreaker } from './CircuitBreaker';
import { DistanceCacheService } from './DistanceCacheService';
import { haversineProvider } from './providers/haversine';
import { osrmProvider } from './providers/osrm';
import { orsProvider } from './providers/ors';
import type { MatrixResult, RouteResult, RoutingProvider } from './providers/types';

export interface Stop {
  id: string;
  location: LatLng;
}

export interface EtaResult {
  durationSeconds: number;
  distanceMeters: number;
  source: string;
}

const osrmBreaker = new CircuitBreaker();
const orsBreaker = new CircuitBreaker();

let lastProviderUsed = 'haversine';
let callsLast5Min: number[] = [];

function recordCall(): void {
  const now = Date.now();
  callsLast5Min.push(now);
  callsLast5Min = callsLast5Min.filter((t) => now - t <= 5 * 60 * 1000);
}

/** Ordered [provider, breaker] pairs to try before falling back to haversine. */
function chain(): Array<[RoutingProvider, CircuitBreaker | null]> {
  const links: Array<[RoutingProvider, CircuitBreaker | null]> = [];
  if (env.ROUTING_PROVIDER !== 'haversine') {
    links.push([osrmProvider, osrmBreaker]);
  }
  if (env.ORS_API_KEY) {
    links.push([orsProvider, orsBreaker]);
  }
  links.push([haversineProvider, null]);
  return links;
}

async function withFallback<T>(run: (provider: RoutingProvider) => Promise<T>): Promise<{ result: T; provider: string }> {
  let lastErr: unknown;
  for (const [provider, breaker] of chain()) {
    if (breaker?.isOpen()) continue;
    try {
      if (provider.name !== 'haversine') recordCall();
      const result = await run(provider);
      breaker?.recordSuccess();
      lastProviderUsed = provider.name;
      return { result, provider: provider.name };
    } catch (err) {
      lastErr = err;
      breaker?.recordFailure();
      logger.warn({ err, provider: provider.name }, 'routing provider failed, trying next in chain');
    }
  }
  // Unreachable in practice: haversine has no breaker and never throws.
  throw lastErr instanceof Error ? lastErr : new Error('all routing providers failed');
}

export const RoutingService = {
  async matrix(origins: LatLng[], dests: LatLng[]): Promise<MatrixResult> {
    const { result } = await withFallback((provider) => provider.matrix(origins, dests));
    return result;
  },

  async eta(from: LatLng, to: LatLng): Promise<EtaResult> {
    const cached = await DistanceCacheService.get(from, to);
    if (cached) {
      return { durationSeconds: cached.durationSeconds, distanceMeters: cached.distanceMeters, source: 'cache' };
    }

    const { result, provider } = await withFallback((p) => p.matrix([from], [to]));
    const durationSeconds = result.durations[0]?.[0] ?? 0;
    const distanceMeters = result.distances[0]?.[0] ?? 0;

    await DistanceCacheService.set(from, to, { durationSeconds, distanceMeters, provider });
    return { durationSeconds, distanceMeters, source: provider };
  },

  async route(waypoints: LatLng[]): Promise<RouteResult> {
    const { result } = await withFallback((provider) => provider.route(waypoints));
    return result;
  },

  /**
   * Best visiting order for one pickup/drop set. Ordering uses haversine distance rather
   * than a routing call — this is a heuristic over a handful of nearby stops, and spending
   * an API call to sequence them would violate the "one /table call per tick" budget (§7.2).
   */
  async optimiseStopOrder(start: LatLng, stops: Stop[]): Promise<Stop[]> {
    if (stops.length <= 1) return stops;

    if (stops.length <= 6) {
      return bruteForceOrder(start, stops);
    }
    return twoOpt(start, nearestNeighbourOrder(start, stops));
  },

  health(): { provider: string; breakerOpen: boolean; cacheHitRate: number } {
    return {
      provider: lastProviderUsed,
      breakerOpen: osrmBreaker.isOpen(),
      cacheHitRate: DistanceCacheService.stats().hitRate
    };
  },

  stats() {
    return {
      ...DistanceCacheService.stats(),
      callsLast5Min: callsLast5Min.length,
      osrmBreakerState: osrmBreaker.getState(),
      orsBreakerState: orsBreaker.getState()
    };
  }
};

function tourLength(start: LatLng, order: Stop[]): number {
  let total = 0;
  let prev = start;
  for (const stop of order) {
    total += haversineKm(prev, stop.location);
    prev = stop.location;
  }
  return total;
}

function bruteForceOrder(start: LatLng, stops: Stop[]): Stop[] {
  let best = stops;
  let bestLen = Infinity;

  const permute = (remaining: Stop[], acc: Stop[]): void => {
    if (remaining.length === 0) {
      const len = tourLength(start, acc);
      if (len < bestLen) {
        bestLen = len;
        best = acc;
      }
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      const next = remaining[i];
      const rest = [...remaining.slice(0, i), ...remaining.slice(i + 1)];
      permute(rest, [...acc, next]);
    }
  };

  permute(stops, []);
  return best;
}

function nearestNeighbourOrder(start: LatLng, stops: Stop[]): Stop[] {
  const remaining = [...stops];
  const order: Stop[] = [];
  let current = start;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i].location);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    order.push(next);
    current = next.location;
  }

  return order;
}

function twoOpt(start: LatLng, order: Stop[]): Stop[] {
  let improved = true;
  let route = order;

  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const candidate = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
        if (tourLength(start, candidate) < tourLength(start, route)) {
          route = candidate;
          improved = true;
        }
      }
    }
  }

  return route;
}
