// Four-layer cost-control strategy (plan.md §7.2):
//   1. Static Location<->Location grid, precomputed once at seed, never expires.
//   2. L1 in-memory LRU in front of Mongo.
//   3. L2 Mongo DistanceCache keyed by geohash-7 buckets (~153m x 153m) so a driver
//      crawling in traffic reuses the same cache entry instead of firing a request per GPS ping.
//   4. Batching — handled by RoutingService.matrix(), one /table call per tick.
import { LRUCache } from 'lru-cache';
import ngeohash from 'ngeohash';
import { DistanceCache } from '../../models/DistanceCache';
import { env } from '../../config/env';
import type { LatLng } from '../../utils/geo';

export interface CachedEta {
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
}

const GEOHASH_PRECISION = 7;

const l1 = new LRUCache<string, CachedEta>({ max: 5000, ttl: 5 * 60 * 1000 });

let hits = 0;
let misses = 0;

function geohashOf(p: LatLng): string {
  return ngeohash.encode(p.lat, p.lng, GEOHASH_PRECISION);
}

export function buildCacheKey(a: LatLng, b: LatLng): string {
  return `${geohashOf(a)}|${geohashOf(b)}|driving`;
}

export const DistanceCacheService = {
  async get(a: LatLng, b: LatLng): Promise<CachedEta | null> {
    const key = buildCacheKey(a, b);

    const fromL1 = l1.get(key);
    if (fromL1) {
      hits++;
      return fromL1;
    }

    const doc = await DistanceCache.findOne({ key }).lean();
    if (doc && (doc.isStatic || !doc.expiresAt || doc.expiresAt.getTime() > Date.now())) {
      hits++;
      const value: CachedEta = { distanceMeters: doc.distanceMeters, durationSeconds: doc.durationSeconds, provider: doc.provider };
      l1.set(key, value);
      return value;
    }

    misses++;
    return null;
  },

  async set(a: LatLng, b: LatLng, value: CachedEta, opts: { isStatic?: boolean } = {}): Promise<void> {
    const key = buildCacheKey(a, b);
    l1.set(key, value);

    const isStatic = opts.isStatic ?? false;
    await DistanceCache.updateOne(
      { key },
      {
        $set: {
          key,
          distanceMeters: value.distanceMeters,
          durationSeconds: value.durationSeconds,
          provider: value.provider,
          isStatic,
          expiresAt: isStatic ? null : new Date(Date.now() + env.ROUTING_CACHE_TTL_SEC * 1000)
        }
      },
      { upsert: true }
    );
  },

  stats() {
    const total = hits + misses;
    return { hits, misses, hitRate: total === 0 ? 0 : hits / total };
  },

  resetStats() {
    hits = 0;
    misses = 0;
  }
};
