"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RoutingService = void 0;
var _geo = require("../../utils/geo");
var _env = require("../../config/env");
var _logger = require("../../config/logger");
var _CircuitBreaker = require("./CircuitBreaker");
var _DistanceCacheService = require("./DistanceCacheService");
var _haversine = require("./providers/haversine");
var _osrm = require("./providers/osrm");
var _ors = require("./providers/ors");
// Public routing facade — composes the provider fallback chain, the cache, and the
// circuit breakers into the single interface the rest of the app depends on (plan.md §7.1).
// Never throws: the haversine provider is the floor of the fallback chain.

const osrmBreaker = new _CircuitBreaker.CircuitBreaker();
const orsBreaker = new _CircuitBreaker.CircuitBreaker();
let lastProviderUsed = 'haversine';
let callsLast5Min = [];
function recordCall() {
  const now = Date.now();
  callsLast5Min.push(now);
  callsLast5Min = callsLast5Min.filter(t => now - t <= 5 * 60 * 1000);
}

/** Ordered [provider, breaker] pairs to try before falling back to haversine. */
function chain() {
  const links = [];
  if (_env.env.ROUTING_PROVIDER !== 'haversine') {
    links.push([_osrm.osrmProvider, osrmBreaker]);
  }
  if (_env.env.ORS_API_KEY) {
    links.push([_ors.orsProvider, orsBreaker]);
  }
  links.push([_haversine.haversineProvider, null]);
  return links;
}
async function withFallback(run) {
  let lastErr;
  for (const [provider, breaker] of chain()) {
    if (breaker?.isOpen()) continue;
    try {
      if (provider.name !== 'haversine') recordCall();
      const result = await run(provider);
      breaker?.recordSuccess();
      lastProviderUsed = provider.name;
      return {
        result,
        provider: provider.name
      };
    } catch (err) {
      lastErr = err;
      breaker?.recordFailure();
      // A provider failing is an expected, handled event — that is the entire
      // point of the fallback chain — so log the reason, not a stack trace.
      // Logging the full `err` here emitted ~30 lines per failure and, during
      // a public-OSRM outage, buried every real log line in the process under
      // thousands of identical undici frames.
      _logger.logger.warn({
        provider: provider.name,
        reason: err instanceof Error ? err.message : String(err),
        breakerOpen: breaker?.isOpen() ?? false
      }, 'routing provider failed, trying next in chain');
    }
  }
  // Unreachable in practice: haversine has no breaker and never throws.
  throw lastErr instanceof Error ? lastErr : new Error('all routing providers failed');
}
const RoutingService = {
  async matrix(origins, dests) {
    const {
      result
    } = await withFallback(provider => provider.matrix(origins, dests));
    return result;
  },
  async eta(from, to) {
    const cached = await _DistanceCacheService.DistanceCacheService.get(from, to);
    if (cached) {
      return {
        durationSeconds: cached.durationSeconds,
        distanceMeters: cached.distanceMeters,
        source: 'cache'
      };
    }
    const {
      result,
      provider
    } = await withFallback(p => p.matrix([from], [to]));
    const durationSeconds = result.durations[0]?.[0] ?? 0;
    const distanceMeters = result.distances[0]?.[0] ?? 0;
    await _DistanceCacheService.DistanceCacheService.set(from, to, {
      durationSeconds,
      distanceMeters,
      provider
    });
    return {
      durationSeconds,
      distanceMeters,
      source: provider
    };
  },
  async route(waypoints) {
    const {
      result
    } = await withFallback(provider => provider.route(waypoints));
    return result;
  },
  /**
   * Best visiting order for one pickup/drop set. Ordering uses haversine distance rather
   * than a routing call — this is a heuristic over a handful of nearby stops, and spending
   * an API call to sequence them would violate the "one /table call per tick" budget (§7.2).
   */
  async optimiseStopOrder(start, stops) {
    if (stops.length <= 1) return stops;
    if (stops.length <= 6) {
      return bruteForceOrder(start, stops);
    }
    return twoOpt(start, nearestNeighbourOrder(start, stops));
  },
  health() {
    return {
      provider: lastProviderUsed,
      breakerOpen: osrmBreaker.isOpen(),
      cacheHitRate: _DistanceCacheService.DistanceCacheService.stats().hitRate
    };
  },
  stats() {
    return {
      ..._DistanceCacheService.DistanceCacheService.stats(),
      callsLast5Min: callsLast5Min.length,
      osrmBreakerState: osrmBreaker.getState(),
      orsBreakerState: orsBreaker.getState()
    };
  }
};
exports.RoutingService = RoutingService;
function tourLength(start, order) {
  let total = 0;
  let prev = start;
  for (const stop of order) {
    total += (0, _geo.haversineKm)(prev, stop.location);
    prev = stop.location;
  }
  return total;
}
function bruteForceOrder(start, stops) {
  let best = stops;
  let bestLen = Infinity;
  const permute = (remaining, acc) => {
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
function nearestNeighbourOrder(start, stops) {
  const remaining = [...stops];
  const order = [];
  let current = start;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = (0, _geo.haversineKm)(current, remaining[i].location);
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
function twoOpt(start, order) {
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
